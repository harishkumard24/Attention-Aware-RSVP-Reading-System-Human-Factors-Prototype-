/* ==========================================================================
   distraction-controller.js
   The decision layer between AttentionMonitor and RSVPEngine.

   Rule: reading continues only while attention is stable.
   - Attention lost (DISTRACTED or FACE_NOT_FOUND) for longer than the grace
     period while reading  -> auto-pause + log distraction event.
   - Attention restored    -> manual resume (default) or auto-resume (opt-in).

   States it consumes from the monitor:
     OFF | CALIBRATING | ATTENTIVE | DISTRACTED | FACE_NOT_FOUND
   ========================================================================== */

const DistractionController = (() => {
  const cfg = {
    enabled: true,      // auto-pause feature on/off
    graceMs: 2000,      // how long attention can be lost before pausing
    autoResume: false,  // resume automatically when attention returns
  };

  let lossTimer = null;       // pending auto-pause timeout
  let pausedBySystem = false; // true while we (not the user) hold the pause
  let lossStartedAt = null;

  // Hooks wired by main.js
  const hooks = {
    pauseReading: null,      // () => void  — pause the engine
    resumeReading: null,     // () => void  — resume the engine
    showPauseOverlay: null,  // (reason) => void
    hidePauseOverlay: null,  // () => void
    updateAttentionUI: null, // (state) => void
    isReading: null,         // () => boolean
  };

  function attentionLost(state) {
    // Begin logging the distraction episode immediately (even short ones).
    if (lossStartedAt === null) {
      lossStartedAt = performance.now();
      SessionLogger.onAttentionLost(state);
    }

    // Only schedule an auto-pause if enabled and currently reading.
    if (!cfg.enabled || lossTimer !== null) return;
    if (!hooks.isReading || !hooks.isReading()) return;

    lossTimer = setTimeout(() => {
      lossTimer = null;
      if (hooks.isReading && hooks.isReading()) {
        pausedBySystem = true;
        hooks.pauseReading();
        SessionLogger.onPause("auto");
        SessionLogger.logEvent("auto_pause", { state });
        if (hooks.showPauseOverlay) hooks.showPauseOverlay(state);
      }
    }, cfg.graceMs);
  }

  function attentionRestored() {
    if (lossStartedAt !== null) {
      lossStartedAt = null;
      SessionLogger.onAttentionRestored();
    }
    // Cancel a pending auto-pause — the glance away was within tolerance.
    if (lossTimer !== null) {
      clearTimeout(lossTimer);
      lossTimer = null;
    }
    // If we paused the reader, either auto-resume or wait for the user.
    if (pausedBySystem) {
      if (cfg.autoResume) {
        pausedBySystem = false;
        if (hooks.hidePauseOverlay) hooks.hidePauseOverlay();
        if (hooks.resumeReading) hooks.resumeReading();
        SessionLogger.logEvent("auto_resume");
      } else if (hooks.showPauseOverlay) {
        // Update overlay copy: attention is back, waiting on the user.
        hooks.showPauseOverlay("RESTORED");
      }
    }
  }

  /** Called from main.js whenever AttentionMonitor changes state. */
  function onAttentionState(state) {
    if (hooks.updateAttentionUI) hooks.updateAttentionUI(state);

    switch (state) {
      case "ATTENTIVE":
        attentionRestored();
        break;
      case "DISTRACTED":
      case "FACE_NOT_FOUND":
        attentionLost(state);
        break;
      case "OFF":
      case "ERROR":
        // Camera off / tracking failed: clear pending logic, keep any system pause.
        if (lossTimer) { clearTimeout(lossTimer); lossTimer = null; }
        if (lossStartedAt !== null) {
          lossStartedAt = null;
          SessionLogger.onAttentionRestored();
        }
        break;
      // CALIBRATING / LOADING_MODEL: neutral — neither lost nor restored.
    }
  }

  /** User clicked Resume on the overlay. */
  function userResumed() {
    pausedBySystem = false;
    if (hooks.hidePauseOverlay) hooks.hidePauseOverlay();
    if (hooks.resumeReading) hooks.resumeReading();
    SessionLogger.logEvent("manual_resume_after_auto_pause");
  }

  function configure(partial) { Object.assign(cfg, partial); }

  return {
    cfg, hooks, onAttentionState, userResumed, configure,
    get pausedBySystem() { return pausedBySystem; },
  };
})();
