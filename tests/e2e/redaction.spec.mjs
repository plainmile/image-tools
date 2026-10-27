import {test,expect} from '@playwright/test';

async function synthetic(page,count=1){
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const png=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=960;c.height=280;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,960,280);
    ctx.fillStyle='#101010';ctx.font='bold 78px Arial';ctx.fillText('SECRET 12345',50,145);
    for(let x=0;x<960;x+=8){
      ctx.fillStyle=(x/8)%2?'#fff':'#000';
      ctx.fillRect(x,190,8,80);
    }
    const blob=await new Promise(ok=>c.toBlob(ok,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('redact-upload').setInputFiles(
    Array.from({length:count},(_,i)=>({
      name:'capture-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(png)
    }))
  );
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  await expect(page.getByTestId('redact-preview')).toHaveAttribute('data-rendered','true');
}
async function draw(page,a=[.2,.25],b=[.65,.65]){
  const rect=await page.getByTestId('redact-overlay').boundingBox();
  await page.mouse.move(rect.x+rect.width*a[0],rect.y+rect.height*a[1]);
  await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*b[0],rect.y+rect.height*b[1],{steps:8});
  await page.mouse.up();
}
async function downloadCapture(page,testId){
  await page.evaluate(()=>{
    const old=URL.createObjectURL.bind(URL);
    window.__saved=[];
    URL.createObjectURL=blob=>{window.__saved.push(blob);return old(blob);};
  });
  const awaited=page.waitForEvent('download');
  await page.getByTestId(testId).click();
  return await awaited;
}
async function outputData(page) {
  return page.evaluate(async()=>{
    const blob=window.__saved.at(-1);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const result={type:blob.type,size:blob.size,signature:Array.from(bytes.subarray(0,4)),
      zipText:new TextDecoder('latin1').decode(bytes)};
    if(blob.type.startsWith('image/')){
      const image=await createImageBitmap(blob);
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
      result.width=image.width;result.height=image.height;
      result.pixel=(x,y)=>0;
      result.masked=Array.from(ctx.getImageData(300,140,1,1).data);
      result.background=Array.from(ctx.getImageData(10,10,1,1).data);
      result.left=Array.from(ctx.getImageData(200,50,1,1).data);
      result.right=Array.from(ctx.getImageData(740,50,1,1).data);
      result.stripe=Array.from(ctx.getImageData(225,230,1,1).data);
      image.close();
    }
    delete result.pixel;
    delete result.zipTextIfUnused;
    return result;
  });
}
async function previewStripe(page) {
  return page.getByTestId('redact-preview').evaluate(c=>{
    const x=Math.floor(c.width*.234),y=Math.floor(c.height*.82);
    return Array.from(c.getContext('2d').getImageData(x,y,1,1).data);
  });
}

test('English/Chinese pages contain manual-only descriptions and correct SEO',async({page})=>{
  for(const route of ['/redact-image/','/zh/redact-image/']){
    const response=await page.goto(route);expect(response.status()).toBe(200);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://image.plainmile.com'+route);
    await expect(page.locator('link[hreflang=en]')).toHaveAttribute('href','https://image.plainmile.com/redact-image/');
    await expect(page.locator('link[hreflang=zh-CN]')).toHaveAttribute('href','https://image.plainmile.com/zh/redact-image/');
    await synthetic(page);
    for(const style of ['solid','mosaic','blur'])await expect(page.getByTestId('redact-style-'+style)).toBeVisible();
    await expect(page.locator('[data-testid^="redact-ocr"]')).toHaveCount(0);
  }
  await page.goto('/zh/');
  await expect(page.locator('main')).not.toContainText('自动识别文字并遮挡');
});

test('manual solid black replaces original pixels in real preview and PNG export',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect.poll(async()=>page.getByTestId('redact-preview').evaluate(c=>{
    const x=Math.floor(c.width*300/960),y=Math.floor(c.height*140/280);
    return c.getContext('2d').getImageData(x,y,1,1).data[0];
  })).toBe(0);
  const dl=await downloadCapture(page,'redact-download');
  expect(dl.suggestedFilename()).toBe('redacted-image.png');
  const out=await outputData(page);
  expect(out.type).toBe('image/png');
  expect([out.width,out.height]).toEqual([960,280]);
  expect(out.masked.slice(0,3)).toEqual([0,0,0]);
  expect(out.background.slice(0,3)).toEqual([255,255,255]);
  await expect(page.getByTestId('redact-status')).toContainText('960×280');
});

test('solid color can be black and white in different regions of one image',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page);
  await draw(page,[.1,.08],[.34,.3]);
  await page.getByTestId('redact-color-white').click();
  await draw(page,[.6,.08],[.92,.3]);
  await downloadCapture(page,'redact-download');
  const out=await outputData(page);
  expect(out.left.slice(0,3)).toEqual([0,0,0]);
  expect(out.right.slice(0,3)).toEqual([255,255,255]);
  await expect(page.getByTestId('redact-count')).toHaveText('2');
});

for(const style of ['mosaic','blur']){
  test(style+' shows real filtered pixels in preview and exported output',async({page})=>{
    await page.goto('/redact-image/');await synthetic(page);
    await page.getByTestId('redact-style-'+style).click();
    await page.getByTestId('redact-strength').press('End');
    await draw(page,[.1,.72],[.9,.96]);
    await expect(page.getByTestId('redact-count')).toHaveText('1');
    const debug=await page.getByTestId('redact-preview').evaluate(c=>{
      const ctx=c.getContext('2d'),ys=Math.floor(c.height*.82);
      return [.22,.225,.23,.235,.24,.245,.25].map(x=>ctx.getImageData(Math.floor(c.width*x),ys,1,1).data[0]);
    });
    console.log('manual preview '+style+': '+JSON.stringify(debug));
    await expect.poll(async()=>(await previewStripe(page))[0]).toBeGreaterThan(30);
    const pre=await previewStripe(page);
    expect(pre[0]).toBeLessThan(220);
    await downloadCapture(page,'redact-download');
    const out=await outputData(page);
    expect(out.stripe[0]).toBeGreaterThan(30);
    expect(out.stripe[0]).toBeLessThan(220);
  });
}

test('solid covers are never overwritten by overlapping pixelation',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page);
  await draw(page,[.2,.25],[.65,.65]);
  await page.getByTestId('redact-style-mosaic').click();
  await draw(page,[.1,.2],[.75,.68]);
  await downloadCapture(page,'redact-download');
  expect((await outputData(page)).masked.slice(0,3)).toEqual([0,0,0]);
});

test('remove mode and per-image undo/redo work without changing other images',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page,2);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByTestId('redact-undo').click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.getByTestId('redact-redo').click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByRole('button',{name:'Remove rectangle'}).click();
  await page.getByTestId('redact-mark').first().click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.getByTestId('redact-undo').click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByRole('button',{name:/capture-1.png/}).click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await expect(page.getByTestId('redact-undo')).toBeDisabled();
  await page.getByRole('button',{name:/capture-0.png/}).click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByRole('button',{name:'Clear all'}).click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.getByTestId('redact-undo').click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});

test('batch ZIP rejects unredacted image and never includes original filenames',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page,2);
  await draw(page);
  await page.getByTestId('redact-download-all').click();
  await expect(page.getByTestId('redact-status')).toContainText('Every exported image');
  await page.getByRole('button',{name:/capture-1.png/}).click();
  await draw(page);
  const dl=await downloadCapture(page,'redact-download-all');
  expect(dl.suggestedFilename()).toBe('plainmile-redacted-images.zip');
  const out=await outputData(page);
  expect(out.signature).toEqual([80,75,3,4]);
  expect(out.size).toBeGreaterThan(200);
  expect(out.zipText).toContain('redacted-01.png');
  expect(out.zipText).toContain('redacted-02.png');
  expect(out.zipText).not.toContain('capture-0');
  expect(out.zipText).not.toContain('capture-1');
});

test('images never leave browser and OCR models are not requested',async({page})=>{
  await page.goto('/redact-image/');
  const unexpected=[];
  const origin=new URL(page.url()).origin;
  page.on('request',request=>{
    if(!['GET','HEAD'].includes(request.method()))unexpected.push(request.url());
    const url=request.url();
    if(url.startsWith('http')&&new URL(url).origin!==origin)unexpected.push(url);
    if(url.includes('/ocr/')||/tesseract|traineddata/i.test(url))unexpected.push(url);
  });
  await synthetic(page);await draw(page);
  const dl=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();await dl;
  expect(unexpected).toEqual([]);
});

test('mobile and portrait image editor have no stretch or horizontal overflow',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('/zh/redact-image/');await synthetic(page);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  const width=await page.evaluate(()=>({
    outer:document.documentElement.scrollWidth,
    inner:document.documentElement.clientWidth
  }));
  expect(width.outer).toBeLessThanOrEqual(width.inner+1);
  const png=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=240;c.height=1200;
    const blob=await new Promise(ok=>c.toBlob(ok,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('redact-upload').setInputFiles({
    name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(png)
  });
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  const bounds=await page.locator('.redactor-stage').evaluate(el=>{
    const box=el.getBoundingClientRect();return {width:box.width,height:box.height};
  });
  expect(Math.abs(bounds.width/bounds.height-0.2)).toBeLessThan(.015);
  expect(bounds.height).toBeLessThanOrEqual(651);
});

test('invalid files cannot replace an existing good image or trigger an export',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page);
  await page.getByTestId('redact-upload').setInputFiles({
    name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')
  });
  await expect(page.getByTestId('redact-status')).toContainText('Only JPEG, PNG and WebP');
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  await expect(page.getByTestId('redact-download')).toBeDisabled();
});

test('public HTML opts out of proxy analytics injection',async({request})=>{
  const response=await request.get('/redact-image/');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['cache-control']).toContain('no-transform');
});
