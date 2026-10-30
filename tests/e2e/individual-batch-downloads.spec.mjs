import {test,expect} from '@playwright/test';
import JSZip from 'jszip';

async function sample(page) {
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=72;canvas.height=48;
    canvas.getContext('2d').fillRect(0,0,72,48);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return ['first.png','second.png'].map(name=>({name,mimeType:'image/png',buffer:Buffer.from(bytes)}));
}

for(const [route,ready,upload,run,details,link,zipLink] of [
  ['/bulk-image-resizer/','[data-editor-ready=true]','upload','process','batch-export-details','batch-download-item','download'],
  ['/zh/convert-image/','[data-converter-ready=true]','convert-upload','convert-process','convert-export-details','convert-download-item','convert-download']
]){
  test('individual downloads preserve ZIP '+route,async({page})=>{
    await page.goto(route);
    await expect(page.locator(ready)).toBeVisible();
    await page.getByTestId(upload).setInputFiles(await sample(page));
    await page.getByTestId(run).click();
    await expect(page.getByTestId(zipLink)).toHaveAttribute('download',/\.zip$/);
    await page.getByTestId(details).locator('summary').click();
    await expect(page.getByTestId(link)).toHaveCount(2);
    const files=await page.getByTestId(link).evaluateAll(async links=>{
      return await Promise.all(links.map(async a=>{
        const blob=await(await fetch(a.href)).blob();
        const bitmap=await createImageBitmap(blob);
        const result={name:a.download,width:bitmap.width,height:bitmap.height,bytes:blob.size};
        bitmap.close();return result;
      }));
    });
    expect(files.map(x=>x.name)).toEqual(route.includes('convert')?['first-converted.jpg','second-converted.jpg']:['first-edited.png','second-edited.png']);
    for(const f of files){expect(f.width).toBe(72);expect(f.height).toBe(48);expect(f.bytes).toBeGreaterThan(20);}
    const zipBytes=await page.getByTestId(zipLink).evaluate(async a=>[...new Uint8Array(await(await fetch(a.href)).arrayBuffer())]);
    expect(Object.keys((await JSZip.loadAsync(Buffer.from(zipBytes))).files)).toHaveLength(2);
  });
}
