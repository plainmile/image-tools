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

test('locked crop resize follows vertical-only gestures and remains within image bounds',()=>{
  const base={x:20,y:20,width:200,height:200};
  // Previously height input was discarded and these would all stay 200x200.
  assert.deepEqual(resizeCrop(base,200,240,400,400,'1','height'),
    {x:20,y:20,width:240,height:240});
  assert.deepEqual(resizeCrop(base,200,140,400,400,'1','height'),
    {x:20,y:20,width:140,height:140});
  assert.deepEqual(resizeCrop(base,260,200,400,400,'1','width'),
    {x:20,y:20,width:260,height:260});
  // Horizontal-only gestures retain their existing default behavior.
  assert.deepEqual(resizeCrop(base,260,200,400,400,'1'),
    {x:20,y:20,width:260,height:260});
  const landscape={x:10,y:20,width:160,height:120};
  const taller=resizeCrop(landscape,160,150,500,400,String(4/3),'height');
  assert.deepEqual(taller,{x:10,y:20,width:200,height:150});
  const nearEdge={x:320,y:300,width:40,height:40};
  const bounded=resizeCrop(nearEdge,40,150,400,400,'1','height');
  assert.deepEqual(bounded,{x:320,y:300,width:80,height:80});
  assert.deepEqual(validateCrop(bounded,400,400),{width:80,height:80});
  assert.throws(()=>resizeCrop(base,200,240,400,400,'1','diagonal'),/axis/);
});

test('quarter turns swap pixel dimensions, while 180 and 360 degrees preserve them',()=>{
  assert.deepEqual(rotationDimensions(640,480,90),{width:480,height:640});
  assert.deepEqual(rotationDimensions(640,480,-90),{width:480,height:640});
  assert.deepEqual(rotationDimensions(640,480,180),{width:640,height:480});
  assert.deepEqual(rotationDimensions(640,480,360),{width:640,height:480});
  assert.throws(()=>rotationDimensions(640,480,25),/90-degree/);
  assert.throws(()=>rotationDimensions(8000,8000,90),/32-megapixel/);
});

test('dragging and resizing huge crops always keeps an exportable selection',()=>{
  const fromCorner=drawCrop({x:0,y:0},{x:9000,y:8000},9000,8000);
  assert.ok(fromCorner.width*fromCorner.height<=32_000_000);
  assert.deepEqual(validateCrop(fromCorner,9000,8000),{width:fromCorner.width,height:fromCorner.height});
  const resized=resizeCrop(fromCorner,9000,8000,9000,8000);
  assert.ok(resized.width*resized.height<=32_000_000);
  assert.deepEqual(validateCrop(resized,9000,8000),{width:resized.width,height:resized.height});
  assert.deepEqual(validateCrop(moveCrop(resized,9000,8000,9000,8000),9000,8000),
    {width:resized.width,height:resized.height});

  // A very wide original is valid input but a crop wider than 10,000px is not valid output.
  const panoramic=drawCrop({x:0,y:0},{x:18000,y:1600},20000,2000);
  assert.ok(panoramic.width<=10_000 && panoramic.height<=10_000);
  assert.deepEqual(validateCrop(panoramic,20000,2000),{width:panoramic.width,height:panoramic.height});

  const square=drawCrop({x:0,y:0},{x:8000,y:8000},8000,8000,'1');
  assert.equal(square.width,square.height);
  assert.deepEqual(validateCrop(square,8000,8000),{width:square.width,height:square.height});
  const ratio=drawCrop({x:8000,y:6000},{x:0,y:0},9000,7000,String(16/9));
  assert.deepEqual(validateCrop(ratio,9000,7000),{width:ratio.width,height:ratio.height});
});
