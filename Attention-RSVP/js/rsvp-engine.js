/* ==========================================================================
   rsvp-engine.js
   Core RSVP reading engine: text parsing, ORP (Optimal Recognition Point)
   calculation, word timing, and playback loop.
   ORP logic adapted from rsvp-reading-main/src/lib/rsvp-utils.js.
   ========================================================================== */

const RSVPEngine = (() => {
  // ---------- text utilities ----------

  function parseText(text) {
    if (!text || typeof text !== "string") return [];
    return text.trim().split(/\s+/).filter((w) => w.length > 0);
  }

  /**
   * ORP index: which *letter* (counting letters only) the eye should fixate.
   * Based on word length. Supports all Unicode letters.
   */
  function getORPIndex(word) {
    if (!word) return 0;
    const len = word.replace(/[^\p{L}\p{N}]/gu, "").length;
    if (len <= 1) return 0;
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 12) return 3;
    return Math.floor(Math.log2(len - 1)) + 1;
  }

  const letterRegex = /[\p{L}\p{N}]/u;

  /** Actual character index of the ORP letter, skipping leading punctuation. */
  function getActualORPIndex(word) {
    if (!word) return 0;
    const orpIndex = getORPIndex(word);
    let count = 0;
    for (let i = 0; i < word.length; i++) {
      if (letterRegex.test(word[i])) {
        if (count === orpIndex) return i;
        count++;
      }
    }
    return Math.min(orpIndex, word.length - 1);
  }

  /** Per-word display delay in ms, with extra pause on sentence punctuation. */
  function getWordDelay(word, wpm, pauseOnPunct = true, punctMult = 2) {
    const base = 60000 / wpm;
    if (!word) return base;
    let delay = base;
    // Longer words get a small bump so very long words aren't skipped past.
    if (word.length >= 9) delay *= 1.3;
    if (pauseOnPunct && /[.!?;:]["')\]]?$/.test(word)) delay *= punctMult;
    else if (pauseOnPunct && /,["')\]]?$/.test(word)) delay *= 1.4;
    return delay;
  }

  // ---------- engine state ----------

  const state = {
    words: [],
    index: 0,
    playing: false,
    wpm: 300,
    pauseOnPunct: true,
    timer: null,
  };

  // Callbacks the app wires up
  const handlers = {
    onWord: null,     // (word, preStr, orpChar, postStr, index, total)
    onPlayState: null,// (playing)
    onFinish: null,   // ()
  };

  function emitWord() {
    const word = state.words[state.index] ?? "";
    const orp = getActualORPIndex(word);
    if (handlers.onWord) {
      handlers.onWord(
        word,
        word.slice(0, orp),
        word.charAt(orp),
        word.slice(orp + 1),
        state.index,
        state.words.length
      );
    }
  }

  function tick() {
    if (!state.playing) return;
    if (state.index >= state.words.length - 1) {
      // Last word shown; finish.
      pause("finished");
      if (handlers.onFinish) handlers.onFinish();
      return;
    }
    state.index++;
    emitWord();
    schedule();
  }

  function schedule() {
    clearTimeout(state.timer);
    const word = state.words[state.index] ?? "";
    state.timer = setTimeout(tick, getWordDelay(word, state.wpm, state.pauseOnPunct));
  }

  // ---------- public API ----------

  function loadText(text) {
    pause("load");
    state.words = parseText(text);
    state.index = 0;
    emitWord();
  }

  function play() {
    if (state.words.length === 0 || state.playing) return false;
    if (state.index >= state.words.length - 1) state.index = 0; // replay after finish
    state.playing = true;
    if (handlers.onPlayState) handlers.onPlayState(true);
    emitWord();
    schedule();
    return true;
  }

  function pause() {
    if (!state.playing) return;
    state.playing = false;
    clearTimeout(state.timer);
    if (handlers.onPlayState) handlers.onPlayState(false);
  }

  function toggle() { state.playing ? pause() : play(); }

  function seek(index) {
    state.index = Math.max(0, Math.min(index, state.words.length - 1));
    emitWord();
    if (state.playing) schedule();
  }

  function step(delta) { seek(state.index + delta); }
  function restart() { seek(0); }

  function setWPM(wpm) {
    state.wpm = Math.max(60, Math.min(1200, wpm));
    if (state.playing) schedule();
    return state.wpm;
  }

  /** Estimated seconds remaining from the current position. */
  function timeRemaining() {
    let ms = 0;
    for (let i = state.index; i < state.words.length; i++) {
      ms += getWordDelay(state.words[i], state.wpm, state.pauseOnPunct);
    }
    return ms / 1000;
  }

  return {
    state, handlers,
    parseText, getORPIndex, getActualORPIndex, getWordDelay,
    loadText, play, pause, toggle, seek, step, restart, setWPM, timeRemaining,
  };
})();
