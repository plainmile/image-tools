import test from 'node:test';
import assert from 'node:assert/strict';
import {cropPreset,validateCrop,moveCrop,resizeCrop,drawCrop,rotationDimensions} from '../../src/lib/transform-core.mjs';

test('crop defaults to a usable centered region and never exceeds the output limit',()=>{
  assert.deepEqual(cropPreset(100,60,'free'),{x:7,y:4,width:85,height:51});
  const square=cropPreset(400,300,'1');
  assert.equal(square.width,square.height);
  assert.ok(square.width>0 && square.x>=0 && square.y>=0);
  const huge=cropPreset(9000,8000,'free');
  assert.ok(huge.width*huge.height<=32_000_000);
  assert.ok(huge.width<=10_000 && huge.height<=10_000);
  assert.deepEqual(validateCrop(huge,9000,8000),{width:huge.width,height:huge.height});
});

test('crop validates full rectangles and refuses overflow or non-integer coordinates',()=>{
  assert.deepEqual(validateCrop({x:5,y:10,width:20,height:30},100,80),{width:20,height:30});
  assert.throws(()=>validateCrop({x:-1,y:0,width:20,height:20},100,80),/inside/);
  assert.throws(()=>validateCrop({x:90,y:0,width:20,height:20},100,80),/inside/);
  assert.throws(()=>validateCrop({x:0,y:0,width:0,height:20},100,80),/inside/);
  assert.throws(()=>validateCrop({x:0.5,y:0,width:10,height:20},100,80),/inside/);
  assert.throws(()=>validateCrop({x:0,y:0,width:6000,height:6000},7000,7000),/32-megapixel/);
});

test('moving and resizing never take the crop outside the image',()=>{
  const crop={x:10,y:15,width:40,height:20};
  assert.deepEqual(moveCrop(crop,1000,-300,100,60),{x:60,y:0,width:40,height:20});
  assert.deepEqual(resizeCrop(crop,500,500,100,60),{x:10,y:15,width:90,height:45});
  const square=resizeCrop(crop,35,35,100,60,'1');
  assert.equal(square.width,square.height);
  assert.deepEqual(drawCrop({x:60,y:40},{x:20,y:10},100,60),{x:20,y:10,width:40,height:30});
  const ratio=drawCrop({x:10,y:10},{x:90,y:50},100,60,'1');
  assert.equal(ratio.width,ratio.height);
  assert.deepEqual(validateCrop(ratio,100,60),{width:ratio.width,height:ratio.height});
});

test('quarter turns swap pixel dimensions, while 180 and 360 degrees preserve them',()=>{
  assert.deepEqual(rotationDimensions(640,480,90),{width:480,height:640});
  assert.deepEqual(rotationDimensions(640,480,-90),{width:480,height:640});
  assert.deepEqual(rotationDimensions(640,480,180),{width:640,height:480});
  assert.deepEqual(rotationDimensions(640,480,360),{width:640,height:480});
  assert.throws(()=>rotationDimensions(640,480,25),/90-degree/);
  assert.throws(()=>rotationDimensions(8000,8000,90),/32-megapixel/);
});
