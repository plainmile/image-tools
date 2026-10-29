import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

async function makeImages(page){
  return page.evaluate(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=96;canvas.height=64;
    const context=canvas.getContext('2d');
    context.fillStyle='#1d6fb2';context.fillRect(0,0,canvas.width,canvas.height);
    context.fillStyle='#fca311';context.fillRect(4,4,28,21);
    const bytes=async(mime)=>{
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,0.9));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    };
    return {png:await bytes('image/png'),jpeg:await bytes('image/jpeg')};
  });
}

test('incorrect image signatures are rejected with a clear Chinese message and preserve the prior selection',async({page})=>{
  await page.goto('/zh/resize-image/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const {png,jpeg}=await makeImages(page);
  await page.getByTestId('upload').setInputFiles({name:'fake.png',mimeType:'image/png',buffer:Buffer.from(jpeg)});
  await expect(page.getByTestId('status')).toContainText('文件格式不一致');
  await expect(page.getByTestId('process')).toBeDisabled();
  await page.getByTestId('upload').setInputFiles({name:'correct.png',mimeType:'image/png',buffer:Buffer.from(png)});
  await expect(page.locator('.file-summary')).toContainText('correct.png');
  await page.getByTestId('upload').setInputFiles({name:'wrong.png',mimeType:'image/png',buffer:Buffer.from(jpeg)});
  await expect(page.locator('.file-summary')).toContainText('correct.png');
  await expect(page.getByTestId('status')).toContainText('文件格式不一致');

  await page.goto('/zh/redact-image/');
  await expect(page.locator('[data-redactor-ready=true]')).toBeVisible();
  await page.getByTestId('redact-upload').setInputFiles({name:'correct.png',mimeType:'image/png',buffer:Buffer.from(png)});
  await expect(page.locator('.redactor-file')).toHaveCount(1);
  await page.getByTestId('redact-upload').setInputFiles({name:'fake.png',mimeType:'image/png',buffer:Buffer.from(jpeg)});
  await expect(page.getByTestId('redact-status')).toContainText('文件格式不一致');
  await expect(page.locator('.redactor-file')).toHaveCount(1);
});

test('bulk resize removes just the unwanted photo, without reselecting the entire batch',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('/zh/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const {png}=await makeImages(page);
  await page.getByTestId('upload').setInputFiles(Array.from({length:3},(_,i)=>({
    name:'sample-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(png)
  })));
  await expect(page.getByTestId('remove-batch-file')).toHaveCount(3);
  await page.getByRole('button',{name:'移除 sample-1.png'}).click();
  await expect(page.getByTestId('remove-batch-file')).toHaveCount(2);
  await expect(page.locator('.file-summary')).toContainText('sample-0.png');
  await expect(page.locator('.file-summary')).not.toContainText('sample-1.png');
  await expect(page.locator('.file-summary')).toContainText('sample-2.png');
  const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.width+1);
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const bytes=await page.evaluate(async()=>{
    const url=document.querySelector('[data-testid=download]').href;
    return [...new Uint8Array(await (await(await fetch(url)).blob()).arrayBuffer())];
  });
  const zip=await JSZip.loadAsync(Buffer.from(bytes));
  expect(Object.keys(zip.files)).toEqual(['01-sample-0-edited.png','02-sample-2-edited.png']);
  await page.getByRole('button',{name:'移除 sample-0.png'}).click();
  await expect(page.getByTestId('download')).toHaveCount(0);
  await expect(page.locator('.file-summary')).toContainText('sample-2.png');
});

test('converter switches from ZIP to direct image download after trimming a batch to one',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const {png}=await makeImages(page);
  await page.getByTestId('convert-upload').setInputFiles(Array.from({length:3},(_,i)=>({
    name:'source-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(png)
  })));
  await expect(page.getByTestId('convert-remove-file')).toHaveCount(3);
  await page.getByRole('button',{name:'Remove source-0.png'}).click();
  await page.getByRole('button',{name:'Remove source-1.png'}).click();
  await expect(page.getByTestId('convert-remove-file')).toHaveCount(0);
  await expect(page.locator('.file-summary')).toContainText('Files selected: 1');
  await expect(page.locator('.file-summary')).toContainText('source-2.png');
  await page.getByTestId('convert-process').click();
  const download=page.getByTestId('convert-download');
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('download','source-2-converted.jpg');
  const meta=await page.evaluate(async()=>{
    const blob=await (await fetch(document.querySelector('[data-testid=convert-download]').href)).blob();
    const bitmap=await createImageBitmap(blob);
    const output={type:blob.type,width:bitmap.width,height:bitmap.height};
    bitmap.close();return output;
  });
  expect(meta).toEqual({type:'image/jpeg',width:96,height:64});
});
