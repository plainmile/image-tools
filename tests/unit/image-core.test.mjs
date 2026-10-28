import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDimensions, aspectDimension, drawRect, validateFile, inputImageFormat, sanitizeStem,
  exportFilename, formatBytes, MAX_FILES, MAX_BATCH_BYTES, jpegBytesWithDpi, fitWithin, MAX_BATCH_OUTPUT_PIXELS, validateBatchPixels, addBatchOutputBytes, MAX_BATCH_OUTPUT_BYTES
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
test('within mode fills the integer output canvas without letterboxing', () => {
  const d=drawRect(1920,1080,801,451,'within');
  assert.deepEqual(d,{sx:0,sy:0,sw:1920,sh:1080,dx:0,dy:0,dw:801,dh:451});
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

test('browser batch memory limit is explicit', () => {
  assert.equal(MAX_BATCH_BYTES, 160 * 1024 * 1024);
});
test('JPEG density is patched to 300 dpi for existing JFIF', () => {
  const jpeg = Uint8Array.from([
    0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,
    0xff,0xd9
  ]);
  const result=jpegBytesWithDpi(jpeg,300);
  assert.equal(result.length,jpeg.length);
  assert.equal(result[13],1);
  assert.deepEqual(Array.from(result.slice(14,18)),[1,44,1,44]);
});
test('JPEG density is inserted if the browser omitted the JFIF header', () => {
  const jpeg=Uint8Array.from([0xff,0xd8,0xff,0xda,0,2,0xff,0xd9]);
  const result=jpegBytesWithDpi(jpeg,300);
  assert.equal(result.length,jpeg.length+18);
  assert.deepEqual(Array.from(result.slice(2,6)),[0xff,0xe0,0,16]);
  assert.deepEqual(Array.from(result.slice(14,18)),[1,44,1,44]);
  assert.throws(()=>jpegBytesWithDpi(new Uint8Array([1,2,3])),/Invalid JPEG/);
});

test('fit within bounding box preserves aspect ratio and does not upscale small images', () => {
  assert.deepEqual(fitWithin(120,80,55,35),{width:53,height:35});
  assert.deepEqual(fitWithin(120,80,800,800),{width:120,height:80});
  assert.deepEqual(fitWithin(800,1200,800,800),{width:533,height:800});
  assert.deepEqual(fitWithin(1920,1080,800,800),{width:800,height:450});
  assert.deepEqual(fitWithin(1080,1920,800,800),{width:450,height:800});
  assert.deepEqual(fitWithin(10000,10000,10000,10000),{width:5656,height:5656});
  assert.throws(()=>fitWithin(100,100,0,100),/Width/);
});

test('batch resource budget blocks multi-image megapixel explosions',()=>{
  assert.equal(MAX_BATCH_OUTPUT_PIXELS,120_000_000);
  assert.equal(validateBatchPixels([{width:120,height:80},{width:120,height:80}],55,35,'within'),3710);
  assert.throws(()=>validateBatchPixels(Array.from({length:5},()=>({width:120,height:80})),8000,4000,'contain'),/120-megapixel/);
});

test('original format is determined from MIME or safe extension fallback', () => {
  assert.equal(inputImageFormat({name:'transparency.png',type:'image/png'}),'png');
  assert.equal(inputImageFormat({name:'photo.jpg',type:'image/jpeg'}),'jpeg');
  assert.equal(inputImageFormat({name:'sample.webp',type:'image/webp'}),'webp');
  assert.equal(inputImageFormat({name:'photo.jpeg',type:''}),'jpeg');
  assert.equal(inputImageFormat({name:'photo.png',type:'application/octet-stream'}),'png');
  assert.throws(()=>inputImageFormat({name:'pretend.png',type:'image/svg+xml'}),/Supported images/);
  assert.throws(()=>validateFile({name:'animated.gif',type:'image/gif',size:128}),/Supported images/);
});

test('ZIP output budget protects the browser from unbounded in-memory archives', () => {
  assert.equal(MAX_BATCH_OUTPUT_BYTES, 128 * 1024 * 1024);
  assert.equal(addBatchOutputBytes(20, 50), 70);
  assert.equal(addBatchOutputBytes(MAX_BATCH_OUTPUT_BYTES - 7, 7), MAX_BATCH_OUTPUT_BYTES);
  assert.throws(() => addBatchOutputBytes(MAX_BATCH_OUTPUT_BYTES - 7, 8), /128 MB/);
  assert.throws(() => addBatchOutputBytes(-1, 1), /Invalid exported byte/);
  assert.throws(() => addBatchOutputBytes(0, Number.NaN), /Invalid exported byte/);
});
