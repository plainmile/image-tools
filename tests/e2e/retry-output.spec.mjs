import {test,expect} from '@playwright/test';

async function testImage(page){
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=45;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#468bd0';ctx.fillRect(0,0,80,45);
    ctx.fillStyle='#d78436';ctx.fillRect(3,3,28,19);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return {name:'last-good.png',mimeType:'image/png',buffer:Buffer.from(bytes)};
}

async function downloadSnapshot(page,testId){
  return page.evaluate(async(id)=>{
    const link=document.querySelector('[data-testid="'+id+'"]');
    if(!link)throw new Error('Missing download link');
    const blob=await (await fetch(link.href)).blob();
    const bitmap=await createImageBitmap(blob);
    const snap={href:link.href,name:link.download,bytes:blob.size,mime:blob.type,width:bitmap.width,height:bitmap.height};
    bitmap.close();
    return snap;
  },testId);
}

async function makeEncoderFail(page){
  await page.evaluate(()=>{
    HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};
  });
}

test('crop re-encode failure leaves previous output pixels and download URL available',async({page})=>{
  await page.goto('/crop-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  await page.getByTestId('transform-upload').setInputFiles(await testImage(page));
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const prior=await downloadSnapshot(page,'transform-download');
  expect(prior.mime).toBe('image/png');
  await makeEncoderFail(page);
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-status')).toContainText('previous image and download');
  await expect(page.getByTestId('transform-status')).toContainText('Image encoding failed');
  await expect(page.getByTestId('transform-crop-result-preview')).toBeVisible();
  expect(await downloadSnapshot(page,'transform-download')).toEqual(prior);
});

test('resize failed reprocessing does not revoke an already downloaded image',async({page})=>{
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  await page.getByTestId('upload').setInputFiles(await testImage(page));
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const prior=await downloadSnapshot(page,'download');
  await makeEncoderFail(page);
  await page.getByTestId('process').click();
  await expect(page.getByTestId('status')).toContainText('previous image and download');
  await expect(page.getByTestId('status')).toContainText('Image encoding failed');
  expect(await downloadSnapshot(page,'download')).toEqual(prior);
});

test('conversion failure keeps last valid export while displaying failed attempt',async({page})=>{
  await page.goto('/zh/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  await page.getByTestId('convert-upload').setInputFiles(await testImage(page));
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-download')).toBeVisible();
  const prior=await downloadSnapshot(page,'convert-download');
  expect(prior.mime).toBe('image/jpeg');
  await makeEncoderFail(page);
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-status')).toContainText('已保留之前的图片和下载结果');
  await expect(page.getByTestId('convert-failed-output')).toContainText('last-good.png');
  await expect(page.getByTestId('convert-failed-output')).toContainText('图片编码失败');
  await expect(page.getByTestId('convert-failed-output')).not.toContainText('Image encoding failed');
  expect(await downloadSnapshot(page,'convert-download')).toEqual(prior);
});
