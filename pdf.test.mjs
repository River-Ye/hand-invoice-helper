import test from 'node:test';
import assert from 'node:assert/strict';
import jspdf from './vendor/jspdf.umd.min.js';
import { createPdfBlob } from './pdf.mjs';

test('creates real image PDFs with one or two A4 pages and respects cancellation', async () => {
  // Node loads the same UMD asset as CommonJS; expose its browser namespace.
  const previousWindow = globalThis.window;
  globalThis.window = { jspdf };
  try {
    const canvas = {
      toDataURL(type) {
        assert.equal(type, 'image/png');
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
      },
    };
    for (const pages of [1, 2]) {
      const blob = await createPdfBlob(Array(pages).fill(canvas));
      assert.equal(blob.type, 'application/pdf');
      const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
      assert.match(pdf, /^%PDF-1\.[3-7]/);
      assert.match(pdf, /%%EOF\s*$/);
      assert.equal([...pdf.matchAll(/\/Type \/Page\b/g)].length, pages);
      const sizes = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
      assert.equal(sizes.length, pages);
      for (const [, width, height] of sizes) {
        assert.ok(Math.abs(Number(width) - 595.28) < 0.02);
        assert.ok(Math.abs(Number(height) - 841.89) < 0.02);
      }
      assert.match(pdf, /\/Subtype \/Image\b/);
      assert.match(pdf, /\/Width 1\b[\s\S]*?\/Height 1\b/);
    }
    await assert.rejects(createPdfBlob([]), /尚無可輸出的頁面/);
    await assert.rejects(createPdfBlob([canvas], { isCurrent: () => false }), /已取消 PDF 下載/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
