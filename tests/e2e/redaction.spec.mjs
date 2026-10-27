import {test,expect} from '@playwright/test';

async function synthetic(page,count=1){
  const bytes=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=960;c.height=280;
    const x=c.getContext('2d',{alpha:false});
    x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
    x.fillStyle='#111';x.font='bold 78px Arial';x.fillText('SECRET 12345',50,145);
    const blob=await new Promise(ok=>c.toBlob(ok,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  await page.getByTestId('redact-upload').setInputFiles(Array.from({length:count},(_,i)=>({
    name:'capture-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(bytes),
  })));
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  return bytes;
}
async function draw(page,from=[.2,.25],to=[.65,.65]){
  const box=await page.getByTestId('redact-overlay').boundingBox();
  await page.mouse.move(box.x+box.width*from[0],box.y+box.height*from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*to[0],box.y+box.height*to[1],{steps:8});
  await page.mouse.up();
}

test('redaction pages are indexed separately and language links are reciprocal', async({page})=>{
  for(const route of ['/redact-image/','/zh/redact-image/']){
    const response=await page.goto(route);
    expect(response.status()).toBe(200);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://image.plainmile.com'+route);
    await expect(page.locator('link[hreflang=en]')).toHaveAttribute('href','https://image.plainmile.com/redact-image/');
    await expect(page.locator('link[hreflang=zh-CN]')).toHaveAttribute('href','https://image.plainmile.com/zh/redact-image/');
    await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  }
});
test('manual black box is flattened into new PNG pixels and leaves other pixels unchanged',async({page})=>{
  await page.goto('/redact-image/');
  await synthetic(page);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.evaluate(()=>{
    const old=URL.createObjectURL.bind(URL);
    window.__exports=[];
    URL.createObjectURL=(blob)=>{window.__exports.push(blob);return old(blob);};
  });
  const download=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await download;
  const result=await page.evaluate(async()=>{
    const blob=window.__exports.at(-1);
    const image=await createImageBitmap(blob);
    const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    const x=c.getContext('2d');x.drawImage(image,0,0);
    return {mime:blob.type,width:image.width,height:image.height,
      masked:Array.from(x.getImageData(300,140,1,1).data),
      untouched:Array.from(x.getImageData(10,10,1,1).data)};
  });
  expect(result.mime).toBe('image/png');
  expect([result.width,result.height]).toEqual([960,280]);
  expect(result.masked.slice(0,3)).toEqual([0,0,0]);
  expect(result.untouched.slice(0,3)).toEqual([255,255,255]);
});
test('remove mode deletes a box, and users can add a replacement',async({page})=>{
  await page.goto('/zh/redact-image/');await synthetic(page);
  await draw(page,[.1,.15],[.5,.6]);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByRole('button',{name:'删除遮挡框'}).click();
  await page.getByTestId('redact-mark').first().click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.getByRole('button',{name:'手动加框'}).click();
  await draw(page,[.1,.2],[.4,.5]);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});
test('batch export requires a mask on each image and packages a ZIP',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page,2);
  await draw(page);
  await page.getByTestId('redact-download-all').click();
  await expect(page.getByTestId('redact-status')).toContainText('Add at least one box');
  await page.getByRole('button',{name:/capture-1.png/}).click();
  await draw(page);
  await page.evaluate(()=>{
    const previous=URL.createObjectURL.bind(URL);
    window.__zipExports=[];
    URL.createObjectURL=(blob)=>{window.__zipExports.push(blob);return previous(blob);};
  });
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download-all').click();
  const result=await downloaded;
  expect(result.suggestedFilename()).toBe('plainmile-redacted-images.zip');
  const zip=await page.evaluate(async()=>{
    const b=window.__zipExports.at(-1);
    const v=new Uint8Array(await b.arrayBuffer());
    return {header:Array.from(v.slice(0,4)),bytes:v.length};
  });
  expect(zip.header).toEqual([80,75,3,4]);
  expect(zip.bytes).toBeGreaterThan(200);
});
test('no source image is submitted to an external server',async({page})=>{
  const unexpected=[];
  await page.goto('/redact-image/');
  const expectedOrigin=new URL(page.url()).origin;
  page.on('request',r=>{
    if(r.method()!=='GET'&&r.method()!=='HEAD')unexpected.push(r.url());
    if(r.url().startsWith('http')&&new URL(r.url()).origin!==expectedOrigin)unexpected.push(r.url());
  });
  await synthetic(page);await draw(page);
  const p=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();await p;
  expect(unexpected).toEqual([]);
});
test('redaction is usable on a narrow mobile screen',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('/zh/redact-image/');
  await synthetic(page);await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  const dimensions=await page.evaluate(()=>({total:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
  expect(dimensions.total).toBeLessThanOrEqual(dimensions.viewport+1);
});
test('actual local OCR finds English text, permits unchecking a suggestion and never contacts an outside OCR service',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium','Run full on-device OCR once; manual features run in all engines');
  test.setTimeout(180000);
  const offsite=[];
  page.on('request',r=>{if(r.url().startsWith('http')&&r.url().indexOf('image.plainmile.com')<0 &&
    !r.url().startsWith('http://127.0.0.1:18082'))offsite.push(r.url());});
  await page.goto('/redact-image/');await synthetic(page);
  const browserErrors=[];
  page.on('pageerror',e=>browserErrors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')browserErrors.push(e.text());});
  page.on('requestfailed',r=>browserErrors.push(r.url()+' '+r.failure()?.errorText));
  page.on('response',response=>{
    if(response.url().includes('/ocr/')&&response.status()>=400){
      browserErrors.push('OCR asset HTTP '+response.status()+' '+response.url());
    }
  });
  await page.getByTestId('redact-ocr').click();
  try{
    await expect(page.getByTestId('redact-mark').first()).toBeVisible({timeout:90000});
  }catch(error){
    const status=await page.getByTestId('redact-status').innerText();
    throw new Error('Actual OCR did not detect text. Status: '+status+' Browser errors: '+
      JSON.stringify(browserErrors)+'; '+error.message);
  }
  const n=await page.getByTestId('redact-mark').count();
  expect(n).toBeGreaterThan(0);
  await expect(page.getByTestId('redact-count')).toHaveText(String(n));
  const c=page.locator('.redactor-recognized input[type=checkbox]').first();
  await expect(c).toBeChecked();
  await c.uncheck();
  await expect(page.getByTestId('redact-count')).toHaveText(String(n-1));
  await page.getByRole('button',{name:'Select all detected'}).click();
  await expect(page.getByTestId('redact-count')).toHaveText(String(n));
  expect(offsite).toEqual([]);
});


test('mixed OCR loads the locally hosted Simplified Chinese model and detects screenshot text', async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium','Exercise both local OCR language packs in Chromium');
  test.setTimeout(180000);
  const outside=[];
  await page.goto('/zh/redact-image/');
  const origin=new URL(page.url()).origin;
  page.on('request',r=>{
    if(r.url().startsWith('http')&&new URL(r.url()).origin!==origin)outside.push(r.url());
  });
  await synthetic(page);
  await page.getByLabel('识别语言').selectOption('mixed');
  await page.getByTestId('redact-ocr').click();
  try{
    await expect(page.getByTestId('redact-mark').first()).toBeVisible({timeout:120000});
  }catch{
    throw new Error('Mixed-language OCR status: '+await page.getByTestId('redact-status').innerText());
  }
  await expect(page.getByTestId('redact-count')).not.toHaveText('0');
  expect(outside).toEqual([]);
});

test('undo, redo and clear are reversible per image',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page,2);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByTestId('redact-undo').click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.getByTestId('redact-redo').click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByRole('button',{name:'Clear all boxes'}).click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.getByTestId('redact-undo').click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByRole('button',{name:/capture-1.png/}).click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await expect(page.getByTestId('redact-undo')).toBeDisabled();
  await page.getByRole('button',{name:/capture-0.png/}).click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});
test('black redaction preview is fully opaque rather than a translucent mockup',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page);await draw(page);
  const fill=await page.getByTestId('redact-mark').first().getAttribute('fill');
  expect(fill).toBe('#000');
});
test('public HTML opts out of proxy script injection with no-transform',async({request})=>{
  const response=await request.get('/redact-image/');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['cache-control']).toContain('no-transform');
});
