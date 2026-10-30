import {test,expect} from '@playwright/test';

async function pngFiles(page,count){
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=75;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#2468ab';ctx.fillRect(0,0,100,75);
    ctx.fillStyle='#e68642';ctx.fillRect(12,10,50,32);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Array.from({length:count},(_,i)=>({
    name:'batch-'+(i+1)+'.png',mimeType:'image/png',buffer:Buffer.from(bytes)
  }));
}

async function coverCurrent(page){
  await expect(page.locator('.redactor-stage')).toHaveAttribute('data-preview-ready','true');
  const overlay=page.getByTestId('redact-overlay');
  await overlay.scrollIntoViewIfNeeded();
  const r=await overlay.boundingBox();
  if(!r)throw new Error('Missing redaction drawing surface');
  await page.mouse.move(r.x+r.width*.14,r.y+r.height*.18);
  await page.mouse.down();
  await page.mouse.move(r.x+r.width*.57,r.y+r.height*.65,{steps:6});
  await page.mouse.up();
  await expect(page.getByTestId('redact-count')).toHaveText('1');
}

test('bulk resize reports every failed output and retains an earlier working ZIP',async({page})=>{
  await page.goto('/zh/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  await page.getByTestId('upload').setInputFiles(await pngFiles(page,3));
  await expect(page.locator('.file-summary')).toContainText('3 个文件');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toHaveAttribute('download','plainmile-images.zip');
  const previous=await page.getByTestId('download').getAttribute('href');
  await expect(page.getByTestId('batch-outcome')).toHaveText('成功导出: 3 · 失败: 0');

  await page.evaluate(()=>{
    HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};
  });
  await page.getByTestId('process').click();
  const failures=page.getByTestId('batch-attempt-errors');
  await expect(failures).toContainText('本次导出失败的图片 (3)');
  for(const i of [1,2,3])await expect(failures).toContainText('batch-'+i+'.png');
  await expect(failures).toContainText('图片编码失败');
  await expect(page.getByTestId('status')).toContainText('已保留之前的图片和下载结果');
  await expect(page.getByTestId('download')).toHaveAttribute('href',previous);
  await expect(page.getByTestId('batch-outcome')).toHaveText('成功导出: 3 · 失败: 0');
});

test('stopped bulk resize separates exported, failed and never-processed images',async({page})=>{
  await page.goto('/zh/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  await page.getByTestId('upload').setInputFiles(await pngFiles(page,3));
  await expect(page.locator('.file-summary')).toContainText('3 个文件');
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    let n=0;
    HTMLCanvasElement.prototype.toBlob=function(callback,mime,quality){
      n++;
      if(n===2){window.__finishSecondResize=()=>callback(null);return;}
      return original.call(this,callback,mime,quality);
    };
  });
  await page.getByTestId('process').click();
  await expect(page.getByTestId('batch-progress')).toContainText('已处理 1 / 3');
  await expect(page.getByTestId('batch-cancel')).toBeEnabled();
  await page.getByTestId('batch-cancel').click();
  await page.evaluate(()=>window.__finishSecondResize());
  await expect(page.getByTestId('batch-outcome')).toHaveText('成功导出: 1 · 失败: 1 · 停止后未处理: 1');
  await expect(page.getByTestId('skipped-outputs')).toContainText('batch-2.png');
  await expect(page.getByTestId('skipped-outputs')).not.toContainText('batch-3.png');
  await expect(page.getByTestId('download')).toHaveAttribute('download','batch-1-edited.png');
  await expect(page.getByTestId('status')).toContainText('已停止批量处理');
  await expect(page.getByTestId('batch-progress')).toHaveCount(0);
});

test('redaction ZIP shows truthful per-file progress without exposing source filenames',async({page})=>{
  await page.goto('/zh/redact-image/');
  await expect(page.locator('[data-redactor-ready=true]')).toBeVisible();
  await page.getByTestId('redact-upload').setInputFiles(await pngFiles(page,2));
  await expect(page.locator('.redactor-file')).toHaveCount(2);
  await coverCurrent(page);
  await page.locator('.redactor-file').nth(1).click();
  await coverCurrent(page);
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    let n=0;
    HTMLCanvasElement.prototype.toBlob=function(callback,mime,quality){
      n++;
      if(n===2){window.__finishSecondRedaction=()=>original.call(this,callback,mime,quality);return;}
      return original.call(this,callback,mime,quality);
    };
  });
  const downloaded=page.waitForEvent('download');
  await page.getByTestId('redact-download-all').click();
  const progress=page.getByTestId('redact-export-progress');
  await expect(progress).toContainText('正在逐张打码 1 / 2');
  await expect(progress.locator('progress')).toHaveAttribute('value','1');
  await expect(progress.locator('progress')).toHaveAttribute('aria-label','正在逐张打码');
  await expect(page.getByTestId('redact-download-all')).toBeDisabled();
  await page.evaluate(()=>window.__finishSecondRedaction());
  expect((await downloaded).suggestedFilename()).toBe('plainmile-redacted-images.zip');
  await expect(progress).toHaveCount(0);
  await expect(page.getByTestId('redact-status')).toContainText('ZIP · 2 张图片');
  await expect(page.getByTestId('redact-download-again')).toHaveAttribute('download','plainmile-redacted-images.zip');
});
