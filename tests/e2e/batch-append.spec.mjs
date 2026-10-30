import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

async function pngSample(page){
  return Buffer.from(await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#285ba5';ctx.fillRect(0,0,96,64);
    const blob=await new Promise(ok=>canvas.toBlob(ok,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
}
const image=(name,png)=>({name,mimeType:'image/png',buffer:png});
async function names(page,testId){
  const data=await page.evaluate(async name=>[...new Uint8Array(await(await fetch(document.querySelector('[data-testid='+name+']').href)).arrayBuffer())],testId);
  return Object.keys((await JSZip.loadAsync(Buffer.from(data))).files);
}

test('bulk resize appends new files and rejects oversized combined selection without erasing ZIP',async({page})=>{
  await page.goto('/zh/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const png=await pngSample(page);
  await page.getByTestId('upload').setInputFiles(image('one.png',png));
  await expect(page.getByTestId('upload')).toHaveAttribute('aria-label','继续添加图片');
  await page.getByTestId('upload').setInputFiles(image('two.png',png));
  await expect(page.locator('.file-summary')).toContainText('2 个文件');
  await expect(page.locator('.file-summary')).toContainText('one.png');
  await expect(page.locator('.file-summary')).toContainText('two.png');
  await page.getByTestId('process').click();
  const download=page.getByTestId('download');
  await expect(download).toHaveAttribute('download','plainmile-images.zip');
  expect(await names(page,'download')).toEqual(['01-one-edited.png','02-two-edited.png']);
  const old=await download.getAttribute('href');
  await page.getByTestId('upload').setInputFiles(Array.from({length:29},(_,i)=>image('extra-'+i+'.png',png)));
  await expect(page.getByTestId('status')).toContainText('每批最多选择 30 张图片');
  await expect(page.locator('.file-summary')).toContainText('2 个文件');
  await expect(download).toHaveAttribute('href',old);
});

test('converter appends a second picker selection and exports both files',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const png=await pngSample(page);
  await page.getByTestId('convert-upload').setInputFiles(image('first.png',png));
  await expect(page.locator('.upload strong')).toHaveText('Add more images');
  await page.getByTestId('convert-upload').setInputFiles(image('second.png',png));
  await expect(page.locator('.file-summary')).toContainText('Files selected: 2');
  await expect(page.locator('.file-summary')).toContainText('first.png');
  await expect(page.locator('.file-summary')).toContainText('second.png');
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-download')).toHaveAttribute('download','plainmile-converted-images.zip');
  expect(await names(page,'convert-download')).toEqual(['01-first-converted.jpg','02-second-converted.jpg']);
});
