import {test,expect} from '@playwright/test';

async function chooseCanvasImage(page,width,height,name){
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const bytes=await page.evaluate(async({width,height})=>{
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#e13d52';ctx.fillRect(0,0,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  },{width,height});
  await page.getByTestId('upload').setInputFiles({
    name,mimeType:'image/png',buffer:Buffer.from(bytes)
  });
  await expect(page.locator('.file-summary')).toContainText(width+'×'+height);
}
async function selectExactMode(page,mode='contain'){
  await page.getByTestId('advanced-resize-summary').click();
  await page.getByTestId('resize-mode').selectOption(mode);
}

test('portrait: locked exact dimensions never distort the source ratio at the 10000px limit',async({page})=>{
  await page.goto('/zh/resize-image/');
  await chooseCanvasImage(page,2,2000,'tall.png');
  await selectExactMode(page);
  await page.getByLabel('同步修改宽高').check();
  await page.getByTestId('width').fill('800');
  // Without this fix, only the height was clipped, yielding 800x10000
  // (80:1000 instead of the source 1:1000 aspect ratio).
  await expect(page.getByTestId('width')).toHaveValue('10');
  await expect(page.getByTestId('height')).toHaveValue('10000');
  await expect(page.getByTestId('status')).toContainText('已同时缩小宽度和高度');
  await expect(page.getByTestId('expected-dimensions')).toContainText('10×10000');
  await page.getByTestId('format').selectOption('png');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const result=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid=download]');
    const bitmap=await createImageBitmap(await(await fetch(link.href)).blob());
    const dimensions={width:bitmap.width,height:bitmap.height};
    bitmap.close();return dimensions;
  });
  expect(result).toEqual({width:10,height:10000});
  expect(result.height/result.width).toBe(1000);
});

test('square: locked exact dimensions respect the 32MP output ceiling before export',async({page})=>{
  await page.goto('/resize-image/');
  await chooseCanvasImage(page,60,60,'square.png');
  await selectExactMode(page,'cover');
  await page.getByLabel('Sync width and height').check();
  await page.getByTestId('width').fill('8000');
  await expect(page.getByTestId('width')).toHaveValue('5656');
  await expect(page.getByTestId('height')).toHaveValue('5656');
  await expect(page.getByTestId('status')).toContainText('both dimensions were reduced');
  await page.getByTestId('width').fill('200');
  await expect(page.getByTestId('height')).toHaveValue('200');
  await expect(page.getByTestId('status')).not.toContainText('both dimensions were reduced');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('result-meta')).toContainText('200×200');
  const result=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid=download]');
    const bitmap=await createImageBitmap(await(await fetch(link.href)).blob());
    const dimensions=[bitmap.width,bitmap.height];bitmap.close();return dimensions;
  });
  expect(result).toEqual([200,200]);
});
