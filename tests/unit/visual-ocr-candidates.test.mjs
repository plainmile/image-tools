import test from 'node:test';
import assert from 'node:assert/strict';
import { detectReviewRegions } from '../../src/lib/visual-ocr-candidates.mjs';

test('industrial overlays produce three distinct, review-only regions',()=>{
  const w=960,h=540,rgba=new Uint8Array(w*h*4);
  for(let p=0;p<rgba.length;p+=4){
    rgba[p]=104;rgba[p+1]=123;rgba[p+2]=137;rgba[p+3]=255;
  }
  function draw(x0,y0,width,height,r,g,b){
    for(let y=y0;y<y0+height;y++)for(let x=x0;x<x0+width;x++){
      const p=(y*w+x)*4;
      rgba[p]=r;rgba[p+1]=g;rgba[p+2]=b;
    }
  }
  // Repeated vertical fins are part of an equipment background.
  for(let i=0;i<40;i++)draw(60+i*20,150,7,220,125,140,146);
  // Clearly separated timestamp, red middle label and bottom overlay.
  for(let i=0;i<16;i++)draw(630+i*15,30,8,29,247,247,247);
  for(let i=0;i<9;i++)draw(420+i*11,299,7,27,211,29,28);
  for(let i=0;i<25;i++)draw(30+i*14,490,8,28,247,247,247);
  const boxes=detectReviewRegions(rgba,w,h,1920,1080);
  assert.deepEqual(boxes.map(b=>b.kind),['top','bottom','color']);
  const [top,bottom,color]=boxes;
  assert.ok(top.x>1200 && top.y<150);
  assert.ok(bottom.y>900 && bottom.x<150);
  assert.ok(color.x>750 && color.x<1000 && color.y>530 && color.y<750);
  for(const b of boxes){
    assert.ok(b.w>30 && b.h>20);
    assert.ok(b.x>=0 && b.y>=0 && b.x+b.w<=1920 && b.y+b.h<=1080);
  }
});

test('invalid or empty image buffers do not create false candidates',()=>{
  assert.deepEqual(detectReviewRegions(new Uint8Array(0),100,100),[]);
  assert.deepEqual(detectReviewRegions(null,0,0),[]);
});
