import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Reads the text layer of a digital (non-scanned) PDF together with where each word sits on the page,
// and rebuilds the rows of the page from that. pdf-parse flattens a page into one stream, which scrambles
// table columns (qty / rate / tax / amount end up interleaved); keeping the positions keeps each row's
// cells together, in order, separated by wide gaps.

const ROW_TOLERANCE = 3;      // text items within this many points vertically belong to one row
const CELL_GAP = 12;          // a horizontal gap wider than this starts a new cell (tab-separated)

export async function extractPdfLayoutText(buffer, { maxPages = 10 } = {}) {
  try {
    const pdf = await getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: true }).promise;
    const pages = Math.min(pdf.numPages, maxPages);
    const out = [];

    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it) => it.str && it.str.trim() !== "")
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }));

      // Top of the page first (PDF y grows upwards), then group into rows.
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      for (const it of items) {
        const row = rows.find((r) => Math.abs(r.y - it.y) <= ROW_TOLERANCE);
        if (row) row.items.push(it);
        else rows.push({ y: it.y, items: [it] });
      }
      rows.sort((a, b) => b.y - a.y);

      const lines = rows.map((r) => {
        r.items.sort((a, b) => a.x - b.x);
        let line = "";
        let prevEnd = null;
        for (const it of r.items) {
          if (prevEnd === null) line = it.str;
          else line += (it.x - prevEnd > CELL_GAP ? "\t" : " ") + it.str;
          prevEnd = it.x + it.w;
        }
        return line.trim();
      });
      out.push(lines.join("\n"));
    }
    return { text: out.join("\n\n"), pages: pdf.numPages };
  } catch (err) {
    console.warn("PDF layout extraction warning:", err.message);
    return { text: "", pages: 0 };
  }
}
