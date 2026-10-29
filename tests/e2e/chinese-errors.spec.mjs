import {test,expect} from '@playwright/test';

async function sourcePng(page) {
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=32;canvas.height=20;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#14a3b8';ctx.fillRect(0,0,32,20);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

test('Chinese image tools explain unsupported GIF and empty files in Chinese',async({page})=>{
  const pages=[
    {url:'/zh/convert-image/',input:'convert-upload',message:'convert-failed-input'},
    {url:'/zh/resize-image/',input:'upload',message:'status'},
    {url:'/zh/crop-image/',input:'transform-upload',message:'transform-status'},
    {url:'/zh/rotate-image/',input:'transform-upload',message:'transform-status'},
    {url:'/zh/redact-image/',input:'redact-upload',message:'redact-status'}
  ];
  for(const item of pages){
    await page.goto(item.url);
    const upload=page.getByTestId(item.input);
    await expect(upload).toBeEnabled();
    await upload.setInputFiles({name:'unsupported.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a','ascii')});
    await expect(page.getByTestId(item.message)).toContainText('仅支持 JPG');
    await expect(page.getByTestId(item.message)).not.toContainText('Supported images');
    await upload.setInputFiles({name:'blank.png',mimeType:'image/png',buffer:Buffer.alloc(0)});
    await expect(page.getByTestId(item.message)).toContainText('为空');
    await expect(page.getByTestId(item.message)).not.toContainText('file is empty');
  }
});

test('Chinese converter and rotate show actionable encoding errors instead of raw English',async({page})=>{
  for(const item of [
    {url:'/zh/convert-image/',input:'convert-upload',start:'convert-process',message:'convert-failed-output',download:'convert-download'},
    {url:'/zh/rotate-image/',input:'transform-upload',start:'transform-process',message:'transform-status',download:'transform-download'}
  ]){
    await page.goto(item.url);
    await expect(page.getByTestId(item.input)).toBeEnabled();
    const png=await sourcePng(page);
    await page.getByTestId(item.input).setInputFiles({name:'valid.png',mimeType:'image/png',buffer:png});
    if(item.url.includes('convert')){
      await expect(page.locator('.file-summary')).toContainText('valid.png');
    } else {
      await expect(page.getByTestId('transform-source')).toContainText('valid.png');
      await page.getByTestId('rotate-right').click();
    }
    await page.evaluate(()=>{
      HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};
    });
    await page.getByTestId(item.start).click();
    await expect(page.getByTestId(item.message)).toContainText('图片编码失败');
    await expect(page.getByTestId(item.message)).not.toContainText('Image encoding failed');
    await expect(page.getByTestId(item.download)).toHaveCount(0);
  }
});
