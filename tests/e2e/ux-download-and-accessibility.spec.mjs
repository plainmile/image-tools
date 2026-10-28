import {test, expect} from '@playwright/test';

async function sample(page) {
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=120;canvas.height=80;
    const context=canvas.getContext('2d');
    context.fillStyle='#327abc';context.fillRect(0,0,120,80);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return {name:'sample.png',mimeType:'image/png',buffer:Buffer.from(bytes)};
}

test('localized skip navigation targets the main landmark',async({page})=>{
  for (const [route,label] of [['/','Skip to main content'],['/zh/','跳转到主要内容']]) {
    await page.goto(route);
    const skip=page.locator('a.skip-link');
    await expect(skip).toHaveText(label);
    await expect(skip).toHaveAttribute('href','#main-content');
    await expect(page.locator('main#main-content')).toHaveAttribute('tabindex','-1');
  }
});

test('resize and convert show actual original versus exported byte sizes',async({page})=>{
  const file=await sample(page);
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  await page.getByTestId('upload').setInputFiles(file);
  await page.getByTestId('process').click();
  await expect(page.getByTestId('size-comparison')).toContainText('Original total');
  await expect(page.getByTestId('size-comparison')).toContainText('Output file');
  await page.goto('/zh/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  await page.getByTestId('convert-upload').setInputFiles(file);
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-size-comparison')).toContainText('原文件合计');
  await expect(page.getByTestId('convert-size-comparison')).toContainText('转换结果');
});

test('redaction exposes a repeatable download link and invalidates it after changing masks',async({page})=>{
  await page.goto('/redact-image/');
  await expect(page.locator('[data-redactor-ready=true]')).toBeVisible();
  await page.getByTestId('redact-upload').setInputFiles(await sample(page));
  const overlay=page.getByTestId('redact-overlay');
  const box=await overlay.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55);
  await page.mouse.up();
  await expect(page.getByTestId('redact-mark')).toHaveCount(1);
  const first=page.waitForEvent('download');
  await page.getByTestId('redact-download').click();
  await first;
  const link=page.getByTestId('redact-download-again');
  await expect(link).toBeVisible();
  await expect(page.getByTestId('redact-saved-result')).toContainText('Original');
  const repeated=page.waitForEvent('download');
  await link.click();
  expect((await repeated).suggestedFilename()).toBe('redacted-image.png');
  await page.getByTestId('redact-undo').click();
  await expect(link).toHaveCount(0);
});


test('partial batch conversion compares bytes only for successful outputs',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const first=await sample(page);
  const second={...first,name:'will-fail.png'};
  await page.getByTestId('convert-upload').setInputFiles([first,second]);
  await expect(page.locator('.file-summary')).toContainText('2');
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    let attempts=0;
    HTMLCanvasElement.prototype.toBlob=function(callback,mime,quality){
      attempts++;
      if(attempts===2){callback(null);return;}
      return original.call(this,callback,mime,quality);
    };
  });
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-download')).toBeVisible();
  await expect(page.getByTestId('convert-failed-output')).toContainText('will-fail.png');
  const bytes=first.buffer.byteLength;
  const size=bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KB':(bytes/1048576).toFixed(2)+' MB';
  await expect(page.getByTestId('convert-size-comparison')).toContainText('Original (exported images): '+size);
});
