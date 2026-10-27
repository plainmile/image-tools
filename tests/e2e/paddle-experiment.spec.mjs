import {test,expect} from '@playwright/test';
test('experimental Paddle scene text engine distinguishes actual words from patterned background',async({page},info)=>{
  test.skip(info.project.name!=='chromium','One browser is sufficient for initial engine feasibility');
  test.setTimeout(300000);
  const offsite=[];
  const browserErrors=[];
  page.on('pageerror',e=>browserErrors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error')browserErrors.push('console: '+m.text());});
  page.on('requestfailed',r=>browserErrors.push('requestfailed '+r.url()+' '+r.failure()?.errorText));
  page.on('response',r=>{if(r.status()>=400)browserErrors.push('HTTP '+r.status()+' '+r.url());});
  page.on('request',r=>{
    if(r.url().startsWith('http')&&
       new URL(r.url()).origin!==new URL(page.url()).origin)offsite.push(r.url());
  });
  await page.goto('/labs/paddle-ocr/');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex,follow');
  const bytes=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=1120;c.height=660;
    const x=c.getContext('2d');
    x.fillStyle='#7a9aaf';x.fillRect(0,0,c.width,c.height);
    // Scene-like texture with repeating vertical fins; not text.
    x.fillStyle='#596e78';x.fillRect(40,110,1030,400);
    for(let j=0;j<44;j++){
      x.fillStyle=j%2?'#b2b8bb':'#89969b';
      x.fillRect(50+j*23,115,11,385);
    }
    // Lettering intentionally placed away from familiar edge presets.
    x.fillStyle='#fff';x.fillRect(480,285,530,115);
    x.fillStyle='#151515';x.font='bold 64px Arial';
    x.fillText('ORDER 4861',525,365);
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByTestId('paddle-file').setInputFiles({name:'patterned-photo.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
  await page.getByTestId('paddle-run').click();
  await expect.poll(()=>page.evaluate(()=>window.__paddleTestState),
    {timeout:240000,intervals:[500,1000,1500]})
    .toMatch(/^(complete|failed)$/);
  const state=await page.evaluate(()=>window.__paddleTestState);
  if(state==='failed'){
    const detail=await page.getByTestId('paddle-output').innerText();
    throw new Error('PaddleOCR browser initialization/inference failed: '+detail+
      '\\nBrowser errors: '+JSON.stringify(browserErrors));
  }
  const result=await page.evaluate(()=>window.__paddleTestResult);
  expect(result.items?.length).toBeGreaterThan(0);
  const texts=result.items.map(i=>i.text).join(' ');
  expect(texts).toMatch(/ORDER|4861/i);
  expect(result.items.length).toBeLessThan(18);
  expect(offsite).toEqual([]);
});
