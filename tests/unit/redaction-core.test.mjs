import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACT_MAX_FILES, REDACT_MAX_BYTES, validateRedactionFiles,
  verifyImageSize, validateRedactionPixels, REDACT_MAX_BATCH_PIXELS, clampBox, boxBetween, extractOcrBoxes,
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
    {text:'Secret',confidence:97,bbox:{x0:10,y0:20,x1:50,y1:35}},
    {text:'   ',confidence:98,bbox:{x0:0,y0:0,x1:10,y1:10}},
    {text:'1234',confidence:96,bbox:{x0:55,y0:20,x1:82,y1:35}},
  ]}]}]}]};
  const list=extractOcrBoxes(data,200,100,100,50);
  assert.equal(list.length,1);
  assert.deepEqual(list[0],{id:'ocr-0',text:'Secret 1234',source:'ocr',
    x:17,y:37,w:150,h:36,confidence:97});
});

test('batch pixel budget rejects oversized combined output',()=>{
  assert.equal(REDACT_MAX_BATCH_PIXELS,96_000_000);
  assert.equal(validateRedactionPixels([{width:1920,height:1080},{width:1920,height:1080}]),4147200);
  assert.throws(()=>validateRedactionPixels(Array.from({length:12},()=>({width:4000,height:3000}))),/96-megapixel/);
  assert.throws(()=>validateRedactionPixels([{width:0,height:42}]),/32-megapixel/);
});

test('outdoor equipment textures are not useful OCR candidates',()=>{
  const words=[
    {text:'|',confidence:99,bbox:{x0:20,y0:10,x1:32,y1:600}},
    {text:'-',confidence:99,bbox:{x0:40,y0:20,x1:100,y1:30}},
    {text:'oi',confidence:23,bbox:{x0:110,y0:120,x1:156,y1:162}},
    {text:'i',confidence:88,bbox:{x0:160,y0:40,x1:163,y1:180}},
    {text:'2026-08-28',confidence:94,bbox:{x0:210,y0:50,x1:490,y1:93}},
    {text:'变压器',confidence:91,bbox:{x0:60,y0:710,x1:180,y1:749}},
    {text:'110kV',confidence:95,bbox:{x0:50,y0:810,x1:190,y1:862}},
    {text:'motor',confidence:17,bbox:{x0:450,y0:200,x1:540,y1:255}},
  ];
  const data={blocks:[]};
  const block={paragraphs:[]};
  const paragraph={lines:[{words}]};
  block.paragraphs.push(paragraph);
  data.blocks.push(block);
  const suggestions=extractOcrBoxes(data,960,960,960,960);
  assert.deepEqual(suggestions.map(s=>s.text),['2026-08-28','变压器','110kV']);
  assert.equal(suggestions[0].source,'ocr');
});
test('OCR scan areas preserve original pixel coordinates',()=>{
  const zone={x:400,y:200,w:600,h:300};
  const data={blocks:[{paragraphs:[{lines:[{words:[
    {text:'DATE',confidence:99,bbox:{x0:10,y0:20,x1:110,y1:65}}
  ]}]}]}]};
  const boxes=extractOcrBoxes(data,1920,1080,600,300,zone);
  assert.equal(boxes.length,1);
  assert.deepEqual([boxes[0].x,boxes[0].y,boxes[0].w,boxes[0].h],[407,217,106,51]);
});

test('confidence filtering does not suppress photographed multi-character text',()=>{
  const data={blocks:[{paragraphs:[{lines:[{words:[
    {text:'ORDER',confidence:44,bbox:{x0:80,y0:40,x1:190,y1:65}},
    {text:'—',confidence:99,bbox:{x0:202,y0:40,x1:250,y1:65}},
    {text:'19',confidence:45,bbox:{x0:260,y0:40,x1:305,y1:65}},
  ]}]}]}]};
  const boxes=extractOcrBoxes(data,500,150,500,150);
  assert.deepEqual(boxes.map(b=>b.text),['ORDER','19']);
});
