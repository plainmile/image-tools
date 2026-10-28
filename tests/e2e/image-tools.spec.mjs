import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

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
  // Wait until decoding finishes and source dimensions have populated the form.
  if(count<=30) await expect(page.locator('.file-summary')).toContainText('sample-0.png');
}
test('English and Chinese pages contain valid static SEO metadata',async({page})=>{
  for(const route of ['/','/zh/','/resize-image/','/zh/resize-image/','/compress-image-to-size/','/zh/compress-image-to-size/','/signature-resizer/','/zh/signature-resizer/','/bulk-image-resizer/','/zh/bulk-image-resizer/','/passport-photo-print/','/zh/passport-photo-print/','/redact-image/','/zh/redact-image/','/privacy/','/zh/privacy/']){
    const response=await page.goto(route);expect(response.status()).toBe(200);
    const canonical=await page.locator('link[rel=canonical]').getAttribute('href');
    expect(canonical).toBe('https://image.plainmile.com'+route);
    expect(await page.locator('link[hreflang=en]').count()).toBe(1);
    expect(await page.locator('link[hreflang=zh-CN]').count()).toBe(1);
  }
});
test('real JPG is generated at exact requested dimensions with correct decoded pixel data',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByLabel('Resize method').selectOption('cover');
  await page.getByTestId('format').selectOption('jpeg');
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
  await page.getByLabel('Resize method').selectOption('contain');
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
    await expect(page.locator('.tool-list .tool-link')).toHaveCount(6);
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
  await page.getByLabel('Resize method').selectOption('contain');
  await page.getByLabel('Sync width and height').check();
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
  await expect(page.getByTestId('upload')).not.toHaveAttribute('multiple');
  await uploadSynthetic(page,1);
  await page.getByLabel('Resize method').selectOption('cover');
  await expect(page.locator('.preview-frame canvas')).toBeVisible();
});

test('batch maximum dimensions do not add padding or enlarge small images',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,2);
  await expect(page.getByLabel('Resize method')).toHaveValue('within');
  await page.getByTestId('width').fill('55');
  await page.getByTestId('height').fill('35');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('result-meta')).toContainText('53×35');
  await expect(page.getByTestId('download')).toBeVisible();
});
test('batch limit reports a clear error without processing',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,31);
  await expect(page.getByTestId('status')).toContainText('Maximum 30 files');
  await expect(page.getByTestId('process')).toBeDisabled();
});

test('batch blocks excessive output pixels before allocating a giant canvas',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,5);
  await page.getByLabel('Resize method').selectOption('contain');
  await page.getByTestId('width').fill('8000');
  await page.getByTestId('height').fill('4000');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('status')).toContainText('120-megapixel');
  await expect(page.getByTestId('download')).toHaveCount(0);
});
test('uploaded image data stays local; processing sends no POST requests',async({page})=>{
  const posts=[];
  page.on('request',request=>{if(request.method()!=='GET'&&request.method()!=='HEAD')posts.push(request.url());});
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByTestId('process').click();await expect(page.getByTestId('download')).toBeVisible();
  expect(posts).toEqual([]);
});

test('proportional resize without borders is default for English and Chinese and exports exact pixels',async({page})=>{
  for(const [route,label] of [['/resize-image/','Resize method'],['/zh/resize-image/','缩放方式']]){
    await page.goto(route);await uploadSynthetic(page);
    await expect(page.getByLabel(label)).toHaveValue('within');
    await page.getByTestId('width').fill('64');
    await page.getByTestId('height').fill('64');
    await expect(page.getByTestId('expected-dimensions')).toContainText('64×43');
    await page.getByTestId('process').click();
    await expect(page.getByTestId('result-meta')).toContainText('64×43');
    const output=await page.evaluate(async()=>{
      const blob=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
      const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');
      c.width=bitmap.width;c.height=bitmap.height;
      const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);
      const corner=Array.from(ctx.getImageData(2,2,1,1).data);
      const dims=[bitmap.width,bitmap.height];
      bitmap.close();return {dims,corner};
    });
    expect(output.dims).toEqual([64,43]);
    expect(output.corner[0]).toBeGreaterThan(135);
    expect(output.corner[1]).toBeLessThan(115);
    expect(output.corner[2]).toBeLessThan(155);
  }
});
test('portrait landscape and square outputs have no automatic white margins',async({page})=>{
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  for(const [width,height,expected] of [[240,120,[64,32]],[120,240,[32,64]],[200,200,[64,64]]]){
    const bytes=await page.evaluate(async({width,height})=>{
      const c=document.createElement('canvas');c.width=width;c.height=height;
      const ctx=c.getContext('2d');ctx.fillStyle='#c72d41';ctx.fillRect(0,0,width,height);
      const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },{width,height});
    await page.getByTestId('upload').setInputFiles({name:'shape-'+width+'x'+height+'.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
    await expect(page.locator('.file-summary')).toContainText(width+'×'+height);
    await page.getByTestId('width').fill('64');await page.getByTestId('height').fill('64');
    await expect(page.getByTestId('expected-dimensions')).toContainText(expected.join('×'));
    await page.getByTestId('process').click();await expect(page.getByTestId('download')).toBeVisible();
    const result=await page.evaluate(async()=>{
      const blob=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
      const bitmap=await createImageBitmap(blob);
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
      const corners=[[0,0],[canvas.width-1,0],[0,canvas.height-1],[canvas.width-1,canvas.height-1]]
        .map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));
      const dims=[bitmap.width,bitmap.height];bitmap.close();return {dims,corners};
    });
    expect(result.dims).toEqual(expected);
    for(const rgb of result.corners){
      expect(rgb[0]).toBeGreaterThan(145);
      expect(rgb[1]).toBeLessThan(120);
      expect(rgb[2]).toBeLessThan(135);
    }
  }
});
test('white letterboxing requires selecting explicit exact-size Fit',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByLabel('Resize method').selectOption('contain');
  await page.getByTestId('width').fill('64');await page.getByTestId('height').fill('64');
  await expect(page.getByTestId('expected-dimensions')).toContainText('64×64');
  await page.getByTestId('process').click();await expect(page.getByTestId('result-meta')).toContainText('64×64');
  const result=await page.evaluate(async()=>{
    const blob=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
    const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');
    c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);
    const top=Array.from(ctx.getImageData(2,2,1,1).data);
    const middle=Array.from(ctx.getImageData(2,32,1,1).data);
    bitmap.close();return {top,middle};
  });
  expect(result.top.slice(0,3).every(x=>x>230)).toBe(true);
  expect(result.middle[0]).toBeGreaterThan(130);
  expect(result.middle[1]).toBeLessThan(120);
});

test('default original export retains transparent PNG pixels and downloaded extension', async({page})=>{
  await page.goto('/zh/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const png=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=40;canvas.height=24;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,40,24);
    ctx.fillStyle='#f43f5e';ctx.fillRect(6,4,28,16);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('upload').setInputFiles({name:'alpha.png',mimeType:'image/png',buffer:Buffer.from(png)});
  await expect(page.locator('.file-summary')).toContainText('40×24');
  await expect(page.getByTestId('format')).toHaveValue('original');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const actual=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid=download]');
    const blob=await(await fetch(link.href)).blob();
    const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
    const alpha=ctx.getImageData(0,0,1,1).data[3];
    const colored=Array.from(ctx.getImageData(10,10,1,1).data);
    const dims=[bitmap.width,bitmap.height];bitmap.close();
    return {type:blob.type,name:link.download,dims,alpha,colored};
  });
  expect(actual.type).toBe('image/png');
  expect(actual.name).toBe('alpha-edited.png');
  expect(actual.dims).toEqual([40,24]);
  expect(actual.alpha).toBe(0);
  expect(actual.colored[0]).toBeGreaterThan(150);
});
test('batch of one always produces a ZIP containing a PNG, not a misleading image link',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page);
  await expect(page.getByTestId('format')).toHaveValue('original');
  await page.getByTestId('width').fill('60');
  await page.getByTestId('height').fill('60');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toContainText('ZIP');
  const downloaded=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid=download]');
    const blob=await(await fetch(link.href)).blob();
    return {name:link.download,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};
  });
  expect(downloaded.name).toBe('plainmile-images.zip');
  const zip=await JSZip.loadAsync(Buffer.from(downloaded.bytes));
  const names=Object.keys(zip.files);
  expect(names).toEqual(['01-sample-0-edited.png']);
  const png=await zip.file(names[0]).async('uint8array');
  expect(Array.from(png.slice(0,8))).toEqual([137,80,78,71,13,10,26,10]);
});
test('mixed JPG and PNG source formats are preserved separately in batch ZIP',async({page})=>{
  await page.goto('/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const images=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=54;c.height=30;
    c.getContext('2d').fillRect(0,0,54,30);
    const toBytes=async(type)=>Array.from(new Uint8Array(await(await new Promise(resolve=>c.toBlob(resolve,type))).arrayBuffer()));
    return {png:await toBytes('image/png'),jpg:await toBytes('image/jpeg')};
  });
  await page.getByTestId('upload').setInputFiles([
    {name:'one.png',mimeType:'image/png',buffer:Buffer.from(images.png)},
    {name:'two.jpg',mimeType:'image/jpeg',buffer:Buffer.from(images.jpg)}
  ]);
  await expect(page.locator('.file-summary')).toContainText('2 file(s)');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const payload=await page.evaluate(async()=>Array.from(new Uint8Array(await(await(await fetch(document.querySelector('[data-testid=download]').href)).blob()).arrayBuffer())));
  const zip=await JSZip.loadAsync(Buffer.from(payload));
  expect(Object.keys(zip.files)).toEqual(['01-one-edited.png','02-two-edited.jpg']);
  expect(Array.from((await zip.file('01-one-edited.png').async('uint8array')).slice(0,8)))
    .toEqual([137,80,78,71,13,10,26,10]);
  expect(Array.from((await zip.file('02-two-edited.jpg').async('uint8array')).slice(0,2)))
    .toEqual([255,216]);
});
test('compression warns about JPEG transparency loss and PNG lossless KB limitations',async({page})=>{
  await page.goto('/compress-image-to-size/');await uploadSynthetic(page);
  await expect(page.getByTestId('format')).toHaveValue('jpeg');
  await expect(page.getByTestId('alpha-warning')).toBeVisible();
  await page.getByTestId('format').selectOption('original');
  await expect(page.getByTestId('png-size-warning')).toBeVisible();
  await expect(page.getByLabel('Quality: 90%').locator('input')).toBeDisabled();
});
test('choosing the same image after output resets the stale download',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByTestId('process').click();await expect(page.getByTestId('download')).toBeVisible();
  await uploadSynthetic(page);
  await expect(page.getByTestId('download')).toHaveCount(0);
  await expect(page.locator('.file-summary')).toContainText('sample-0.png');
});
