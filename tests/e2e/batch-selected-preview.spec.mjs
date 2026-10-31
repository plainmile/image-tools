import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

// Synthetic browser-generated fixtures: test images never leave the client.
async function picture(page,name,width,height,color,{jpeg=false,transparent=false}={}) {
  const bytes=await page.evaluate(async({width,height,color,jpeg,transparent})=>{
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    if(!transparent){ctx.fillStyle=color;ctx.fillRect(0,0,width,height);}
    else{ctx.fillStyle=color;ctx.fillRect(0,0,Math.floor(width/2),height);}
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,jpeg?'image/jpeg':'image/png',0.92));
    return [...new Uint8Array(await blob.arrayBuffer())];
  },{width,height,color,jpeg,transparent});
  return {name,mimeType:jpeg?'image/jpeg':'image/png',buffer:Buffer.from(bytes)};
}

async function displayedImage(page) {
  return page.evaluate(async()=>{
    const img=document.querySelector('.editor-preview .preview-frame img');
    await img.decode();
    const c=document.createElement('canvas');
    c.width=img.naturalWidth;c.height=img.naturalHeight;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const color=[...ctx.getImageData(0,0,1,1).data];
    return {width:c.width,height:c.height,color};
  });
}

test('converter previews each selected source without replacing an already generated ZIP @public-smoke',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const a=await picture(page,'red.png',96,64,'#ee2222');
  const b=await picture(page,'blue.png',42,75,'#2266ee');
  await page.getByTestId('convert-upload').setInputFiles([a,b]);
  await expect(page.getByTestId('convert-preview-file')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Preview red.png'})).toHaveAttribute('aria-pressed','true');
  expect((await displayedImage(page)).color[0]).toBeGreaterThan(200);
  await page.getByRole('button',{name:'Preview blue.png'}).click();
  await expect(page.getByTestId('convert-preview-caption')).toContainText('blue.png');
  await expect(page.getByRole('button',{name:'Preview blue.png'})).toHaveAttribute('aria-pressed','true');
  const blue=await displayedImage(page);
  expect([blue.width,blue.height]).toEqual([42,75]);
  expect(blue.color[2]).toBeGreaterThan(200);
  await page.getByTestId('convert-process').click();
  const download=page.getByTestId('convert-download');
  await expect(download).toHaveAttribute('download','plainmile-converted-images.zip');
  const href=await download.getAttribute('href');
  await page.getByRole('button',{name:'Preview red.png'}).click();
  await expect(page.getByTestId('convert-preview-caption')).toContainText('red.png');
  await expect(download).toHaveAttribute('href',href);
  const comparison=page.getByTestId('convert-batch-comparison-image');
  await expect(comparison).toHaveAttribute('src',
    await page.getByTestId('convert-download-item').first().getAttribute('href'));
  const redFile=await comparison.evaluate(async img=>{
    const blob=await(await fetch(img.src)).blob();return {type:blob.type,bytes:blob.size};
  });
  expect(redFile.type).toBe('image/jpeg');
  expect(redFile.bytes).toBeGreaterThan(100);
  expect((await displayedImage(page)).color[0]).toBeGreaterThan(200);
  await page.getByTestId('convert-preview-toggle').click();
  await expect(comparison).toHaveAttribute('alt','Original image');
  expect(await comparison.evaluate(async img=>(await(await fetch(img.src)).blob()).type)).toBe('image/png');
  await page.getByTestId('convert-preview-toggle').click();
  await expect(comparison).toHaveAttribute('src',
    await page.getByTestId('convert-download-item').first().getAttribute('href'));
  await page.getByRole('button',{name:'Preview blue.png'}).click();
  await expect(comparison).toHaveAttribute('src',
    await page.getByTestId('convert-download-item').nth(1).getAttribute('href'));
  await expect(download).toHaveAttribute('href',href);
  const zipBytes=await page.evaluate(async()=>[...new Uint8Array(await(await fetch(document.querySelector('[data-testid=convert-download]').href)).arrayBuffer())]);
  const zip=await JSZip.loadAsync(Buffer.from(zipBytes));
  expect(Object.keys(zip.files)).toEqual(['01-red-converted.jpg','02-blue-converted.jpg']);
});

test('bulk resize shows each selected source with correct transparency, including after ZIP export',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('/zh/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const jpeg=await picture(page,'opaque.jpg',90,45,'#2866aa',{jpeg:true});
  const png=await picture(page,'transparent.png',50,90,'#ee5533',{transparent:true});
  await page.getByTestId('upload').setInputFiles([jpeg,png]);
  await expect(page.getByTestId('batch-preview-file')).toHaveCount(2);
  await page.getByRole('button',{name:'预览 transparent.png'}).click();
  await expect(page.getByTestId('batch-preview-caption')).toContainText('transparent.png');
  const canvas=page.getByTestId('editor-preview-canvas');
  await expect(canvas).toHaveAttribute('aria-busy','false');
  const img=await canvas.evaluate(c=>({w:c.width,h:c.height,alpha:c.getContext('2d').getImageData(c.width-1,c.height-1,1,1).data[3]}));
  expect(img).toEqual({w:50,h:90,alpha:0});
  const bounds=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);

  await page.getByTestId('process').click();
  const download=page.getByTestId('download');
  await expect(download).toHaveAttribute('download','plainmile-images.zip');
  const href=await download.getAttribute('href');
  const comparison=page.getByTestId('batch-comparison-image');
  await page.getByRole('button',{name:'预览 opaque.jpg'}).click();
  await expect(page.getByTestId('batch-preview-caption')).toContainText('实际导出的图片');
  await expect(comparison).toHaveAttribute('src',
    await page.getByTestId('batch-download-item').first().getAttribute('href'));
  expect(await comparison.evaluate(async img=>{
    const blob=await(await fetch(img.src)).blob();
    await img.decode();return {mime:blob.type,w:img.naturalWidth,h:img.naturalHeight};
  })).toEqual({mime:'image/jpeg',w:90,h:45});
  await page.getByRole('button',{name:'预览 transparent.png'}).click();
  await expect(comparison).toHaveAttribute('src',
    await page.getByTestId('batch-download-item').nth(1).getAttribute('href'));
  const exportedAlpha=await comparison.evaluate(async img=>{
    await img.decode();
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    return ctx.getImageData(c.width-1,c.height-1,1,1).data[3];
  });
  expect(exportedAlpha).toBe(0);
  await page.getByTestId('batch-preview-toggle').click();
  await expect(page.getByTestId('batch-preview-toggle')).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('batch-preview-caption')).toContainText('调整前的原始图片');
  expect(await comparison.evaluate(async img=>(await(await fetch(img.src)).blob()).type)).toBe('image/png');
  await page.getByTestId('batch-preview-toggle').click();
  await expect(comparison).toHaveAttribute('src',
    await page.getByTestId('batch-download-item').nth(1).getAttribute('href'));
  await expect(download).toHaveAttribute('href',href);
});

test('removing a different batch file keeps the selected preview and removing the active file picks a survivor',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const files=[
    await picture(page,'one.png',30,25,'#b32222'),
    await picture(page,'two.png',35,30,'#22b322'),
    await picture(page,'three.png',40,35,'#2222b3')
  ];
  await page.getByTestId('convert-upload').setInputFiles(files);
  await page.getByRole('button',{name:'Preview two.png'}).click();
  await page.getByRole('button',{name:'Remove one.png'}).click();
  await expect(page.getByTestId('convert-preview-caption')).toContainText('two.png');
  await expect(page.getByRole('button',{name:'Preview two.png'})).toHaveAttribute('aria-pressed','true');
  expect((await displayedImage(page)).width).toBe(35);
  await page.getByRole('button',{name:'Remove two.png'}).click();
  await expect(page.getByTestId('convert-preview-file')).toHaveCount(0);
  expect((await displayedImage(page)).width).toBe(40);
  await expect(page.locator('.file-summary')).toContainText('three.png');
});


test('failed converter input never borrows a later file’s completed export',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const first=await picture(page,'first.png',60,40,'#ee2222');
  const second=await picture(page,'second.png',40,60,'#2222ee');
  await page.getByTestId('convert-upload').setInputFiles([first,second]);
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    let count=0;
    HTMLCanvasElement.prototype.toBlob=function(callback,mime,quality){
      if(++count===1){callback(null);return;}
      return original.call(this,callback,mime,quality);
    };
  });
  await page.getByTestId('convert-process').click();
  const download=page.getByTestId('convert-download');
  await expect(download).toHaveAttribute('download','second-converted.jpg');
  await expect(page.getByTestId('convert-batch-comparison-image')).toHaveCount(0);
  await expect(page.getByTestId('convert-preview-caption')).toContainText('This image was not converted');
  await page.getByRole('button',{name:'Preview second.png'}).click();
  const comparison=page.getByTestId('convert-batch-comparison-image');
  await expect(comparison).toHaveAttribute('src',await download.getAttribute('href'));
  expect((await displayedImage(page)).color[2]).toBeGreaterThan(200);
  await page.getByTestId('convert-format').selectOption('webp');
  await expect(comparison).toHaveCount(0);
  await expect(download).toHaveCount(0);
});

test('failed bulk resize input never displays a different source’s encoded file',async({page})=>{
  await page.goto('/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const first=await picture(page,'first.png',60,40,'#ee2222');
  const second=await picture(page,'second.png',40,60,'#2222ee');
  await page.getByTestId('upload').setInputFiles([first,second]);
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    let count=0;
    HTMLCanvasElement.prototype.toBlob=function(callback,mime,quality){
      if(++count===1){callback(null);return;}
      return original.call(this,callback,mime,quality);
    };
  });
  await page.getByTestId('process').click();
  const download=page.getByTestId('download');
  await expect(download).toHaveAttribute('download','second-edited.png');
  await expect(page.getByTestId('batch-comparison-image')).toHaveCount(0);
  await expect(page.getByTestId('batch-preview-caption')).toContainText('This image was not exported');
  await page.getByRole('button',{name:'Preview second.png'}).click();
  const comparison=page.getByTestId('batch-comparison-image');
  await expect(comparison).toHaveAttribute('src',await download.getAttribute('href'));
  expect((await displayedImage(page)).color[2]).toBeGreaterThan(200);
  await page.getByTestId('width').fill('80');
  await expect(comparison).toHaveCount(0);
  await expect(download).toHaveCount(0);
});
