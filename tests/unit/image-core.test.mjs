import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDimensions, aspectDimension, drawRect, validateFile, sanitizeStem,
  exportFilename, formatBytes, MAX_FILES
} from '../../src/lib/image-core.mjs';

test('dimensions: exact positive integers and resource limits', () => {
  assert.deepEqual(assertDimensions(600, 400), { width: 600, height: 400 });
  assert.throws(() => assertDimensions(0, 600), /Width/);
  assert.throws(() => assertDimensions(600.1, 600), /Width/);
  assert.throws(() => assertDimensions(9000, 9000), /32-megapixel/);
});
test('aspect dimensions stay proportional', () => {
  assert.equal(aspectDimension(1200, 800, 600, 'width'), 400);
  assert.equal(aspectDimension(1200, 800, 200, 'height'), 300);
});
test('contain mode never crops the original image', () => {
  const d = drawRect(1200, 600, 600, 600, 'contain');
  assert.deepEqual(d, { sx: 0, sy: 0, sw: 1200, sh: 600, dx: 0, dy: 150, dw: 600, dh: 300 });
});
test('cover mode crops symmetrically and allows pan', () => {
  const d = drawRect(1200, 600, 600, 600, 'cover');
  assert.equal(d.sx, 300);
  assert.equal(d.sw, 600);
  assert.equal(drawRect(1200, 600, 600, 600, 'cover', 1, 1).sx, 600);
  assert.equal(drawRect(1200, 600, 600, 600, 'cover', 1, -1).sx, 0);
});
test('reject unsupported images and huge inputs', () => {
  assert.throws(() => validateFile({ name: 'bad.svg', size: 2, type: 'image/svg+xml' }), /Supported/);
  assert.throws(() => validateFile({ name: 'bad.png', size: 0, type: 'image/png' }), /empty/);
  assert.throws(() => validateFile({ name: 'bad.png', size: 50_000_000, type: 'image/png' }), /40 MB/);
  assert.equal(MAX_FILES, 30);
});
test('safe exported names and accurate file size', () => {
  assert.equal(sanitizeStem('../../a:bad?.png'), '..-..-a-bad-');
  assert.equal(exportFilename('scan.webp', 'jpeg'), 'scan-edited.jpg');
  assert.equal(formatBytes(1024), '1.0 KB');
});
