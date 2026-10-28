import React,{useEffect,useRef,useState} from 'react';
import JSZip from 'jszip';
import { MAX_FILES,MAX_BATCH_BYTES,MAX_AXIS,MAX_OUTPUT_PIXELS,assertDimensions,fitWithin,validateBatchPixels,inspectImage,processImage,makePassportSheet,aspectDimension,drawRect,inputImageFormat,exportFilename,formatBytes } from '../lib/image-core.mjs';

const dict = {
  en: {
    upload:'Choose image', hint:'JPG, PNG or WebP · up to 40 MB each',
    width:'Width (px)',height:'Height (px)',keep:'Sync width and height',
    mode:'Resize method',within:'Keep proportions (recommended)',contain:'Keep whole image, add space',cover:'Crop edges to fit',format:'Format',originalFormat:'Same as original',
    target:'Maximum size (KB; 0 = no limit)',quality:'Quality',
    advancedResize:'Need exact width and height? More options',activeResize:'Current method',modeWithinHelp:'Default: keep the original proportions without cropping or borders. Width and height are maximums, not exact output dimensions.',modeContainHelp:'Keep everything and use the exact width and height you entered. Empty space may appear around the picture.',modeCoverHelp:'Fill the exact width and height you entered without empty borders. Some edges of the picture may be cut off.',
    downscale:'Allow smaller dimensions if needed',exactSizeNotice:'Exact width and height will be preserved. If the KB limit cannot be met, processing stops instead of changing the dimensions.',
    run:'Convert',working:'Processing…',download:'Download file',
    done:'Ready to download',error:'Could not process image',
    files:'Files',settings:'Settings',preview:'Preview',original:'Original',
    reset:'Clear',zoom:'Crop zoom',x:'Horizontal position',y:'Vertical position',
    sheet:'Make print sheet',notice:'Six 2×2-inch photos on a 4×6-inch sheet. Check the issuing authority’s rules before using it for an application.',
    choose:'Choose a file to start.',pending:'File selected.',local:'Processed in this browser tab.',
    batch:'Resize up to 30 images. By default, images keep their proportions without white borders, and smaller images are not enlarged. Download the ZIP.',empty:'The selected image will appear here.',
    single:'Choose one image for this tool.',count:'Output files',
    loading:'Reading image…',limit:'Total selected files must be 160 MB or less.',
    drop:'You can also drop images here.',cropPreview:'Crop preview; the downloaded sheet has six copies.',
    estimate:'Planned dimensions (before optional KB downscaling)',noPadding:'No borders, no cropping, no upscaling',mayPad:'Exact size; may add padding',mayCrop:'Exact size; may crop edges',zipDownload:'Download ZIP',formatWarning:'JPEG cannot keep transparency; transparent PNG/WebP pixels become white.',pngSizeWarning:'PNG uses lossless encoding. For very small KB limits, choose a supported JPG/WebP format or enable smaller dimensions.',qualityNote:'Quality changes JPEG/WebP only.',batchPreview:'First input image preview; check individual files after ZIP export.',optionalSize:'File-size and quality (optional)',batchItems:'View each exported image',batchPlan:'Planned sizes (before optional KB downscaling)'
  },
  zh: {
    upload:'选择图片',hint:'支持 JPG、PNG、WebP，单张不超过 40 MB',
    width:'宽度（像素）',height:'高度（像素）',keep:'同步修改宽高',
    mode:'缩放方式',within:'按比例缩放（推荐）',contain:'保留整张图，空白补齐',cover:'裁剪边缘，填满尺寸',format:'输出格式',originalFormat:'保持原始格式',
    target:'最大大小（KB；0 表示不限）',quality:'画质',
    advancedResize:'需要固定宽高？展开其他方式',activeResize:'当前方式',modeWithinHelp:'默认按比例缩放：不裁剪、不加白边，宽高是上限，实际尺寸可能更小。',modeContainHelp:'完整保留图片，并补齐到填写的宽高。四周可能出现空白（PNG 可能是透明的）。',modeCoverHelp:'裁成填写的宽高，不会有白边，但图片边缘可能被裁掉。',
    downscale:'必要时允许减小像素',exactSizeNotice:'已选择固定宽高：即使设置了 KB 上限，也不会偷偷缩小图片。无法同时满足时会提示失败。',
    run:'开始处理',working:'正在处理…',download:'下载文件',
    done:'可以下载',error:'图片处理失败',
    files:'文件',settings:'参数设置',preview:'预览',original:'原图',
    reset:'清空',zoom:'裁剪缩放',x:'水平位置',y:'垂直位置',
    sheet:'生成打印排版',notice:'4×6 英寸纸面排放六张 2×2 英寸照片。用于证件申请前，请核对相关机构的照片要求。',
    choose:'请选择图片。',pending:'已选择图片。',local:'图片仅在当前浏览器标签页处理。',
    batch:'一次最多处理 30 张图片。默认保持每张图片比例、不留白，也不会放大小图。结果打包下载 ZIP。',empty:'选择图片后在这里查看预览。',
    single:'该工具一次只能处理一张图片。',count:'输出文件',
    loading:'正在读取图片…',limit:'所选文件总大小不能超过 160 MB。',
    drop:'也可以把图片拖到这里。',cropPreview:'裁剪预览；下载的打印排版包含六张照片。',
    estimate:'预计输出像素（不含可选的 KB 缩小）',noPadding:'按原图比例，无白边、不裁剪、不放大小图',mayPad:'固定尺寸，可能添加留白',mayCrop:'固定尺寸，可能裁掉边缘',zipDownload:'下载 ZIP 压缩包',formatWarning:'JPG 不支持透明背景。透明 PNG/WebP 转 JPG 时，透明区域会变为白色。',pngSizeWarning:'PNG 为无损编码，较小的 KB 限制可能无法达到；可按接收要求改用 JPG/WebP，或允许缩小尺寸。',qualityNote:'画质只影响 JPG/WebP。',batchPreview:'这里只预览第一张原图；ZIP 内每张图片请下载后检查。',optionalSize:'文件大小与画质（可选）',batchItems:'逐张查看输出结果',batchPlan:'预计各图片输出尺寸（不含可选的 KB 缩小）'
  }
};
export default function Editor({lang='en',tool='resize'}) {
  const t=dict[lang],sheet=tool==='passport-photo-print',batch=tool==='bulk-image-resizer';
  const [files,setFiles]=useState([]),[width,setWidth]=useState(sheet?600:800),[height,setHeight]=useState(sheet?600:800);
  const [keep,setKeep]=useState(false),[mode,setMode]=useState(sheet?'cover':'within');
  const [format,setFormat]=useState(tool==='compress-image-to-size'?'jpeg':'original'),[target,setTarget]=useState(tool==='compress-image-to-size'?100:0);
  const [quality,setQuality]=useState(90),[downscale,setDownscale]=useState(tool==='compress-image-to-size');
  const [zoom,setZoom]=useState(100),[cropX,setCropX]=useState(0),[cropY,setCropY]=useState(0);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[output,setOutput]=useState(null);
  const [preview,setPreview]=useState(null),[ready,setReady]=useState(false);
  const [inspecting,setInspecting]=useState(false);
  const canvasRef=useRef(null),selectionId=useRef(0);
  useEffect(()=>{setReady(true);return ()=>{selectionId.current+=1;};},[]);
  useEffect(()=>{setOutput(null);},[width,height,mode,format,target,quality,downscale,zoom,cropX,cropY]);
  useEffect(()=>{
    if (!preview || !canvasRef.current || output) return;
    let active=true;
    const image=new Image();
    image.onload=()=>{
      if(!active || !canvasRef.current)return;
      const canvas=canvasRef.current;
      let requestedW=sheet?600:Number(width),requestedH=sheet?600:Number(height);
      if(!Number.isFinite(requestedW)||!Number.isFinite(requestedH)||requestedW<=0||requestedH<=0)return;
      if(mode==='within'){
        try{
          const fitted=fitWithin(image.naturalWidth,image.naturalHeight,requestedW,requestedH);
          requestedW=fitted.width; requestedH=fitted.height;
        }catch{return;}
      }
      const scale=Math.min(1,440/requestedW,440/requestedH);
      const w=Math.max(1,Math.round(requestedW*scale)),h=Math.max(1,Math.round(requestedH*scale));
      canvas.width=w;canvas.height=h;
      const context=canvas.getContext('2d');
      if(!context)return;
      context.clearRect(0,0,w,h);
      if(format==='jpeg'||sheet||(format==='original'&&files[0]&&inputImageFormat(files[0].file)==='jpeg')){context.fillStyle='#fff';context.fillRect(0,0,w,h);}
      const region=drawRect(image.naturalWidth,image.naturalHeight,w,h,
        sheet?'cover':mode,Number(zoom)/100,Number(cropX)/100,Number(cropY)/100);
      context.imageSmoothingEnabled=true;
      context.imageSmoothingQuality='high';
      context.drawImage(image,region.sx,region.sy,region.sw,region.sh,region.dx,region.dy,region.dw,region.dh);
    };
    image.onerror=()=>{};
    image.src=preview;
    return ()=>{active=false;image.onload=null;image.onerror=null;};
  },[preview,output,width,height,mode,format,zoom,cropX,cropY,sheet,files]);
  useEffect(()=>()=>{if(output?.url)URL.revokeObjectURL(output.url);},[output]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  async function selectFiles(chosen){
    if(busy)return;
    const id=++selectionId.current;
    setFiles([]);setOutput(null);setPreview(null);setStatus('');
    if(chosen.length>MAX_FILES){setStatus(lang==='zh'?'最多选择 30 张图片。':'Maximum 30 files.');return;}
    if(!batch && chosen.length>1){setStatus(t.single);return;}
    if(chosen.reduce((sum,f)=>sum+f.size,0)>MAX_BATCH_BYTES){setStatus(t.limit);return;}
    if(!chosen.length)return;
    setInspecting(true);setStatus(t.loading);
    try{
      const meta=[];
      // Do not decode thirty large photos at once; browsers can run out of memory.
      for(const file of chosen)meta.push(await inspectImage(file));
      if(id!==selectionId.current)return;
      setFiles(chosen.map((file,i)=>({file,...meta[i]})));
      setPreview(URL.createObjectURL(chosen[0]));
      if(!sheet&&!batch&&chosen.length===1){
        const {width:w,height:h}=meta[0];
        const scale=Math.min(1,MAX_AXIS/w,MAX_AXIS/h,Math.sqrt(MAX_OUTPUT_PIXELS/(w*h)));
        setWidth(Math.max(1,Math.floor(w*scale)));
        setHeight(Math.max(1,Math.floor(h*scale)));
      }
      setStatus(t.pending);
    }catch(err){
      if(id===selectionId.current){setFiles([]);setPreview(null);setStatus(err.message||t.error);}
    }finally{if(id===selectionId.current)setInspecting(false);}
  }
  function pick(e){
    const chosen=Array.from(e.target.files||[]);
    // Allow selecting the same file again without needing to press Clear first.
    e.target.value='';
    void selectFiles(chosen);
  }
  function drop(e){
    e.preventDefault();
    if(!busy)void selectFiles(Array.from(e.dataTransfer?.files||[]));
  }
  function paste(e){
    const files=Array.from(e.clipboardData?.files||[]);
    if(files.length){e.preventDefault();void selectFiles(files);}
  }
  function changeWidth(v){
    setWidth(v);
    if(keep&&files[0]&&v!==''&&Number.isInteger(Number(v))&&Number(v)>0&&Number(v)<=MAX_AXIS)
      setHeight(aspectDimension(files[0].width,files[0].height,v,'width'));
  }
  function changeHeight(v){
    setHeight(v);
    if(keep&&files[0]&&v!==''&&Number.isInteger(Number(v))&&Number(v)>0&&Number(v)<=MAX_AXIS)
      setWidth(aspectDimension(files[0].width,files[0].height,v,'height'));
  }
  async function run(e){
    e.preventDefault();if(!files.length||busy||inspecting)return;
    setBusy(true);setOutput(null);setStatus(t.working);
    try{
      const options={width:Number(width),height:Number(height),mode,format,targetKb:Number(target),
        quality:Number(quality)/100,allowDownscale:mode==='within'&&downscale,zoom:Number(zoom)/100,cropX:Number(cropX)/100,cropY:Number(cropY)/100};
      if(batch)validateBatchPixels(files,options.width,options.height,mode);
      const results=[];
      for(const item of files){
        const result=sheet?await makePassportSheet(item.file,options):await processImage(item.file,options);
        results.push({name:exportFilename(item.file.name,result.format,sheet?'print-sheet':'edited'),...result});
      }
      let blob,name;
      if(!batch&&results.length===1){blob=results[0].blob;name=results[0].name;}
      else{
        const zip=new JSZip();results.forEach((r,i)=>zip.file(String(i+1).padStart(2,'0')+'-'+r.name,r.blob));
        blob=await zip.generateAsync({type:'blob'});name='plainmile-images.zip';
      }
      const url=URL.createObjectURL(blob);
      setOutput({url,blob,name,results});setStatus(t.done);
    }catch(err){setStatus(err.message||t.error);}
    finally{setBusy(false);}
  }
  const sourceFormats=files.map(item=>inputImageFormat(item.file));
  const anyNonJpeg=sourceFormats.some(type=>type!=='jpeg');
  const allSourcePng=sourceFormats.length>0&&sourceFormats.every(type=>type==='png');
  const losslessOutput=format==='png'||(format==='original'&&allSourcePng);
  let plannedDimensions=null;
  if(files.length&&!sheet&&!batch){
    try{
      if(mode==='within')plannedDimensions=fitWithin(files[0].width,files[0].height,Number(width),Number(height));
      else if(Number.isInteger(Number(width))&&Number(width)>0&&Number.isInteger(Number(height))&&Number(height)>0)
        plannedDimensions={width:Number(width),height:Number(height)};
    }catch{/* Invalid dimensions are reported on processing. */}
  }
  const batchPlanned=batch?files.map(item=>{
    try{
      const dimensions=mode==='within'?fitWithin(item.width,item.height,Number(width),Number(height))
        :assertDimensions(Number(width),Number(height));
      return {name:item.file.name,...dimensions};
    }catch{return null;}
  }):[];
  const sizeOptions=<>
    <label className="wide">{t.target}<input data-testid="target" type="number" min="0" max="20000" step="1" value={target} disabled={busy||inspecting} onChange={e=>setTarget(e.target.value)}/></label>
    <label>{t.quality}: {quality}%<input type="range" min="5" max="95" value={quality} disabled={losslessOutput||busy||inspecting} onChange={e=>setQuality(e.target.value)}/><small>{t.qualityNote}</small></label>
    {mode==='within'?<label className="check"><input type="checkbox" checked={downscale} disabled={busy||inspecting} onChange={e=>setDownscale(e.target.checked)}/>{t.downscale}</label>:<p className="resize-mode-help wide" data-testid="exact-size-note">{t.exactSizeNotice}</p>}
  </>;
  return <section className="editor" data-editor-ready={ready?'true':'false'} aria-label={t.settings} onPaste={paste}>
    <div className="editor-workspace">
      <form className="editor-controls" onSubmit={run}>
        <div className="control-section">
          <h2 className="panel-title">{t.files}</h2>
          <label className="upload" onDragOver={e=>e.preventDefault()} onDrop={drop}>
            <strong>{t.upload}</strong>
            <input aria-label={t.upload} data-testid="upload" type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              disabled={!ready||busy||inspecting} multiple={batch} onChange={pick}/>
            <span>{t.hint}{batch?' · '+MAX_FILES+' max':''}. {t.drop}</span>
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
            <label>{mode==='within'?(lang==='zh'?'最大宽度（像素）':'Max width (px)'):t.width}<input data-testid="width" type="number" min="1" max="10000" disabled={busy||inspecting} value={width} onChange={e=>changeWidth(e.target.value)}/></label>
            <label>{mode==='within'?(lang==='zh'?'最大高度（像素）':'Max height (px)'):t.height}<input data-testid="height" type="number" min="1" max="10000" disabled={busy||inspecting} value={height} onChange={e=>changeHeight(e.target.value)}/></label>
            <p className="resize-mode-help wide" data-testid="resize-mode-help">{mode==='within'?t.modeWithinHelp:mode==='cover'?t.modeCoverHelp:t.modeContainHelp}</p>
            <details className="resize-advanced wide" data-testid="advanced-resize">
              <summary data-testid="advanced-resize-summary">{mode==='within'?t.advancedResize:t.activeResize+': '+(mode==='cover'?t.cover:t.contain)}</summary>
              <div className="resize-advanced-inner">
                <label>{t.mode}<select data-testid="resize-mode" value={mode} disabled={busy||inspecting} onChange={e=>{setMode(e.target.value);if(e.target.value==='within')setKeep(false);}}>
                  <option value="within">{t.within}</option><option value="cover">{t.cover}</option><option value="contain">{t.contain}</option>
                </select></label>
                {!batch&&mode!=='within'&&<label className="check wide"><input type="checkbox" checked={keep} disabled={busy||inspecting} onChange={e=>{
                  setKeep(e.target.checked);
                  if(e.target.checked&&files[0]&&Number(width)>0&&Number(width)<=MAX_AXIS)
                    setHeight(aspectDimension(files[0].width,files[0].height,width,'width'));
                }}/>{t.keep}</label>}
              </div>
            </details>
            <label>{t.format}<select data-testid="format" value={format} disabled={busy||inspecting} onChange={e=>setFormat(e.target.value)}>
              <option value="original">{t.originalFormat}</option><option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option>
            </select></label>
            {plannedDimensions&&<p className="mode-explain wide" data-testid="expected-dimensions">
              {t.estimate}: <strong>{plannedDimensions.width}×{plannedDimensions.height} px</strong>
              <span>{mode==='within'?t.noPadding:mode==='contain'?t.mayPad:t.mayCrop}</span>
            </p>}
            {batch&&batchPlanned.length>0&&batchPlanned.every(Boolean)&&<details className="batch-plan wide" data-testid="batch-plan">
              <summary>{t.batchPlan} ({batchPlanned.length})</summary>
              <ul>{batchPlanned.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.width}×{item.height} px</span></li>)}</ul>
            </details>}
            {format==='jpeg'&&anyNonJpeg&&<p className="mode-explain wide" data-testid="alpha-warning">{t.formatWarning}</p>}
            {Number(target)>0&&losslessOutput&&<p className="mode-explain wide" data-testid="png-size-warning">{t.pngSizeWarning}</p>}
            {tool==='compress-image-to-size'||tool==='signature-resizer'?sizeOptions:
              <details className="output-advanced wide" data-testid="output-advanced">
                <summary>{t.optionalSize}</summary>
                <div className="output-advanced-grid">{sizeOptions}</div>
              </details>}
          </div>
        </div>}
        {(sheet||mode==='cover')&&<div className="control-section">
          <h2 className="panel-title">{lang==='zh'?'裁剪位置':'Crop position'}</h2>
          <div className="field-grid">
            <label>{t.zoom}: {zoom}%<input type="range" min="100" max="300" value={zoom} disabled={busy||inspecting} onChange={e=>setZoom(e.target.value)}/></label>
            <label>{t.x}: {cropX}<input type="range" min="-100" max="100" value={cropX} disabled={busy||inspecting} onChange={e=>setCropX(e.target.value)}/></label>
            <label>{t.y}: {cropY}<input type="range" min="-100" max="100" value={cropY} disabled={busy||inspecting} onChange={e=>setCropY(e.target.value)}/></label>
          </div>
        </div>}
        {sheet&&<p className="notice">{t.notice}</p>}
        {batch&&<p className="notice">{t.batch}</p>}
        <div className="form-actions">
          <button data-testid="process" disabled={!files.length||busy||inspecting} type="submit">{busy?t.working:sheet?t.sheet:t.run}</button>
          <button type="button" disabled={busy||inspecting} className="secondary" onClick={()=>{selectionId.current+=1;setFiles([]);setPreview(null);setOutput(null);setStatus('');const el=document.querySelector('[data-testid=upload]');if(el)el.value='';}}>{t.reset}</button>
        </div>
      </form>
      <aside className="editor-preview" aria-label={t.preview}>
        <h2 className="panel-title">{t.preview}</h2>
        <div className="preview-frame">
          {!batch&&output?.results.length===1 ? <img alt={lang==='zh'?'处理后的图片':'Processed image'} src={output.url}/> :
           preview ? <canvas ref={canvasRef} aria-label={sheet?t.cropPreview:t.preview}/> :
           <p className="preview-empty">{t.empty}</p>}
        </div>
        {batch&&!!files.length?<p className="preview-caption">{t.batchPreview}</p>:
         !!files.length&&!output&&<p className="preview-caption">{sheet?t.cropPreview:files[0].file.name+' · '+files[0].width+'×'+files[0].height}</p>}
        {output&&<div className="result">
          <strong>{t.done}</strong>
          <p data-testid="result-meta">{batch?
            output.results.length+' '+t.count+' · ZIP '+formatBytes(output.blob.size):
            output.results.map(r=>r.width+'×'+r.height+' · '+r.format.toUpperCase()+' · '+formatBytes(r.bytes)).join(' | ')}</p>
          {batch&&<details className="batch-export-details" data-testid="batch-export-details">
            <summary>{t.batchItems} ({output.results.length})</summary>
            <ul>{output.results.map((r,i)=><li key={i}><span>{r.name}</span><span>{r.width}×{r.height} · {r.format.toUpperCase()} · {formatBytes(r.bytes)}</span></li>)}</ul>
          </details>}
          <a data-testid="download" className="download" href={output.url} download={output.name}>{batch?t.zipDownload:t.download} · {formatBytes(output.blob.size)}</a>
        </div>}
      </aside>
    </div>
    <div className="editor-footer"><p role="status" data-testid="status">{status||t.choose}</p><span>{t.local}</span></div>
  </section>;
}
