import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACT_MAX_FILES, REDACT_MAX_BYTES, validateRedactionFiles,
  verifyImageSize, validateRedactionPixels, REDACT_MAX_BATCH_PIXELS, clampBox, boxBetween ,
} from '../../src/lib/redaction-core.mjs';

test('validate input limits and unsupported types', () => {
  assert.throws(() => validateRedactionFiles([]), /Choose/);
  assert.throws(() => validateRedactionFiles(Array(13).fill({size:1,type:'image/png'})), /12/);
  assert.throws(() => validateRedactionFiles([{size:1,type:'image/svg+xml'}]), /JPEG/);
  assert.equal(REDACT_MAX_FILES, 12);
  assert.equal(REDACT_MAX_BYTES, 100*1024*1024);
});
test('geometry clamps to image and rejects tiny boxes', () => {
  assert.deepEqual(clampBox({x:-5,y:-5,w:20,h:20},50,50),
    {x:0,y:0,w:15,h:15});
  assert.equal(clampBox({x:5,y:5,w:1,h:1},50,50), null);
  assert.deepEqual(boxBetween({x:90,y:40},{x:10,y:10},100,50),
    {x:10,y:10,w:80,h:30});
  assert.throws(()=>verifyImageSize(8000,8000),/32-megapixel/);
});

test('batch pixel budget rejects oversized combined output',()=>{
  assert.equal(REDACT_MAX_BATCH_PIXELS,96_000_000);
  assert.equal(validateRedactionPixels([{width:1920,height:1080},{width:1920,height:1080}]),4147200);
  assert.throws(()=>validateRedactionPixels(Array.from({length:12},()=>({width:4000,height:3000}))),/96-megapixel/);
  assert.throws(()=>validateRedactionPixels([{width:0,height:42}]),/32-megapixel/);
});

