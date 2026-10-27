import test from 'node:test';
import assert from 'node:assert/strict';
import {ocrPasses,mergeOcrCandidates,preserveSelectedOcrCandidates} from '../../src/lib/ocr-multipass.mjs';

test('OCR strategies are independent of photograph color, position or subject',()=>{
  assert.deepEqual(ocrPasses('standard').map(p=>p.psm),['11','3']);
  assert.deepEqual(ocrPasses('standard',true).map(p=>p.psm),['6','11']);
  assert.equal(ocrPasses('detailed').length,4);
  assert.deepEqual(ocrPasses('detailed').map(p=>p.variant),
    ['original','contrast','invert','threshold']);
});
test('spatially deduplicate repeated OCR passes, keeping actual text',()=>{
  const boxes=[
    {id:'a',text:'ORDER',confidence:91,x:15,y:30,w:100,h:40},
    {id:'b',text:'ORDER',confidence:64,x:16,y:29,w:100,h:42},
    {id:'c',text:'ADDRESS',confidence:73,x:250,y:90,w:150,h:50},
    {id:'d',text:'—',confidence:95,x:60,y:130,w:25,h:10},
  ];
  const result=mergeOcrCandidates(boxes);
  assert.deepEqual(result.map(x=>x.text),['ORDER','ADDRESS']);
});
test('similarly sized boxes at different locations remain independent',()=>{
  const boxes=[
    {text:'ORDER',confidence:91,x:15,y:30,w:100,h:40},
    {text:'ORDER',confidence:91,x:15,y:130,w:100,h:40},
    {text:'PAID',confidence:80,x:240,y:30,w:90,h:42},
  ];
  assert.equal(mergeOcrCandidates(boxes).length,3);
});

test('re-scanning keeps approved OCR covers, without duplicating nearby candidates',()=>{
  const approved={id:'approved',text:'ACCOUNT',source:'ocr',x:20,y:40,w:160,h:40};
  const fresh=[{id:'new',source:'ocr',x:21,y:41,w:158,h:40},{id:'other',source:'ocr',x:20,y:115,w:125,h:30}];
  const result=preserveSelectedOcrCandidates(fresh,[approved,{id:'manual',source:'manual',x:5,y:5,w:8,h:8}]);
  assert.deepEqual(result.map(box=>box.id),['approved','other']);
  assert.deepEqual(preserveSelectedOcrCandidates([], [approved]).map(box=>box.id),['approved']);
});
