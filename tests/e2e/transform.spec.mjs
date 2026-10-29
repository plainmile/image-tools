import {test,expect} from '@playwright/test';

async function testPng(page,width=40,height=30){
  const bytes=await page.evaluate(async([w,h])=>{
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ef0000';ctx.fillRect(0,0,w/2,h);
    ctx.fillStyle='#0000ef';ctx.fillRect(w/2,0,w/2,h);
    ctx.fillStyle='#00ef00';ctx.fillRect(0,0,Math.max(1,Math.floor(w/4)),Math.max(1,Math.floor(h/4)));
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  },[width,height]);
  return Buffer.from(bytes);
}

async function downloadedPixels(page){
  return await page.evaluate(async()=>{
    const a=document.querySelector('[data-testid=transform-download]');
    const blob=await (await fetch(a.href)).blob();
    const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
    const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
    const obj={name:a.download,mime:blob.type,bytes:blob.size,w:bitmap.width,h:bitmap.height,
      tl:pixel(0,0),tr:pixel(bitmap.width-1,0),bl:pixel(0,bitmap.height-1)};
    bitmap.close();
    return obj;
  });
}

test('crop and rotate have bilingual titles, canonical and mobile width without overflow',async({page})=>{
  for(const route of ['/crop-image/','/zh/crop-image/','/rotate-image/','/zh/rotate-image/']){
    const response=await page.goto(route);
    expect(response.status()).toBe(200);
    await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://image.plainmile.com'+route);
    const englishRoute=route.startsWith('/zh/')?route.slice(3):route;
    await expect(page.locator('link[hreflang=en]')).toHaveAttribute('href','https://image.plainmile.com'+englishRoute);
    await expect(page.locator('link[hreflang=zh-CN]')).toHaveAttribute('href',/https:\/\/image\.plainmile\.com\/zh\/(crop-image|rotate-image)\//);
    await expect(page.getByTestId('transform-process')).toBeDisabled();
  }
  await page.setViewportSize({width:375,height:812});
  for(const route of ['/zh/crop-image/','/zh/rotate-image/']){
    await page.goto(route);
    await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
    const widths=await page.evaluate(()=>({
      content:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.content+1);
  }
});

test('crop exports only selected original pixels, without stretching or uploading @public-smoke',async({page})=>{
  const posts=[];
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))posts.push(r.url());});
  await page.goto('/crop-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  await page.getByTestId('transform-upload').setInputFiles({
    name:'corners.png',mimeType:'image/png',buffer:await testPng(page)
  });
  await expect(page.getByTestId('transform-dimensions')).toContainText('px');
  await page.locator('.transform-coordinates summary').click();
  await page.getByTestId('crop-width').fill('10');
  await page.getByTestId('crop-height').fill('9');
  await page.getByTestId('crop-x').fill('0');
  await page.getByTestId('crop-y').fill('0');
  await expect(page.getByTestId('transform-dimensions')).toContainText('10×9 px');
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const result=await downloadedPixels(page);
  expect(result.name).toBe('corners-cropped.png');
  expect([result.w,result.h]).toEqual([10,9]);
  expect(result.mime).toBe('image/png');
  expect(result.tl[1]).toBeGreaterThan(220); // green upper-left pattern
  expect(result.bl[0]).toBeGreaterThan(220); // red lower-left
  expect(posts).toEqual([]);
  await page.getByTestId('crop-x').fill('15');
  await expect(page.getByTestId('transform-download')).toHaveCount(0);
});

test('crop stays adjustable after first export and regenerates only on demand',async({page})=>{
  await page.goto('/crop-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  await page.getByTestId('transform-upload').setInputFiles({
    name:'refine.png',mimeType:'image/png',buffer:await testPng(page,80,60)
  });
  await page.locator('.transform-coordinates summary').click();
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  await expect(page.getByTestId('crop-stage')).toBeVisible();
  await expect(page.getByTestId('transform-crop-result-preview')).toBeVisible();
  const first=await page.evaluate(async()=>{
    const url=document.querySelector('[data-testid=transform-download]').href;
    return [...new Uint8Array(await(await fetch(url)).arrayBuffer())];
  });
  const before=Number(await page.getByTestId('crop-x').inputValue());
  // Clicking Apply changes can scroll the controls into view; scroll the
  // actual frame back into the viewport before sending mouse coordinates.
  await page.getByTestId('crop-selection').scrollIntoViewIfNeeded();
  const frame=await page.getByTestId('crop-selection').boundingBox();
  const x=frame.x+frame.width/2,y=frame.y+frame.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+26,y,{steps:8});
  await page.mouse.up();
  await expect.poll(async()=>Number(await page.getByTestId('crop-x').inputValue())).toBeGreaterThan(before);
  await expect(page.getByTestId('transform-download')).toHaveCount(0);
  await expect(page.getByTestId('transform-crop-result-preview')).toHaveCount(0);
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const second=await page.evaluate(async()=>{
    const url=document.querySelector('[data-testid=transform-download]').href;
    return [...new Uint8Array(await(await fetch(url)).arrayBuffer())];
  });
  expect(second).not.toEqual(first);
});

test('square crop keeps ratio while dragging and produces an actual square file',async({page})=>{
  await page.goto('/zh/crop-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  await page.getByTestId('transform-upload').setInputFiles({
    name:'square.png',mimeType:'image/png',buffer:await testPng(page,80,60)
  });
  await page.getByTestId('crop-aspect').selectOption('1');
  await page.locator('.transform-coordinates summary').click();
  const width=Number(await page.getByTestId('crop-width').inputValue());
  const height=Number(await page.getByTestId('crop-height').inputValue());
  expect(width).toBe(height);
  const frame=await page.getByTestId('crop-selection').boundingBox();
  const stage=await page.getByTestId('crop-stage').boundingBox();
  const start={x:frame.x+frame.width/2,y:frame.y+frame.height/2};
  await page.mouse.move(start.x,start.y);
  await page.mouse.down();
  await page.mouse.move(start.x+Math.min(14,stage.width/8),start.y+2,{steps:6});
  await page.mouse.up();
  const movedX=Number(await page.getByTestId('crop-x').inputValue());
  expect(movedX).toBeGreaterThanOrEqual(0);
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const result=await downloadedPixels(page);
  expect(result.w).toBe(result.h);
});

test('locked square crop corner grows from a vertical-only drag and exports correct pixels',async({page})=>{
  await page.goto('/zh/crop-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  await page.getByTestId('transform-upload').setInputFiles({
    name:'vertical-corner.png',mimeType:'image/png',buffer:await testPng(page,400,400)
  });
  await page.getByTestId('crop-aspect').selectOption('1');
  await page.locator('.transform-coordinates summary').click();
  const before=Number(await page.getByTestId('crop-width').inputValue());
  expect(before).toBe(Number(await page.getByTestId('crop-height').inputValue()));
  await page.locator('.crop-handle').scrollIntoViewIfNeeded();
  const handle=await page.locator('.crop-handle').boundingBox();
  const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+20,{steps:10});
  await page.mouse.up();
  const afterWidth=Number(await page.getByTestId('crop-width').inputValue());
  const afterHeight=Number(await page.getByTestId('crop-height').inputValue());
  expect(afterWidth).toBeGreaterThan(before);
  expect(afterWidth).toBe(afterHeight);
  await expect(page.getByTestId('transform-dimensions')).toContainText(afterWidth+'×'+afterHeight+' px');
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const output=await downloadedPixels(page);
  expect(output.name).toBe('vertical-corner-cropped.png');
  expect([output.w,output.h]).toEqual([afterWidth,afterHeight]);
  // Exact coordinate editing still works after the drag and clears stale exports.
  await page.getByTestId('crop-height').fill('200');
  await expect(page.getByTestId('transform-dimensions')).toContainText('200×200 px');
  await expect(page.getByTestId('transform-download')).toHaveCount(0);
});

test('right rotation swaps pixels and flip-horizontal mirrors the rotated preview @public-smoke',async({page})=>{
  await page.goto('/rotate-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  await page.getByTestId('transform-upload').setInputFiles({
    name:'orientation.png',mimeType:'image/png',buffer:await testPng(page,40,30)
  });
  await expect(page.getByTestId('transform-process')).toBeDisabled();
  await page.getByTestId('rotate-right').click();
  await expect(page.getByTestId('transform-dimensions')).toContainText('30×40');
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const clockwise=await downloadedPixels(page);
  expect([clockwise.w,clockwise.h]).toEqual([30,40]);
  expect(clockwise.tr[1]).toBeGreaterThan(220); // top-left source green turns to top-right
  expect(clockwise.tl[0]).toBeGreaterThan(220); // bottom-left source red turns to top-left
  await page.getByTestId('flip-horizontal').click();
  await expect(page.getByTestId('flip-horizontal')).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('transform-download')).toHaveCount(0);
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const mirrored=await downloadedPixels(page);
  expect(mirrored.tl[1]).toBeGreaterThan(220); // now top-left is original green
  expect([mirrored.w,mirrored.h]).toEqual([30,40]);
  await page.locator('button.transform-reset').click();
  await expect(page.getByTestId('transform-process')).toBeDisabled();
});

test('transparent PNG rotates to JPEG with white background, no silent animation export',async({page})=>{
  await page.goto('/zh/rotate-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  const transparent=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=25;canvas.height=10;
    canvas.getContext('2d').fillRect(5,3,8,4);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('transform-upload').setInputFiles({name:'alpha.png',mimeType:'image/png',buffer:Buffer.from(transparent)});
  await page.getByTestId('transform-format').selectOption('jpeg');
  await expect(page.getByTestId('transform-alpha-warning')).toBeVisible();
  await page.getByTestId('rotate-right').click();
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const converted=await downloadedPixels(page);
  expect(converted.mime).toBe('image/jpeg');
  expect([converted.w,converted.h]).toEqual([10,25]);
  expect(converted.tl.slice(0,3).every(x=>x>240)).toBe(true);
  const fake=Buffer.from([82,73,70,70,28,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,2]);
  const existingHref=await page.getByTestId('transform-download').getAttribute('href');
  await page.getByTestId('transform-upload').setInputFiles({name:'anim.webp',mimeType:'image/webp',buffer:fake});
  await expect(page.getByTestId('transform-status')).toContainText('动画');
  // Invalid animated input must not discard an earlier completed edit.
  await expect(page.getByTestId('transform-status')).toContainText('已保留');
  await expect(page.getByTestId('transform-download')).toHaveAttribute('href',existingHref);
  await expect(page.getByTestId('transform-process')).toBeEnabled();
});
