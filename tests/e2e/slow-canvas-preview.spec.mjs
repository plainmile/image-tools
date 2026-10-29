import { test, expect } from '@playwright/test';

// Verify the *visible* pixels, not just selected-file labels or URL strings.
async function solidPng(page, color) {
  const bytes=await page.evaluate(async(fill)=>{
    const canvas=document.createElement('canvas');
    canvas.width=44;canvas.height=30;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle=fill;ctx.fillRect(0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  },color);
  return Buffer.from(bytes);
}

async function delayNextPreviewDecode(page, canvasSelector) {
  await page.evaluate((selector)=>{
    window.__oldPreviewCanvas=document.querySelector(selector);
    const NativeImage=window.Image;
    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    let assignments=0;
    // Validation uses the first new Image(); the subsequent preview Image
    // deliberately remains unpainted until our test releases decoding.
    window.Image=function(...args){
      const img=new NativeImage(...args);
      Object.defineProperty(img,'src',{
        configurable:true,
        get(){return descriptor.get.call(img);},
        set(url){
          assignments+=1;
          if(assignments===2){
            window.__releaseDelayedPreview=()=>descriptor.set.call(img,url);
          }else{
            descriptor.set.call(img,url);
          }
        }
      });
      return img;
    };
  },canvasSelector);
}

const pages=[
  {label:'resize',url:'/zh/resize-image/',ready:'[data-editor-ready=true]',upload:'upload',file:'file-summary',
    canvas:'[data-testid=editor-preview-canvas]',loading:'editor-preview-status',title:'正在生成图片预览'},
  {label:'rotate',url:'/zh/rotate-image/',ready:'[data-transform-ready=true]',upload:'transform-upload',file:'transform-source',
    canvas:'[data-testid=rotate-preview]',loading:'rotate-preview-status',title:'正在生成图片预览'}
];

for(const config of pages){
  test(`${config.label}: switching source under slow decoding never displays old bitmap`,async({page})=>{
    await page.goto(config.url);
    await expect(page.locator(config.ready)).toBeVisible();
    const red=await solidPng(page,'#dd2a43');
    const blue=await solidPng(page,'#1475d5');
    await page.getByTestId(config.upload).setInputFiles({
      name:'old-red.png',mimeType:'image/png',buffer:red
    });
    await expect(page.getByTestId(config.file)).toContainText('old-red.png');
    await expect(page.getByTestId(config.loading)).toHaveCount(0);
    const oldColor=await page.locator(config.canvas).evaluate(canvas=>
      Array.from(canvas.getContext('2d').getImageData(5,5,1,1).data)
    );
    expect(oldColor[0]).toBeGreaterThan(170);
    expect(oldColor[3]).toBe(255);

    await delayNextPreviewDecode(page,config.canvas);
    await page.getByTestId(config.upload).setInputFiles({
      name:'new-blue.png',mimeType:'image/png',buffer:blue
    });
    await expect(page.getByTestId(config.file)).toContainText('new-blue.png');
    await page.waitForFunction(()=>typeof window.__releaseDelayedPreview==='function');
    await expect(page.getByTestId(config.loading)).toContainText(config.title);
    await expect(page.locator(config.canvas)).toHaveAttribute('aria-busy','true');
    const pending=await page.evaluate(selector=>{
      const canvas=document.querySelector(selector);
      return {
        freshCanvas:canvas!==window.__oldPreviewCanvas,
        pixel:Array.from(canvas.getContext('2d').getImageData(5,5,1,1).data)
      };
    },config.canvas);
    expect(pending.freshCanvas).toBe(true);
    expect(pending.pixel[3]).toBe(0);

    await page.evaluate(()=>window.__releaseDelayedPreview());
    await expect(page.getByTestId(config.loading)).toHaveCount(0);
    await expect(page.locator(config.canvas)).toHaveAttribute('aria-busy','false');
    const newColor=await page.locator(config.canvas).evaluate(canvas=>
      Array.from(canvas.getContext('2d').getImageData(5,5,1,1).data)
    );
    expect(newColor[0]).toBeLessThan(70);
    expect(newColor[2]).toBeGreaterThan(150);
    expect(newColor[3]).toBe(255);
  });
}
