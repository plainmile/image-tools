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


const METADATA_COLLISION_PNGS=[
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgFUkBAACfAH6yIjP3AAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNIEWEFAAFdAH5CFQ0QAAAAAElFTkSuQmCC'
];
async function chooseWithFixedMetadata(page,inputId,base64){
  await page.evaluate(({inputId,base64})=>{
    const bytes=Uint8Array.from(atob(base64),letter=>letter.charCodeAt(0));
    const file=new File([bytes],'same-name.png',{type:'image/png',lastModified:1700000000000});
    const transfer=new DataTransfer();
    transfer.items.add(file);
    const input=document.querySelector('[data-testid="'+inputId+'"]');
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },{inputId,base64});
}
for(const tool of [
  {route:'/bulk-image-resizer/',upload:'upload',ready:'editor-ready',process:'process',download:'download',suffix:'edited.png',status:'status'},
  {route:'/convert-image/',upload:'convert-upload',ready:'converter-ready',process:'convert-process',download:'convert-download',suffix:'converted.jpg',status:'convert-status'}
]){
  test(tool.route+' never drops distinct same-name/size/time images',async({page})=>{
    await page.goto(tool.route);
    await expect(page.locator('[data-'+tool.ready+'="true"]')).toBeVisible();
    // Both valid PNGs are exactly 69 bytes, have the same filename, MIME and
    // modification time, but contain different RGB pixels.
    await chooseWithFixedMetadata(page,tool.upload,METADATA_COLLISION_PNGS[0]);
    await expect(page.locator('.file-summary strong')).toContainText('1');
    await chooseWithFixedMetadata(page,tool.upload,METADATA_COLLISION_PNGS[1]);
    await expect(page.locator('.file-summary strong')).toContainText('2');
    await page.getByTestId(tool.process).click();
    const download=page.getByTestId(tool.download);
    await expect(download).toHaveAttribute('download',/\.zip$/);
    const originalHref=await download.getAttribute('href');
    const data=await page.evaluate(async id=>
      [...new Uint8Array(await(await fetch(document.querySelector('[data-testid="'+id+'"]').href)).arrayBuffer())],
    tool.download);
    const zip=await JSZip.loadAsync(Buffer.from(data));
    const entries=Object.keys(zip.files);
    expect(entries).toEqual([
      '01-same-name-'+tool.suffix,
      '02-same-name-'+tool.suffix
    ]);
    const first=await zip.file(entries[0]).async('nodebuffer');
    const second=await zip.file(entries[1]).async('nodebuffer');
    expect(first.equals(second)).toBe(false);

    // A *genuine* byte-for-byte duplicate is still skipped, preserving the
    // selected batch and the previously completed download.
    await chooseWithFixedMetadata(page,tool.upload,METADATA_COLLISION_PNGS[1]);
    await expect(page.locator('.file-summary strong')).toContainText('2');
    await expect(page.getByTestId(tool.status)).toContainText('already selected');
    await expect(download).toHaveAttribute('href',originalHref);
  });
}
