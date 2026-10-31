import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

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
  // The image gallery can render before asynchronous decoding has released the busy state.
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  return bytes;
}
async function draw(page,from=[.2,.25],to=[.65,.65]){
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  // Playwright mouse coordinates are viewport based; ensure the entire image is in view
  // before dragging, including on short Firefox/WebKit headless viewports.
  await expect(page.locator('.redactor-stage')).toHaveAttribute('data-preview-ready','true');
  await page.getByTestId('redact-overlay').scrollIntoViewIfNeeded();
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
test('manual black box is flattened into new PNG pixels and leaves other pixels unchanged @public-smoke',async({page})=>{
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
  await expect(page.getByTestId('redact-status')).toContainText('960×280');
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
  await page.getByRole('button',{name:'手动画框'}).click();
  await draw(page,[.1,.2],[.4,.5]);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});
test('batch export requires a mask on each image and packages a ZIP',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page,2);
  await draw(page);
  await page.getByTestId('redact-download-all').click();
  await expect(page.getByTestId('redact-status')).toContainText('Add at least one box');
  await expect(page.getByTestId('redact-status')).toContainText('capture-1.png');
  // The tool takes us to the first unfinished image; no manual hunting needed.
  await expect(page.locator('.redactor-file.chosen')).toContainText('capture-1.png');
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
    return {header:Array.from(v.slice(0,4)),bytes:v.length,compressionMethod:v[8]|(v[9]<<8)};
  });
  expect(zip.header).toEqual([80,75,3,4]);
  // These image blobs were already compressed; ZIP must not deflate them again.
  expect(zip.compressionMethod).toBe(0);
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
test('no source image is submitted to an external server @public-smoke',async({page})=>{
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
  await expect(page.getByTestId('redact-effect')).toHaveValue('solid');
  await expect(page.getByTestId('redact-mark')).toHaveCount(1);
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

test('portrait redaction preview retains correct aspect ratio',async({page})=>{
  await page.goto('/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const pixels=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=1200;
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('redact-upload').setInputFiles({name:'portrait.png',mimeType:'image/png',buffer:Buffer.from(pixels)});
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  const size=await page.locator('.redactor-stage').evaluate(element=>{
    const box=element.getBoundingClientRect();return {width:box.width,height:box.height};
  });
  expect(Math.abs(size.width/size.height-0.2)).toBeLessThan(0.015);
  expect(size.height).toBeLessThanOrEqual(651);
});

test('no OCR controls and all three manual effects are available for export',async({page})=>{
  await page.goto('/zh/redact-image/');await synthetic(page);await draw(page);
  await expect(page.getByTestId('redact-ocr')).toHaveCount(0);
  await expect(page.getByTestId('redact-effect').locator('option')).toHaveCount(3);
  await expect(page.getByTestId('redact-effect').locator('option[value=white]')).toHaveCount(0);
  for(const mode of ['solid','mosaic','blur']){
    await page.getByTestId('redact-effect').selectOption(mode);
    if(mode!=='solid')await expect(page.getByTestId('redact-strength')).toBeVisible();
    const downloaded=page.waitForEvent('download');await page.getByTestId('redact-download').click();await downloaded;
    await expect(page.getByTestId('redact-status')).toContainText('960×280');
  }
});

test('existing private black boxes do not change when choosing blur for new areas',async({page})=>{
  await page.goto('/redact-image/');
  await synthetic(page);
  await draw(page,[.10,.10],[.32,.7]);
  await page.getByTestId('redact-effect').selectOption('blur');
  await draw(page,[.55,.10],[.85,.7]);
  const selectors=page.getByTestId('redact-area-effect');
  await expect(selectors).toHaveCount(2);
  await expect(selectors.nth(0)).toHaveValue('solid');
  await expect(selectors.nth(1)).toHaveValue('blur');
  await page.getByTestId('redact-effect').selectOption('mosaic');
  await expect(selectors.nth(0)).toHaveValue('solid');
  await expect(selectors.nth(1)).toHaveValue('blur');
  await selectors.nth(1).selectOption('mosaic');
  await expect(selectors.nth(0)).toHaveValue('solid');
  await expect(selectors.nth(1)).toHaveValue('mosaic');
  await expect(page.getByTestId('redact-area-strength')).toHaveCount(1);
});

test('mosaic, blur and black pixel previews match actual PNG exports',async({page})=>{
  await page.goto('/redact-image/'); await synthetic(page);
  await draw(page);
  await page.evaluate(()=>{
    const original=URL.createObjectURL.bind(URL);
    window.__actualExports=[];
    URL.createObjectURL=(blob)=>{window.__actualExports.push(blob);return original(blob);};
  });
  for(const mode of ['solid','mosaic','blur']){
    await page.getByTestId('redact-area-effect').selectOption(mode);
    // This covers the center of the synthetic black-on-white caption.
    // Preview canvas dimensions match source for this small test image.
    await expect.poll(()=>page.locator('.redactor-preview-canvas').evaluate(c=>c.width)).toBe(960);
    const request=page.waitForEvent('download');
    await page.getByTestId('redact-download').click();await request;
    const pixels=await page.evaluate(async()=>{
      const blob=window.__actualExports.at(-1);
      const bitmap=await createImageBitmap(blob);
      const off=document.createElement('canvas');off.width=bitmap.width;off.height=bitmap.height;
      off.getContext('2d').drawImage(bitmap,0,0);
      const canvas=document.querySelector('.redactor-preview-canvas');
      const imageData=off.getContext('2d').getImageData(250,135,1,1).data;
      const previewData=canvas.getContext('2d').getImageData(250,135,1,1).data;
      bitmap.close();
      return {exported:Array.from(imageData),preview:Array.from(previewData)};
    });
    expect(pixels.preview.slice(0,3)).toEqual(pixels.exported.slice(0,3));
    if(mode==='solid')expect(pixels.exported.slice(0,3)).toEqual([0,0,0]);
  }
});

test('manual redaction supports file dropping and keeps OCR absent',async({page})=>{
  await page.goto('/zh/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const bytes=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=160;c.height=100;
    const blob=await new Promise(ok=>c.toBlob(ok,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.locator('.redactor-top').evaluate((element,bytes)=>{
    const transfer=new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)],'dropped.png',{type:'image/png'}));
    element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  },bytes);
  await expect(page.getByTestId('redact-overlay')).toBeVisible();
  await expect(page.getByTestId('redact-ocr')).toHaveCount(0);
});

test('overlapping blur and mosaic never reveal an earlier solid privacy cover',async({page})=>{
  await page.goto('/redact-image/');
  await synthetic(page);
  // Original image is white at x=500,y=170. A solid cover changes it to black.
  await draw(page,[.20,.25],[.65,.65]);
  await page.getByTestId('redact-effect').selectOption('mosaic');
  await draw(page,[.30,.30],[.60,.70]);
  await page.getByTestId('redact-effect').selectOption('blur');
  await draw(page,[.30,.35],[.75,.75]);
  await expect(page.getByTestId('redact-area-effect')).toHaveCount(3);
  await expect(page.getByTestId('redact-area-effect').nth(0)).toHaveValue('solid');
  await page.evaluate(()=>{
    const original=URL.createObjectURL.bind(URL);
    window.__capturedRedaction=null;
    URL.createObjectURL=(blob)=>{if(blob.type==='image/png')window.__capturedRedaction=blob;return original(blob);};
  });
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();await downloaded;
  const result=await page.evaluate(async()=>{
    const bitmap=await createImageBitmap(window.__capturedRedaction);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    canvas.getContext('2d').drawImage(bitmap,0,0);
    const output=Array.from(canvas.getContext('2d').getImageData(500,170,1,1).data);
    const preview=document.querySelector('.redactor-preview-canvas');
    const live=Array.from(preview.getContext('2d').getImageData(500,170,1,1).data);
    bitmap.close();
    return {output,live};
  });
  expect(result.output.slice(0,3)).toEqual([0,0,0]);
  expect(result.live.slice(0,3)).toEqual([0,0,0]);
});

test('pasted screenshots cannot replace redaction work while download is encoding',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page);await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  // Hold the browser-native PNG export long enough to send an actual paste event.
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){
      return original.call(this,blob=>setTimeout(()=>callback(blob),700),...args);
    };
  });
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await expect(page.getByTestId('redact-download')).toBeDisabled();
  const paste=await page.evaluate(()=>{
    const transfer=new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0,1,2,3])],'interrupt.png',{type:'image/png'}));
    const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});
    window.dispatchEvent(event);
    return {prevented:event.defaultPrevented};
  });
  expect(paste.prevented).toBe(false);
  await downloaded;
  await expect(page.locator('.redactor-gallery')).toContainText('capture-0.png');
  await expect(page.locator('.redactor-gallery')).not.toContainText('interrupt.png');
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});

test('adding images never overwrites previously drawn redactions',async({page})=>{
  await page.goto('/zh/redact-image/');const bytes=await synthetic(page);await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.getByTestId('redact-upload').setInputFiles({name:'different-image.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await page.locator('.redactor-file').first().click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  expect((await downloaded).suggestedFilename()).toBe('redacted-image.png');
});
test('invalid and over-limit additions preserve existing redactions',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page);await draw(page);
  await page.getByTestId('redact-upload').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from([0,1,2,3])});
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await synthetic(page,12);
  await expect(page.getByTestId('redact-status')).toContainText('at most 12');
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});
test('untyped screenshots, empty picker and Chinese errors preserve existing masks',async({page})=>{
  await page.goto('/zh/redact-image/');
  const bytes=await synthetic(page);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');

  // Some mobile file sources report an empty MIME even for a valid PNG.
  await page.getByTestId('redact-upload').setInputFiles({
    name:'mobile-screenshot.PNG',mimeType:'',buffer:Buffer.from(bytes)
  });
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  await expect(page.locator('.redactor-gallery')).toContainText('mobile-screenshot.PNG');
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  const before=await page.getByTestId('redact-status').innerText();

  // Choosing Cancel must not clear any masks, downloads, or status.
  await page.getByTestId('redact-upload').evaluate(input=>{
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect(page.getByTestId('redact-status')).toHaveText(before);
  await page.locator('.redactor-file').first().click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');

  await page.getByTestId('redact-upload').setInputFiles(
    Array.from({length:11},(_,i)=>({
      name:'overflow-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(bytes)
    }))
  );
  await expect(page.getByTestId('redact-status')).toContainText('最多选择 12 张图片');
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});

test('animated WebP/APNG are rejected without losing already drawn privacy masks',async({page})=>{
  await page.goto('/redact-image/');
  await synthetic(page);
  await draw(page);
  const movingWebp=Buffer.from([82,73,70,70,28,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,2]);
  await page.getByTestId('redact-upload').setInputFiles({
    name:'animation.webp',mimeType:'image/webp',buffer:movingWebp
  });
  await expect(page.getByTestId('redact-status')).toContainText('Animated PNG/WebP');
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  const download=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await download; // Original static image and its redaction remain usable.

  await page.goto('/zh/redact-image/');
  await synthetic(page);
  await draw(page);
  const signature=[137,80,78,71,13,10,26,10];
  const chunk=(type,data=[])=>[0,0,0,data.length,...[...type].map(c=>c.charCodeAt(0)),...data,0,0,0,0];
  const apng=Buffer.from([...signature,...chunk('IHDR',Array(13).fill(0)),
    ...chunk('acTL',Array(8).fill(0)),...chunk('IDAT')]);
  await page.getByTestId('redact-upload').setInputFiles({
    name:'animation.png',mimeType:'image/png',buffer:apng
  });
  await expect(page.getByTestId('redact-status')).toContainText('暂不支持动画 PNG/WebP');
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});

test('clear all images requests confirmation when any masks exist',async({page})=>{
  await page.goto('/zh/redact-image/');await synthetic(page);await draw(page);
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByTestId('redact-clear-images').click();
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByTestId('redact-clear-images').click();
  await expect(page.locator('.redactor-file')).toHaveCount(0);
  await synthetic(page);
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('0');
});


test('removing one edited image confirms data loss, preserves other masks and invalidates the old ZIP',async({page})=>{
  await page.goto('/zh/redact-image/');
  await synthetic(page,3);
  await draw(page,[.2,.2],[.6,.6]);
  await page.locator('.redactor-file').nth(1).click();
  await draw(page,[.1,.1],[.5,.5]);
  await page.locator('.redactor-file').nth(2).click();
  await draw(page,[.3,.2],[.7,.7]);
  await expect(page.getByTestId('redact-remove-image')).toHaveCount(3);
  await page.locator('.redactor-file').nth(1).click();
  await expect(page.locator('.redactor-file.chosen')).toHaveAttribute('aria-pressed','true');

  const previousZip=page.waitForEvent('download');
  await page.getByTestId('redact-download-all').click();
  await previousZip;
  await expect(page.getByTestId('redact-download-again')).toBeVisible();

  page.once('dialog',dialog=>{
    expect(dialog.message()).toContain('capture-1.png');
    expect(dialog.message()).toContain('遮挡框');
    void dialog.dismiss();
  });
  await page.getByTestId('redact-remove-image').nth(1).click();
  await expect(page.getByTestId('redact-remove-image')).toHaveCount(3);
  await expect(page.getByTestId('redact-download-again')).toBeVisible();
  await expect(page.getByTestId('redact-count')).toHaveText('1');

  page.once('dialog',dialog=>{expect(dialog.message()).toContain('capture-1.png');void dialog.accept();});
  await page.getByTestId('redact-remove-image').nth(1).click();
  await expect(page.getByTestId('redact-remove-image')).toHaveCount(2);
  await expect(page.locator('.redactor-gallery')).not.toContainText('capture-1.png');
  await expect(page.locator('.redactor-file.chosen')).toContainText('capture-2.png');
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect(page.getByTestId('redact-download-again')).toHaveCount(0);
  await expect(page.getByTestId('redact-status')).toContainText('已移除图片');
  await page.locator('.redactor-file').first().click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');

  const download=page.waitForEvent('download');
  await page.getByTestId('redact-download-all').click();
  expect((await download).suggestedFilename()).toBe('plainmile-redacted-images.zip');
  const raw=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid="redact-download-again"]');
    return [...new Uint8Array(await (await fetch(link.href)).arrayBuffer())];
  });
  const zip=await JSZip.loadAsync(Buffer.from(raw));
  expect(Object.keys(zip.files)).toEqual(['redacted-01.png','redacted-02.png']);
  for(const name of Object.keys(zip.files)){
    const bytes=Buffer.from(await zip.file(name).async('uint8array'));
    expect(Array.from(bytes.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);
  }
});

test('removing an unedited image needs no confirmation and keeps edited work on mobile',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('/redact-image/');
  await synthetic(page,2);
  await draw(page);
  await page.locator('.redactor-file').nth(1).click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  let confirmations=0;
  page.on('dialog',dialog=>{confirmations+=1;void dialog.dismiss();});
  await page.getByTestId('redact-remove-image').nth(1).click();
  expect(confirmations).toBe(0);
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.locator('.redactor-file.chosen')).toContainText('capture-0.png');
  await expect(page.locator('.redactor-file.chosen')).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect(page.getByTestId('redact-download-all')).toHaveCount(0);
  const layout=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,
    width:document.documentElement.clientWidth
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width+1);
  const download=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  expect((await download).suggestedFilename()).toBe('redacted-image.png');
});

test('switching image thumbnails preserves a finished ZIP until a mask changes',async({page})=>{
  await page.goto('/redact-image/');await synthetic(page,2);
  await draw(page);
  await page.getByRole('button',{name:/capture-1\.png/}).click();
  await draw(page);
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download-all').click();
  await downloaded;
  const href=await page.getByTestId('redact-download-again').getAttribute('href');
  await page.getByRole('button',{name:/capture-0\.png/}).click();
  await expect(page.getByTestId('redact-download-again')).toHaveAttribute('href',href);
  await page.getByRole('button',{name:/capture-1\.png/}).click();
  await expect(page.getByTestId('redact-download-again')).toHaveAttribute('href',href);
  await draw(page,[.7,.15],[.88,.45]);
  await expect(page.getByTestId('redact-download-again')).toHaveCount(0);
});

test('a single finished download stays available when returning to its unchanged image',async({page})=>{
  await page.goto('/zh/redact-image/');await synthetic(page,2);await draw(page);
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await downloaded;
  const href=await page.getByTestId('redact-download-again').getAttribute('href');
  await page.getByRole('button',{name:/capture-0\.png/}).click();
  await expect(page.getByTestId('redact-download-again')).toHaveAttribute('href',href);
  await page.getByRole('button',{name:/capture-1\.png/}).click();
  await expect(page.getByTestId('redact-download-again')).toHaveCount(0);
  await page.getByRole('button',{name:/capture-0\.png/}).click();
  await expect(page.getByTestId('redact-download-again')).toHaveAttribute('href',href);
  await draw(page,[.7,.1],[.85,.4]);
  await expect(page.getByTestId('redact-download-again')).toHaveCount(0);
});

test('JPEG export warns of transparency loss and flattens transparent pixels to white',async({page})=>{
  await page.goto('/zh/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const data=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,80,80);
    ctx.fillStyle='#a33';ctx.fillRect(25,25,30,30);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('redact-upload').setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:Buffer.from(data)});
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  await draw(page,[.3,.3],[.7,.7]);
  await page.locator('#redact-format').selectOption('jpeg');
  await expect(page.getByTestId('redact-alpha-warning')).toContainText('透明区域会变成白色');
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await downloaded;
  const result=await page.evaluate(async()=>{
    const a=document.querySelector('[data-testid="redact-download-again"]');
    const blob=await(await fetch(a.href)).blob();
    const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
    const corner=Array.from(ctx.getImageData(4,4,1,1).data);
    const masked=Array.from(ctx.getImageData(40,40,1,1).data);
    bitmap.close();return {name:a.download,mime:blob.type,corner,masked};
  });
  expect(result.name).toBe('redacted-image.jpg');
  expect(result.mime).toBe('image/jpeg');
  expect(result.corner.slice(0,3).every(x=>x>=245)).toBe(true);
  expect(result.masked.slice(0,3).every(x=>x<=15)).toBe(true);
  await page.locator('#redact-format').selectOption('png');
  await expect(page.getByTestId('redact-alpha-warning')).toHaveCount(0);
});

test('same-image privacy edits hide stale previews and suspend export until the new masks are painted',async({page})=>{
  await page.goto('/zh/redact-image/');
  await synthetic(page);
  const stage=page.locator('.redactor-stage');
  await expect(stage).toHaveAttribute('data-preview-ready','true');

  // Freeze a single image decode without a timer: this must exercise the
  // second preview of the SAME file, not the earlier gallery-switch case.
  const freezeNextPreview=async()=>{
    await page.evaluate(()=>{
      const decode=window.createImageBitmap.bind(window);
      let paused=false;
      window.createImageBitmap=(file,...args)=>{
        if(!paused&&file?.name==='capture-0.png'){
          paused=true;
          return new Promise((resolve,reject)=>{
            window.__releaseMaskPreview=()=>decode(file,...args).then(resolve,reject);
          });
        }
        return decode(file,...args);
      };
      window.__releaseMaskPreview=null;
    });
  };
  const assertBlocked=async()=>{
    await expect.poll(()=>page.evaluate(()=>typeof window.__releaseMaskPreview)).toBe('function');
    await expect(stage).toHaveAttribute('data-preview-ready','false');
    await expect(stage).toHaveAttribute('aria-busy','true');
    await expect(page.locator('.redactor-preview-loading')).toBeVisible();
    await expect(page.getByTestId('redact-download')).toBeDisabled();
  };
  await freezeNextPreview();
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await assertBlocked();
  await page.evaluate(()=>window.__releaseMaskPreview());
  await expect(stage).toHaveAttribute('data-preview-ready','true');
  await expect(page.getByTestId('redact-download')).toBeEnabled();

  // Changing an existing mask from solid to blur is equally safety-critical:
  // the canvas still has a black box until the blur preview finishes.
  await freezeNextPreview();
  await page.getByTestId('redact-area-effect').selectOption('blur');
  await assertBlocked();
  await page.evaluate(()=>window.__releaseMaskPreview());
  await expect(stage).toHaveAttribute('data-preview-ready','true');
  await expect(page.getByTestId('redact-download')).toBeEnabled();
  await expect(page.locator('.redactor-preview-loading')).toHaveCount(0);
});

test('slow preview switching never shows old image or accepts wrongly placed privacy boxes',async({page})=>{
  await page.addInitScript(()=>{
    const original=window.createImageBitmap.bind(window);
    let secondImageCalls=0;
    window.createImageBitmap=(file,...args)=>{
      if(file?.name==='slow-preview.png'&&++secondImageCalls===2){
        return new Promise((resolve,reject)=>{
          window.__releaseSlowPreview=()=>original(file,...args).then(resolve,reject);
        });
      }
      return original(file,...args);
    };
  });
  await page.goto('/zh/redact-image/');
  const bytes=await synthetic(page);
  await expect(page.locator('.redactor-stage')).toHaveAttribute('data-preview-ready','true');
  await page.getByTestId('redact-upload').setInputFiles({
    name:'slow-preview.png',mimeType:'image/png',buffer:Buffer.from(bytes)
  });
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  await expect(page.locator('.redactor-stage')).toHaveAttribute('data-preview-ready','false');
  await expect(page.locator('.redactor-stage')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('.redactor-preview-loading')).toContainText('加载当前图片');
  // Changing the key clears the previous image immediately, even before decode.
  const alpha=await page.evaluate(()=>{
    const canvas=document.querySelector('.redactor-preview-canvas');
    return canvas.getContext('2d').getImageData(10,10,1,1).data[3];
  });
  expect(alpha).toBe(0);
  await page.getByTestId('redact-overlay').scrollIntoViewIfNeeded();
  const rect=await page.getByTestId('redact-overlay').boundingBox();
  await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.3);
  await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.6,rect.y+rect.height*.7,{steps:8});
  await page.mouse.up();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
  await expect(page.getByTestId('redact-download')).toBeDisabled();
  await page.evaluate(()=>window.__releaseSlowPreview());
  await expect(page.locator('.redactor-stage')).toHaveAttribute('data-preview-ready','true');
  await expect(page.locator('.redactor-preview-loading')).toHaveCount(0);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});


async function uploadFixedFiles(page,files) {
  await page.evaluate(files=>{
    const dt=new DataTransfer();
    for(const item of files){
      const data=Uint8Array.from(item.bytes);
      dt.items.add(new File([data],item.name,{type:'image/png',lastModified:1700000000000}));
    }
    const input=document.querySelector('[data-testid="redact-upload"]');
    input.files=dt.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },files);
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
}

async function safeRedactionPng(page){
  return await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=96;c.height=64;
    const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,96,64);
    ctx.fillStyle='#123456';ctx.fillRect(6,10,70,25);
    return [...new Uint8Array(await(await new Promise(resolve=>c.toBlob(resolve,'image/png'))).arrayBuffer())];
  });
}

test('reimporting an identical image preserves existing privacy masks and completed download',async({page})=>{
  await page.goto('/zh/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const bytes=await safeRedactionPng(page);
  const selected={name:'private-screenshot.png',bytes};
  await uploadFixedFiles(page,[selected]);
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await downloaded;
  const saved=page.getByTestId('redact-download-again');
  const before=await saved.getAttribute('href');
  await uploadFixedFiles(page,[selected]);
  await expect(page.getByTestId('redact-status')).toContainText('已添加过');
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect(saved).toHaveAttribute('href',before);
});

test('redactor never skips different valid PNG bytes despite matching filename, size and time',async({page})=>{
  await page.goto('/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const png=[
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgFUkBAACfAH6yIjP3AAAAAElFTkSuQmCC',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNIEWEFAAFdAH5CFQ0QAAAAAElFTkSuQmCC'
  ].map(b64=>Array.from(Buffer.from(b64,'base64')));
  expect(png[0].length).toBe(png[1].length);
  await uploadFixedFiles(page,[{name:'identical-metadata.png',bytes:png[0]}]);
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await uploadFixedFiles(page,[{name:'identical-metadata.png',bytes:png[1]}]);
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await expect(page.getByTestId('redact-status')).toContainText('Images added');
  // A byte-identical third selection must not grow the batch.
  await uploadFixedFiles(page,[{name:'identical-metadata.png',bytes:png[1]}]);
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await expect(page.getByTestId('redact-status')).toContainText('Already selected');
});

test('redactor can reselect an existing image at its twelve-file limit but rejects a thirteenth',async({page})=>{
  await page.goto('/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const bytes=await safeRedactionPng(page);
  await uploadFixedFiles(page,Array.from({length:12},(_,i)=>({name:'shot-'+i+'.png',bytes})));
  await expect(page.locator('.redactor-file')).toHaveCount(12);
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await uploadFixedFiles(page,[{name:'shot-0.png',bytes}]);
  await expect(page.getByTestId('redact-status')).toContainText('Already selected');
  await expect(page.locator('.redactor-file')).toHaveCount(12);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await uploadFixedFiles(page,[{name:'shot-12.png',bytes}]);
  await expect(page.getByTestId('redact-status')).toContainText('at most 12');
  await expect(page.locator('.redactor-file')).toHaveCount(12);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
});


test('mixed invalid redaction input retains valid files and explains every rejection in Chinese',async({page})=>{
  await page.goto('/zh/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const bytes=await safeRedactionPng(page);
  await page.getByTestId('redact-upload').setInputFiles([
    {name:'valid.png',mimeType:'image/png',buffer:Buffer.from(bytes)},
    {name:'broken.png',mimeType:'image/png',buffer:Buffer.from([0,1,2,3])},
    {name:'unsupported.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')}
  ]);
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await expect(page.locator('.redactor-gallery')).toContainText('valid.png');
  await expect(page.getByTestId('redact-status')).toContainText('部分无效图片已跳过');
  const errors=page.getByTestId('redact-failed-input');
  await expect(errors).toContainText('未导入的无效图片 (2)');
  await expect(errors).toContainText('broken.png');
  await expect(errors).toContainText('unsupported.gif');
  await expect(errors).toContainText('仅支持 JPG、PNG 和 WebP');
  await draw(page);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  const download=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  expect((await download).suggestedFilename()).toBe('redacted-image.png');
});

test('an entirely invalid redaction retry preserves masks and the last completed ZIP',async({page})=>{
  await page.goto('/redact-image/');
  await synthetic(page,2);
  await draw(page);
  await page.locator('.redactor-file').nth(1).click();
  await draw(page);
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download-all').click();
  await downloaded;
  const saved=page.getByTestId('redact-download-again');
  const previous=await saved.getAttribute('href');
  await page.getByTestId('redact-upload').setInputFiles([
    {name:'nope.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')},
    {name:'broken.png',mimeType:'image/png',buffer:Buffer.from([1,2,3,4])}
  ]);
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await expect(page.getByTestId('redact-failed-input')).toContainText('nope.gif');
  await expect(page.getByTestId('redact-failed-input')).toContainText('broken.png');
  await expect(saved).toHaveAttribute('href',previous);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.locator('.redactor-file').first().click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect(saved).toHaveAttribute('href',previous);
});

test('new valid file plus same-content repeat and corrupt image appends only the valid file',async({page})=>{
  await page.goto('/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  const bytes=await safeRedactionPng(page);
  await uploadFixedFiles(page,[{name:'private.png',bytes}]);
  await draw(page);
  await uploadFixedFiles(page,[
    {name:'private.png',bytes},
    {name:'new.png',bytes},
    {name:'corrupt.png',bytes:[0,1,2,3]}
  ]);
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await expect(page.getByTestId('redact-status')).toContainText('Identical images were skipped');
  await expect(page.getByTestId('redact-status')).toContainText('Some invalid images were skipped');
  await expect(page.getByTestId('redact-failed-input')).toContainText('corrupt.png');
  await page.locator('.redactor-file').first().click();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await page.locator('.redactor-file').nth(1).click();
  await expect(page.getByTestId('redact-count')).toHaveText('0');
});


test('large-image blur preview matches exported native-resolution effect',async({page})=>{
  await page.goto('/redact-image/');
  await expect(page.locator('[data-redactor-ready="true"]')).toBeVisible();
  // A sharp black/white boundary reveals blur-radius scaling errors that
  // ordinary same-size preview fixtures cannot detect.
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=2400;canvas.height=1200;
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#000';ctx.fillRect(0,0,1200,1200);
    ctx.fillStyle='#fff';ctx.fillRect(1200,0,1200,1200);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('redact-upload').setInputFiles({
    name:'large-test.png',mimeType:'image/png',buffer:Buffer.from(bytes)
  });
  await expect(page.getByTestId('redact-upload')).toBeEnabled();
  await page.getByTestId('redact-effect').selectOption('blur');
  await draw(page,[.20,.20],[.80,.80]);
  await expect(page.getByTestId('redact-count')).toHaveText('1');
  await expect(page.locator('.redactor-stage')).toHaveAttribute('data-preview-ready','true');
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await downloaded;
  await expect(page.getByTestId('redact-download-again')).toBeVisible();
  const pixels=await page.evaluate(async()=>{
    const preview=document.querySelector('.redactor-preview-canvas');
    const link=document.querySelector('[data-testid="redact-download-again"]');
    const image=await createImageBitmap(await(await fetch(link.href)).blob());
    const full=document.createElement('canvas');
    full.width=image.width;full.height=image.height;
    const fullCtx=full.getContext('2d');
    fullCtx.drawImage(image,0,0);
    const previewCtx=preview.getContext('2d');
    const delta=[16,24,36].map(dx=>{
      const x=1200+dx,y=600;
      const xPreview=Math.round(x*preview.width/image.width);
      const yPreview=Math.round(y*preview.height/image.height);
      const actual=fullCtx.getImageData(x,y,1,1).data[0];
      const shown=previewCtx.getImageData(xPreview,yPreview,1,1).data[0];
      return {actual,shown,difference:Math.abs(actual-shown)};
    });
    const sizes={previewWidth:preview.width,outputWidth:image.width};
    image.close();
    return {sizes,delta};
  });
  expect(pixels.sizes.outputWidth).toBe(2400);
  expect(pixels.sizes.previewWidth).toBeLessThan(2400);
  // If blur fails silently, exported white-side pixels remain 255.
  expect(pixels.delta[1].actual).toBeGreaterThan(130);
  expect(pixels.delta[1].actual).toBeLessThan(245);
  for(const point of pixels.delta)expect(point.difference).toBeLessThanOrEqual(23);
});
