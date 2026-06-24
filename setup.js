/**
 * Generates any MISSING pass images so the app can boot and sign a pass.
 * Real art (the saluting frog thumbnail, brewery logo) should replace these.
 * Required by Apple: icon.png (29), icon@2x.png (58), logo.png, logo@2x.png.
 * Optional: thumbnail.png (90), thumbnail@2x.png (180) - the frog mascot.
 */
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, 'pass-images');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const OLIVE = 0x2d3521ff;
const SAND  = 0xd6c08cff;

async function makeIfMissing(name, w, h, bg, label) {
  const file = path.join(dir, name);
  if (fs.existsSync(file)) { console.log(`kept  ${name}`); return; }
  const img = new Jimp(w, h, bg);
  if (label) {
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    img.print(font, 0, 0, { text: label, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER, alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE }, w, h);
  }
  await img.writeAsync(file);
  console.log(`made  ${name} (${w}x${h})`);
}

(async () => {
  await makeIfMissing('icon.png', 29, 29, OLIVE);
  await makeIfMissing('icon@2x.png', 58, 58, OLIVE);
  await makeIfMissing('logo.png', 160, 50, OLIVE, 'SALUTES');
  await makeIfMissing('logo@2x.png', 320, 100, OLIVE, 'SALUTES');
  await makeIfMissing('thumbnail.png', 90, 90, SAND, 'BCB');
  await makeIfMissing('thumbnail@2x.png', 180, 180, SAND, 'BCB');
  console.log('\nDone. Replace pass-images/ with real Bullfrog art when ready.');
})();
