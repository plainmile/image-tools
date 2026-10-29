import React,{useEffect,useRef,useState} from 'react';
import {validateRedactionFiles,validateRedactionPixels,decodeBitmap,boxBetween,paintRedactions,flattenRedactedImage,addRedactionOutputBytes} from '../lib/redaction-core.mjs';
import {formatBytes,inputImageFormat} from '../lib/image-core.mjs';
import {clipboardImageFiles} from '../lib/clipboard.mjs';
import '../styles/redactor.css';

const labels={
  en:{upload:'Choose images',limit:'JPG, PNG or WebP · up to 12 images / 100 MB total',draw:'Draw rectangles',erase:'Remove rectangles',undo:'Undo',redo:'Redo',clear:'Clear all boxes',style:'Style for new rectangles',solid:'Solid black — secure concealment',mosaic:'Pixelate / mosaic',blur:'Gaussian blur',warning:'Use solid black for private text, account numbers or passwords. Pixelation and blur are visual effects, not secure concealment.',remove:'Remove',download:'Download image',zip:'Download all as ZIP',format:'Save as',jpegAlpha:'JPG replaces transparent pixels with white. Use PNG or WebP to keep transparency.',first:'Select images to start.',hint:'Choose a style, then drag to add a rectangle. Existing rectangles keep their own styles; change them in the area list.',local:'All editing happens in your browser; images are not uploaded.',need:'Add at least one box to each image before ZIP export.',ready:'Download ready',images:'Images',masks:'Redacted areas',strength:'Effect strength',drop:'Drop images here or paste a screenshot',working:'Processing…',clearFiles:'Remove all images',confirmClear:'Remove every image and all redaction boxes? This cannot be undone.',added:'Images added. Previous masks are preserved.',removeImage:'Remove image',confirmRemove:'Remove "{name}" and all its redaction boxes? This cannot be undone.',removed:'Image removed. Other images and boxes are kept.'},
  zh:{upload:'选择图片',limit:'JPG、PNG 或 WebP · 最多 12 张 / 100 MB',draw:'手动画框',erase:'删除遮挡框',undo:'撤销',redo:'重做',clear:'清空本图',style:'新画遮挡框的方式',solid:'黑色实心遮挡（保护隐私）',mosaic:'像素马赛克',blur:'高斯模糊',warning:'密码、证件号和其他敏感文字请用实心黑块。马赛克和模糊仅供视觉处理，不能保证保密。',remove:'删除',download:'下载当前图片',zip:'全部打包 ZIP 下载',format:'导出格式',jpegAlpha:'JPG 无法保留透明背景，透明区域会变成白色。需要透明背景请选择 PNG 或 WebP。',first:'请选择图片。',hint:'先选择打码方式，再拖动画框。已画的区域不会随全局模式改变，可在下方逐个调整。',local:'所有操作均在浏览器本地完成，图片不会上传。',need:'批量导出前，请为每张图片至少画一个遮挡框。',ready:'文件可以下载',images:'图片列表',masks:'遮挡区域',strength:'效果强度',drop:'可拖放图片或粘贴截图',working:'正在处理…',clearFiles:'清空所有图片',confirmClear:'确定清空全部图片和遮挡框吗？此操作不可撤销。',added:'图片已加入列表，原来的遮挡框已保留。',removeImage:'移除图片',confirmRemove:'移除“{name}”及其所有遮挡框？此操作无法撤销。',removed:'已移除图片，其他图片和遮挡框均已保留。'}
};
function redactError(error,lang){
  const message=String(error?.message||error||'Image could not be processed.');
  if(lang==='zh' && message.includes('Image contents do not match'))
    return '图片内容与 JPG、PNG 或 WebP 文件格式不一致，请选择原始图片。';
  if(lang==='zh' && message.includes('Animated PNG/WebP'))
    return '暂不支持动画 PNG/WebP。只处理第一帧会遗漏其他动画帧，因此未导入图片。';
  if(lang==='zh'){
    const translations=[
      ['Redacted output exceeds 128 MB','打码图片的累计导出大小超过 128 MB，请减少图片数量，或改选 JPG/WebP 后重试。'],
      ['Select at most 12 images','最多选择 12 张图片，请减少数量后重试。'],
      ['Selected files exceed the 100 MB','已选图片总大小超过 100 MB，请分批处理。'],
      ['Each image must be at most 40 MB','每张图片应小于或等于 40 MB，请选择较小的文件。'],
      ['Only JPEG, PNG and WebP','仅支持 JPG、PNG 和 WebP 图片。'],
      ['Image exceeds the 32-megapixel','单张图片超过 3200 万像素，请先缩小图片尺寸。'],
      ['Selected images exceed the 96-megapixel','整批图片超过 9600 万像素，请减少图片数量。'],
      ['Image encoding failed','图片编码失败，请尝试更换导出格式。'],
    ];
    const match=translations.find(([key])=>message.includes(key));
    if(match)return match[1];
  }
  return message;
}
function save(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export default function Redactor({lang='en'}){
  const t=labels[lang];
  const [items,setItems]=useState([]),[activeId,setActiveId]=useState(null);
  const [tool,setTool]=useState('draw'),[effect,setEffect]=useState('solid'),[strength,setStrength]=useState(24);
  const [format,setFormat]=useState('png'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[draft,setDraft]=useState(null),[lastDownload,setLastDownload]=useState(null);
  const canvasRef=useRef(null),dragRef=useRef(null),urls=useRef([]),sequence=useRef(0),selection=useRef(0),busyRef=useRef(false),itemsRef=useRef([]);
  const current=items.find(v=>v.id===activeId)||null,boxes=current?.masks||[];
  const visibleDownload=Boolean(lastDownload&&(lastDownload.kind==='zip'||lastDownload.sourceId===activeId));
  useEffect(()=>{itemsRef.current=items;},[items]);
  useEffect(()=>()=>{if(lastDownload?.url)URL.revokeObjectURL(lastDownload.url);},[lastDownload]);
  function discardDownload(){setLastDownload(null);}
  useEffect(()=>{
    setReady(true);
    function paste(event){
      const files=clipboardImageFiles(event);
      if(files.length&&!busyRef.current){event.preventDefault();void choose(files);}
    }
    window.addEventListener('paste',paste);
    return()=>{selection.current++;urls.current.forEach(url=>URL.revokeObjectURL(url));window.removeEventListener('paste',paste);};
  },[]);
  async function choose(files){
    // Cancelling an OS file picker is not an error and must not disturb masks.
    if(busyRef.current||!files.length)return;
    busyRef.current=true;
    const token=++selection.current,next=[];
    setBusy(true);setMessage('');
    try{
      // Keep already-redacted images; a second upload must not discard completed work.
      const existing=itemsRef.current;
      validateRedactionFiles([...existing.map(entry=>entry.file),...files]);
      for(const file of files){
        const bmp=await decodeBitmap(file);
        const width=bmp.width,height=bmp.height;bmp.close();
        next.push({id:'file-'+(++sequence.current),file,width,height,url:URL.createObjectURL(file),masks:[],undo:[],redo:[]});
      }
      validateRedactionPixels([...existing,...next]);
      if(token!==selection.current){next.forEach(v=>URL.revokeObjectURL(v.url));return;}
      const combined=[...existing,...next];
      urls.current.push(...next.map(v=>v.url));
      itemsRef.current=combined;
      setItems(combined);setActiveId(next[0].id);setTool('draw');discardDownload();setMessage(t.added);
    }catch(error){next.forEach(v=>URL.revokeObjectURL(v.url));setMessage(redactError(error,lang));}
    finally{if(token===selection.current){busyRef.current=false;setBusy(false);}}
  }
  function removeImage(id){
    if(busyRef.current)return;
    const existing=itemsRef.current;
    const index=existing.findIndex(item=>item.id===id);
    if(index<0)return;
    const removed=existing[index];
    // Only destroying an already edited image needs confirmation. Unedited
    // mistakes can be removed in one click without resetting the other masks.
    if(removed.masks.length && !window.confirm(t.confirmRemove.replace('{name}',removed.file.name)))return;
    const remaining=existing.filter(item=>item.id!==id);
    const nextActiveId=activeId===id ? (remaining[Math.min(index,remaining.length-1)]?.id??null) : activeId;
    urls.current=urls.current.filter(url=>url!==removed.url);
    URL.revokeObjectURL(removed.url);
    itemsRef.current=remaining;
    dragRef.current=null;
    setDraft(null);setItems(remaining);setActiveId(nextActiveId);
    if(activeId===id)setTool('draw');
    // The previous download might contain the now-removed source: never
    // leave a stale redacted ZIP or single-image file available.
    discardDownload();
    setMessage(remaining.length?t.removed:t.first);
  }
  function clearImages(){
    if(busyRef.current)return;
    if(itemsRef.current.some(entry=>entry.masks.length)&&!window.confirm(t.confirmClear))return;
    selection.current++;
    urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current=[];
    itemsRef.current=[];dragRef.current=null;
    setItems([]);setActiveId(null);setDraft(null);discardDownload();setMessage('');
  }
  function modify(fn){
    if(!current||busy)return;
    discardDownload();
    setItems(prev=>prev.map(v=>{
      if(v.id!==current.id)return v;
      const next=fn(v.masks);
      if(!Array.isArray(next)||next===v.masks)return v;
      return {...v,masks:next,undo:[...v.undo.slice(-39),v.masks],redo:[]};
    }));
  }
  function undo(){
    if(!current?.undo.length||busy)return;
    discardDownload();
    setItems(a=>a.map(v=>v.id!==activeId?v:{...v,masks:v.undo.at(-1),undo:v.undo.slice(0,-1),redo:[...v.redo.slice(-39),v.masks]}));
  }
  function redo(){
    if(!current?.redo.length||busy)return;
    discardDownload();
    setItems(a=>a.map(v=>v.id!==activeId?v:{...v,masks:v.redo.at(-1),redo:v.redo.slice(0,-1),undo:[...v.undo.slice(-39),v.masks]}));
  }
  function position(e){
    const bounds=e.currentTarget.getBoundingClientRect();
    return {x:Math.max(0,Math.min(current.width,(e.clientX-bounds.left)/bounds.width*current.width)),y:Math.max(0,Math.min(current.height,(e.clientY-bounds.top)/bounds.height*current.height))};
  }
  function start(e){
    if(!current||busy||tool!=='draw'||e.button>0)return;
    dragRef.current=position(e);e.currentTarget.setPointerCapture(e.pointerId);setDraft(null);
  }
  function move(e){
    if(!dragRef.current||!current)return;
    setDraft(boxBetween(dragRef.current,position(e),current.width,current.height));
  }
  function end(e){
    if(!dragRef.current||!current)return;
    const box=boxBetween(dragRef.current,position(e),current.width,current.height);
    dragRef.current=null;setDraft(null);
    if(box)modify(a=>[...a,{id:'mask-'+(++sequence.current),...box,source:'manual',effect,strength}]);
  }
  useEffect(()=>{
    if(!current||!canvasRef.current)return;
    let stopped=false;const canvas=canvasRef.current;
    (async()=>{
      const bmp=await decodeBitmap(current.file);
      try{
        if(stopped)return;
        const scale=Math.min(1,1100/bmp.width,1100/bmp.height,Math.sqrt(1250000/(bmp.width*bmp.height)));
        canvas.width=Math.max(1,Math.round(bmp.width*scale));
        canvas.height=Math.max(1,Math.round(bmp.height*scale));
        const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
        ctx.scale(canvas.width/bmp.width,canvas.height/bmp.height);
        ctx.drawImage(bmp,0,0);
        paintRedactions(ctx,bmp,current.masks,effect,strength);
      }finally{bmp.close();}
    })().catch(e=>{if(!stopped)setMessage(e.message);});
    return()=>{stopped=true;};
  },[current?.id,current?.masks,effect,strength]);
  async function download(all=false){
    if(busyRef.current)return;
    const list=all?items:[current];
    if(!list.length||list.some(v=>!v?.masks?.length)){setMessage(t.need);return;}
    busyRef.current=true;setBusy(true);
    try{
      if(all){
        const {default: JSZip}=await import('jszip');
        const zip=new JSZip();
        let outputBytes=0;
        for(let i=0;i<list.length;i++){
          const out=await flattenRedactedImage(list[i].file,list[i].masks,effect,format,strength);
          outputBytes=addRedactionOutputBytes(outputBytes,out.blob.size);
          zip.file('redacted-'+String(i+1).padStart(2,'0')+'.'+(format==='jpeg'?'jpg':format),out.blob);
        }
        // JPEG, PNG and WebP output blobs are already encoded: deflating them
        // again adds CPU work without meaningful savings on mobile devices.
        const blob=await zip.generateAsync({type:'blob',compression:'STORE'});
        save(blob,'plainmile-redacted-images.zip');
        setLastDownload({url:URL.createObjectURL(blob),name:'plainmile-redacted-images.zip',bytes:blob.size,sourceBytes:list.reduce((sum,item)=>sum+item.file.size,0),kind:'zip'});
        setMessage(t.ready+' · ZIP · '+formatBytes(blob.size));
      }else{
        const out=await flattenRedactedImage(current.file,current.masks,effect,format,strength);
        save(out.blob,out.filename);
        setLastDownload({url:URL.createObjectURL(out.blob),name:out.filename,bytes:out.blob.size,sourceBytes:current.file.size,kind:'single',sourceId:current.id});
        setMessage(t.ready+' · '+current.width+'×'+current.height+' · '+formatBytes(out.blob.size));
      }
    }catch(e){setMessage(redactError(e,lang));}finally{busyRef.current=false;setBusy(false);}
  }
  return <section className="redactor" data-redactor-ready={String(ready)}>
    <div className="redactor-top" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void choose(Array.from(e.dataTransfer?.files||[]));}}><label className="redactor-upload">{t.upload}<input data-testid="redact-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple disabled={!ready||busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void choose(files);}}/></label><span className="redactor-hint">{t.limit} · {t.drop}</span></div>
    {items.length>0&&<>
      <div className="redactor-gallery" aria-label={t.images}>{items.map((v,i)=><div className="redactor-gallery-entry" role="group" aria-label={v.file.name} key={v.id}>
        <button className={'redactor-file '+(v.id===activeId?'chosen':'')} type="button" disabled={busy} aria-pressed={v.id===activeId} onClick={()=>{setActiveId(v.id);setDraft(null);}}>
          <span>{v.file.name}</span><small>{v.width}×{v.height} · {v.masks.length} {lang==='zh'?'处':'boxes'}</small>
        </button>
        <button type="button" className="redactor-secondary redactor-remove-file" data-testid="redact-remove-image"
          aria-label={t.removeImage+' '+(i+1)} disabled={busy} onClick={()=>removeImage(v.id)}>{t.removeImage}</button>
      </div>)}</div>
      <div className="redactor-tools">
        <div className="redactor-main">
          <div className="redactor-actions">
            <button type="button" className={tool==='draw'?'chosen':''} onClick={()=>setTool('draw')} disabled={busy}>{t.draw}</button>
            <button type="button" className={tool==='erase'?'chosen':''} onClick={()=>setTool('erase')} disabled={busy}>{t.erase}</button>
            <button type="button" data-testid="redact-undo" className="redactor-secondary" onClick={undo} disabled={busy||!current?.undo.length}>{t.undo}</button>
            <button type="button" data-testid="redact-redo" className="redactor-secondary" onClick={redo} disabled={busy||!current?.redo.length}>{t.redo}</button>
            <button type="button" className="redactor-secondary" onClick={()=>modify(()=>[])} disabled={busy||!boxes.length}>{t.clear}</button>
             <button type="button" className="redactor-secondary" data-testid="redact-clear-images" disabled={busy} onClick={clearImages}>{t.clearFiles}</button>
          </div>
          <p className="redactor-instruction">{t.hint}</p>
          <div className="redactor-stage-wrap">{current&&<div className="redactor-stage" style={{aspectRatio:current.width+'/'+current.height,maxWidth:Math.min(900,650*current.width/current.height)+'px'}}>
            <canvas ref={canvasRef} className="redactor-preview-canvas" role="img" aria-label={lang==='zh'?'真实打码效果预览':'Live redaction effect preview'}/>
            <svg data-testid="redact-overlay" data-mode={tool} viewBox={'0 0 '+current.width+' '+current.height} preserveAspectRatio="none" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{dragRef.current=null;setDraft(null);}}>
              <rect x="0" y="0" width={current.width} height={current.height} fill="transparent"/>
              {boxes.map(m=><rect key={m.id} data-testid="redact-mark" data-mark-id={m.id} x={m.x} y={m.y} width={m.w} height={m.h} fill="transparent" stroke="#f59e0b" strokeWidth={Math.max(2,current.width/800)} onPointerDown={e=>{if(tool!=='erase'||busy)return;e.preventDefault();e.stopPropagation();modify(a=>a.filter(b=>b.id!==m.id));}}/>)}
              {draft&&<rect data-testid="redact-draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h} fill="rgba(0,0,0,.18)" stroke="#f59e0b" strokeDasharray="8 5" pointerEvents="none"/>}
            </svg>
          </div>}</div>
          <p className="redactor-instruction">{t.warning}</p>
        </div>
        <aside className="redactor-sidebar">
          <div className="redactor-control">
            <label htmlFor="redact-effect">{t.style}</label>
            <select id="redact-effect" data-testid="redact-effect" value={effect} disabled={busy} onChange={e=>setEffect(e.target.value)}><option value="solid">{t.solid}</option><option value="mosaic">{t.mosaic}</option><option value="blur">{t.blur}</option></select>
            {effect!=='solid'&&<label>{t.strength}: {strength}<input data-testid="redact-strength" type="range" min="8" max="64" step="4" value={strength} onChange={e=>setStrength(+e.target.value)}/></label>}
            <p className="redactor-warning">{t.warning}</p>
          </div>
          <div className="redactor-control"><div className="redactor-heading"><strong>{t.masks}</strong><span data-testid="redact-count">{boxes.length}</span></div>
            <div className="redactor-areas">{boxes.map((m,i)=><div className="redactor-area-entry" key={m.id}>
              <span>{lang==='zh'?'遮挡区域':'Area'} {i+1}</span>
              <select data-testid="redact-area-effect" aria-label={(lang==='zh'?'区域样式 ':'Style for area ')+(i+1)} value={m.effect||'solid'} disabled={busy}
                onChange={e=>modify(a=>a.map(v=>v.id===m.id?{...v,effect:e.target.value}:v))}>
                <option value="solid">{t.solid}</option><option value="mosaic">{t.mosaic}</option><option value="blur">{t.blur}</option>
              </select>
              <button type="button" className="redactor-secondary" disabled={busy} onClick={()=>modify(a=>a.filter(v=>v.id!==m.id))}>{t.remove}</button>
              {(m.effect||'solid')!=='solid'&&<label className="redactor-area-strength">{t.strength}: {m.strength??strength}
                <input data-testid="redact-area-strength" type="range" min="8" max="64" step="4" value={m.strength??strength} disabled={busy}
                  onChange={e=>modify(a=>a.map(v=>v.id===m.id?{...v,strength:Number(e.target.value)}:v))}/>
              </label>}
            </div>)}</div>
          </div>
          <div className="redactor-control"><label htmlFor="redact-format">{t.format}</label><select id="redact-format" value={format} onChange={e=>{setFormat(e.target.value);discardDownload();}} disabled={busy}><option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WebP</option></select>
            {format==='jpeg'&&items.some(item=>inputImageFormat(item.file)!=='jpeg')&&<p className="redactor-warning" data-testid="redact-alpha-warning">{t.jpegAlpha}</p>}
            <div className="redactor-actions"><button type="button" data-testid="redact-download" disabled={busy||!current?.masks.length} onClick={()=>void download(false)}>{t.download}</button>{items.length>1&&<button type="button" data-testid="redact-download-all" disabled={busy} onClick={()=>void download(true)}>{t.zip}</button>}</div>
          </div>
        </aside>
      </div>
    </>}
    {!items.length&&<p className="redactor-empty">{t.first}</p>}
    {visibleDownload&&<div className="redactor-saved-result" data-testid="redact-saved-result">
      <span>{lang==='zh'?'原文件':'Original'}: {formatBytes(lastDownload.sourceBytes)} · {lang==='zh'?'结果':'Output'}: {formatBytes(lastDownload.bytes)}</span>
      <a className="download" data-testid="redact-download-again" href={lastDownload.url} download={lastDownload.name}>{lang==='zh'?'再次下载':'Download again'}</a>
    </div>}
    <div className="redactor-status"><p role="status" data-testid="redact-status">{message||t.first}</p><p>{t.local}</p></div>
  </section>;
}
