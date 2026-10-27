import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACT_MAX_FILES, REDACT_MAX_BYTES, validateRedactionFiles,
  verifyImageSize, clampBox, boxBetween, extractOcrBoxes,
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
test('OCR boxes map from smaller scan to original pixels', () => {
  const data={blocks:[{paragraphs:[{lines:[{words:[
    {text:'Secret',bbox:{x0:10,y0:20,x1:50,y1:35}},
    {text:'   ',bbox:{x0:0,y0:0,x1:10,y1:10}},
    {text:'1234',bbox:{x0:55,y0:20,x1:82,y1:35}},
  ]}]}]}]};
  const list=extractOcrBoxes(data,200,100,100,50);
  assert.equal(list.length,2);
  assert.deepEqual(list[0],{id:'ocr-0',text:'Secret',source:'ocr',x:17,y:37,w:86,h:36});
});
