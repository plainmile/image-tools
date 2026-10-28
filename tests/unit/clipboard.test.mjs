import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardImageFiles} from '../../src/lib/clipboard.mjs';

test('only image clipboard files are selected, even with other attached content',()=>{
  const png={name:'screenshot.png',type:'image/png'};
  const txt={name:'notes.txt',type:'text/plain'};
  assert.deepEqual(clipboardImageFiles({target:{closest:()=>null},clipboardData:{files:[txt,png]}}),[png]);
  assert.deepEqual(clipboardImageFiles({target:{closest:()=>null},clipboardData:{files:[txt]}}),[]);
  assert.deepEqual(clipboardImageFiles({target:{closest:()=>null},clipboardData:{files:[]}}),[]);
});

test('clipboard image entries support browsers without clipboardData.files',()=>{
  const webp={name:'capture.webp',type:'image/webp'};
  const evt={target:{closest:()=>null},clipboardData:{items:[
    {kind:'string',type:'text/plain'},
    {kind:'file',type:'image/webp',getAsFile:()=>webp},
    {kind:'file',type:'image/png',getAsFile:()=>null}
  ]}};
  assert.deepEqual(clipboardImageFiles(evt),[webp]);
});

test('do not intercept paste in dimensions or other editable controls',()=>{
  const png={name:'image.png',type:'image/png'};
  const event={target:{closest:()=>({tagName:'INPUT'})},clipboardData:{files:[png]}};
  assert.deepEqual(clipboardImageFiles(event),[]);
  assert.deepEqual(clipboardImageFiles(null),[]);
  assert.deepEqual(clipboardImageFiles({target:{closest:()=>null}}),[]);
});
