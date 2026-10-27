import {scanCanvas, canvasBlob, extractOcrBoxes} from './redaction-core.mjs';

// Generic full-image OCR, with no reliance on text being at the top,
// bottom, in a red label, or in an industrial equipment photograph.
// Tesseract PSM 11 scans scattered text; PSM 3 handles document layout.
export function ocrPasses(mode='standard', hasRegion=false) {
  const passes=[
    {name:'original',psm:hasRegion?'6':'11',variant:'original'},
    {name:'contrast',psm:hasRegion?'11':'3',variant:'contrast'},
  ];
  if(mode==='detailed'){
    passes.push(
      {name:'light-on-dark',psm:'11',variant:'invert'},
      {name:'binarized',psm:'11',variant:'threshold'},
    );
  }
  return passes;
}
function percentile(histogram,total,fraction) {
  let sum=0;
  for(let n=0;n<256;n++){
    sum+=histogram[n];
    if(sum>=Math.max(1,total*fraction))return n;
  }
  return 255;
}
export function enhanceCanvas(canvas,variant) {
  if(variant==='original')return canvas;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('Cannot prepare OCR image.');
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  const rgba=image.data,total=canvas.width*canvas.height;
  const gray=new Uint8Array(total),histogram=new Uint32Array(256);
  for(let i=0;i<total;i++){
    const p=i*4;
    const g=Math.max(0,Math.min(255,Math.round(.299*rgba[p]+.587*rgba[p+1]+.114*rgba[p+2])));
    gray[i]=g;histogram[g]++;
  }
  const low=percentile(histogram,total,.02),high=percentile(histogram,total,.98);
  const spread=Math.max(40,high-low);
  let local=null;
  if(variant==='threshold'){
    // Integral image gives locally adaptive thresholding, which is more
    // robust to paper shadows and uneven lighting than a single global cut.
    const stride=canvas.width+1;
    local=new Uint32Array(stride*(canvas.height+1));
    for(let y=1;y<=canvas.height;y++){
      let sum=0;
      for(let x=1;x<=canvas.width;x++){
        sum+=gray[(y-1)*canvas.width+x-1];
        local[y*stride+x]=local[(y-1)*stride+x]+sum;
      }
    }
  }
  for(let y=0;y<canvas.height;y++){
    for(let x=0;x<canvas.width;x++){
      const i=y*canvas.width+x,p=i*4;
      let value=gray[i];
      if(variant==='threshold'){
        const radius=16,x0=Math.max(0,x-radius),y0=Math.max(0,y-radius);
        const x1=Math.min(canvas.width,x+radius+1),y1=Math.min(canvas.height,y+radius+1);
        const stride=canvas.width+1;
        const sum=local[y1*stride+x1]-local[y1*stride+x0]-
                  local[y0*stride+x1]+local[y0*stride+x0];
        const mean=sum/((x1-x0)*(y1-y0));
        value=value<mean-8?0:255;
      }else{
        value=Math.round(Math.max(0,Math.min(255,(value-low)*255/spread)));
        if(variant==='invert')value=255-value;
      }
      rgba[p]=rgba[p+1]=rgba[p+2]=value;
      rgba[p+3]=255;
    }
  }
  ctx.putImageData(image,0,0);
  return canvas;
}
export function mergeOcrCandidates(candidates) {
  const ordered=[...candidates].filter(c=>c&&Number.isFinite(c.x)&&
    Number.isFinite(c.y)&&Number.isFinite(c.w)&&Number.isFinite(c.h)&&
    c.w>=2&&c.h>=2&&/[\p{L}\p{N}]/u.test(c.text||''))
    .sort((a,b)=>(b.confidence||0)-(a.confidence||0));
  const result=[];
  for(const candidate of ordered){
    const area=candidate.w*candidate.h;
    const matches=result.some(existing=>{
      const x=Math.max(0,Math.min(candidate.x+candidate.w,existing.x+existing.w)-
        Math.max(candidate.x,existing.x));
      const y=Math.max(0,Math.min(candidate.y+candidate.h,existing.y+existing.h)-
        Math.max(candidate.y,existing.y));
      const intersection=x*y;
      const union=area+existing.w*existing.h-intersection;
      return union>0&&(intersection/union>.36 ||
        intersection/Math.min(area,existing.w*existing.h)>.72);
    });
    if(!matches)result.push(candidate);
  }
  return result.sort((a,b)=>a.y-b.y||a.x-b.x).slice(0,250);
}
export async function recognizeImageText(worker,bitmap,{region=null,mode='standard',cancelled=()=>false,onPass=()=>{}}={}) {
  const passes=ocrPasses(mode,Boolean(region)),candidates=[];
  for(let index=0;index<passes.length;index++){
    if(cancelled())break;
    const pass=passes[index];
    onPass(index+1,passes.length,pass.name);
    const canvas=enhanceCanvas(scanCanvas(bitmap,region),pass.variant);
    const width=canvas.width,height=canvas.height;
    let blob;
    try{blob=await canvasBlob(canvas,'image/png');}
    finally{canvas.width=0;canvas.height=0;}
    if(cancelled())break;
    await worker.setParameters({tessedit_pageseg_mode:pass.psm});
    const {data}=await worker.recognize(blob,{}, {blocks:true});
    if(cancelled())break;
    candidates.push(...extractOcrBoxes(data,bitmap.width,bitmap.height,width,height,region));
  }
  return mergeOcrCandidates(candidates);
}
