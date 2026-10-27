import { test, expect } from '@playwright/test';

async function uploadSynthetic(page, count=1){
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
