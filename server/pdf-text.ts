// PDF → plain text via pdfjs-dist (Mozilla's maintained pdf.js). Replaces
// pdf-parse, whose bundled 2018 pdf.js build fails on ordinary valid PDFs
// with "bad XRef entry" on modern Node — which silently broke the whole
// generate-quiz-from-PDF feature.
//
// The legacy build is the one supported for Node; dynamic import keeps the
// (fairly large) module off the startup path, mirroring the old pattern.

const MAX_PAGES = 200;

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdf.js mutates/transfers the buffer it is given — hand it a copy so the
  // caller's buffer (e.g. multer's) stays intact.
  const data = new Uint8Array(pdfBuffer.byteLength);
  data.set(pdfBuffer);

  const loadingTask = getDocument({ data, useSystemFonts: true });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (error: any) {
    const name = String(error?.name || "");
    if (name === "PasswordException") {
      throw new Error("This PDF is password-protected. Please remove the password and try again.");
    }
    throw new Error("Could not read this file as a PDF. Please check that it is a valid, uncorrupted PDF.");
  }

  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
      page.cleanup();
    }
    return parts.join("\n").replace(/\s+/g, " ").trim();
  } finally {
    await loadingTask.destroy();
  }
}
