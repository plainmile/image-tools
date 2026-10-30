import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

async function selectResizeMode(page,mode){
  const panel=page.getByTestId('advanced-resize');
  if(!(await panel.evaluate(node=>node.open)))await page.getByTestId('advanced-resize-summary').click();
  await page.getByTestId('resize-mode').selectOption(mode);
}


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
test('English and Chinese pages contain valid static SEO metadata @public-smoke',async({page})=>{
  for(const route of ['/','/zh/','/resize-image/','/zh/resize-image/','/compress-image-to-size/','/zh/compress-image-to-size/','/signature-resizer/','/zh/signature-resizer/','/convert-image/','/zh/convert-image/','/crop-image/','/zh/crop-image/','/rotate-image/','/zh/rotate-image/','/bulk-image-resizer/','/zh/bulk-image-resizer/','/passport-photo-print/','/zh/passport-photo-print/','/redact-image/','/zh/redact-image/','/privacy/','/zh/privacy/']){
    const response=await page.goto(route,{waitUntil:'domcontentloaded'});expect(response.status()).toBe(200);
    const canonical=await page.locator('link[rel=canonical]').getAttribute('href');
    expect(canonical).toBe('https://image.plainmile.com'+route);
    expect(await page.locator('link[hreflang=en]').count()).toBe(1);
    expect(await page.locator('link[hreflang=zh-CN]').count()).toBe(1);
  }
});
test('real JPG is generated at exact requested dimensions with correct decoded pixel data @public-smoke',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await selectResizeMode(page,'cover');
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
test('compression to KB limit verifies actual bytes @public-smoke',async({page})=>{
  await page.goto('/compress-image-to-size/');await uploadSynthetic(page);
  await page.getByTestId('width').fill('100');await page.getByTestId('height').fill('80');
  await page.getByTestId('target').fill('20');await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const bytes=await page.evaluate(async()=> (await (await fetch(document.querySelector('[data-testid=download]').href)).blob()).size);
  expect(bytes).toBeLessThanOrEqual(20*1000);
});
test('100 KB cap rejects a 101,000-byte JPEG but retains a valid sub-100,000-byte export',async({page})=>{
  await page.goto('/zh/compress-image-to-size/');
  await uploadSynthetic(page);
  await expect(page.getByTestId('target-kb-hint')).toContainText('100,000 字节');
  await page.getByTestId('target').fill('100');
  // Wrap actual JPEG encoder output with trailing padding to exercise the
  // 100,000 / 102,400 boundary across Chromium, Firefox and WebKit.
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,mime,quality){
      return original.call(this,(real)=>{
        if(!real)return callback(null);
        const size=quality>=0.895?101000:99500;
        callback(new Blob([real,new Uint8Array(Math.max(0,size-real.size))],{type:real.type}));
      },mime,quality);
    };
  });
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const bytes=await page.evaluate(async()=>{
    const url=document.querySelector('[data-testid=download]').href;
    return (await(await fetch(url)).blob()).size;
  });
  expect(bytes).toBe(99500);
  await expect(page.getByTestId('exact-bytes')).toContainText('99500');
  // The result display must use the same decimal KB as the 100 KB form limit.
  await expect(page.getByTestId('result-meta')).toContainText('99.5 KB');
  await expect(page.getByTestId('size-comparison')).toContainText('99.5 KB');
});

test('narrow signatures with a KB limit can downscale instead of stopping at 48 pixels',async({page})=>{
  await page.goto('/signature-resizer/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  // A real, high-detail 32x600 PNG stays above 5,000 bytes unless its pixel
  // dimensions are reduced. No mocked encoders or invalid file padding.
  const png=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=600;
    const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(32,600);
    let seed=123456789;
    for(let i=0;i<pixels.data.length;i+=4){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;
      pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  expect(png.length).toBeGreaterThan(5000);
  await page.getByTestId('upload').setInputFiles({
    name:'narrow-signature.png',mimeType:'image/png',buffer:Buffer.from(png)
  });
  await expect(page.locator('.file-summary')).toContainText('32×600');
  await page.getByTestId('target').fill('5');
  await page.getByRole('checkbox',{name:'Allow smaller dimensions if needed'}).check();
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const result=await page.evaluate(async()=>{
    const url=document.querySelector('[data-testid="download"]').href;
    const blob=await(await fetch(url)).blob();
    const bitmap=await createImageBitmap(blob);
    const dimensions={width:bitmap.width,height:bitmap.height,bytes:blob.size,mime:blob.type};
    bitmap.close();return dimensions;
  });
  expect(result.mime).toBe('image/png');
  expect(result.width).toBeLessThan(32);
  expect(result.height).toBeLessThan(600);
  expect(result.bytes).toBeLessThanOrEqual(5000);
  await expect(page.getByTestId('result-meta')).toContainText(result.width+'×'+result.height);
  await expect(page.getByTestId('exact-bytes')).toContainText(String(result.bytes));
});

test('bulk ZIP contains actual processed images @public-smoke',async({page})=>{
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
  await selectResizeMode(page,'contain');
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
    await expect(page.locator('.tool-list .tool-link')).toHaveCount(9);
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
test('375px layout has no horizontal page overflow @public-smoke',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  for(const route of ['/zh/','/zh/resize-image/','/passport-photo-print/']){
    await page.goto(route,{waitUntil:'domcontentloaded'});
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
  await selectResizeMode(page,'contain');
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
  await selectResizeMode(page,'cover');
  await expect(page.locator('.preview-frame canvas')).toBeVisible();
});

test('batch maximum dimensions do not add padding or enlarge small images',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,2);
  await expect(page.getByLabel('Resize method')).toHaveValue('within');
  await page.getByTestId('width').fill('55');
  await page.getByTestId('height').fill('35');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('batch-export-details')).toContainText('53×35');
  await expect(page.getByTestId('result-meta')).toContainText('2');
  await expect(page.getByTestId('download')).toBeVisible();
});
test('batch limit reports a clear error without processing',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,31);
  await expect(page.getByTestId('status')).toContainText('Maximum 30 files');
  await expect(page.getByTestId('process')).toBeDisabled();
});

test('batch blocks excessive output pixels before allocating a giant canvas',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,5);
  await selectResizeMode(page,'contain');
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
test('white letterboxing requires explicit exact-size Fit and JPEG format',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await selectResizeMode(page,'contain');
  await page.getByTestId('format').selectOption('jpeg');
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
test('one successful bulk resize downloads PNG directly',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page);
  await page.getByTestId('width').fill('60');await page.getByTestId('height').fill('60');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toContainText('Download file');
  await expect(page.getByTestId('download')).toHaveAttribute('download','sample-0-edited.png');
  const data=await page.evaluate(async()=>Array.from(new Uint8Array(await(await(await fetch(document.querySelector('[data-testid=download]').href)).blob()).arrayBuffer())));
  expect(data.slice(0,8)).toEqual([137,80,78,71,13,10,26,10]);
  await expect(page.getByTestId('size-comparison')).toContainText('Output file');
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
  await expect(page.locator('.field-grid input[type="range"]').first()).toBeDisabled();
});
test('choosing the same image after output resets the stale download',async({page})=>{
  await page.goto('/resize-image/');await uploadSynthetic(page);
  await page.getByTestId('process').click();await expect(page.getByTestId('download')).toBeVisible();
  await uploadSynthetic(page);
  await expect(page.getByTestId('download')).toHaveCount(0);
  await expect(page.locator('.file-summary')).toContainText('sample-0.png');
});

test('Chinese resizing choices use plain words and explain what happens before upload',async({page})=>{
  await page.goto('/zh/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const mode=page.getByTestId('resize-mode');
  await expect(mode).toHaveValue('within');
  await expect(mode.locator('option[value="within"]')).toHaveText('按比例缩放（推荐）');
  await expect(mode.locator('option[value="cover"]')).toHaveText('裁剪边缘，填满尺寸');
  await expect(mode.locator('option[value="contain"]')).toHaveText('保留整张图，空白补齐');
  await expect(page.getByTestId('resize-mode-help')).toContainText('不加白边');
  await expect(mode).toBeHidden();
  await expect(page.getByTestId('advanced-resize-summary')).toContainText('需要固定宽高');
  await page.getByTestId('advanced-resize-summary').click();
  await expect(mode).toBeVisible();
  await mode.selectOption('cover');
  await expect(page.getByTestId('resize-mode-help')).toContainText('可能被裁掉');
  await mode.selectOption('contain');
  await expect(page.getByTestId('resize-mode-help')).toContainText('可能出现空白');
});
test('English resizing choices explain proportional, crop and padding modes',async({page})=>{
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const mode=page.getByTestId('resize-mode');
  await expect(mode).toHaveValue('within');
  await expect(mode.locator('option[value="within"]')).toHaveText('Keep proportions (recommended)');
  await expect(page.getByTestId('resize-mode-help')).toContainText('without cropping or borders');
  await expect(mode).toBeHidden();
  await page.getByTestId('advanced-resize-summary').click();
  await expect(mode).toBeVisible();
  await mode.selectOption('cover');
  await expect(page.getByTestId('resize-mode-help')).toContainText('may be cut off');
  await mode.selectOption('contain');
  await expect(page.getByTestId('resize-mode-help')).toContainText('Empty space may appear');
});

test('chosen specialist mode remains clearly labelled when advanced options are collapsed',async({page})=>{
  await page.goto('/zh/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await selectResizeMode(page,'cover');
  await page.getByTestId('advanced-resize-summary').click();
  await expect(page.getByTestId('resize-mode')).toBeHidden();
  await expect(page.getByTestId('advanced-resize-summary')).toContainText('当前方式');
  await expect(page.getByTestId('advanced-resize-summary')).toContainText('裁剪边缘');
  await expect(page.getByTestId('resize-mode-help')).toContainText('可能被裁掉');
  await selectResizeMode(page,'within');
  await expect(page.getByTestId('advanced-resize-summary')).toContainText('需要固定宽高');
  await expect(page.getByTestId('resize-mode')).toHaveValue('within');
});
test('mobile initially shows simple resize inputs without specialist mode picker',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('/zh/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('width')).toBeVisible();
  await expect(page.getByTestId('height')).toBeVisible();
  await expect(page.getByTestId('resize-mode')).toBeHidden();
  await expect(page.getByTestId('advanced-resize-summary')).toBeVisible();
  await expect(page.getByTestId('resize-mode-help')).toContainText('默认按比例缩放');
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.viewport+1);
});

test('simple resizing hides optional KB controls, while compression shows its KB target',async({page})=>{
  await page.goto('/zh/resize-image/');await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('output-advanced')).toBeVisible();
  await expect(page.getByTestId('target')).toBeHidden();
  await expect(page.getByTestId('width')).toBeVisible();
  await page.getByTestId('output-advanced').locator('summary').click();
  await expect(page.getByTestId('target')).toBeVisible();
  await page.goto('/zh/compress-image-to-size/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('target')).toBeVisible();
  await expect(page.getByTestId('target')).toHaveValue('100');
});
test('signature resize has no unsolicited default file-size limit',async({page})=>{
  await page.goto('/signature-resizer/');await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByTestId('target')).toHaveValue('0');
  await uploadSynthetic(page);await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
});
test('batch export has a short summary and a per-image dimensions list',async({page})=>{
  await page.goto('/bulk-image-resizer/');await uploadSynthetic(page,3);
  await expect(page.getByTestId('batch-preview-caption')).toContainText('Original preview with the current resize settings');
  await expect(page.getByTestId('batch-preview-file')).toHaveCount(3);
  await page.getByTestId('width').fill('50');await page.getByTestId('height').fill('40');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toContainText('ZIP');
  await expect(page.getByTestId('result-meta')).toContainText('3');
  await expect(page.getByTestId('result-meta')).not.toContainText(' | ');
  const details=page.getByTestId('batch-export-details');
  await details.locator('summary').click();
  await expect(details.locator('li')).toHaveCount(3);
  await expect(details.locator('li').first()).toContainText('50×33');
});

test('exact-size mode never silently downscales when KB goal cannot be met',async({page})=>{
  await page.goto('/zh/resize-image/');
  await uploadSynthetic(page);
  await page.getByTestId('advanced-resize-summary').click();
  await page.getByTestId('resize-mode').selectOption('contain');
  await expect(page.getByTestId('exact-size-note')).toContainText('不会偷偷缩小');
  await page.getByTestId('width').fill('400');
  await page.getByTestId('height').fill('400');
  await page.getByTestId('format').selectOption('png');
  await page.locator('[data-testid="output-advanced"] summary').click();
  await page.getByTestId('target').fill('1');
  await expect(page.locator('.output-advanced input[type=checkbox]')).toHaveCount(0);
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toHaveCount(0);
  await expect(page.getByTestId('status')).toContainText('无法达到指定 KB');
  await expect(page.getByTestId('status')).not.toContainText('Could not reach');
  await page.getByTestId('target').fill('0');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('result-meta')).toContainText('400×400');
});
test('proportional mode retains optional downscaling control',async({page})=>{
  await page.goto('/resize-image/');
  await uploadSynthetic(page);
  await page.locator('[data-testid="output-advanced"] summary').click();
  await expect(page.locator('.output-advanced input[type=checkbox]')).toHaveCount(1);
});

test('batch one and batch many preserve the same 800px default maxima and expose planned sizes',async({page})=>{
  await page.goto('/bulk-image-resizer/');
  await uploadSynthetic(page,1);
  await expect(page.getByTestId('width')).toHaveValue('800');
  await expect(page.getByTestId('height')).toHaveValue('800');
  await page.getByTestId('batch-plan').locator('summary').click();
  await expect(page.getByTestId('batch-plan')).toContainText('120×80');
  // Start a fresh selection for the single-vs-many comparison.
  await page.getByRole('button',{name:'Clear'}).click();
  await uploadSynthetic(page,2);
  await expect(page.getByTestId('width')).toHaveValue('800');
  await expect(page.getByTestId('batch-plan').locator('li')).toHaveCount(2);
  await page.getByTestId('width').fill('60');
  await page.getByTestId('height').fill('60');
  await expect(page.getByTestId('batch-plan').locator('li').first()).toContainText('60×40');
});

test('JPEG output preview fills transparent source pixels with white before export',async({page})=>{
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const bytes=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=32;c.height=32;
    c.getContext('2d').clearRect(0,0,32,32);
    const b=await new Promise(ok=>c.toBlob(ok,'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByTestId('upload').setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await expect(page.locator('.file-summary')).toContainText('32×32');
  await page.getByTestId('format').selectOption('jpeg');
  await expect.poll(async()=>page.evaluate(()=>{
    const c=document.querySelector('.preview-frame canvas');
    if(!c||!c.width)return null;
    return Array.from(c.getContext('2d').getImageData(0,0,1,1).data);
  })).toEqual([255,255,255,255]);
});

test('bulk resize with invalid plus valid image directly downloads one success',async({page})=>{
  await page.goto('/zh/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const png=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=48;c.height=32;
    c.getContext('2d').fillRect(0,0,48,32);
    const b=await new Promise(r=>c.toBlob(r,'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByTestId('upload').setInputFiles([
    {name:'bad-source.png',mimeType:'image/png',buffer:Buffer.from([1,2,3,4,5])},
    {name:'good-source.png',mimeType:'image/png',buffer:Buffer.from(png)}
  ]);
  await expect(page.getByTestId('skipped-inputs')).toContainText('bad-source.png');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toHaveAttribute('download','good-source-edited.png');
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await(await fetch(document.querySelector('[data-testid=download]').href)).blob()).arrayBuffer())));
  expect(bytes.slice(0,8)).toEqual([137,80,78,71,13,10,26,10]);
});
test('batch exports successes and names individual files that fail a strict KB limit',async({page})=>{
  await page.goto('/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const images=await page.evaluate(async()=>{
    const make=async(noisy)=>{
      const c=document.createElement('canvas');
      c.width=noisy?160:24;c.height=noisy?120:24;
      const x=c.getContext('2d');
      if(noisy){
        const im=x.createImageData(c.width,c.height);
        let state=0x12345678;
        for(let i=0;i<im.data.length;i+=4){
          state^=state<<13;state^=state>>>17;state^=state<<5;
          im.data[i]=state&255;im.data[i+1]=(state>>>8)&255;im.data[i+2]=(state>>>16)&255;im.data[i+3]=255;
        }
        x.putImageData(im,0,0);
      }else{ x.fillStyle='#336699';x.fillRect(0,0,c.width,c.height); }
      const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    };
    return {small:await make(false),large:await make(true)};
  });
  await page.getByTestId('upload').setInputFiles([
    {name:'small.png',mimeType:'image/png',buffer:Buffer.from(images.small)},
    {name:'detailed.png',mimeType:'image/png',buffer:Buffer.from(images.large)}
  ]);
  await expect(page.locator('.file-summary')).toContainText('2 file(s)');
  await page.locator('[data-testid=output-advanced] summary').click();
  await page.getByTestId('target').fill('1');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toContainText('Download file');
  await expect(page.getByTestId('skipped-outputs')).toContainText('detailed.png');
  await expect(page.getByTestId('skipped-outputs')).toContainText('Could not reach');
  await expect(page.getByTestId('result-meta')).toContainText('PNG');
  const bytes=await page.evaluate(async()=>{
    const blob=await(await fetch(document.querySelector('[data-testid=download]').href)).blob();
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await expect(page.getByTestId('download')).toHaveAttribute('download','small-edited.png');
  expect(bytes.slice(0,8)).toEqual([137,80,78,71,13,10,26,10]);
});

test('Chinese resize and batch limits explain failures in Chinese, without fake downloads',async({page})=>{
  await page.goto('/zh/resize-image/');await uploadSynthetic(page);
  await selectResizeMode(page,'contain');
  await page.getByTestId('width').fill('9000');
  await page.getByTestId('height').fill('9000');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('status')).toContainText('3200 万像素');
  await expect(page.getByTestId('status')).not.toContainText('32-megapixel');
  await expect(page.getByTestId('download')).toHaveCount(0);

  const animation=Buffer.from([82,73,70,70,28,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,2]);
  await page.getByTestId('upload').setInputFiles({name:'animated.webp',mimeType:'image/webp',buffer:animation});
  await expect(page.getByTestId('status')).toContainText('暂不支持动画');

  await page.goto('/zh/bulk-image-resizer/');await uploadSynthetic(page,5);
  await selectResizeMode(page,'cover');
  await page.getByTestId('width').fill('5000');
  await page.getByTestId('height').fill('5000');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('status')).toContainText('1.2 亿');
  await expect(page.getByTestId('status')).not.toContainText('120-megapixel');
  await expect(page.getByTestId('download')).toHaveCount(0);
});

test('Chinese bulk output error identifies a file that misses the KB limit',async({page})=>{
  await page.goto('/zh/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const imgs=await page.evaluate(async()=>{
    async function make(noisy){
      const c=document.createElement('canvas');c.width=noisy?160:24;c.height=noisy?120:24;
      const ctx=c.getContext('2d');
      if(noisy){
        const data=ctx.createImageData(c.width,c.height);
        let seed=0x12345678;
        for(let i=0;i<data.data.length;i+=4){
          seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
          data.data[i]=seed&255;data.data[i+1]=(seed>>>8)&255;data.data[i+2]=(seed>>>16)&255;data.data[i+3]=255;
        }
        ctx.putImageData(data,0,0);
      }else{ctx.fillStyle='#336699';ctx.fillRect(0,0,c.width,c.height);}
      const b=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    }
    return {small:await make(false),noisy:await make(true)};
  });
  await page.getByTestId('upload').setInputFiles([
    {name:'small.png',mimeType:'image/png',buffer:Buffer.from(imgs.small)},
    {name:'noisy.png',mimeType:'image/png',buffer:Buffer.from(imgs.noisy)}
  ]);
  await expect(page.locator('.file-summary')).toContainText('2 个文件');
  await page.locator('[data-testid=output-advanced] summary').click();
  await page.getByTestId('target').fill('1');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toHaveAttribute('download','small-edited.png');
  await expect(page.getByTestId('skipped-outputs')).toContainText('noisy.png');
  await expect(page.getByTestId('skipped-outputs')).toContainText('无法达到指定 KB');
  await expect(page.getByTestId('skipped-outputs')).not.toContainText('Could not reach');
});

test('failed 4x6 JPEG print export releases its full-size canvas',async({page})=>{
  await page.goto('/passport-photo-print/');
  await uploadSynthetic(page);
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,type,...args){
      if(this.width===1200&&this.height===1800&&type==='image/jpeg'){
        window.__failedPrintCanvas=this;
        callback(null);
        return;
      }
      return original.call(this,callback,type,...args);
    };
  });
  await page.getByTestId('process').click();
  await expect(page.getByTestId('status')).toContainText('Image encoding failed');
  await expect(page.getByTestId('download')).toHaveCount(0);
  const freed=await page.evaluate(()=>({
    width:window.__failedPrintCanvas?.width,
    height:window.__failedPrintCanvas?.height
  }));
  expect(freed).toEqual({width:0,height:0});
});
