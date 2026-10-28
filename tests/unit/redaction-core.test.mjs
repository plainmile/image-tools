import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDACT_MAX_FILES, REDACT_MAX_BYTES, validateRedactionFiles,
  verifyImageSize, validateRedactionPixels, REDACT_MAX_BATCH_PIXELS, REDACT_MAX_ZIP_BYTES, addRedactionOutputBytes, clampBox, boxBetween, decodeBitmap,
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

test('animated image redaction rejects before decoding any still frame',async()=>{
  const wrap=(bytes,name,type)=>{
    const b=new Blob([Uint8Array.from(bytes)]);
    return {name,type,size:b.size,slice:(...args)=>b.slice(...args)};
  };
  const webp=wrap([82,73,70,70,28,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,2],
    'animation.webp','image/webp');
  const signature=[137,80,78,71,13,10,26,10];
  const chunk=(type,payload=[])=>[0,0,0,payload.length,...[...type].map(c=>c.charCodeAt(0)),...payload,0,0,0,0];
  const apng=wrap([...signature,...chunk('IHDR',Array(13).fill(0)),
    ...chunk('acTL',Array(8).fill(0)),...chunk('IDAT')],
    'animation.png','image/png');
  await assert.rejects(decodeBitmap(webp),/Animated PNG\/WebP/);
  await assert.rejects(decodeBitmap(apng),/Animated PNG\/WebP/);
});

test('redaction ZIP budget is checked before JSZip allocation',()=>{
  assert.equal(REDACT_MAX_ZIP_BYTES,128*1024*1024);
  assert.equal(addRedactionOutputBytes(20,30),50);
  assert.equal(addRedactionOutputBytes(REDACT_MAX_ZIP_BYTES-1,1),REDACT_MAX_ZIP_BYTES);
  assert.throws(()=>addRedactionOutputBytes(REDACT_MAX_ZIP_BYTES-1,2),/128 MB/);
  assert.throws(()=>addRedactionOutputBytes(-1,1),/Invalid/);
  assert.throws(()=>addRedactionOutputBytes(1,Number.NaN),/Invalid/);
});

test('redaction accepts image filename fallback only when explicit MIME is absent',()=>{
  assert.doesNotThrow(()=>validateRedactionFiles([{name:'screenshot.PNG',type:'',size:512}]));
  assert.doesNotThrow(()=>validateRedactionFiles([{name:'photo.JpG',type:'application/octet-stream',size:2048}]));
  assert.doesNotThrow(()=>validateRedactionFiles([{name:'unusual-name',type:'image/webp',size:512}]));
  assert.throws(()=>validateRedactionFiles([{name:'renamed.png',type:'image/svg+xml',size:512}]),/JPEG/);
  assert.throws(()=>validateRedactionFiles([{name:'animation.gif',type:'',size:512}]),/JPEG/);
});
