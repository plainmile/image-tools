import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACT_MAX_FILES,REDACT_MAX_BYTES,REDACT_MAX_BATCH_PIXELS,
  validateRedactionFiles,verifyImageSize,validateRedactionPixels,
  clampBox,boxBetween,getMaskStyle,
} from '../../src/lib/redaction-core.mjs';

test('limits reject unsupported, oversized or empty uploads',()=>{
  assert.throws(()=>validateRedactionFiles([]),/Choose/);
  assert.throws(()=>validateRedactionFiles(Array(13).fill({size:1,type:'image/png'})),/12/);
  assert.throws(()=>validateRedactionFiles([{size:1,type:'image/svg+xml'}]),/JPEG/);
  assert.equal(REDACT_MAX_FILES,12);
  assert.equal(REDACT_MAX_BYTES,100*1024*1024);
  assert.throws(()=>verifyImageSize(8000,8000),/32-megapixel/);
});
test('manual rectangles stay within image and reject invalid geometry',()=>{
  assert.deepEqual(clampBox({x:-5,y:-5,w:20,h:20},50,50),{x:0,y:0,w:15,h:15});
  assert.equal(clampBox({x:5,y:5,w:1,h:1},50,50),null);
  assert.equal(clampBox({x:5,y:5,w:-10,h:20},50,50),null);
  assert.equal(clampBox({x:1000,y:20,w:20,h:20},50,50),null);
  assert.deepEqual(boxBetween({x:90,y:40},{x:10,y:10},100,50),{x:10,y:10,w:80,h:30});
});
test('aggregate memory budget for manual batch redaction',()=>{
  assert.equal(REDACT_MAX_BATCH_PIXELS,96_000_000);
  assert.equal(validateRedactionPixels([{width:1920,height:1080},{width:1920,height:1080}]),4147200);
  assert.throws(()=>validateRedactionPixels(Array.from({length:12},()=>({width:4000,height:3000}))),/96-megapixel/);
});
test('style is stored per rectangle and rejects malformed style settings',()=>{
  assert.deepEqual(getMaskStyle({effect:'solid',color:'#aabbcc',strength:32}),
    {effect:'solid',color:'#aabbcc',strength:32});
  assert.deepEqual(getMaskStyle({effect:'white'}),
    {effect:'solid',color:'#ffffff',strength:24});
  assert.equal(getMaskStyle({effect:'mosaic',strength:64}).effect,'mosaic');
  assert.equal(getMaskStyle({effect:'blur',strength:24}).effect,'blur');
  assert.throws(()=>getMaskStyle({effect:'unknown'}),/Unsupported/);
  assert.throws(()=>getMaskStyle({effect:'solid',color:'transparent'}),/Invalid/);
  assert.throws(()=>getMaskStyle({effect:'mosaic',strength:1000}),/strength/);
});
