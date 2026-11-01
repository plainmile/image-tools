import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

async function fixture(page) {
  const raw=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#2675bd';ctx.fillRect(0,0,64,48);
    const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return ['first.png','second.png','third.png'].map(name=>({
    name,mimeType:'image/png',buffer:Buffer.from(raw)
  }));
}

test('stopping a batch keeps encoded successes and counts unattempted images separately @public-smoke',async({page})=>{
  await page.goto('/zh/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  await page.getByTestId('convert-upload').setInputFiles(await fixture(page));
  await page.evaluate(()=>{
    const old=HTMLCanvasElement.prototype.toBlob;
    let count=0;
    HTMLCanvasElement.prototype.toBlob=function(cb,type,q){
      if(++count===2){window.__finish=()=>old.call(this,cb,type,q);return;}
      return old.call(this,cb,type,q);
    };
  });
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-progress')).toContainText('1 / 3');
  await page.getByTestId('convert-cancel').click();
  await page.evaluate(()=>window.__finish());
  await expect(page.getByTestId('convert-batch-outcome')).toHaveText('转换成功: 2 · 失败: 0 · 停止后未处理: 1');
  await expect(page.getByTestId('convert-size-comparison')).toContainText('成功导出图片的原文件');
  await expect(page.getByTestId('convert-size-comparison')).not.toContainText('原文件合计');
  const untouched=page.getByTestId('convert-not-processed');
  await untouched.locator('summary').click();
  await expect(untouched.locator('li')).toHaveText(['third.png']);
  await expect(page.getByTestId('convert-failed-output')).toHaveCount(0);
  const link=page.getByTestId('convert-download');
  await expect(link).toHaveAttribute('download','plainmile-converted-images.zip');
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(
    document.querySelector('[data-testid=convert-download]').href)).arrayBuffer())));
  const zip=await JSZip.loadAsync(Buffer.from(bytes));
  expect(Object.keys(zip.files)).toEqual(['01-first-converted.jpg','02-second-converted.jpg']);
});

test('all failed before stopping: failures are not confused with unprocessed files',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  await page.getByTestId('convert-upload').setInputFiles(await fixture(page));
  await page.evaluate(()=>{
    let count=0;
    HTMLCanvasElement.prototype.toBlob=function(cb){
      if(++count===2){window.__finish=()=>cb(null);return;}
      cb(null);
    };
  });
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-progress')).toContainText('1 / 3');
  await page.getByTestId('convert-cancel').click();
  await page.evaluate(()=>window.__finish());
  await expect(page.getByTestId('convert-attempt-outcome')).toHaveText('This attempt · Converted: 0 · Failed: 2 · Not processed after stopping: 1');
  await expect(page.getByTestId('convert-failed-output')).toContainText('first.png');
  await expect(page.getByTestId('convert-failed-output')).toContainText('second.png');
  await expect(page.getByTestId('convert-failed-output')).not.toContainText('third.png');
  const untouched=page.getByTestId('convert-not-processed-attempt');
  await untouched.locator('summary').click();
  await expect(untouched.locator('li')).toHaveText(['third.png']);
  await expect(page.getByTestId('convert-download')).toHaveCount(0);
});

test('completed partial failure never invents a stopped-before-processing count',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  await page.getByTestId('convert-upload').setInputFiles(await fixture(page));
  await page.evaluate(()=>{
    const old=HTMLCanvasElement.prototype.toBlob;
    let count=0;
    HTMLCanvasElement.prototype.toBlob=function(cb,type,q){
      if(++count===2){cb(null);return;}
      return old.call(this,cb,type,q);
    };
  });
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-batch-outcome')).toHaveText('Converted: 2 · Failed: 1');
  await expect(page.getByTestId('convert-size-comparison')).toContainText('Original (exported images)');
  await expect(page.getByTestId('convert-failed-output')).toContainText('second.png');
  await expect(page.getByTestId('convert-not-processed')).toHaveCount(0);
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(
    document.querySelector('[data-testid=convert-download]').href)).arrayBuffer())));
  const zip=await JSZip.loadAsync(Buffer.from(bytes));
  expect(Object.keys(zip.files)).toEqual(['01-first-converted.jpg','02-third-converted.jpg']);
});
