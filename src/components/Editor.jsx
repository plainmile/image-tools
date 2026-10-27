import React,{useEffect,useState} from 'react';
import JSZip from 'jszip';
import { MAX_FILES,inspectImage,processImage,makePassportSheet,aspectDimension,exportFilename,formatBytes } from '../lib/image-core.mjs';

const dict={
en:{upload:'Choose images',hint:'Images stay in your browser. JPEG, PNG, WebP · 40 MB per file · up to 30 files.',width:'Width (px)',height:'Height (px)',keep:'Keep aspect ratio',mode:'Fitting',contain:'Fit with white space',cover:'Fill and crop',format:'Output format',target:'Maximum file size (KB; 0 = no limit)',quality:'Quality',downscale:'Allow smaller dimensions to meet KB target',run:'Process images',working:'Processing…',download:'Download',done:'Output ready',error:'Could not process image',files:'Selected files',reset:'Clear',zoom:'Crop zoom',x:'Horizontal position',y:'Vertical position',sheet:'Create 4×6 print sheet',notice:'Photo print creates six 2×2 inch tiles at 300 pixels per inch. It does not verify official photo compliance; check rules before applying.',choose:'Select an image to begin',pending:'Ready to process.',local:'No uploads, accounts, or AI.',batch:'Multiple files are saved together as a ZIP.',size:'Original image'},
zh:{upload:'选择图片',hint:'图片只在浏览器中处理。支持 JPEG、PNG、WebP；单张最多 40 MB，最多 30 张。',width:'宽度（像素）',height:'高度（像素）',keep:'保持宽高比例',mode:'适配方式',contain:'完整保留，添加留白',cover:'填满并裁剪',format:'输出格式',target:'最大文件大小（KB；0 表示不限）',quality:'图像质量',downscale:'允许缩小像素以满足 KB 限制',run:'处理图片',working:'正在处理…',download:'下载',done:'输出已就绪',error:'图片处理失败',files:'选中的文件',reset:'清空',zoom:'裁剪缩放',x:'水平位置',y:'垂直位置',sheet:'制作 4×6 英寸打印排版',notice:'打印排版会生成六张 2×2 英寸照片（300 像素/英寸）。它不会验证官方证件照要求，请先核对申请规则。',choose:'先选择图片',pending:'可以开始处理。',local:'无需上传、账号或 AI。',batch:'多张输出会打包为 ZIP。',size:'原始图片'}
};
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export default function Editor({lang='en',tool='resize'}) {
  const t=dict[lang],sheet=tool==='passport-photo-print',batch=tool==='bulk-image-resizer';
  const [files,setFiles]=useState([]),[width,setWidth]=useState(sheet?600:800),[height,setHeight]=useState(sheet?600:800);
  const [keep,setKeep]=useState(false),[mode,setMode]=useState(sheet?'cover':'contain');
  const [format,setFormat]=useState('jpeg'),[target,setTarget]=useState(tool==='compress-image-to-size'||tool==='signature-resizer'?100:0);
  const [quality,setQuality]=useState(90),[downscale,setDownscale]=useState(tool==='compress-image-to-size');
  const [zoom,setZoom]=useState(100),[cropX,setCropX]=useState(0),[cropY,setCropY]=useState(0);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[output,setOutput]=useState(null);
  useEffect(()=>()=>{if(output?.url)URL.revokeObjectURL(output.url);},[output]);
  async function pick(e){
    const chosen=Array.from(e.target.files||[]);
    setOutput(null);
    if(chosen.length>MAX_FILES || (!batch&&!sheet&&chosen.length>MAX_FILES)){setStatus('Maximum 30 files.');return;}
    try {
      if(!chosen.length){setFiles([]);setStatus('');return;}
      const meta=await Promise.all(chosen.map(inspectImage));
      setFiles(chosen.map((file,i)=>({file,...meta[i]})));
      if(!sheet&&chosen.length===1){setWidth(meta[0].width);setHeight(meta[0].height);}
      setStatus(t.pending);
    }catch(err){setFiles([]);setStatus(err.message);}
  }
  function changeWidth(v){setWidth(v);if(keep&&files[0])setHeight(aspectDimension(files[0].width,files[0].height,v,'width'));}
  function changeHeight(v){setHeight(v);if(keep&&files[0])setWidth(aspectDimension(files[0].width,files[0].height,v,'height'));}
  async function run(e){
    e.preventDefault();if(!files.length||busy)return;
    setBusy(true);setOutput(null);setStatus(t.working);
    try{
      const options={width:Number(width),height:Number(height),mode,format,targetKb:Number(target),
        quality:Number(quality)/100,allowDownscale:downscale,zoom:Number(zoom)/100,cropX:Number(cropX)/100,cropY:Number(cropY)/100};
      const results=[];
      for(const item of files){
        const result=sheet?await makePassportSheet(item.file,options):await processImage(item.file,options);
        results.push({name:exportFilename(item.file.name,result.format,sheet?'print-sheet':'edited'),...result});
      }
      let blob,name;
      if(results.length===1){blob=results[0].blob;name=results[0].name;}
      else{
        const zip=new JSZip();results.forEach((r,i)=>zip.file(String(i+1).padStart(2,'0')+'-'+r.name,r.blob));
        blob=await zip.generateAsync({type:'blob'});name='plainmile-images.zip';
      }
      const url=URL.createObjectURL(blob);
      setOutput({url,blob,name,results});setStatus(t.done);
    }catch(err){setStatus(err.message||t.error);}
    finally{setBusy(false);}
  }
  return <section className="editor" aria-label="Image editor">
    <div className="editor-note">{t.local}</div>
    <form onSubmit={run}>
      <label className="upload"><strong>{t.upload}</strong><span>{t.hint}</span><input aria-label={t.upload} data-testid="upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple={!sheet} onChange={pick}/></label>
      {!!files.length&&<div className="file-summary"><strong>{t.files} ({files.length})</strong><ul>{files.slice(0,8).map((f,i)=><li key={i}>{f.file.name} · {f.width}×{f.height} · {formatBytes(f.file.size)}</li>)}</ul>{files.length>8&&<span>+{files.length-8}</span>}</div>}
      {!sheet&&<div className="field-grid">
        <label>{t.width}<input data-testid="width" type="number" min="1" max="10000" value={width} onChange={e=>changeWidth(e.target.value)}/></label>
        <label>{t.height}<input data-testid="height" type="number" min="1" max="10000" value={height} onChange={e=>changeHeight(e.target.value)}/></label>
        <label className="check"><input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)}/>{t.keep}</label>
        <label>{t.mode}<select value={mode} onChange={e=>setMode(e.target.value)}><option value="contain">{t.contain}</option><option value="cover">{t.cover}</option></select></label>
        <label>{t.format}<select data-testid="format" value={format} onChange={e=>setFormat(e.target.value)}><option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label>
        <label>{t.target}<input data-testid="target" type="number" min="0" max="20000" step="1" value={target} onChange={e=>setTarget(e.target.value)}/></label>
        <label>{t.quality}: {quality}%<input type="range" min="5" max="95" value={quality} onChange={e=>setQuality(e.target.value)}/></label>
        <label className="check"><input type="checkbox" checked={downscale} onChange={e=>setDownscale(e.target.checked)}/>{t.downscale}</label>
      </div>}
      {(sheet||mode==='cover')&&<div className="field-grid">
        <label>{t.zoom}: {zoom}%<input type="range" min="100" max="300" value={zoom} onChange={e=>setZoom(e.target.value)}/></label>
        <label>{t.x}: {cropX}<input type="range" min="-100" max="100" value={cropX} onChange={e=>setCropX(e.target.value)}/></label>
        <label>{t.y}: {cropY}<input type="range" min="-100" max="100" value={cropY} onChange={e=>setCropY(e.target.value)}/></label>
      </div>}
      {sheet&&<p className="notice">{t.notice}</p>}
      <div className="actions"><button data-testid="process" disabled={!files.length||busy} type="submit">{busy?t.working:sheet?t.sheet:t.run}</button>
      <button type="button" className="secondary" onClick={()=>{setFiles([]);setOutput(null);setStatus('');const el=document.querySelector('[data-testid=upload]');if(el)el.value='';}}>{t.reset}</button></div>
    </form>
    <p role="status" data-testid="status">{status||t.choose}</p>
    {output&&<div className="result"><div><strong>{t.done}</strong><p data-testid="result-meta">{output.results.map(r=>r.width+'×'+r.height+' · '+formatBytes(r.bytes)).join(' | ')}</p></div><a data-testid="download" className="download" href={output.url} download={output.name}>{t.download} · {formatBytes(output.blob.size)}</a>{output.results.length===1&&<img alt="Generated result preview" src={output.url}/>}</div>}
    {batch&&<p className="notice">{t.batch}</p>}
  </section>;
}
