import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

async function makePng(page) {
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=60;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#2476bc';ctx.fillRect(0,0,100,60);
    ctx.fillStyle='#eb8e24';ctx.fillRect(0,0,20,20);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(bytes);
}
const bad={name:'broken.png',mimeType:'image/png',buffer:Buffer.from([1,2,3,4,5])};
async function pasteScreenshot(page,bytes,selector) {
  return await page.evaluate(({bytes,selector})=>{
    const file=new File([Uint8Array.from(bytes)],'pasted-screenshot.png',{type:'image/png'});
    // Firefox does not reliably expose clipboardData on synthetic ClipboardEvent.
    // Provide a clipboard-like payload to test the event handling logic consistently.
    const event=new Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'clipboardData',{value:{files:[file],items:[]}});
    (selector?document.querySelector(selector):document.body).dispatchEvent(event);
    return event.defaultPrevented;
  },{bytes:Array.from(bytes),selector});
}

test('crop: invalid new file does not discard the previous successful download',async({page})=>{
  await page.goto('/crop-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  const png=await makePng(page);
  await page.getByTestId('transform-upload').setInputFiles({name:'original.png',mimeType:'image/png',buffer:png});
  await expect(page.getByTestId('transform-source')).toContainText('original.png');
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const oldHref=await page.getByTestId('transform-download').getAttribute('href');
  await page.getByTestId('transform-upload').setInputFiles(bad);
  await expect(page.getByTestId('transform-status')).toContainText('previous image');
  await expect(page.getByTestId('transform-source')).toContainText('original.png');
  await expect(page.getByTestId('transform-download')).toHaveAttribute('href',oldHref);
  await page.locator('.transform-coordinates summary').click();
  const input=page.getByTestId('crop-width');
  await input.fill('');
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('transform-download')).toHaveAttribute('href',oldHref);
  await input.fill('12');
  await input.blur();
  await expect(input).toHaveValue('12');
  await expect(page.getByTestId('transform-download')).toHaveCount(0);
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const width=await page.evaluate(async()=>{
    const a=document.querySelector('[data-testid=transform-download]');
    const bitmap=await createImageBitmap(await (await fetch(a.href)).blob());
    const w=bitmap.width;bitmap.close();return w;
  });
  expect(width).toBe(12);
});

test('rotate: Ctrl+V screenshot works; invalid replacement preserves completed edit',async({page})=>{
  await page.goto('/zh/rotate-image/');
  await expect(page.locator('[data-transform-ready=true]')).toBeVisible();
  const png=await makePng(page);
  expect(await pasteScreenshot(page,png)).toBe(true);
  await expect(page.getByTestId('transform-source')).toContainText('pasted-screenshot.png');
  await page.getByTestId('rotate-right').click();
  await page.getByTestId('transform-process').click();
  await expect(page.getByTestId('transform-download')).toBeVisible();
  const old=await page.getByTestId('transform-download').getAttribute('href');
  await page.getByTestId('transform-upload').setInputFiles(bad);
  await expect(page.getByTestId('transform-status')).toContainText('已保留');
  await expect(page.getByTestId('transform-download')).toHaveAttribute('href',old);
});

test('format converter: invalid new file and empty selection preserve the previous output',async({page})=>{
  await page.goto('/convert-image/');
  await expect(page.locator('[data-converter-ready=true]')).toBeVisible();
  const png=await makePng(page);
  await page.getByTestId('convert-upload').setInputFiles({name:'first.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.file-summary')).toContainText('first.png');
  await page.getByTestId('convert-process').click();
  await expect(page.getByTestId('convert-download')).toBeVisible();
  const old=await page.getByTestId('convert-download').getAttribute('href');
  await page.getByTestId('convert-upload').setInputFiles(bad);
  await expect(page.getByTestId('convert-failed-input')).toContainText('broken.png');
  await expect(page.getByTestId('convert-status')).toContainText('Previous images and download are kept.');
  await expect(page.locator('.file-summary')).toContainText('first.png');
  await expect(page.getByTestId('convert-download')).toHaveAttribute('href',old);
  await page.getByTestId('convert-upload').setInputFiles([]);
  await expect(page.getByTestId('convert-download')).toHaveAttribute('href',old);
  await page.getByTestId('convert-format').selectOption('png');
  await expect(page.getByTestId('convert-download')).toHaveCount(0);
});

test('resize: invalid replacement keeps old output; pasting into width input is not treated as an image',async({page})=>{
  const posts=[];
  page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))posts.push(r.url());});
  await page.goto('/resize-image/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const png=await makePng(page);
  await page.getByTestId('upload').setInputFiles({name:'valid.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.file-summary')).toContainText('valid.png');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const old=await page.getByTestId('download').getAttribute('href');
  await page.getByTestId('upload').setInputFiles(bad);
  await expect(page.getByTestId('status')).toContainText('previous image and download');
  await expect(page.locator('.file-summary')).toContainText('valid.png');
  await expect(page.getByTestId('download')).toHaveAttribute('href',old);
  expect(await pasteScreenshot(page,png,'[data-testid=width]')).toBe(false);
  await expect(page.getByTestId('download')).toHaveAttribute('href',old);
  expect(await pasteScreenshot(page,png)).toBe(true);
  await expect(page.locator('.file-summary')).toContainText('pasted-screenshot.png');
  await expect(page.getByTestId('download')).toHaveCount(0);
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  expect(posts).toEqual([]);
});

test('bulk resize: invalid and oversized replacement keeps the existing ZIP bytes intact',async({page})=>{
  await page.goto('/bulk-image-resizer/');
  await expect(page.locator('[data-editor-ready=true]')).toBeVisible();
  const png=await makePng(page);
  await page.getByTestId('upload').setInputFiles([
    {name:'one.png',mimeType:'image/png',buffer:png},
    {name:'two.png',mimeType:'image/png',buffer:png}
  ]);
  await expect(page.locator('.file-summary')).toContainText('2 file(s)');
  await page.getByTestId('process').click();
  await expect(page.getByTestId('download')).toBeVisible();
  const old=await page.getByTestId('download').getAttribute('href');
  await page.getByTestId('upload').setInputFiles(
    Array.from({length:31},(_,i)=>({name:'too-many-'+i+'.png',mimeType:'image/png',buffer:png}))
  );
  await expect(page.getByTestId('status')).toContainText('Maximum 30 files.');
  await expect(page.getByTestId('download')).toHaveAttribute('href',old);
  await page.getByTestId('upload').setInputFiles(bad);
  await expect(page.getByTestId('skipped-inputs')).toContainText('broken.png');
  await expect(page.getByTestId('download')).toHaveAttribute('href',old);
  const raw=await page.evaluate(async()=>{
    const link=document.querySelector('[data-testid=download]');
    return [...new Uint8Array(await (await(await fetch(link.href)).blob()).arrayBuffer())];
  });
  const zip=await JSZip.loadAsync(Buffer.from(raw));
  expect(Object.keys(zip.files)).toEqual(['01-one-edited.png','02-two-edited.png']);
});
