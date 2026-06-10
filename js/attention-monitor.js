/* ==========================================================================
   attention-monitor.js
   Webcam attention detection using MediaPipe FaceMesh (loaded via CDN in
   index.html). Answers ONE question reliably:
       "Is the user looking at the screen, or not?"
   It does NOT estimate exact x/y gaze (webcam gaze is too noisy for that).

   Signals used per frame:
     1. Face present at all          -> if not: FACE_NOT_FOUND
     2. Head yaw (turned left/right) -> if too far: DISTRACTED
     3. Head pitch (looking down/up) -> if too far: DISTRACTED
     4. Iris offset inside the eye   -> if eyes clearly off-screen: DISTRACTED
     5. Eyes closed (EAR)            -> if sustained: DISTRACTED

   Emits states: "OFF" | "CALIBRATING" | "ATTENTIVE" | "DISTRACTED" | "FACE_NOT_FOUND"
   ========================================================================== */

const AttentionMonitor = (() => {
  const S = {
    running: false,
    faceMesh: null,
    camera: null,
    state: "OFF",
    lastFaceSeenAt: 0,
    lastResultAt: 0,      // last time onResults fired at all (watchdog)
    gotFirstResult: false,
    framesSeen: 0,
    watchdog: null,
    // smoothing buffers
    yawBuf: [],
    pitchBuf: [],
    gazeBuf: [],
  };

  // Tunable thresholds (calibrated for a laptop webcam at ~50–70 cm)
  const THRESH = {
    yaw: 0.30,        // |normalized yaw| above this = head turned away
    pitchDown: 0.42,  // looking down at phone/desk
    pitchUp: -0.18,   // looking up over the screen
    gaze: 0.30,       // iris horizontal offset from eye center
    earClosed: 0.16,  // eye aspect ratio below this = eyes closed
    faceLostMs: 600,  // no face for this long = FACE_NOT_FOUND
    calibFrames: 20,  // frames before we trust the signal
    smooth: 6,        // moving-average window
  };

  let onState = null; // callback(state)

  function setState(s) {
    if (s === S.state) return;
    S.state = s;
    if (onState) onState(s);
  }

  function avgPush(buf, v) {
    buf.push(v);
    if (buf.length > THRESH.smooth) buf.shift();
    return buf.reduce((a, b) => a + b, 0) / buf.length;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /* Eye Aspect Ratio for one eye (vertical opening / horizontal width). */
  function eyeAspect(lm, top, bottom, left, right) {
    const w = dist(lm[left], lm[right]);
    return w > 0 ? dist(lm[top], lm[bottom]) / w : 0;
  }

  function analyze(landmarks) {
    // ---- Head yaw: nose tip vs. midpoint between cheeks, normalised by face width
    const nose = landmarks[1];
    const lCheek = landmarks[234];
    const rCheek = landmarks[454];
    const faceW = dist(lCheek, rCheek);
    const midX = (lCheek.x + rCheek.x) / 2;
    const yaw = avgPush(S.yawBuf, faceW > 0 ? (nose.x - midX) / faceW : 0);

    // ---- Head pitch: nose tip vs. eye line, normalised by face width
    const eyeMidY = (landmarks[33].y + landmarks[263].y) / 2;
    const pitch = avgPush(S.pitchBuf, faceW > 0 ? (nose.y - eyeMidY) / faceW : 0);

    // ---- Iris gaze (FaceMesh refineLandmarks gives iris points 468 & 473)
    let gaze = 0;
    if (landmarks.length > 473) {
      const lIris = landmarks[468], rIris = landmarks[473];
      const lOff = irisOffset(landmarks, lIris, 33, 133);   // left eye corners
      const rOff = irisOffset(landmarks, rIris, 362, 263);  // right eye corners
      gaze = avgPush(S.gazeBuf, (lOff + rOff) / 2);
    }

    // ---- Eyes closed?
    const earL = eyeAspect(landmarks, 159, 145, 33, 133);
    const earR = eyeAspect(landmarks, 386, 374, 362, 263);
    const eyesClosed = (earL + earR) / 2 < THRESH.earClosed;

    const lookingAway =
      Math.abs(yaw) > THRESH.yaw ||
      pitch > THRESH.pitchDown ||
      pitch < THRESH.pitchUp ||
      Math.abs(gaze) > THRESH.gaze ||
      eyesClosed;

    return { yaw, pitch, gaze, eyesClosed, lookingAway };
  }

  /* Horizontal iris position within the eye, -0.5 .. +0.5 (0 = centered). */
  function irisOffset(lm, iris, innerIdx, outerIdx) {
    const a = lm[innerIdx], b = lm[outerIdx];
    const w = b.x - a.x;
    if (Math.abs(w) < 1e-6) return 0;
    return (iris.x - a.x) / w - 0.5;
  }

  function onResults(results) {
    try {
      S.lastResultAt = performance.now();
      if (!S.gotFirstResult) {
        S.gotFirstResult = true;
        console.info("[AttentionMonitor] FaceMesh is running — first results received.");
      }

      const video = document.getElementById("webcamVideo");
      const canvas = document.getElementById("camOverlay");
      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const faces = results.multiFaceLandmarks;

      if (faces && faces.length > 0) {
        S.lastFaceSeenAt = performance.now();
        S.framesSeen++;
        const lm = faces[0];
        const a = analyze(lm);

        // Draw a minimal eye-line indicator on the preview
        ctx.strokeStyle = a.lookingAway ? "#ffb020" : "#34c759";
        ctx.lineWidth = 2;
        const p1 = lm[33], p2 = lm[263];
        ctx.beginPath();
        ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
        ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
        ctx.stroke();

        if (S.framesSeen < THRESH.calibFrames) {
          setState("CALIBRATING");
        } else {
          setState(a.lookingAway ? "DISTRACTED" : "ATTENTIVE");
        }
      }
      // No-face handling lives in the watchdog so it works even
      // if results stop arriving entirely.
    } catch (err) {
      console.error("[AttentionMonitor] onResults error:", err);
    }
  }

  /**
   * Watchdog (runs every 500 ms, independent of FaceMesh callbacks):
   *  - model never produced a result -> keep "loading", then ERROR after 15 s
   *  - results stopped arriving      -> ERROR (pipeline crashed)
   *  - results arriving but no face  -> FACE_NOT_FOUND
   */
  function watchdogTick() {
    if (!S.running) return;
    const now = performance.now();

    if (!S.gotFirstResult) {
      if (now - S.startedAt > 15000) {
        console.error(
          "[AttentionMonitor] FaceMesh produced no results in 15s. " +
          "Likely cause: model files failed to download from the CDN " +
          "(check the browser console Network tab for red .wasm/.tflite requests)."
        );
        setState("ERROR");
      } else {
        setState("LOADING_MODEL");
      }
      return;
    }

    if (now - S.lastResultAt > 5000) {
      console.error("[AttentionMonitor] FaceMesh stopped sending results (pipeline stalled).");
      setState("ERROR");
      return;
    }

    if (now - S.lastFaceSeenAt > THRESH.faceLostMs && S.state !== "FACE_NOT_FOUND") {
      setState("FACE_NOT_FOUND");
    }
  }

  // ---------- public API ----------

  async function start(stateCallback) {
    if (S.running) return true;
    onState = stateCallback;

    // If the CDN <script> tags failed to load, FaceMesh/Camera won't exist.
    if (typeof FaceMesh === "undefined" || typeof Camera === "undefined") {
      console.error(
        "[AttentionMonitor] MediaPipe scripts not loaded. " +
        "Check your internet connection / any ad-blocker blocking cdn.jsdelivr.net, then reload."
      );
      setState("ERROR");
      return false;
    }

    const video = document.getElementById("webcamVideo");

    try {
      S.faceMesh = new FaceMesh({
        // MUST match the <script> version in index.html exactly
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`,
      });
      S.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true, // enables iris landmarks 468/473
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      S.faceMesh.onResults(onResults);

      S.camera = new Camera(video, {
        onFrame: async () => { await S.faceMesh.send({ image: video }); },
        width: 320,
        height: 240,
      });
      await S.camera.start();

      S.running = true;
      S.framesSeen = 0;
      S.gotFirstResult = false;
      S.startedAt = performance.now();
      S.lastFaceSeenAt = performance.now();
      S.lastResultAt = performance.now();
      setState("LOADING_MODEL");
      clearInterval(S.watchdog);
      S.watchdog = setInterval(watchdogTick, 500);
      return true;
    } catch (err) {
      console.error("Attention monitor failed to start:", err);
      setState("OFF");
      return false;
    }
  }

  function stop() {
    if (!S.running) return;
    clearInterval(S.watchdog);
    S.watchdog = null;
    try { S.camera && S.camera.stop(); } catch (_) {}
    const video = document.getElementById("webcamVideo");
    if (video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    S.running = false;
    S.yawBuf = []; S.pitchBuf = []; S.gazeBuf = [];
    setState("OFF");
  }

  return {
    start, stop, THRESH,
    get running() { return S.running; },
    get state() { return S.state; },
  };
})();
