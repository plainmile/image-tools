import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

async function makeImages(page) {
  return page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=37;canvas.height=19;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,37,19);
    ctx.fillStyle='#ed264b';ctx.fillRect(5,3,22,11);
    const convert=async mime=>{
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    };
    return {png:await convert('image/png'),jpeg:await convert('image/jpeg')};
  });
}

test('English and Chinese converter pages have reciprocal SEO and a usable compact form',async({page})=>{
  for(const route of ['/convert-image/','/zh/convert-image/']){
    const res=await page.goto(route);
    expect(res.status()).toBe(200);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','https://image.plainmile.com'+route);
    await expect(page.locator('link[hreflang=en]')).toHaveAttribute('href','https://image.plainmile.com/convert-image/');
    await expect(page.locator('link[hreflang=zh-CN]')).toHaveAttribute('href','https://image.plainmile.com/zh/convert-image/');
    await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
    await expect(page.getByTestId('convert-format')).toHaveValue('jpeg');
    await expect(page.getByTestId('convert-process')).toBeDisabled();
  }
  await page.setViewportSize({width:375,height:812});
  await page.goto('/zh/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const measures=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  expect(measures.scroll).toBeLessThanOrEqual(measures.width+1);
});

test('one transparent PNG converts directly to a same-size JPEG with white background',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const bytes=(await makeImages(page)).png;
  await page.getByTestId('convert-upload').setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await expect(page.locator('.file-summary')).toContainText('37×19');
  await expect(page.getByTestId('convert-alpha-warning')).toBeVisible();
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-download')).toBeVisible();
  const output=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid=convert-download]');
    const blob=await(await fetch(link.href)).blob();
    const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
    const corner=Array.from(ctx.getImageData(0,0,1,1).data);
    const result={type:blob.type,name:link.download,size:blob.size,dimensions:[bitmap.width,bitmap.height],corner};
    bitmap.close();return result;
  });
  expect(output).toMatchObject({type:'image/jpeg',name:'transparent-converted.jpg',dimensions:[37,19]});
  expect(output.size).toBeGreaterThan(100);
  expect(output.corner.slice(0,3).every(x=>x>240)).toBe(true);
  await expect(page.getByTestId('convert-result-meta')).toContainText(String(output.size));
});

test('two mixed-format inputs produce a real PNG ZIP preserving both dimensions',async({page})=>{
  await page.goto('/zh/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const images=await makeImages(page);
  await page.getByTestId('convert-upload').setInputFiles([
    {name:'one.jpg',mimeType:'image/jpeg',buffer:Buffer.from(images.jpeg)},
    {name:'two.png',mimeType:'image/png',buffer:Buffer.from(images.png)}
  ]);
  await expect(page.locator('.file-summary')).toContainText('2');
  await page.getByTestId('convert-format').selectOption('png');
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-download')).toBeVisible();
  const payload=await page.evaluate(async()=>{
    const a=document.querySelector('[data-testid=convert-download]');
    return {name:a.download,bytes:Array.from(new Uint8Array(await(await(await fetch(a.href)).blob()).arrayBuffer()))};
  });
  expect(payload.name).toBe('plainmile-converted-images.zip');
  const zip=await JSZip.loadAsync(Buffer.from(payload.bytes));
  expect(Object.keys(zip.files)).toEqual(['01-one-converted.png','02-two-converted.png']);
  for(const name of Object.keys(zip.files)){
    const bytes=Buffer.from(await zip.file(name).async('uint8array'));
    expect(Array.from(bytes.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);
    expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([37,19]);
  }
});

test('animated APNG and WebP are blocked instead of being turned into silent still frames',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const signature=[137,80,78,71,13,10,26,10];
  const chunk=(tag,bytes)=>[0,0,0,bytes.length,...[...tag].map(x=>x.charCodeAt(0)),...bytes,0,0,0,0];
  const apng=Buffer.from([...signature,...chunk('IHDR',Array(13).fill(0)),...chunk('acTL',Array(8).fill(0)),...chunk('IDAT',[])]);
  const webp=Buffer.from([82,73,70,70,28,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,2]);
  for(const item of [{name:'moving.png',mimeType:'image/png',buffer:apng},{name:'moving.webp',mimeType:'image/webp',buffer:webp}]){
    await page.getByTestId('convert-upload').setInputFiles(item);
    await expect(page.getByTestId('convert-failed-input')).toContainText('Animated');
    await expect(page.getByTestId('convert-process')).toBeDisabled();
    await expect(page.getByTestId('convert-download')).toHaveCount(0);
  }
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  await page.getByTestId('upload').setInputFiles({name:'moving.png',mimeType:'image/png',buffer:apng});
  await expect(page.getByTestId('status')).toContainText('Animated');
  await expect(page.getByTestId('process')).toBeDisabled();
});

test('converter skips corrupt inputs without losing valid outputs, and makes no POST requests',async({page})=>{
  const posts=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))posts.push(r.url());});
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const {png}=await makeImages(page);
  await page.getByTestId('convert-upload').setInputFiles([
    {name:'bad.png',mimeType:'image/png',buffer:Buffer.from([1,2,3,4])},
    {name:'good.png',mimeType:'image/png',buffer:Buffer.from(png)}
  ]);
  await expect(page.getByTestId('convert-failed-input')).toContainText('bad.png');
  await page.getByTestId('convert-format').selectOption('png');
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-download')).toBeVisible();
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await(await fetch(document.querySelector('[data-testid=convert-download]').href)).blob()).arrayBuffer())));
  const zip=await JSZip.loadAsync(Buffer.from(bytes));
  expect(Object.keys(zip.files)).toEqual(['01-good-converted.png']);
  expect(posts).toEqual([]);
});

test('bulk image resizing has an actionable cancel control during processing',async({page})=>{
  await page.goto('/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const {png}=await makeImages(page);
  await page.getByTestId('upload').setInputFiles(Array.from({length:4},(_,i)=>({
    name:'photo-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(png)
  })));
  await expect(page.locator('.file-summary')).toContainText('4');
  await page.evaluate(()=>{
    const old=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){
      return old.call(this,blob=>setTimeout(()=>callback(blob),350),...args);
    };
  });
  await page.getByTestId('process').click();
  await expect(page.getByTestId('batch-progress')).toBeVisible();
  await expect(page.getByTestId('batch-cancel')).toBeVisible();
  await page.getByTestId('batch-cancel').click();
  await expect(page.getByTestId('status')).toContainText('Batch stopped.');
  await expect(page.getByTestId('download')).toHaveCount(0);
});
