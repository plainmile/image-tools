import { mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Package archives are only fetched by npm in CI/the build container.
// OCR scripts, WASM and traineddata are served from our own image tools origin.
const root = 'node_modules';
const destination = 'public/ocr';
await mkdir(join(destination, 'core'), { recursive: true });
await mkdir(join(destination, 'lang'), { recursive: true });

const scriptSource = join(root, 'tesseract.js', 'dist', 'worker.min.js');
await copyFile(scriptSource, join(destination, 'worker.min.js'));

const coreFiles = (await readdir(join(root, 'tesseract.js-core')))
  .filter((name) => /^tesseract-core(?:-[a-z0-9]+)*\.wasm(?:\.js)?$/.test(name));
if (!coreFiles.includes('tesseract-core-simd-lstm.wasm.js') ||
    !coreFiles.includes('tesseract-core-relaxedsimd-lstm.wasm.js') ||
    !coreFiles.some((name) => name.endsWith('.wasm'))) {
  throw new Error('Tesseract core assets are missing; fail rather than falling back to a CDN.');
}
for (const name of coreFiles) {
  await copyFile(join(root, 'tesseract.js-core', name), join(destination, 'core', name));
}
for (const lang of ['eng', 'chi_sim']) {
  const source = join(root, '@tesseract.js-data', lang, '4.0.0_best_int', lang + '.traineddata.gz');
  if ((await stat(source)).size < 100_000) throw new Error('Traineddata file is too small: ' + lang);
  await copyFile(source, join(destination, 'lang', lang + '.traineddata.gz'));
}
console.log('OCR assets copied to public/ocr, including ' + coreFiles.length + ' core files.');
