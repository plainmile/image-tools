import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  REDACT_MAX_FILES, decodeBitmap, scanCanvas, canvasBlob, extractOcrBoxes,
  validateRedactionFiles, validateRedactionPixels, boxBetween, flattenRedactedImage,
} from '../lib/redaction-core.mjs';
import { formatBytes } from '../lib/image-core.mjs';
import '../styles/redactor.css';

const messages = {
  en: {
    upload:'Choose images',hint:'JPG, PNG or WebP · up to 12 images / 100 MB total',
    files:'Images',noImage:'Choose images or paste a screenshot to begin.',
    detect:'Find and cover text', detectAll:'Find text in all images', cancel:'Stop scanning',
    scanLanguage:'Recognition language',scanProgress:'Recognizing',loading:'Reading images…',
    detected:'Detected text',nothing:'No words detected. Add rectangles manually.',
    all:'Select all detected',clearDetected:'Unselect detected text',
    draw:'Draw boxes',erase:'Remove boxes',undo:'Undo',redo:'Redo',eraseNote:'In Remove mode, tap a box to delete it.',
    drawNote:'Drag across the picture to add a box. Use Remove boxes to delete one.',
    clear:'Clear all boxes',masks:'Covered areas',remove:'Remove',
    effect:'Cover style',solid:'Solid black (recommended)',white:'Solid white',
    mosaic:'Mosaic (visual only)',blur:'Blur (visual only)',
    warning:'For passwords, keys or ID numbers use solid black. Mosaic and blur are not reliable concealment.',
    missed:'OCR can miss small, rotated or low-contrast text. Review every image and add or remove boxes before sharing.',
    format:'Save as',download:'Download this image',zip:'Download all as ZIP',
    needBoxes:'Add at least one box to every image you plan to export.',
    success:'File ready.',cancelled:'Recognition stopped.',done:'Recognition complete.',
    noMatches:'No readable text was found. You can draw boxes manually.',
    local:'All recognition and editing run locally in this browser.',
    count:'selected',first:'Choose a file.',partial:'Check detected results and manually drawn areas.',
    progress:'Loading language data…',help:'Toggle individual detected words below to remove or restore their cover.',
  },
  zh: {
    upload:'选择图片',hint:'JPG、PNG、WebP，最多 12 张，总计 100 MB',
    files:'图片列表',noImage:'选择图片，或粘贴一张截图。',
    detect:'识别并遮挡文字',detectAll:'识别所有图片的文字',cancel:'停止识别',
    scanLanguage:'识别语言',scanProgress:'正在识别',loading:'正在读取图片…',
    detected:'识别的文字',nothing:'没有识别出文字，可手动画框。',
    all:'选中所有识别结果',clearDetected:'取消识别结果的遮挡',
    draw:'手动加框',erase:'删除遮挡框',undo:'撤销',redo:'重做',eraseNote:'切换到删除模式后，点击遮挡框即可移除。',
    drawNote:'在图片上拖动鼠标或手指添加遮挡框。想删掉时切换到删除模式。',
    clear:'清除本图全部遮挡',masks:'遮挡区域',remove:'删除',
    effect:'打码方式',solid:'实心黑块（推荐）',white:'实心白块',
    mosaic:'马赛克（仅视觉处理）',blur:'模糊（仅视觉处理）',
    warning:'密码、密钥、证件号码等敏感信息应使用实心黑块。马赛克和模糊不能保证隐藏内容。',
    missed:'文字识别可能漏掉小字、倾斜或模糊的文字。分享前请逐张检查并补画或删除遮挡框。',
    format:'导出格式',download:'下载当前图片',zip:'全部打包 ZIP 下载',
    needBoxes:'每张需要导出的图片至少添加一个遮挡框。',
    success:'文件已生成。',cancelled:'已停止识别。',done:'文字识别完成。',
    noMatches:'未发现清晰可读的文字，可以手动画框。',
    local:'文字识别及图片处理只在当前浏览器执行。',
    count:'已选择',first:'请选择图片。',partial:'检查自动识别和手动添加的遮挡区域。',
    progress:'正在加载文字识别文件…',help:'下方可以逐条取消遮挡，也可以重新选中。',
  }
};

function localFileName(file) { return String(file?.name || 'image').slice(0,100); }
function sameEntry(existing, update) { return existing.map(f => f.id === update.id ? { ...f, ...update } : f); }
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export default function Redactor({ lang='en' }) {
  const t = messages[lang];
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [language, setLanguage] = useState(lang === 'zh' ? 'mixed' : 'eng');
  const [tool, setTool] = useState('draw');
  const [effect, setEffect] = useState('solid');
  const [format, setFormat] = useState('png');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState(null);
  const MAX_UNDO = 40;
  const workerRef = useRef(null);
  const busyRef = useRef(false);
  const runIdRef = useRef(0);
  const counterRef = useRef(0);
  const dragStartRef = useRef(null);
  const urlRef = useRef([]);
  const current = items.find(item => item.id === activeId) || null;
  const busy = scanning || saving || loading;
  busyRef.current = busy;

  useEffect(() => {
    setReady(true);
    const onPaste = (event) => {
      if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return;
      const images = Array.from(event.clipboardData?.files || []);
      if (images.length) { event.preventDefault(); void selectImages(images); }
    };
    window.addEventListener('paste', onPaste);
    return () => {
      runIdRef.current += 1;
      void workerRef.current?.terminate().catch(() => {});
      urlRef.current.forEach(url => URL.revokeObjectURL(url));
      window.removeEventListener('paste', onPaste);
    };
  }, []);
  async function selectImages(files) {
    if (busyRef.current) return;
    setMessage('');
    setLoading(true);
    const next = [];
    try {
      validateRedactionFiles(files);
      for (const file of files) {
        const bitmap = await decodeBitmap(file);
        const width = bitmap.width, height = bitmap.height;
        bitmap.close();
        next.push({
          id: 'image-' + (++counterRef.current), file, width, height,
          url: URL.createObjectURL(file), suggestions: [], masks: [], undo: [], redo: [], scanned: false,
        });
      }
      validateRedactionPixels(next);
      urlRef.current.forEach(url => URL.revokeObjectURL(url));
      urlRef.current = next.map(item => item.url);
      setItems(next);
      setActiveId(next[0].id);
      setTool('draw');
      setMessage(t.partial);
    } catch (error) {
      // Decoding can fail after earlier files created object URLs.
      // A rejected selection must not leave temporary URLs alive.
      next.forEach(item => URL.revokeObjectURL(item.url));
      setMessage(error.message || t.first);
    } finally { setLoading(false); }
  }
  function updateMasks(id, callback) {
    setItems(prev => prev.map(f => {
      if (f.id !== id) return f;
      const updated = callback(f.masks, f);
      if (updated === f.masks || !Array.isArray(updated)) return f;
      return { ...f, masks: updated, undo: [...f.undo.slice(-(MAX_UNDO-1)),f.masks], redo: [] };
    }));
  }
  function undoCurrent() {
    if (!current || !current.undo.length || busy) return;
    setItems(prev => prev.map(f => {
      if (f.id !== current.id || !f.undo.length) return f;
      return { ...f, masks:f.undo[f.undo.length-1],undo:f.undo.slice(0,-1),
        redo:[...f.redo.slice(-(MAX_UNDO-1)),f.masks] };
    }));
  }
  function redoCurrent() {
    if (!current || !current.redo.length || busy) return;
    setItems(prev => prev.map(f => {
      if (f.id !== current.id || !f.redo.length) return f;
      return { ...f, masks:f.redo[f.redo.length-1],redo:f.redo.slice(0,-1),
        undo:[...f.undo.slice(-(MAX_UNDO-1)),f.masks] };
    }));
  }
  function toggleSuggestion(s) {
    if (!current) return;
    updateMasks(current.id, (masks) =>
      masks.some(m => m.id === s.id) ? masks.filter(m => m.id !== s.id) : [...masks, s]);
  }
  function selectAll() {
    if (!current) return;
    updateMasks(current.id, (masks, f) => {
      const ids = new Set(masks.map(m => m.id));
      return [...masks, ...f.suggestions.filter(s => !ids.has(s.id))];
    });
  }
  function clearDetected() {
    if (!current) return;
    updateMasks(current.id, masks => masks.filter(m => m.source !== 'ocr'));
  }
  function clearCurrent() {
    if (!current) return;
    updateMasks(current.id, () => []);
    setMessage('');
  }
  function removeBox(id) {
    if (!current) return;
    updateMasks(current.id, masks => masks.filter(m => m.id !== id));
  }
  function toPoint(e) {
    if (!current) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(current.width, (e.clientX - rect.left) * current.width / rect.width)),
      y: Math.max(0, Math.min(current.height, (e.clientY - rect.top) * current.height / rect.height)),
    };
  }
  function pointerDown(e) {
    if (!current || tool !== 'draw' || busy || e.button > 0) return;
    const point = toPoint(e);
    dragStartRef.current = point;
    setDraft(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e) {
    if (!dragStartRef.current || !current || tool !== 'draw') return;
    setDraft(boxBetween(dragStartRef.current, toPoint(e), current.width, current.height));
  }
  function pointerUp(e) {
    if (!current || !dragStartRef.current) return;
    const rect = boxBetween(dragStartRef.current, toPoint(e), current.width, current.height);
    dragStartRef.current = null; setDraft(null);
    if (rect) {
      const box = { id: 'manual-' + (++counterRef.current), ...rect, source: 'manual', text: '' };
      updateMasks(current.id, masks => [...masks, box]);
    }
  }

  async function recognize(all=false) {
    if (busy || !items.length) return;
    const selected = all ? [...items] : items.filter(f => f.id === activeId);
    if (!selected.length) return;
    const runId = ++runIdRef.current;
    setScanning(true); setMessage(t.progress);
    let worker;
    try {
      // Lazy import so visitors who only draw boxes never load OCR runtime.
      const { createWorker } = await import('tesseract.js');
      const langCodes = language === 'mixed' ? ['chi_sim','eng'] : ['eng'];
      worker = await createWorker(langCodes, 1, {
        workerPath:'/ocr/worker.min.js',
        corePath:'/ocr/core',
        langPath:'/ocr/lang',
        workerBlobURL:false,
        logger: e => {
          if(runId !== runIdRef.current)return;
          const progress=Number.isFinite(e.progress)?' '+Math.round(e.progress*100)+'%':'';
          setMessage(t.scanProgress+progress);
        },
      });
      workerRef.current = worker;
      for(let index=0; index<selected.length;index+=1){
        if(runId!==runIdRef.current)break;
        const item=selected[index];
        setMessage(t.scanProgress+' '+(index+1)+'/'+selected.length+' — '+localFileName(item.file));
        const bitmap=await decodeBitmap(item.file);
        let source;
        try { source=scanCanvas(bitmap); } finally { bitmap.close(); }
        const blob=await canvasBlob(source,'image/png');
        const scanWidth=source.width,scanHeight=source.height;
        source.width=0; source.height=0;
        const result=await worker.recognize(blob,{}, {blocks:true});
        if(runId!==runIdRef.current)break;
        const suggestions=extractOcrBoxes(result.data,item.width,item.height,scanWidth,scanHeight);
        setItems(prev => prev.map(f => {
          if(f.id!==item.id)return f;
          return { ...f, scanned:true, suggestions,
            undo: [...f.undo.slice(-(MAX_UNDO-1)), f.masks],redo: [],
            masks:[...f.masks.filter(m=>m.source!=='ocr'), ...suggestions] };
        }));
      }
      if(runId===runIdRef.current)setMessage(t.done+' '+t.partial);
    }catch(error) {
      if(runId===runIdRef.current)setMessage((error.message||'OCR failed')+'. '+t.missed);
    }finally {
      if(workerRef.current===worker)workerRef.current=null;
      if(worker)try{await worker.terminate();}catch{}
      setScanning(false);
    }
  }
  function stopScan() {
    if(!scanning)return;
    ++runIdRef.current;
    void workerRef.current?.terminate().catch(()=>{});
    setMessage(t.cancelled);
  }
  async function downloadCurrent() {
    if (!current || saving) return;
    if (!current.masks.length){setMessage(t.needBoxes);return;}
    setSaving(true);
    try {
      const out=await flattenRedactedImage(current.file,current.masks,effect,format);
      saveBlob(out.blob,out.filename);
      setMessage(t.success);
    }catch(error){setMessage(error.message);}finally{setSaving(false);}
  }
  async function downloadBatch() {
    if(!items.length || busy)return;
    if(items.some(f=>!f.masks.length)){setMessage(t.needBoxes);return;}
    setSaving(true);
    try {
      const zip=new JSZip();
      for(let index=0;index<items.length;index+=1){
        const f=items[index];
        const out=await flattenRedactedImage(f.file,f.masks,effect,format);
        zip.file('redacted-'+String(index+1).padStart(2,'0')+'.'+(format==='jpeg'?'jpg':format),out.blob);
      }
      const blob=await zip.generateAsync({type:'blob'});
      saveBlob(blob,'plainmile-redacted-images.zip');
      setMessage(t.success);
    }catch(error){setMessage(error.message);}finally{setSaving(false);}
  }
  const boxes = current?.masks || [];
  const selectedIds = new Set(boxes.map(b=>b.id));
  const fill = effect==='white' ? '#fff' :
    effect==='mosaic' || effect==='blur' ? 'rgba(70,85,104,.42)' : '#000';
  return <section className="redactor" data-redactor-ready={ready?'true':'false'} aria-label={lang==='zh'?'图片打码编辑器':'Image redaction editor'}>
    <div className="redactor-top">
      <label className="redactor-upload">{t.upload}
        <input data-testid="redact-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          multiple disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void selectImages(files);}}/>
      </label>
      <span className="redactor-hint">{t.hint}</span>
    </div>
    {!!items.length&&<>
      <div className="redactor-gallery" aria-label={t.files}>
        {items.map(item=><button type="button" key={item.id} className={'redactor-file '+(item.id===activeId?'chosen':'')}
          onClick={()=>{setActiveId(item.id);setDraft(null);}} disabled={busy}>
          <span>{localFileName(item.file)}</span>
          <small>{item.width}×{item.height} · {item.masks.length} {lang==='zh'?'处遮挡':'boxes'}</small>
        </button>)}
      </div>
      <div className="redactor-tools">
        <div className="redactor-main">
          <div className="redactor-actions">
            <button type="button" className={tool==='draw'?'chosen':''} onClick={()=>setTool('draw')}>{t.draw}</button>
            <button type="button" className={tool==='erase'?'chosen':''} onClick={()=>setTool('erase')}>{t.erase}</button>
            <button type="button" className="redactor-secondary" data-testid="redact-undo" onClick={undoCurrent} disabled={busy||!current?.undo?.length}>{t.undo}</button>
            <button type="button" className="redactor-secondary" data-testid="redact-redo" onClick={redoCurrent} disabled={busy||!current?.redo?.length}>{t.redo}</button>
            <button type="button" className="redactor-secondary" onClick={clearCurrent} disabled={busy||!boxes.length}>{t.clear}</button>
          </div>
          <p className="redactor-instruction">{tool==='draw'?t.drawNote:t.eraseNote}</p>
          <div className="redactor-stage-wrap">
            {current&&<div className="redactor-stage" style={{aspectRatio:current.width+'/'+current.height}}>
              <img src={current.url} alt={lang==='zh'?'待处理图片':'Image to redact'} draggable={false}/>
              <svg data-testid="redact-overlay" viewBox={'0 0 '+current.width+' '+current.height}
                preserveAspectRatio="none" aria-label={t.drawNote}
                onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
                onPointerCancel={()=>{dragStartRef.current=null;setDraft(null);}}>
                <rect x="0" y="0" width={current.width} height={current.height} fill="transparent"/>
                {boxes.map(box=><rect key={box.id} data-testid="redact-mark"
                  data-mark-id={box.id} x={box.x} y={box.y} width={box.w} height={box.h}
                  fill={fill} stroke="#f59e0b" strokeWidth={Math.max(2,current.width/800)}
                  onPointerDown={e=>{
                    if(tool!=='erase')return;
                    e.preventDefault(); e.stopPropagation(); removeBox(box.id);
                  }}/>)}
                {draft&&<rect data-testid="redact-draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h}
                  stroke="#e69d1b" strokeWidth={Math.max(2,current.width/800)} strokeDasharray="8 6" fill="rgba(0,0,0,.45)"
                  pointerEvents="none"/>}
              </svg>
            </div>}
          </div>
          <p className="redactor-instruction">{t.missed}</p>
        </div>
        <aside className="redactor-sidebar">
          <div className="redactor-control">
            <label htmlFor="ocr-language">{t.scanLanguage}</label>
            <select id="ocr-language" value={language} disabled={busy} onChange={e=>setLanguage(e.target.value)}>
              <option value="eng">English</option>
              <option value="mixed">简体中文 + English</option>
            </select>
            <div className="redactor-actions">
              <button type="button" data-testid="redact-ocr" disabled={busy} onClick={()=>void recognize(false)}>{t.detect}</button>
              {items.length>1&&<button type="button" data-testid="redact-ocr-all" className="redactor-secondary" disabled={busy}
                onClick={()=>void recognize(true)}>{t.detectAll}</button>}
              {scanning&&<button type="button" className="redactor-secondary" onClick={stopScan}>{t.cancel}</button>}
            </div>
            <p className="redactor-instruction">{t.help}</p>
          </div>
          <div className="redactor-control">
            <div className="redactor-heading"><strong>{t.detected}</strong><span>{current?.suggestions.length||0}</span></div>
            {current?.scanned && !current.suggestions.length&&<p>{t.nothing}</p>}
            <div className="redactor-actions">
              <button className="redactor-secondary" type="button" disabled={!current?.suggestions.length||busy} onClick={selectAll}>{t.all}</button>
              <button className="redactor-secondary" type="button" disabled={!current?.suggestions.length||busy} onClick={clearDetected}>{t.clearDetected}</button>
            </div>
            {!!current?.suggestions.length&&<div className="redactor-recognized">
              {current.suggestions.map(s=><label key={s.id}>
                <input type="checkbox" checked={selectedIds.has(s.id)} onChange={()=>toggleSuggestion(s)} disabled={busy}/>
                <span>{s.text}</span>
              </label>)}
              {current.suggestions.length>300&&<small>{lang==='zh'?'滚动查看全部识别结果':'Scroll to review all detected words'}</small>}
            </div>}
          </div>
          <div className="redactor-control">
            <label htmlFor="redact-effect">{t.effect}</label>
            <select id="redact-effect" data-testid="redact-effect" value={effect} disabled={busy} onChange={e=>setEffect(e.target.value)}>
              <option value="solid">{t.solid}</option>
              <option value="white">{t.white}</option>
              <option value="mosaic">{t.mosaic}</option>
              <option value="blur">{t.blur}</option>
            </select>
            <p className="redactor-warning">{t.warning}</p>
          </div>
          <div className="redactor-control">
            <div className="redactor-heading"><strong>{t.masks}</strong><span data-testid="redact-count">{boxes.length}</span></div>
            <div className="redactor-areas">
              {boxes.slice(-15).map((box,index)=><div key={box.id}>
                <span>{box.source==='ocr'?box.text:(lang==='zh'?'手动框':'Manual box')+' '+(index+1)}</span>
                <button type="button" className="redactor-secondary" disabled={busy} onClick={()=>removeBox(box.id)}>{t.remove}</button>
              </div>)}
            </div>
          </div>
          <div className="redactor-control">
            <label htmlFor="redact-format">{t.format}</label>
            <select id="redact-format" value={format} disabled={busy} onChange={e=>setFormat(e.target.value)}>
              <option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WebP</option>
            </select>
            <div className="redactor-actions">
              <button data-testid="redact-download" disabled={busy||!current?.masks.length} type="button" onClick={()=>void downloadCurrent()}>{t.download}</button>
              {items.length>1&&<button data-testid="redact-download-all" type="button" disabled={busy}
                onClick={()=>void downloadBatch()}>{t.zip}</button>}
            </div>
          </div>
        </aside>
      </div>
    </>}
    {!items.length&&<p className="redactor-empty">{t.noImage}</p>}
    <div className="redactor-status">
      <p role="status" data-testid="redact-status">{message||t.first}</p>
      <p>{t.local}</p>
    </div>
  </section>;
}
