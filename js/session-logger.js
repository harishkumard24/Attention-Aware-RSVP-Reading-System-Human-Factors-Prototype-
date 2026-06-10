/* ==========================================================================
   session-logger.js
   Human-factors experiment logger. Tracks reading behaviour and distraction
   events, persists to localStorage, exports JSON for analysis.
   ========================================================================== */

const SessionLogger = (() => {
  let session = null;

  // Internal accumulators
  let playStartedAt = null;       // when current play run started
  let distractionStartedAt = null;// when current attention-loss began

  function newSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function start(textLength, wpm) {
    session = {
      sessionId: newSessionId(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      textLength,                 // total words
      initialWpm: wpm,
      finalWpm: wpm,
      wordsRead: 0,
      maxWordIndex: 0,
      totalActiveReadingMs: 0,    // time the reader was actually playing
      autoPauseCount: 0,          // pauses triggered by attention loss
      manualPauseCount: 0,
      restartCount: 0,
      gazeLossEvents: 0,          // every attention-loss episode (even short ones)
      totalDistractedMs: 0,
      events: [],                 // timestamped event trail
      completionPercentage: 0,
    };
    logEvent("session_start", { textLength, wpm });
  }

  function logEvent(type, data = {}) {
    if (!session) return;
    session.events.push({ t: new Date().toISOString(), type, ...data });
  }

  // ----- playback hooks -----

  function onPlay() {
    if (!session) return;
    playStartedAt = performance.now();
    logEvent("play");
  }

  function onPause(reason) {
    if (!session) return;
    if (playStartedAt !== null) {
      session.totalActiveReadingMs += performance.now() - playStartedAt;
      playStartedAt = null;
    }
    if (reason === "auto") session.autoPauseCount++;
    else if (reason === "manual") session.manualPauseCount++;
    logEvent("pause", { reason });
  }

  function onRestart() {
    if (!session) return;
    session.restartCount++;
    logEvent("restart");
  }

  function onProgress(index, total) {
    if (!session) return;
    session.maxWordIndex = Math.max(session.maxWordIndex, index);
    session.wordsRead = session.maxWordIndex + 1;
    session.completionPercentage = total > 0
      ? Math.round(((session.maxWordIndex + 1) / total) * 100)
      : 0;
  }

  function onWpmChange(wpm) {
    if (!session) return;
    session.finalWpm = wpm;
    logEvent("wpm_change", { wpm });
  }

  // ----- attention hooks -----

  function onAttentionLost(state) {
    if (!session || distractionStartedAt !== null) return;
    distractionStartedAt = performance.now();
    session.gazeLossEvents++;
    logEvent("attention_lost", { state });
  }

  function onAttentionRestored() {
    if (!session || distractionStartedAt === null) return;
    session.totalDistractedMs += performance.now() - distractionStartedAt;
    distractionStartedAt = null;
    logEvent("attention_restored");
  }

  function onComplete() {
    if (!session) return;
    session.completedAt = new Date().toISOString();
    logEvent("session_complete");
    persist();
  }

  // ----- persistence & export -----

  function snapshot() {
    if (!session) return null;
    const snap = JSON.parse(JSON.stringify(session));
    // Fold in any in-progress timers so the snapshot is accurate.
    if (playStartedAt !== null) {
      snap.totalActiveReadingMs += performance.now() - playStartedAt;
    }
    if (distractionStartedAt !== null) {
      snap.totalDistractedMs += performance.now() - distractionStartedAt;
    }
    snap.totalActiveReadingMs = Math.round(snap.totalActiveReadingMs);
    snap.totalDistractedMs = Math.round(snap.totalDistractedMs);
    return snap;
  }

  function persist() {
    const snap = snapshot();
    if (!snap) return;
    try {
      const all = JSON.parse(localStorage.getItem("focusrsvp_sessions") || "[]");
      const i = all.findIndex((s) => s.sessionId === snap.sessionId);
      if (i >= 0) all[i] = snap; else all.push(snap);
      localStorage.setItem("focusrsvp_sessions", JSON.stringify(all.slice(-50)));
    } catch (e) {
      console.warn("Could not persist session:", e);
    }
  }

  function exportJSON() {
    const snap = snapshot();
    if (!snap) return;
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `focusrsvp-session-${snap.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return {
    start, logEvent, snapshot, persist, exportJSON,
    onPlay, onPause, onRestart, onProgress, onWpmChange,
    onAttentionLost, onAttentionRestored, onComplete,
    get active() { return session !== null; },
  };
})();
