/* ==========================================================================
   main.js
   Wires together: RSVPEngine + AttentionMonitor + DistractionController +
   SessionLogger + all UI elements.
   ========================================================================== */

(() => {
  // ---------- element refs ----------
  const $ = (id) => document.getElementById(id);

  const wordDisplay = $("wordDisplay");
  const wPre = wordDisplay.querySelector(".w-pre");
  const wOrp = wordDisplay.querySelector(".w-orp");
  const wPost = wordDisplay.querySelector(".w-post");
  const stageHint = $("stageHint");

  const playBtn = $("playBtn");
  const playIcon = $("playIcon");
  const pauseIcon = $("pauseIcon");
  const progressBar = $("progressBar");
  const wpmValue = $("wpmValue");
  const wordCounter = $("wordCounter");
  const timeRemaining = $("timeRemaining");

  const attentionPill = $("attentionPill");
  const attentionLabel = $("attentionLabel");
  const camDock = $("camDock");
  const camBadge = $("camBadge");

  const pauseOverlay = $("pauseOverlay");
  const pauseTitle = $("pauseTitle");
  const pauseSub = $("pauseSub");

  // ---------- helpers ----------

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function openModal(id) { $(id).classList.remove("hidden"); }
  function closeModal(id) { $(id).classList.add("hidden"); }

  // ---------- RSVP engine wiring ----------

  RSVPEngine.handlers.onWord = (word, pre, orp, post, index, total) => {
    wPre.textContent = pre;
    wOrp.textContent = orp;
    wPost.textContent = post;
    wordCounter.textContent = `${total ? index + 1 : 0} / ${total}`;
    progressBar.max = Math.max(total - 1, 1);
    progressBar.value = index;
    timeRemaining.textContent = `${fmtTime(RSVPEngine.timeRemaining())} left`;
    SessionLogger.onProgress(index, total);
  };

  RSVPEngine.handlers.onPlayState = (playing) => {
    playIcon.classList.toggle("hidden", playing);
    pauseIcon.classList.toggle("hidden", !playing);
    stageHint.classList.toggle("hidden", playing);
  };

  RSVPEngine.handlers.onFinish = () => {
    SessionLogger.onPause("finished");
    SessionLogger.onComplete();
    stageHint.textContent = "Finished! Press M for stats, R to read again.";
    stageHint.classList.remove("hidden");
    renderStats();
    openModal("statsModal");
  };

  // ---------- play / pause / nav ----------

  function userPlay() {
    if (RSVPEngine.state.words.length === 0) { openModal("textModal"); return; }
    if (RSVPEngine.play()) SessionLogger.onPlay();
  }

  function userPause() {
    if (!RSVPEngine.state.playing) return;
    RSVPEngine.pause();
    SessionLogger.onPause("manual");
  }

  playBtn.addEventListener("click", () => {
    if (DistractionController.pausedBySystem) { DistractionController.userResumed(); return; }
    RSVPEngine.state.playing ? userPause() : userPlay();
  });

  $("restartBtn").addEventListener("click", () => {
    RSVPEngine.restart();
    SessionLogger.onRestart();
  });
  $("backBtn").addEventListener("click", () => RSVPEngine.step(-10));
  $("fwdBtn").addEventListener("click", () => RSVPEngine.step(10));

  progressBar.addEventListener("input", () => {
    RSVPEngine.seek(parseInt(progressBar.value, 10));
  });

  // ---------- WPM ----------

  function setWpm(v) {
    const wpm = RSVPEngine.setWPM(v);
    wpmValue.textContent = wpm;
    $("setWpm").value = wpm;
    $("setWpmVal").textContent = `${wpm} WPM`;
    SessionLogger.onWpmChange(wpm);
  }
  $("wpmUp").addEventListener("click", () => setWpm(RSVPEngine.state.wpm + 25));
  $("wpmDown").addEventListener("click", () => setWpm(RSVPEngine.state.wpm - 25));

  // ---------- text loading ----------

  $("textBtn").addEventListener("click", () => openModal("textModal"));
  $("sampleBtn").addEventListener("click", () => {
    $("textArea").value = FileInput.SAMPLE_TEXT;
    $("fileStatus").textContent = "Sample passage loaded into the box.";
  });

  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $("fileStatus").textContent = "Reading file…";
    try {
      $("textArea").value = await FileInput.readFile(file);
      $("fileStatus").textContent = `Loaded ${file.name}`;
    } catch (err) {
      $("fileStatus").textContent = err.message;
    }
    e.target.value = "";
  });

  $("loadTextBtn").addEventListener("click", () => {
    const text = $("textArea").value;
    const words = RSVPEngine.parseText(text);
    if (words.length === 0) {
      $("fileStatus").textContent = "Paste or upload some text first.";
      return;
    }
    RSVPEngine.loadText(text);
    SessionLogger.start(words.length, RSVPEngine.state.wpm);
    closeModal("textModal");
    stageHint.textContent = "Press Space or ▶ to start reading";
    stageHint.classList.remove("hidden");
  });

  // ---------- settings ----------

  $("settingsBtn").addEventListener("click", () => openModal("settingsModal"));
  $("statsBtn").addEventListener("click", () => { renderStats(); openModal("statsModal"); });

  document.querySelectorAll(".modal-close").forEach((btn) =>
    btn.addEventListener("click", () => closeModal(btn.dataset.close))
  );
  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); })
  );

  $("setWpm").addEventListener("input", (e) => setWpm(parseInt(e.target.value, 10)));
  $("setFontSize").addEventListener("input", (e) => {
    document.documentElement.style.setProperty("--word-size", `${e.target.value}px`);
    $("setFontSizeVal").textContent = `${e.target.value} px`;
  });
  $("setPunctPause").addEventListener("change", (e) => {
    RSVPEngine.state.pauseOnPunct = e.target.checked;
  });
  $("setAutoPause").addEventListener("change", (e) => {
    DistractionController.configure({ enabled: e.target.checked });
  });
  $("setGraceMs").addEventListener("input", (e) => {
    const ms = parseInt(e.target.value, 10);
    DistractionController.configure({ graceMs: ms });
    $("setGraceVal").textContent = `${(ms / 1000).toFixed(1)} s`;
  });
  $("setAutoResume").addEventListener("change", (e) => {
    DistractionController.configure({ autoResume: e.target.checked });
  });
  $("setShowCam").addEventListener("change", (e) => {
    camDock.classList.toggle("hidden", !e.target.checked || !AttentionMonitor.running);
  });

  // ---------- attention tracking ----------

  const PILL_STATES = {
    OFF:            { cls: "pill-off",  label: "Camera off",        badge: "off" },
    LOADING_MODEL:  { cls: "pill-warn", label: "Loading model…",    badge: "loading model…" },
    CALIBRATING:    { cls: "pill-warn", label: "Calibrating…",      badge: "calibrating…" },
    ATTENTIVE:      { cls: "pill-good", label: "Attention: active", badge: "tracking" },
    DISTRACTED:     { cls: "pill-warn", label: "Looking away",      badge: "looking away" },
    FACE_NOT_FOUND: { cls: "pill-bad",  label: "Face not found",    badge: "no face" },
    ERROR:          { cls: "pill-bad",  label: "Tracking failed — see console (F12)", badge: "error" },
  };

  DistractionController.hooks.isReading = () => RSVPEngine.state.playing;
  DistractionController.hooks.pauseReading = () => RSVPEngine.pause();
  DistractionController.hooks.resumeReading = () => { if (RSVPEngine.play()) SessionLogger.onPlay(); };

  DistractionController.hooks.updateAttentionUI = (state) => {
    const info = PILL_STATES[state] || PILL_STATES.OFF;
    attentionPill.className = `pill ${info.cls}`;
    attentionLabel.textContent = info.label;
    camBadge.textContent = info.badge;
    document.body.classList.toggle("att-warn", state === "DISTRACTED" || state === "CALIBRATING");
    document.body.classList.toggle("att-bad", state === "FACE_NOT_FOUND");
  };

  DistractionController.hooks.showPauseOverlay = (reason) => {
    if (reason === "RESTORED") {
      pauseTitle.textContent = "Attention restored";
      pauseSub.textContent = "Welcome back. Resume when you're ready.";
    } else if (reason === "FACE_NOT_FOUND") {
      pauseTitle.textContent = "Paused — face not found";
      pauseSub.textContent = "The camera can't see you. Sit back in frame, then resume.";
    } else {
      pauseTitle.textContent = "Paused — attention lost";
      pauseSub.textContent = "You looked away, so reading stopped to make sure you don't miss words.";
    }
    pauseOverlay.classList.remove("hidden");
  };

  DistractionController.hooks.hidePauseOverlay = () => pauseOverlay.classList.add("hidden");

  $("resumeBtn").addEventListener("click", () => DistractionController.userResumed());

  $("cameraToggleBtn").addEventListener("click", async () => {
    if (AttentionMonitor.running) {
      AttentionMonitor.stop();
      camDock.classList.add("hidden");
      DistractionController.onAttentionState("OFF");
    } else {
      attentionLabel.textContent = "Starting camera…";
      const ok = await AttentionMonitor.start((state) =>
        DistractionController.onAttentionState(state)
      );
      if (ok) {
        if ($("setShowCam").checked) camDock.classList.remove("hidden");
      } else {
        attentionLabel.textContent = "Camera unavailable";
      }
    }
  });

  // ---------- stats ----------

  function renderStats() {
    const s = SessionLogger.snapshot();
    const grid = $("statsGrid");
    if (!s) {
      grid.innerHTML = `<p class="meta">No session yet. Load a text and start reading.</p>`;
      return;
    }
    const cards = [
      [s.completionPercentage + "%", "Completion"],
      [s.wordsRead, "Words read"],
      [s.finalWpm, "Final WPM"],
      [fmtTime(s.totalActiveReadingMs / 1000), "Active reading"],
      [s.autoPauseCount, "Auto-pauses"],
      [s.manualPauseCount, "Manual pauses"],
      [s.gazeLossEvents, "Gaze-loss events"],
      [(s.totalDistractedMs / 1000).toFixed(1) + "s", "Distracted time"],
      [s.restartCount, "Restarts"],
    ];
    grid.innerHTML = cards
      .map(([v, k]) => `<div class="stat-card"><div class="v">${v}</div><div class="k">${k}</div></div>`)
      .join("");
  }

  $("exportBtn").addEventListener("click", () => SessionLogger.exportJSON());
  $("resetStatsBtn").addEventListener("click", () => {
    SessionLogger.persist();
    if (RSVPEngine.state.words.length > 0) {
      SessionLogger.start(RSVPEngine.state.words.length, RSVPEngine.state.wpm);
    }
    renderStats();
  });

  // Persist the session snapshot periodically and on exit
  setInterval(() => SessionLogger.persist(), 10000);
  window.addEventListener("beforeunload", () => SessionLogger.persist());

  // ---------- keyboard shortcuts ----------

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    switch (e.code) {
      case "Space":
        e.preventDefault();
        if (DistractionController.pausedBySystem) DistractionController.userResumed();
        else RSVPEngine.state.playing ? userPause() : userPlay();
        break;
      case "ArrowLeft": RSVPEngine.step(-10); break;
      case "ArrowRight": RSVPEngine.step(10); break;
      case "ArrowUp": setWpm(RSVPEngine.state.wpm + 25); break;
      case "ArrowDown": setWpm(RSVPEngine.state.wpm - 25); break;
      case "KeyR": RSVPEngine.restart(); SessionLogger.onRestart(); break;
      case "KeyS": openModal("settingsModal"); break;
      case "KeyM": renderStats(); openModal("statsModal"); break;
      case "KeyC": $("cameraToggleBtn").click(); break;
      case "Escape":
        document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
        break;
    }
  });

  // ---------- boot ----------
  wPre.textContent = "";
  wOrp.textContent = "·";
  wPost.textContent = "";
})();
