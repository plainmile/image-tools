import { test, expect } from '@playwright/test';

async function uploadSynthetic(page, count=1){
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const png=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=120;c.height=80;
    const x=c.getContext('2d');x.fillStyle='#cf3d4e';x.fillRect(0,0,120,80);
    x.fillStyle='#104679';x.fillRect(20,20,60,40);
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('upload').setInputFiles(Array.from({length:count},(_,i)=>({name:'sample-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(png)})));
}
test('English and Chinese pages contain valid static SEO metadata',async({page})=>{
  for(const route of ['/','/zh/','/resize-image/','/zh/resize-image/','/compress-image-to-size/','/zh/compress-image-to-size/','/signature-resizer/','/zh/signature-resizer/','/bulk-image-resizer/','/zh/bulk-image-resizer/','/passport-photo-print/','/zh/passport-photo-print/','/privacy/','/zh/privacy/']){
    const response=await page.goto(route);expect(response.status()).toBe(200);
    const canonical=await page.locator('link[rel=canonical]').getAttribute('href');
    expect(canonical).toBe('https://image.plainmile.com'+route);
    expect(await page.locator('link[hreflang=en]').count()).toBe(1);
    expect(await page.locator('link[hreflang=zh-CN]').count()).toBe(1);
  }
});
test('real JPG is generated at exact requested dimensions with correct decoded pixel data',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByTestId('width').fill('64');await page.getByTestId('height').fill('64');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('result-meta')).toContainText('64×64');
  const values=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid=download]');const blob=await (await fetch(link.href)).blob();
    const bitmap=await createImageBitmap(blob);const result={width:bitmap.width,height:bitmap.height,type:blob.type,bytes:blob.size};bitmap.close();return result;
  });
  expect(values).toMatchObject({width:64,height:64,type:'image/jpeg'});expect(values.bytes).toBeGreaterThan(100);
});
test('compression to KB limit verifies actual bytes',async({page})=>{
  await page.goto('/compress-image-to-size/');await uploadSynthetic(page);
  await page.getByTestId('width').fill('100');await page.getByTestId('height').fill('80');
  await page.getByTestId('target').fill('20');await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const bytes=await page.evaluate(async()=> (await (await fetch(document.querySelector('[data-testid=download]').href)).blob()).size);
  expect(bytes).toBeLessThanOrEqual(20*1024);
});
test('bulk ZIP contains actual processed images',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,2);
  await page.getByTestId('width').fill('55');await page.getByTestId('height').fill('35');
  await page.getByTestId('process').click();await expect(page.getByTestId('download')).toBeVisible();
  const entries=await page.evaluate(async()=>{
    const blob=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
    const buffer=new Uint8Array(await blob.arrayBuffer());
    return {header:Array.from(buffer.slice(0,4)),size:buffer.length};
  });
  expect(entries.header).toEqual([80,75,3,4]);expect(entries.size).toBeGreaterThan(100);
});
test('passport 4x6 output is 1200 by 1800',async({page})=>{
  await page.goto('/passport-photo-print/');await uploadSynthetic(page);
  await page.getByTestId('process').click();
  await expect(page.getByTestId('result-meta')).toContainText('1200×1800');
  const result=await page.evaluate(async()=>{const b=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();const i=await createImageBitmap(b);return [i.width,i.height];});
  expect(result).toEqual([1200,1800]);
});
test('mobile remains usable and navigation works',async({page})=>{
  await page.setViewportSize({width:375,height:812});await page.goto('/zh/resize-image/');
  await expect(page.getByRole('heading',{level:1})).toBeVisible();
  await uploadSynthetic(page);await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
});
test('invalid and oversized dimensions report error without false download',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByTestId('width').fill('9000');await page.getByTestId('height').fill('9000');
  await page.getByTestId('process').click();await expect(page.getByTestId('status')).toContainText('32-megapixel');
  await expect(page.getByTestId('download')).toHaveCount(0);
});

test('sibling websites appear on both language versions', async({page}) => {
  for (const route of ['/', '/zh/', '/resize-image/', '/zh/resize-image/']) {
    await page.goto(route);
    await expect(page.locator('footer a[href="https://plainmile.com/"]')).toBeVisible();
    await expect(page.locator('footer a[href="https://pdf.plainmile.com/"]')).toBeVisible();
  }
});

test('plain tool-first layout and localized labels',async({page})=>{
  for(const route of ['/','/zh/']){
    await page.goto(route);
    await expect(page.locator('.tool-list .tool-link')).toHaveCount(5);
    await expect(page.locator('.brandmark,.eyebrow,.tile')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/No uploads, accounts, or AI|无需上传、账号或 AI/);
  }
  await page.goto('/zh/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByRole('heading',{name:'参数设置'})).toBeVisible();
  await uploadSynthetic(page);
  await expect(page.locator('.preview-frame canvas')).toBeVisible();
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
});
test('375px layout has no horizontal page overflow',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  for(const route of ['/zh/','/zh/resize-image/','/passport-photo-print/']){
    await page.goto(route);
    if(route!=='/zh/') await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);
  }
});

test('transparent PNG retains alpha; JPEG gets white background',async({page})=>{
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const bytes=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=24;c.height=24;
    const ctx=c.getContext('2d');ctx.clearRect(0,0,24,24);
    ctx.fillStyle='red';ctx.fillRect(8,8,8,8);
    return Array.from(new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer()));
  });
  await page.getByTestId('upload').setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await page.getByTestId('width').fill('24');await page.getByTestId('height').fill('24');
  await page.getByTestId('format').selectOption('png');await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const a=await page.evaluate(async()=>{
    const b=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
    const i=await createImageBitmap(b);const c=document.createElement('canvas');c.width=24;c.height=24;
    const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,1,1).data[3];
  });
  expect(a).toBe(0);
  await page.getByTestId('format').selectOption('jpeg');
  await expect(page.getByTestId('download')).toHaveCount(0);
  await page.getByTestId('process').click();await expect(page.getByTestId('download')).toBeVisible();
  const rgb=await page.evaluate(async()=>{
    const b=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
    const i=await createImageBitmap(b);const c=document.createElement('canvas');c.width=24;c.height=24;
    const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return Array.from(ctx.getImageData(0,0,1,1).data);
  });
  expect(rgb[0]).toBeGreaterThan(240);expect(rgb[1]).toBeGreaterThan(240);expect(rgb[2]).toBeGreaterThan(240);
});
test('clearing a pixel input with lock aspect ratio does not crash',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByLabel('Keep aspect ratio').check();
  await page.getByTestId('width').fill('');
  await expect(page.getByTestId('width')).toHaveValue('');
  await page.getByTestId('width').fill('60');
  await expect(page.getByTestId('height')).toHaveValue('40');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('result-meta')).toContainText('60×40');
});
test('print sheet JPEG declares 300 pixels per inch in JFIF',async({page})=>{
  await page.goto('/passport-photo-print/');await uploadSynthetic(page);
  await page.getByTestId('process').click();await expect(page.getByTestId('download')).toBeVisible();
  const marker=await page.evaluate(async()=>{
    const b=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
    const v=new Uint8Array(await b.arrayBuffer());
    return {identifier:Array.from(v.slice(6,11)),units:v[13],x:v[14]*256+v[15],y:v[16]*256+v[17]};
  });
  expect(marker).toEqual({identifier:[74,70,73,70,0],units:1,x:300,y:300});
});
test('single-image tools reject multiple uploads and expose real crop preview',async({page})=>{
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await uploadSynthetic(page,2);
  await expect(page.getByTestId('status')).toContainText('Choose one image');
  await expect(page.getByTestId('process')).toBeDisabled();
  await uploadSynthetic(page,1);
  await page.getByLabel('Fitting').selectOption('cover');
  await expect(page.locator('.preview-frame canvas')).toBeVisible();
});
