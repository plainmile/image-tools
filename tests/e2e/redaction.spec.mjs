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
  // ZIP filenames are stored in cleartext: never leak source image filenames.
  const names=await page.evaluate(async()=>{
    const blob=window.__zipExports.at(-1);
    return new TextDecoder('latin1').decode(await blob.arrayBuffer());
  });
  expect(names).toContain('redacted-01.png');
  expect(names).toContain('redacted-02.png');
  expect(names).not.toContain('capture-0');
  expect(names).not.toContain('capture-1');
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
  const c=page.locator('.redactor-recognized input[type=checkbox]').first();
  try{
    await expect(c).toBeVisible({timeout:90000});
  }catch(error){
    const status=await page.getByTestId('redact-status').innerText();
    throw new Error('Actual OCR did not detect reviewable text. Status: '+status+' Browser errors: '+
      JSON.stringify(browserErrors)+'; '+error.message);
  }
  const n=await page.locator('.redactor-recognized input[type=checkbox]').count();
  expect(n).toBeGreaterThan(0);
  await expect(page.getByTestId('redact-suggestion').first()).toBeVisible();
  await expect(page.getByTestId('redact-mark')).toHaveCount(0);
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await expect(c).not.toBeChecked();
  await c.check();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await c.uncheck();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Cover all candidates'}).click();
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
  const checkbox=page.locator('.redactor-recognized input[type=checkbox]').first();
  try{
    await expect(checkbox).toBeVisible({timeout:120000});
  }catch{
    throw new Error('Mixed-language OCR status: '+await page.getByTestId('redact-status').innerText());
  }
  await expect(page.getByTestId('redact-mark')).toHaveCount(0);
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
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

test('downloaded redacted image does not reveal the source filename',async({page})=>{
  await page.goto('/redact-image/');
  await synthetic(page);
  await draw(page);
  const download=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  const result=await download;
  expect(result.suggestedFilename()).toBe('redacted-image.png');
  expect(result.suggestedFilename()).not.toContain('capture');
});

test('users can limit OCR scanning to a selected region and return to full picture',async({page})=>{
  await page.goto('/zh/redact-image/');await synthetic(page);
  await page.getByTestId('redact-region-mode').click();
  await draw(page,[.04,.12],[.70,.80]);
  await expect(page.getByTestId('redact-scan-region')).toBeVisible();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.getByTestId('redact-region-reset').click();
  await expect(page.getByTestId('redact-scan-region')).toHaveCount(0);
});
test('industrial-style texture cannot cause automatic blackout during OCR',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium','Real OCR test with synthetic noisy background');
  test.setTimeout(180000);
  await page.goto('/zh/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const image=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=960;c.height=460;
    const x=c.getContext('2d');
    x.fillStyle='#83a7ce';x.fillRect(0,0,960,460);
    x.fillStyle='#6f7c81';x.fillRect(20,70,920,325);
    for(let k=0;k<42;k++){
      const xx=32+k*21;
      x.fillStyle=k%2?'#c9d1d3':'#78898f';x.fillRect(xx,90,12,285);
      x.strokeStyle='#374c52';x.beginPath();x.moveTo(xx+14,88);x.lineTo(xx+14,380);x.stroke();
    }
    x.fillStyle='#fff';x.font='bold 36px Arial';x.fillText('2026-08-28 12:10:32',450,49);
    x.fillStyle='#fff';x.font='bold 44px Arial';x.fillText('110 kV TRANSFORMER',34,446);
    const blob=await new Promise(ok=>c.toBlob(ok,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('redact-upload').setInputFiles({
    name:'synthetic-equipment.png',mimeType:'image/png',buffer:Buffer.from(image)
  });
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  await page.getByTestId('redact-ocr').click();
  await expect(page.getByTestId('redact-ocr')).toBeDisabled();
  await expect(page.getByTestId('redact-ocr')).toBeEnabled({timeout:120000});
  await expect(page.getByTestId('redact-status')).toContainText('识别');
  await expect(page.getByTestId('redact-mark')).toHaveCount(0);
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await expect(page.getByTestId('redact-download')).toBeDisabled();
});


test('OCR detects text in receipts, chat screenshots and photographed signs at different locations',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium','Real multi-image Tesseract OCR regression');
  test.setTimeout(300000);
  await page.goto('/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const pictures=await page.evaluate(async()=>{
    const themes=[
      {name:'receipt',text:'INVOICE 4826',x:180,y:335},
      {name:'chat',text:'MESSAGE 8421',x:315,y:272},
      {name:'photo',text:'PARKING 284',x:460,y:490},
    ];
    const files=[];
    for(const theme of themes){
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=620;
      const c=canvas.getContext('2d');
      if(theme.name==='receipt'){
        c.fillStyle='#fff';c.fillRect(0,0,960,620);
        c.fillStyle='#777';c.fillRect(65,110,800,3);
        c.fillRect(65,460,800,3);c.fillRect(65,500,800,3);
        c.fillStyle='#141414';
      }else if(theme.name==='chat'){
        c.fillStyle='#f8f8f8';c.fillRect(0,0,960,620);
        c.fillStyle='#284e92';c.fillRect(260,175,630,175);
        c.fillStyle='#fff';
      }else{
        c.fillStyle='#526e81';c.fillRect(0,0,960,620);
        c.fillStyle='#3c4f5c';
        for(let i=0;i<18;i++)c.fillRect(i*58,40,9,540);
        c.fillStyle='#f4efd9';c.fillRect(415,410,520,130);
        c.fillStyle='#171717';
      }
      c.font='bold 57px Arial';
      c.fillText(theme.text,theme.x,theme.y);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      files.push({name:theme.name+'.png',buffer:Array.from(new Uint8Array(await blob.arrayBuffer()))});
    }
    return files;
  });
  await page.getByTestId('redact-upload').setInputFiles(pictures.map(f=>({
    name:f.name,mimeType:'image/png',buffer:Buffer.from(f.buffer)
  })));
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  await page.getByTestId('redact-ocr-all').click();
  await expect(page.getByTestId('redact-ocr-all')).toBeEnabled({timeout:240000});
  for(const scene of [
    {name:'receipt',word:'INVOICE',x:180,y:335},
    {name:'chat',word:'MESSAGE',x:315,y:272},
    {name:'photo',word:'PARKING',x:460,y:490}
  ]){
    await page.getByRole('button',{name:new RegExp(scene.name+'.png')}).click();
    const matching=page.locator('.redactor-recognized label')
      .filter({hasText:new RegExp(scene.word,'i')}).first();
    await expect(matching, 'OCR failed on '+scene.name+': '+
      await page.locator('.redactor-recognized').innerText()).toBeVisible();
    await expect(page.getByTestId('redact-count')).toHaveText('0');
    await matching.locator('input').check();
    const mark=page.getByTestId('redact-mark').first();
    await expect(mark).toHaveAttribute('fill','#000');
    const box=await mark.evaluate(el=>({
      x:+el.getAttribute('x'),y:+el.getAttribute('y'),
      w:+el.getAttribute('width'),h:+el.getAttribute('height')
    }));
    // The OCR box must correspond to the actual painted caption,
    // regardless of its vertical position or background style.
    expect(box.x).toBeLessThan(scene.x+220);
    expect(box.x+box.w).toBeGreaterThan(scene.x+40);
    expect(box.y).toBeLessThan(scene.y);
    expect(box.y+box.h).toBeGreaterThan(scene.y-65);
  }
  // Check that checking an OCR result changes *exported image pixels*,
  // rather than merely changing the checkbox or the SVG border.
  await page.evaluate(()=>{
    const orig=URL.createObjectURL.bind(URL);
    window.__redactedOutput=null;
    URL.createObjectURL=blob=>{
      if(blob.type==='image/png')window.__redactedOutput=blob;
      return orig(blob);
    };
  });
  const promise=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await promise;
  const actual=await page.evaluate(async()=>{
    const blob=window.__redactedOutput;
    const bm=await createImageBitmap(blob);
    const c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;
    const ctx=c.getContext('2d');ctx.drawImage(bm,0,0);
    const b=document.querySelector('[data-testid=redact-mark]');
    const x=Math.round(+b.getAttribute('x')+(+b.getAttribute('width'))/2);
    const y=Math.round(+b.getAttribute('y')+(+b.getAttribute('height'))/2);
    return Array.from(ctx.getImageData(x,y,1,1).data);
  });
  expect(actual.slice(0,3)).toEqual([0,0,0]);
});
