/* ==========================================================================
   file-input.js
   Text sources: paste, .txt upload, .pdf upload (pdf.js), sample passage.
   ========================================================================== */

const FileInput = (() => {
  const SAMPLE_TEXT = `Rapid Serial Visual Presentation, or RSVP, is a reading technique in which words are displayed one at a time at a fixed point on the screen. Because the eye no longer needs to move across lines of text, the costly saccades and fixations of normal reading are eliminated, and reading speed can increase dramatically. However, RSVP has a well-known human factors weakness: the text keeps moving even when the reader does not. If you glance away for even a second, words are lost forever, because there is no page to look back at. This prototype addresses that use error directly. A webcam-based attention monitor watches whether your face and gaze are oriented toward the screen. When attention is lost for longer than a configurable grace period, the reader pauses automatically and logs the distraction event. When you look back, you can resume exactly where you left off. The goal is not raw speed but reliable comprehension: an interface that adapts to the human, instead of demanding that the human adapt to the interface. Try looking away from the screen now and watch what happens.`;

  function readTxt(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the text file."));
      reader.readAsText(file);
    });
  }

  async function readPdf(file) {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF library not loaded. Check your internet connection.");
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return cleanText(text);
  }

  /** Light text cleaning: collapse whitespace, strip control chars. */
  function cleanText(text) {
    return text
      .replace(/[\u0000-\u0008\u000B-\u001F]/g, " ")
      .replace(/-\n(\w)/g, "$1")   // re-join words hyphenated across lines
      .replace(/\s+/g, " ")
      .trim();
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return readPdf(file);
    if (name.endsWith(".txt")) return cleanText(await readTxt(file));
    throw new Error("Unsupported file type. Use .txt or .pdf.");
  }

  return { readFile, cleanText, SAMPLE_TEXT };
})();
