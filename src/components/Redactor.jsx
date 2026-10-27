import React,{useEffect,useRef,useState} from 'react';
import JSZip from 'jszip';
import {
  decodeBitmap,validateRedactionFiles,validateRedactionPixels,boxBetween,
  paintRedactions,flattenRedactedImage,
} from '../lib/redaction-core.mjs';
import {formatBytes} from '../lib/image-core.mjs';
import '../styles/redactor.css';

const labels={
  en:{
    upload:'Choose images',hint:'JPG, PNG or WebP · 12 images / 100 MB maximum',
    drop:'Or drag and drop images here, or paste a screenshot (Ctrl/⌘ + V).',
    images:'Images',none:'Choose an image to begin.',reading:'Reading image…',
    draw:'Draw rectangle',erase:'Remove rectangle',undo:'Undo',redo:'Redo',clear:'Clear all',
    drawHelp:'Drag over each area you want to cover. Each new box uses the selected style.',
    eraseHelp:'Click a highlighted rectangle to remove it. Undo is available.',
    style:'How should the area look?',solid:'Solid color',mosaic:'Pixelate',blur:'Blur',
    solidHint:'Fully replaces hidden pixels. Choose this for private information.',
    weakHint:'For appearance only. Blur or pixelation may leave text recoverable. Use solid color for secrets.',
    color:'Cover color',black:'Black',white:'White',custom:'Custom color',
    strength:'Effect strength',styleHelp:'Changing the style only affects new rectangles.',
    areas:'Covered areas',area:'Area',remove:'Remove',empty:'Drag on the image to add a cover.',
    save:'Export',format:'Output format',download:'Download image',zip:'Download ZIP',
    needsMask:'Every exported image must have at least one manually drawn cover.',
    ready:'Saved file:',batchReady:'ZIP prepared:',success:'Ready',working:'Creating file…',
    change:'Remove images',local:'Everything is edited in your browser; no image uploads.',
    caution:'Inspect the full image before sharing. Only solid color is suitable for sensitive text.',
  },
  zh:{
    upload:'选择图片',hint:'支持 JPG、PNG、WebP，最多 12 张 / 总计 100 MB',
    drop:'也可以拖放图片，或粘贴截图（Ctrl/⌘ + V）。',
    images:'图片',none:'请先选择图片。',reading:'正在读取图片…',
    draw:'画矩形框',erase:'删除矩形框',undo:'撤销',redo:'重做',clear:'清除本图',
    drawHelp:'在图片上拖动选中需要遮挡的位置，新画的框使用当前选中的方式。',
    eraseHelp:'点击已有遮挡区域即可删除，也可以撤销。',
    style:'打码方式',solid:'纯色遮挡',mosaic:'马赛克',blur:'模糊',
    solidHint:'完全替换原始像素。敏感信息建议使用这种方式。',
    weakHint:'仅用于视觉处理。模糊和马赛克可能被推测或恢复，密码、证件号等请用纯色遮挡。',
    color:'遮挡颜色',black:'黑色',white:'白色',custom:'自定义颜色',
    strength:'效果强度',styleHelp:'切换方式只影响新画的区域，不会改变已经画好的框。',
    areas:'已遮挡区域',area:'区域',remove:'删除',empty:'在图片上拖动鼠标或手指画框。',
    save:'导出图片',format:'输出格式',download:'下载当前图片',zip:'批量下载 ZIP',
    needsMask:'每张准备导出的图片都必须先手动画至少一个遮挡框。',
    ready:'文件已生成：',batchReady:'ZIP 已生成：',success:'完成',working:'正在生成文件…',
    change:'清空图片',local:'图片只在浏览器中编辑，不会上传。',
    caution:'分享前请逐张检查。敏感文字请使用纯色遮挡。',
  },
};

function saveBlob(blob,filename) {
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function updateOne(entries,id,callback) {
  return entries.map(entry=>entry.id===id?callback(entry):entry);
}

export default function Redactor({lang='en'}) {
  const t=labels[lang];
  const [items,setItems]=useState([]);
  const [activeId,setActiveId]=useState(null);
  const [tool,setTool]=useState('draw');
  const [effect,setEffect]=useState('solid');
  const [color,setColor]=useState('#000000');
  const [strength,setStrength]=useState(24);
  const [format,setFormat]=useState('png');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState('');
  const [draft,setDraft]=useState(null);
  const [ready,setReady]=useState(false);
  const [paintReady,setPaintReady]=useState(false);
  const current=items.find(x=>x.id===activeId)||null;
  const masks=current?.masks||[];
  const blocked=busy||loading;
  const urlRef=useRef([]);
  const sequenceRef=useRef(0);
  const selectionRef=useRef(0);
  const busyRef=useRef(false);
  const pointRef=useRef(null);
  const previewRef=useRef(null);
  const bitmapRef=useRef(null);
  busyRef.current=blocked;

  useEffect(()=>{
    setReady(true);
    const paste=event=>{
      if(['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName))return;
      const files=Array.from(event.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));
      if(files.length&&!busyRef.current){event.preventDefault();void selectImages(files);}
    };
    window.addEventListener('paste',paste);
    return()=>{
      ++selectionRef.current;
      urlRef.current.forEach(url=>URL.revokeObjectURL(url));
      window.removeEventListener('paste',paste);
    };
  },[]);

  // Decode only the active image. Do not keep every full-resolution bitmap in RAM.
  useEffect(()=>{
    let alive=true;
    setPaintReady(false);
    if(bitmapRef.current){bitmapRef.current.bitmap.close();bitmapRef.current=null;}
    if(!current)return ()=>{alive=false;};
    decodeBitmap(current.file).then(bitmap=>{
      if(!alive){bitmap.close();return;}
      bitmapRef.current={id:current.id,bitmap};
      setPaintReady(true);
    }).catch(error=>{if(alive)setStatus(error.message||t.reading);});
    return()=>{
      alive=false;
      if(bitmapRef.current?.id===current.id){bitmapRef.current.bitmap.close();bitmapRef.current=null;}
    };
  },[current?.id]);

  // The editor renders the actual effect, not a fake semi-transparent box.
  useEffect(()=>{
    if(!paintReady||!current||!previewRef.current||bitmapRef.current?.id!==current.id)return;
    const bitmap=bitmapRef.current.bitmap;
    const preview=previewRef.current;
    const scale=Math.min(1,900/current.width,650/current.height);
    const width=Math.max(1,Math.round(current.width*scale));
    const height=Math.max(1,Math.round(current.height*scale));
    preview.width=width;preview.height=height;
    preview.dataset.rendered='false';
    try{
      const ctx=preview.getContext('2d');
      if(!ctx)throw new Error('Canvas unavailable.');
      ctx.clearRect(0,0,width,height);
      ctx.drawImage(bitmap,0,0,width,height);
      paintRedactions(ctx,bitmap,masks,'solid',width,height);
      preview.dataset.rendered='true';
    }catch(error){preview.dataset.rendered='false';setStatus(error.message||'Unable to render preview.');}
  },[current?.id,current?.masks,paintReady]);

  async function selectImages(files) {
    if(busyRef.current)return;
    const attempt=++selectionRef.current;
    setLoading(true);setStatus(t.reading);
    const next=[];
    try {
      validateRedactionFiles(files);
      for(const file of files){
        const bitmap=await decodeBitmap(file);
        const width=bitmap.width,height=bitmap.height;bitmap.close();
        next.push({id:'image-'+(++sequenceRef.current),file,width,height,
          url:URL.createObjectURL(file),masks:[],undo:[],redo:[]});
      }
      validateRedactionPixels(next);
      if(attempt!==selectionRef.current){next.forEach(i=>URL.revokeObjectURL(i.url));return;}
      urlRef.current.forEach(url=>URL.revokeObjectURL(url));
      urlRef.current=next.map(item=>item.url);
      setItems(next);setActiveId(next[0].id);setTool('draw');setDraft(null);
      setStatus(t.drawHelp);
    }catch(error){
      next.forEach(item=>URL.revokeObjectURL(item.url));
      if(attempt===selectionRef.current)setStatus(error.message||t.none);
    }finally{if(attempt===selectionRef.current)setLoading(false);}
  }
  function clearImages(){
    if(blocked)return;
    ++selectionRef.current;
    urlRef.current.forEach(url=>URL.revokeObjectURL(url));
    urlRef.current=[];
    setItems([]);setActiveId(null);setDraft(null);setStatus(t.none);
  }

  function changeMasks(id,callback) {
    setItems(previous=>updateOne(previous,id,entry=>{
      const updated=callback(entry.masks);
      if(updated===entry.masks||!Array.isArray(updated))return entry;
      return {...entry,masks:updated,undo:[...entry.undo.slice(-39),entry.masks],redo:[]};
    }));
  }
  function undo(){
    if(!current||!current.undo.length||blocked)return;
    setItems(entries=>updateOne(entries,current.id,item=>{
      if(!item.undo.length)return item;
      return {...item,masks:item.undo.at(-1),undo:item.undo.slice(0,-1),
        redo:[...item.redo.slice(-39),item.masks]};
    }));
  }
  function redo(){
    if(!current||!current.redo.length||blocked)return;
    setItems(entries=>updateOne(entries,current.id,item=>{
      if(!item.redo.length)return item;
      return {...item,masks:item.redo.at(-1),redo:item.redo.slice(0,-1),
        undo:[...item.undo.slice(-39),item.masks]};
    }));
  }
  function removeBox(id) {
    if(!current||blocked)return;
    changeMasks(current.id,prev=>prev.filter(box=>box.id!==id));
  }
  function point(event){
    if(!current)return null;
    const bounds=event.currentTarget.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return null;
    return {
      x:Math.max(0,Math.min(current.width,(event.clientX-bounds.left)*current.width/bounds.width)),
      y:Math.max(0,Math.min(current.height,(event.clientY-bounds.top)*current.height/bounds.height)),
    };
  }
  function pointerDown(event){
    if(!current||tool!=='draw'||blocked||event.button>0||previewRef.current?.dataset.rendered!=='true')return;
    pointRef.current=point(event);setDraft(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event){
    if(!pointRef.current||!current||tool!=='draw')return;
    const end=point(event);if(end)setDraft(boxBetween(pointRef.current,end,current.width,current.height));
  }
  function pointerUp(event){
    if(!current||!pointRef.current)return;
    const end=point(event);
    const box=end&&boxBetween(pointRef.current,end,current.width,current.height);
    pointRef.current=null;setDraft(null);
    if(box&&tool==='draw'){
      const mask={...box,id:'manual-'+(++sequenceRef.current),effect,color,strength};
      changeMasks(current.id,prev=>[...prev,mask]);
    }
  }
  async function downloadCurrent(){
    if(!current||blocked)return;
    if(!masks.length){setStatus(t.needsMask);return;}
    setBusy(true);setStatus(t.working);
    try {
      const file=await flattenRedactedImage(current.file,masks,'solid',format);
      saveBlob(file.blob,file.filename);
      setStatus(t.ready+' '+file.width+'×'+file.height+' · '+formatBytes(file.blob.size));
    }catch(error){setStatus(error.message);}finally{setBusy(false);}
  }
  async function downloadBatch(){
    if(items.length<2||blocked)return;
    if(items.some(entry=>!entry.masks.length)){setStatus(t.needsMask);return;}
    setBusy(true);setStatus(t.working);
    try {
      const zip=new JSZip();
      for(let index=0;index<items.length;index++){
        const item=items[index];
        const file=await flattenRedactedImage(item.file,item.masks,'solid',format);
        zip.file('redacted-'+String(index+1).padStart(2,'0')+'.'+(format==='jpeg'?'jpg':format),file.blob);
      }
      const result=await zip.generateAsync({type:'blob'});
      saveBlob(result,'plainmile-redacted-images.zip');
      setStatus(t.batchReady+' '+items.length+' · '+formatBytes(result.size));
    }catch(error){setStatus(error.message);}finally{setBusy(false);}
  }
  const effectLabel={solid:t.solid,mosaic:t.mosaic,blur:t.blur};
  return <section className="redactor" data-redactor-ready={ready?'true':'false'}
    aria-label={lang==='zh'?'手动图片打码':'Manual image redaction'}>
    <div className="redactor-top" onDragOver={e=>e.preventDefault()}
      onDrop={e=>{e.preventDefault();if(!blocked)void selectImages(Array.from(e.dataTransfer?.files||[]));}}>
      <label className="redactor-upload" htmlFor="redact-files">{t.upload}</label>
      <input id="redact-files" className="redactor-file-input" data-testid="redact-upload"
        type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        disabled={blocked} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void selectImages(files);}}/>
      <span className="redactor-hint">{t.hint}</span>
      <span className="redactor-hint redactor-drop">{t.drop}</span>
      {!!items.length&&<button type="button" className="redactor-secondary" disabled={blocked}
        onClick={clearImages}>{t.change}</button>}
    </div>
    {!!items.length&&<>
      <div className="redactor-gallery" aria-label={t.images}>
        {items.map(item=><button key={item.id} type="button"
          className={'redactor-file '+(item.id===activeId?'chosen':'')}
          aria-current={item.id===activeId?'true':undefined}
          disabled={blocked} onClick={()=>{setActiveId(item.id);setDraft(null);setTool('draw');}}>
          <span>{item.file.name}</span>
          <small>{item.width}×{item.height} · {item.masks.length} {t.areas}</small>
        </button>)}
      </div>
      <div className="redactor-tools">
        <div className="redactor-main">
          <div className="redactor-actions">
            <button type="button" className={tool==='draw'?'chosen':''} aria-pressed={tool==='draw'}
              disabled={blocked} onClick={()=>setTool('draw')}>{t.draw}</button>
            <button type="button" className={tool==='erase'?'chosen':''} aria-pressed={tool==='erase'}
              disabled={blocked} onClick={()=>setTool('erase')}>{t.erase}</button>
            <button type="button" className="redactor-secondary" data-testid="redact-undo"
              disabled={blocked||!current?.undo.length} onClick={undo}>{t.undo}</button>
            <button type="button" className="redactor-secondary" data-testid="redact-redo"
              disabled={blocked||!current?.redo.length} onClick={redo}>{t.redo}</button>
            <button type="button" className="redactor-secondary" disabled={blocked||!masks.length}
              onClick={()=>changeMasks(current.id,()=>[])}>{t.clear}</button>
          </div>
          <p className="redactor-instruction">{tool==='draw'?t.drawHelp:t.eraseHelp}</p>
          <div className="redactor-stage-wrap">
            {current&&<div className="redactor-stage" style={{
              aspectRatio:current.width+'/'+current.height,
              maxWidth:Math.min(900,650*current.width/current.height)+'px'
            }}>
              <canvas ref={previewRef} data-testid="redact-preview" data-rendered="false"
                aria-label={lang==='zh'?'带真实打码效果的预览':'Preview with actual redaction effects'}/>
              <svg data-testid="redact-overlay" viewBox={'0 0 '+current.width+' '+current.height}
                preserveAspectRatio="none" aria-label={t.drawHelp}
                onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
                onPointerCancel={()=>{pointRef.current=null;setDraft(null);}}>
                <rect x="0" y="0" width={current.width} height={current.height} fill="transparent"/>
                {masks.map((mask,index)=><rect key={mask.id} data-testid="redact-mark"
                  data-mark-id={mask.id} x={mask.x} y={mask.y} width={mask.w} height={mask.h}
                  fill="transparent" stroke="#f4a340" strokeDasharray="6 4"
                  strokeWidth={Math.max(2,current.width/800)}
                  role={tool==='erase'?'button':undefined} tabIndex={tool==='erase'?0:-1}
                  aria-label={t.remove+' '+t.area+' '+(index+1)}
                  onPointerDown={e=>{if(tool==='erase'&&!blocked){e.stopPropagation();e.preventDefault();removeBox(mask.id);}}}
                  onKeyDown={e=>{if(tool==='erase'&&(e.key==='Enter'||e.key===' ')){e.preventDefault();removeBox(mask.id);}}}/>)}
                {draft&&<rect data-testid="redact-draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h}
                  fill="rgba(244,163,64,.18)" stroke="#f4a340" strokeWidth={Math.max(2,current.width/800)}
                  strokeDasharray="7 5" pointerEvents="none"/>}
              </svg>
            </div>}
          </div>
          <p className="redactor-instruction">{t.caution}</p>
        </div>
        <aside className="redactor-sidebar">
          <div className="redactor-control">
            <strong className="redactor-control-title">{t.style}</strong>
            <div className="redactor-style-choices" role="group" aria-label={t.style}>
              {['solid','mosaic','blur'].map(value=><button key={value} type="button"
                data-testid={'redact-style-'+value} className={effect===value?'chosen':''}
                aria-pressed={effect===value} disabled={blocked}
                onClick={()=>setEffect(value)}>{effectLabel[value]}</button>)}
            </div>
            {effect==='solid'?<div className="redactor-effect-settings">
              <label className="redactor-field-label">{t.color}</label>
              <div className="redactor-color-choices">
                <button type="button" data-testid="redact-color-black" className={color==='#000000'?'chosen':''}
                  aria-pressed={color==='#000000'} disabled={blocked}
                  onClick={()=>setColor('#000000')}>{t.black}</button>
                <button type="button" data-testid="redact-color-white" className={color==='#ffffff'?'chosen':''}
                  aria-pressed={color==='#ffffff'} disabled={blocked}
                  onClick={()=>setColor('#ffffff')}>{t.white}</button>
                <label>{t.custom}<input aria-label={t.custom} type="color" value={color}
                  disabled={blocked} onChange={e=>setColor(e.target.value)}/></label>
              </div>
              <p className="redactor-good">{t.solidHint}</p>
            </div>:<div className="redactor-effect-settings">
              <label className="redactor-field-label" htmlFor="redact-strength">{t.strength}: {strength}</label>
              <input id="redact-strength" data-testid="redact-strength" type="range" min="8" max="64" step="4"
                value={strength} disabled={blocked} onChange={e=>setStrength(Number(e.target.value))}/>
              <p className="redactor-warning">{t.weakHint}</p>
            </div>}
            <p className="redactor-instruction">{t.styleHelp}</p>
          </div>
          <div className="redactor-control">
            <div className="redactor-heading"><strong>{t.areas}</strong>
              <span data-testid="redact-count">{masks.length}</span></div>
            {!masks.length?<p>{t.empty}</p>:<div className="redactor-areas">
              {masks.map((box,index)=><div key={box.id}>
                <span>{t.area} {index+1} · {effectLabel[box.effect]}</span>
                <button type="button" className="redactor-secondary" disabled={blocked}
                  aria-label={t.remove+' '+(index+1)} onClick={()=>removeBox(box.id)}>{t.remove}</button>
              </div>)}
            </div>}
          </div>
          <div className="redactor-control">
            <strong className="redactor-control-title">{t.save}</strong>
            <label className="redactor-field-label" htmlFor="redact-format">{t.format}</label>
            <select id="redact-format" data-testid="redact-format" value={format} disabled={blocked}
              onChange={e=>setFormat(e.target.value)}>
              <option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WebP</option>
            </select>
            <div className="redactor-actions">
              <button type="button" data-testid="redact-download" disabled={blocked||!masks.length}
                onClick={()=>void downloadCurrent()}>{t.download}</button>
              {items.length>1&&<button type="button" data-testid="redact-download-all"
                className="redactor-secondary" disabled={blocked}
                onClick={()=>void downloadBatch()}>{t.zip}</button>}
            </div>
          </div>
        </aside>
      </div>
    </>}
    {!items.length&&<p className="redactor-empty">{t.none}</p>}
    <div className="redactor-status">
      <p role="status" data-testid="redact-status">{status||t.none}</p><p>{t.local}</p>
    </div>
  </section>;
}
