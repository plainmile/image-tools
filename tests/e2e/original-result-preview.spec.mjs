import {test,expect} from '@playwright/test';

async function screenshot(page) {
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=96;canvas.height=64;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#417fb5';ctx.fillRect(0,0,96,64);
    ctx.fillStyle='#edb432';ctx.fillRect(10,10,35,20);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return {name:'original.png',mimeType:'image/png',buffer:Buffer.from(bytes)};
}

for(const params of [
  {route:'/resize-image/',ready:'[data-editor-ready=true]',upload:'upload',run:'process',picture:'editor-comparison-image',toggle:'editor-preview-toggle',download:'download',format:'format',next:'jpeg'},
  {route:'/zh/compress-image-to-size/',ready:'[data-editor-ready=true]',upload:'upload',run:'process',picture:'editor-comparison-image',toggle:'editor-preview-toggle',download:'download',format:'format',next:'png'},
  {route:'/convert-image/',ready:'[data-converter-ready=true]',upload:'convert-upload',run:'convert-process',picture:'convert-comparison-image',toggle:'convert-preview-toggle',download:'convert-download',format:'convert-format',next:'png'}
]){
  test('one-click original/result comparison preserves downloads '+params.route,async({page})=>{
    await page.goto(params.route);
    await expect(page.locator(params.ready)).toBeVisible();
    await page.getByTestId(params.upload).setInputFiles(await screenshot(page));
    // A comparison toggle must not distract people before a result exists.
    await expect(page.getByTestId(params.toggle)).toHaveCount(0);
    await page.getByTestId(params.run).click();
    const toggle=page.getByTestId(params.toggle),picture=page.getByTestId(params.picture);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed','false');
    const resultImage=await picture.getAttribute('src');
    expect(resultImage).toMatch(/^blob:/);
    const download=page.getByTestId(params.download);
    await expect(download).toHaveAttribute('href',resultImage);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed','true');
    await expect(picture).toHaveAttribute('alt',/Original image|原始图片/);
    const originalImage=await picture.getAttribute('src');
    expect(originalImage).toMatch(/^blob:/);
    expect(originalImage).not.toBe(resultImage);
    const originalDimensions=await picture.evaluate(async image=>{
      const blob=await(await fetch(image.src)).blob();
      const bitmap=await createImageBitmap(blob);
      const dimensions=[bitmap.width,bitmap.height];
      bitmap.close();
      return dimensions;
    });
    expect(originalDimensions).toEqual([96,64]);
    await expect(download).toHaveAttribute('href',resultImage);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed','false');
    await expect(picture).toHaveAttribute('src',resultImage);
    await page.getByTestId(params.format).selectOption(params.next);
    await expect(toggle).toHaveCount(0);
    await expect(download).toHaveCount(0);
  });
}
