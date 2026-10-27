import React,{useEffect,useState} from 'react';
import JSZip from 'jszip';
import { MAX_FILES,inspectImage,processImage,makePassportSheet,aspectDimension,exportFilename,formatBytes } from '../lib/image-core.mjs';

const dict = {
  en: {
    upload:'Choose image', hint:'JPG, PNG or WebP · up to 40 MB each',
    width:'Width (px)',height:'Height (px)',keep:'Keep aspect ratio',
    mode:'Fitting',contain:'Fit entire image',cover:'Fill and crop',format:'Format',
    target:'Maximum size (KB; 0 = no limit)',quality:'Quality',
    downscale:'Allow smaller dimensions if needed',
    run:'Convert',working:'Processing…',download:'Download file',
    done:'Ready to download',error:'Could not process image',
    files:'Files',settings:'Settings',preview:'Preview',original:'Original',
    reset:'Clear',zoom:'Crop zoom',x:'Horizontal position',y:'Vertical position',
    sheet:'Make print sheet',notice:'Six 2×2-inch photos on a 4×6-inch sheet. Check the issuing authority’s rules before using it for an application.',
    choose:'Choose a file to start.',pending:'File selected.',local:'Processed in this browser tab.',
    batch:'Multiple results are packaged in a ZIP.',empty:'The selected image will appear here.',
    single:'Choose one image for this tool.',count:'Output files'
  },
  zh: {
    upload:'选择图片',hint:'支持 JPG、PNG、WebP，单张不超过 40 MB',
    width:'宽度（像素）',height:'高度（像素）',keep:'保持宽高比例',
    mode:'适配方式',contain:'完整显示',cover:'填满并裁剪',format:'输出格式',
    target:'最大大小（KB；0 表示不限）',quality:'画质',
    downscale:'必要时允许减小像素',
    run:'开始处理',working:'正在处理…',download:'下载文件',
    done:'可以下载',error:'图片处理失败',
    files:'文件',settings:'参数设置',preview:'预览',original:'原图',
    reset:'清空',zoom:'裁剪缩放',x:'水平位置',y:'垂直位置',
    sheet:'生成打印排版',notice:'4×6 英寸纸面排放六张 2×2 英寸照片。用于证件申请前，请核对相关机构的照片要求。',
    choose:'请选择图片。',pending:'已选择图片。',local:'图片仅在当前浏览器标签页处理。',
    batch:'多个结果将打包为 ZIP 文件。',empty:'选择图片后在这里查看预览。',
    single:'该工具一次只能处理一张图片。',count:'输出文件'
  }
};
export default function Editor({lang='en',tool='resize'}) {
  const t=dict[lang],sheet=tool==='passport-photo-print',batch=tool==='bulk-image-resizer';
  const [files,setFiles]=useState([]),[width,setWidth]=useState(sheet?600:800),[height,setHeight]=useState(sheet?600:800);
  const [keep,setKeep]=useState(false),[mode,setMode]=useState(sheet?'cover':'contain');
  const [format,setFormat]=useState('jpeg'),[target,setTarget]=useState(tool==='compress-image-to-size'||tool==='signature-resizer'?100:0);
  const [quality,setQuality]=useState(90),[downscale,setDownscale]=useState(tool==='compress-image-to-size');
  const [zoom,setZoom]=useState(100),[cropX,setCropX]=useState(0),[cropY,setCropY]=useState(0);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[output,setOutput]=useState(null);
  const [preview,setPreview]=useState(null),[ready,setReady]=useState(false);
  useEffect(()=>{setReady(true);},[]);
  useEffect(()=>()=>{if(output?.url)URL.revokeObjectURL(output.url);},[output]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  async function pick(e){
    const chosen=Array.from(e.target.files||[]);
    setOutput(null);
    setPreview(null);
    if(chosen.length>MAX_FILES){setFiles([]);setStatus(lang==='zh'?'最多选择 30 张图片。':'Maximum 30 files.');return;}
    if(!batch && chosen.length>1){setFiles([]);setStatus(t.single);return;}
    try {
      if(!chosen.length){setFiles([]);setStatus('');return;}
      const meta=await Promise.all(chosen.map(inspectImage));
      setFiles(chosen.map((file,i)=>({file,...meta[i]})));
      setPreview(URL.createObjectURL(chosen[0]));
      if(!sheet&&chosen.length===1){setWidth(meta[0].width);setHeight(meta[0].height);}
      setStatus(t.pending);
    }catch(err){setFiles([]);setPreview(null);setStatus(err.message);}
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
  return <section className="editor" data-editor-ready={ready?'true':'false'} aria-label={t.settings}>
    <div className="editor-workspace">
      <form className="editor-controls" onSubmit={run}>
        <div className="control-section">
          <h2 className="panel-title">{t.files}</h2>
          <label className="upload">
            <strong>{t.upload}</strong>
            <input aria-label={t.upload} data-testid="upload" type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              multiple={batch} onChange={pick}/>
            <span>{t.hint}{batch?' · '+MAX_FILES+' max':''}</span>
          </label>
          {!!files.length&&<div className="file-summary">
            <strong>{files.length} {lang==='zh'?'个文件':'file(s)'}</strong>
            <ul>{files.slice(0,6).map((f,i)=><li key={i}>{f.file.name} · {f.width}×{f.height} · {formatBytes(f.file.size)}</li>)}</ul>
            {files.length>6&&<span>+{files.length-6}</span>}
          </div>}
        </div>
        {!sheet&&<div className="control-section">
          <h2 className="panel-title">{t.settings}</h2>
          <div className="field-grid">
            <label>{t.width}<input data-testid="width" type="number" min="1" max="10000" value={width} onChange={e=>changeWidth(e.target.value)}/></label>
            <label>{t.height}<input data-testid="height" type="number" min="1" max="10000" value={height} onChange={e=>changeHeight(e.target.value)}/></label>
            <label className="check wide"><input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)}/>{t.keep}</label>
            <label>{t.mode}<select value={mode} onChange={e=>setMode(e.target.value)}><option value="contain">{t.contain}</option><option value="cover">{t.cover}</option></select></label>
            <label>{t.format}<select data-testid="format" value={format} onChange={e=>setFormat(e.target.value)}><option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label>
            <label className="wide">{t.target}<input data-testid="target" type="number" min="0" max="20000" step="1" value={target} onChange={e=>setTarget(e.target.value)}/></label>
            <label>{t.quality}: {quality}%<input type="range" min="5" max="95" value={quality} onChange={e=>setQuality(e.target.value)}/></label>
            <label className="check"><input type="checkbox" checked={downscale} onChange={e=>setDownscale(e.target.checked)}/>{t.downscale}</label>
          </div>
        </div>}
        {(sheet||mode==='cover')&&<div className="control-section">
          <h2 className="panel-title">{lang==='zh'?'裁剪位置':'Crop position'}</h2>
          <div className="field-grid">
            <label>{t.zoom}: {zoom}%<input type="range" min="100" max="300" value={zoom} onChange={e=>setZoom(e.target.value)}/></label>
            <label>{t.x}: {cropX}<input type="range" min="-100" max="100" value={cropX} onChange={e=>setCropX(e.target.value)}/></label>
            <label>{t.y}: {cropY}<input type="range" min="-100" max="100" value={cropY} onChange={e=>setCropY(e.target.value)}/></label>
          </div>
        </div>}
        {sheet&&<p className="notice">{t.notice}</p>}
        {batch&&<p className="notice">{t.batch}</p>}
        <div className="form-actions">
          <button data-testid="process" disabled={!files.length||busy} type="submit">{busy?t.working:sheet?t.sheet:t.run}</button>
          <button type="button" className="secondary" onClick={()=>{setFiles([]);setPreview(null);setOutput(null);setStatus('');const el=document.querySelector('[data-testid=upload]');if(el)el.value='';}}>{t.reset}</button>
        </div>
      </form>
      <aside className="editor-preview" aria-label={t.preview}>
        <h2 className="panel-title">{t.preview}</h2>
        <div className="preview-frame">
          {output?.results.length===1 ? <img alt={lang==='zh'?'处理后的图片':'Processed image'} src={output.url}/> :
           preview ? <img alt={t.original} src={preview}/> :
           <p className="preview-empty">{t.empty}</p>}
        </div>
        {!!files.length&&!output&&<p className="preview-caption">{files[0].file.name} · {files[0].width}×{files[0].height}</p>}
        {output&&<div className="result">
          <strong>{t.done}</strong>
          <p data-testid="result-meta">{output.results.map(r=>r.width+'×'+r.height+' · '+formatBytes(r.bytes)).join(' | ')}</p>
          <a data-testid="download" className="download" href={output.url} download={output.name}>{t.download} · {formatBytes(output.blob.size)}</a>
        </div>}
      </aside>
    </div>
    <div className="editor-footer"><p role="status" data-testid="status">{status||t.choose}</p><span>{t.local}</span></div>
  </section>;
}
