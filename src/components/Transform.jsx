import {useEffect,useRef,useState} from 'react';
import {inspectImage,inputImageFormat,exportFilename,formatBytes} from '../lib/image-core.mjs';
import {clipboardImageFiles} from '../lib/clipboard.mjs';
import {
  cropPreset,validateCrop,moveCrop,resizeCrop,drawCrop,
  rotationDimensions,drawRotation,exportTransform
} from '../lib/transform-core.mjs';

const copy = {
  en:{
    choose:'Choose image', hint:'JPG, PNG, WebP · up to 40 MB',
    drop:'Drop one image here, or choose a file.',
    introCrop:'Choose the part to keep. Drag the frame, resize its corner, or draw a new frame.',
    introRotate:'Rotate or flip the picture. Preview updates before you save.',
    empty:'Choose one image to see a preview.',checking:'Checking image…',
    unsupported:'Please select one JPG, PNG or WebP image.',
    selected:'Ready to edit.',ratio:'Crop shape',free:'Free crop',
    square:'Square (1:1)',landscape:'Landscape (4:3)',wide:'Wide (16:9)',portrait:'Portrait (3:4)',
    cropHelp:'Drag inside the box to move it. Drag its bottom-right corner to resize. Drag outside to select a new area.',
    advanced:'Set exact crop coordinates (optional)',x:'Left (px)',y:'Top (px)',w:'Width (px)',h:'Height (px)',
    resetFrame:'Reset crop',left:'Rotate left 90°',right:'Rotate right 90°',
    flipH:'Flip horizontally',flipV:'Flip vertically',resetChanges:'Reset edits',
    output:'Output format',same:'Same as original',quality:'Quality',
    jpg:'JPEG replaces transparency with white. Select PNG or WebP to keep transparency.',
    saveCrop:'Crop image',saveRotate:'Apply changes',
    clear:'Clear',working:'Editing image…',finished:'Image ready. Use Download image below.',
    preview:'Preview',result:'Output',download:'Download image',
    refine:'Need another adjustment? Drag the crop frame above and crop again.',
    noAction:'Choose a rotation or flip first.',
    dimensions:'Output dimensions',local:'Images stay in this browser; nothing is uploaded.',
    metadata:'New exports do not retain EXIF or other original metadata.',
    pixelCap:'Output exceeds the browser canvas limit. Crop a smaller area, or resize the image first.',
    paste:'Or paste a screenshot (Ctrl+V / ⌘V).',kept:' Your previous image and download are still available.',
  },
  zh:{
    choose:'选择图片',hint:'支持 JPG、PNG、WebP · 单张最多 40 MB',
    drop:'拖入一张图片，或点击选择文件。',
    introCrop:'框选想保留的部分，拖动框选区域或拉动右下角来调整。',
    introRotate:'旋转或翻转图片，保存前可查看实际效果。',
    empty:'请选择图片查看预览。',checking:'正在检查图片…',
    unsupported:'请仅选择一张 JPG、PNG 或 WebP 图片。',
    selected:'图片已准备好。',ratio:'裁剪比例',free:'自由裁剪',
    square:'正方形 (1:1)',landscape:'横向 (4:3)',wide:'宽屏 (16:9)',portrait:'竖向 (3:4)',
    cropHelp:'拖动框内区域可移动；拖动右下角可缩放；在框外拖动可重新选择。也可展开精确坐标。',
    advanced:'精确裁剪坐标（可选）',x:'左侧位置（px）',y:'顶部位置（px）',w:'宽度（px）',h:'高度（px）',
    resetFrame:'重置裁剪框',left:'向左旋转 90°',right:'向右旋转 90°',
    flipH:'水平翻转',flipV:'垂直翻转',resetChanges:'重置操作',
    output:'输出格式',same:'保持原格式',quality:'画质',
    jpg:'JPG 不支持透明，透明区域会变为白色。需要透明请选择 PNG 或 WebP。',
    saveCrop:'裁剪图片',saveRotate:'应用修改',
    clear:'清空',working:'正在处理图片…',finished:'处理完成，请点击下方下载按钮。',
    preview:'预览',result:'处理结果',download:'下载图片',
    refine:'还想调整？直接拖动上方裁剪框，再点击“裁剪图片”即可。',
    noAction:'请先旋转或翻转图片。',
    dimensions:'输出像素',local:'图片只在当前浏览器本地处理，不会上传。',
    metadata:'重新导出的文件不保留原始 EXIF 等元数据。',
    pixelCap:'输出像素超过浏览器限制。请缩小裁剪范围，或先调整原图尺寸。',
    paste:'也可以粘贴截图（Ctrl+V / ⌘V）。',kept:' 已保留之前的图片和下载结果。',
  }
};

const ASPECTS=[['free','free'],['1','square'],[String(4/3),'landscape'],[String(16/9),'wide'],[String(3/4),'portrait']];

function errorMessage(error,lang) {
  const message=String(error?.message||error||'Unknown error');
  if (lang !== 'zh') return message;
  if (message.includes('Image contents do not match')) return '图片内容与 JPG、PNG 或 WebP 文件格式不一致，请选择原始图片。';
  if (message.includes('Animated PNG/WebP')) return '暂不支持动画 PNG/WebP，以免丢失动画帧。';
  if (message.includes('32-megapixel')) return '输出超过 3200 万像素限制，请缩小裁剪区域。';
  if (message.includes('40 MB')) return '单张文件不能超过 40 MB。';
  if (message.includes('80 megapixels')) return '原图超过 8000 万像素限制。';
  if (message.includes('decoded')) return '图片无法解码，可能已损坏或格式不受支持。';
  return message;
}

export default function Transform({lang='en',tool='crop'}) {
  const t=copy[lang],isCrop=tool==='crop';
  const [ready,setReady]=useState(false),[checking,setChecking]=useState(false),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(null),[source,setSource]=useState(null);
  const [status,setStatus]=useState(''),[result,setResult]=useState(null);
  const [aspect,setAspect]=useState('free'),[crop,setCrop]=useState(null);
  const [coordDraft,setCoordDraft]=useState({});
  const [degrees,setDegrees]=useState(0),[flipH,setFlipH]=useState(false),[flipV,setFlipV]=useState(false);
  const [format,setFormat]=useState('original'),[quality,setQuality]=useState(90);
  const request=useRef(0),stage=useRef(null),drag=useRef(null),previewCanvas=useRef(null);
  useEffect(()=>{setReady(true);return()=>{request.current+=1;};},[]);
  useEffect(()=>()=>{if(source)URL.revokeObjectURL(source);},[source]);
  useEffect(()=>()=>{if(result?.url)URL.revokeObjectURL(result.url);},[result]);
  useEffect(()=>{setResult(null);setStatus(prev=>prev===t.finished?t.selected:prev);},[crop,degrees,flipH,flipV,format,quality]);

  async function choose(items) {
    if(busy||checking||!items.length)return;
    if(items.length!==1){setStatus(t.unsupported+(selected?t.kept:''));return;}
    const key=++request.current;
    setChecking(true);setStatus(t.checking);
    try{
      const file=items[0];
      const dims=await inspectImage(file);
      if(key!==request.current)return;
      // Only replace the current image and its download after successful validation.
      setSelected({file,...dims});
      setCrop(isCrop?cropPreset(dims.width,dims.height,'free'):null);
      setSource(URL.createObjectURL(file));setResult(null);setCoordDraft({});
      setDegrees(0);setFlipH(false);setFlipV(false);setAspect('free');setFormat('original');
      setStatus(t.selected);
    }catch(err){
      if(key===request.current)setStatus(errorMessage(err,lang)+(selected?t.kept:''));
    }finally{if(key===request.current)setChecking(false);}
  }
  useEffect(()=>{
    const handle=(event)=>{
      if(busy||checking)return;
      const images=clipboardImageFiles(event);
      if(!images.length)return;
      event.preventDefault();
      void choose(images);
    };
    document.addEventListener('paste',handle);
    return()=>document.removeEventListener('paste',handle);
  },[busy,checking,selected,lang,isCrop]);
  function clear(){
    if(busy||checking)return;
    ++request.current;setSelected(null);setCrop(null);setCoordDraft({});setSource(null);setResult(null);
    setStatus('');setAspect('free');setDegrees(0);setFlipH(false);setFlipV(false);
    setFormat('original');setQuality(90);
  }
  function updateAspect(value){
    setAspect(value);setCoordDraft({});
    if(selected)setCrop(cropPreset(selected.width,selected.height,value));
    setResult(null);
  }
  function coordinate(key,value){
    setCoordDraft(previous=>({...previous,[key]:value}));
    if(!selected||!crop||value==='')return;
    const n=Number(value);if(!Number.isSafeInteger(n))return;
    const sw=selected.width,sh=selected.height;
    try{
      if(key==='x')setCrop(moveCrop(crop,n-crop.x,0,sw,sh));
      if(key==='y')setCrop(moveCrop(crop,0,n-crop.y,sw,sh));
      if(key==='width')setCrop(resizeCrop(crop,n,crop.height,sw,sh,aspect));
      if(key==='height')setCrop(aspect==='free'?resizeCrop(crop,crop.width,n,sw,sh):resizeCrop(crop,n*Number(aspect),n,sw,sh,aspect,'height'));
    }catch{/* Invalid intermediate typing cannot modify the current crop. */}
  }
  function pointerPoint(event){
    const bounds=stage.current.getBoundingClientRect();
    return {
      x:Math.max(0,Math.min(selected.width,Math.round((event.clientX-bounds.left)*selected.width/bounds.width))),
      y:Math.max(0,Math.min(selected.height,Math.round((event.clientY-bounds.top)*selected.height/bounds.height)))
    };
  }
  function pointerDown(event){
    if(!isCrop||!selected||!crop||busy||event.button!==0)return;
    event.preventDefault();
    const action=event.target.closest('[data-crop-action]')?.dataset.cropAction||'draw';
    drag.current={action,start:pointerPoint(event),base:{...crop}};
    setCoordDraft({});
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event){
    if(!drag.current||!selected)return;
    const {action,start,base}=drag.current,point=pointerPoint(event);
    const dx=point.x-start.x,dy=point.y-start.y;
    let next;
    if(action==='move')next=moveCrop(base,dx,dy,selected.width,selected.height);
    else if(action==='resize'){
      // With a locked ratio the longer relative gesture (horizontal or
      // vertical) drives the corner, so up/down dragging is never ignored.
      const axis=aspect!=='free'&&Math.abs(dy)/base.height>Math.abs(dx)/base.width?'height':'width';
      next=resizeCrop(base,base.width+dx,base.height+dy,selected.width,selected.height,aspect,axis);
    }
    else next=drawCrop(start,point,selected.width,selected.height,aspect);
    setCrop(next);
  }
  function pointerUp(event){
    drag.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function rotate(amount){
    setDegrees(d=>((d+amount)%360+360)%360);setResult(null);
  }
  const sourceFormat=selected?inputImageFormat(selected.file):null;
  const chosenFormat=format==='original'?sourceFormat:format;
  const hasAlpha=sourceFormat==='png'||sourceFormat==='webp';
  const isLossy=chosenFormat==='jpeg'||chosenFormat==='webp';
  const edited=isCrop?Boolean(crop):degrees!==0||flipH||flipV;
  let outputDims=null;
  try {
    if(selected&&isCrop&&crop)outputDims=validateCrop(crop,selected.width,selected.height);
    else if(selected&&!isCrop)outputDims=rotationDimensions(selected.width,selected.height,degrees);
  }catch{/* We validate again before exporting. */}

  useEffect(()=>{
    if(isCrop||!source||!selected||result||!previewCanvas.current)return;
    let valid=true;
    const img=new Image();
    img.onload=()=>{
      if(!valid||!previewCanvas.current)return;
      let dims;
      try { dims=rotationDimensions(img.naturalWidth,img.naturalHeight,degrees); }
      catch { return; }
      const scale=Math.min(1,480/dims.width,330/dims.height);
      const canvas=previewCanvas.current;
      canvas.width=Math.max(1,Math.round(dims.width*scale));
      canvas.height=Math.max(1,Math.round(dims.height*scale));
      const ctx=canvas.getContext('2d');
      if(!ctx)return;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      if(chosenFormat==='jpeg'){
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
      }
      ctx.scale(canvas.width/dims.width,canvas.height/dims.height);
      drawRotation(ctx,img,img.naturalWidth,img.naturalHeight,degrees,flipH,flipV);
    };
    img.src=source;
    return()=>{valid=false;img.onload=null;};
  },[source,selected,isCrop,result,degrees,flipH,flipV,chosenFormat]);

  async function exportFile(event){
    event.preventDefault();
    if(!selected||busy||checking||!edited)return;
    // Keep the last successful export downloadable until a new one succeeds.
    setBusy(true);setStatus(t.working);
    try{
      const output=await exportTransform(selected.file,{
        tool:isCrop?'crop':'rotate',crop,degrees,flipH,flipV,
        format,quality:Number(quality)/100
      });
      const suffix=isCrop?'cropped':'rotated';
      setResult({...output,url:URL.createObjectURL(output.blob),name:exportFilename(selected.file.name,output.format,suffix)});
      setStatus(t.finished);
    }catch(error){setStatus(errorMessage(error,lang)+(result?.url?t.kept:''));}
    finally{setBusy(false);}
  }
  const cropStyle=selected&&crop?{
    left:(100*crop.x/selected.width)+'%',
    top:(100*crop.y/selected.height)+'%',
    width:(100*crop.width/selected.width)+'%',
    height:(100*crop.height/selected.height)+'%'
  }:null;

  return <section className="editor" data-transform-ready={ready?'true':'false'}>
    <div className="editor-workspace">
      <form className="editor-controls" onSubmit={exportFile}>
        <div className="control-section">
          <h2 className="panel-title">{t.choose}</h2>
          <label className="upload" onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();void choose(Array.from(e.dataTransfer?.files||[]));}}>
            <strong>{t.drop}</strong>
            <input data-testid="transform-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              disabled={!ready||busy||checking}
              onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void choose(files);}}/>
            <span>{t.hint} · {t.paste}</span>
          </label>
          {selected&&<p className="file-summary" data-testid="transform-source">{selected.file.name} · {selected.width}×{selected.height} · {formatBytes(selected.file.size)}</p>}
        </div>
        {selected&&<div className="control-section">
          <h2 className="panel-title">{isCrop?t.ratio:(lang==='zh'?'旋转与翻转':'Rotate and flip')}</h2>
          {isCrop?<>
            <div className="field-grid"><label className="wide">{t.ratio}
              <select data-testid="crop-aspect" value={aspect} disabled={busy} onChange={e=>updateAspect(e.target.value)}>
                {ASPECTS.map(([value,label])=><option key={value} value={value}>{t[label]}</option>)}
              </select>
            </label></div>
            <p className="resize-mode-help">{t.cropHelp}</p>
            <details className="output-advanced transform-coordinates">
              <summary>{t.advanced}</summary>
              <div className="field-grid">
                {['x','y','width','height'].map((key)=><label key={key}>
                  {t[{x:'x',y:'y',width:'w',height:'h'}[key]]}
                  <input data-testid={'crop-'+key} type="number" min={key==='x'||key==='y'?0:1} step="1"
                    disabled={busy} value={coordDraft[key]??crop?.[key]??''} onChange={e=>coordinate(key,e.target.value)}
                    onBlur={()=>setCoordDraft(previous=>{const next={...previous};delete next[key];return next;})}/>
                </label>)}
              </div>
            </details>
            <button className="secondary transform-reset" type="button" disabled={busy} onClick={()=>{setCoordDraft({});setCrop(cropPreset(selected.width,selected.height,aspect));setResult(null);}}>{t.resetFrame}</button>
          </>:<>
            <div className="transform-buttons">
              <button className="secondary" type="button" data-testid="rotate-left" disabled={busy} onClick={()=>rotate(-90)}>{t.left}</button>
              <button className="secondary" type="button" data-testid="rotate-right" disabled={busy} onClick={()=>rotate(90)}>{t.right}</button>
              <button className="secondary" type="button" data-testid="flip-horizontal" aria-pressed={flipH} disabled={busy} onClick={()=>{setFlipH(v=>!v);setResult(null);}}>{t.flipH}</button>
              <button className="secondary" type="button" data-testid="flip-vertical" aria-pressed={flipV} disabled={busy} onClick={()=>{setFlipV(v=>!v);setResult(null);}}>{t.flipV}</button>
            </div>
            <button className="secondary transform-reset" type="button" disabled={busy} onClick={()=>{setDegrees(0);setFlipH(false);setFlipV(false);setResult(null);}}>{t.resetChanges}</button>
          </>}
        </div>}
        {selected&&<div className="control-section">
          <h2 className="panel-title">{t.output}</h2>
          <div className="field-grid">
            <label className="wide">{t.output}
              <select data-testid="transform-format" disabled={busy} value={format} onChange={e=>setFormat(e.target.value)}>
                <option value="original">{t.same}</option><option value="jpeg">JPG</option>
                <option value="png">PNG</option><option value="webp">WebP</option>
              </select>
            </label>
            {isLossy&&<label className="wide">{t.quality}: {quality}%
              <input type="range" min="5" max="95" disabled={busy} value={quality} onChange={e=>setQuality(e.target.value)}/>
            </label>}
          </div>
          {chosenFormat==='jpeg'&&hasAlpha&&<p className="notice" data-testid="transform-alpha-warning">{t.jpg}</p>}
          <p className="notice">{t.metadata}</p>
          {!outputDims&&<p className="notice" role="alert">{t.pixelCap} <a href={lang==='zh'?'/zh/resize-image/':'/resize-image/'}>{lang==='zh'?'修改图片尺寸':'Resize image'}</a></p>}
        </div>}
        <div className="form-actions">
          <button type="submit" data-testid="transform-process" disabled={!ready||checking||busy||!edited||!selected||!outputDims}>{isCrop?t.saveCrop:t.saveRotate}</button>
          <button type="button" className="secondary" disabled={busy||checking} onClick={clear}>{t.clear}</button>
        </div>
      </form>
      <aside className="editor-preview">
        <h2 className="panel-title">{t.preview}</h2>
        <p className="transform-help">{isCrop?t.introCrop:t.introRotate}</p>
        <div className="transform-viewer" data-testid="transform-preview">
          {!selected||!source?<p className="preview-empty">{t.empty}</p>:
           isCrop? <div ref={stage} data-testid="crop-stage" className="crop-stage"
             style={{width:'min(100%, '+Math.round(360*selected.width/selected.height)+'px)',aspectRatio:selected.width+' / '+selected.height}}
             onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
             <img src={source} alt={lang==='zh'?'裁剪区域原图':'Image to crop'} draggable={false}/>
             {crop&&<div className="crop-selection" data-crop-action="move" style={cropStyle} data-testid="crop-selection">
               <span className="crop-grid" aria-hidden="true"/>
               <span className="crop-handle" data-crop-action="resize" aria-hidden="true"/>
             </div>}
           </div>:
           result?<img className="transform-result-image" src={result.url} alt={t.result}/>:
           <canvas ref={previewCanvas} className="rotate-preview" data-testid="rotate-preview" role="img" aria-label={t.preview}/>}
        </div>
        {selected&&outputDims&&<p className="transform-output-size" data-testid="transform-dimensions">{t.dimensions}: {outputDims.width}×{outputDims.height} px</p>}
        {result&&<div className="result">
          <strong>{t.result}</strong>
          {isCrop&&<>
            <img className="transform-result-image transform-crop-result" data-testid="transform-crop-result-preview"
              src={result.url} alt={t.result}/>
            <p className="transform-refine-help">{t.refine}</p>
          </>}
          <p data-testid="transform-result-meta">{result.width}×{result.height} · {result.format.toUpperCase()} · {formatBytes(result.bytes)} ({result.bytes} {lang==='zh'?'字节':'bytes'})</p>
           <p data-testid="transform-size-comparison">{lang==='zh'?'原文件':'Original'}: {formatBytes(selected.file.size)} · {lang==='zh'?'处理结果':'Output'}: {formatBytes(result.bytes)}</p>
          <a className="download" data-testid="transform-download" href={result.url} download={result.name}>{t.download}</a>
        </div>}
      </aside>
    </div>
    <div className="editor-footer"><p role="status" data-testid="transform-status">{status||(selected?(!isCrop&&!edited?t.noAction:t.selected):t.empty)}</p><span>{t.local}</span></div>
  </section>;
}
