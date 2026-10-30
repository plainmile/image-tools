import {useEffect,useRef,useState} from 'react';
import {clipboardImageFiles} from '../lib/clipboard.mjs';
import {
  MAX_FILES, MAX_BATCH_BYTES, MAX_BATCH_OUTPUT_PIXELS,
  inspectImage, assertDimensions, processImage, inputImageFormat,
  addBatchOutputBytes, exportFilename, formatBytes, mergeSelectedImages
} from '../lib/image-core.mjs';

const language = {
  en: {
    upload:'Select images',addMore:'Add more images',appendHint:'New images are added to this batch. Clear to start over.',alreadyAdded:'These images were already selected; nothing changed.',duplicateSkipped:'Duplicate selections were skipped.',hint:'JPG, PNG, WebP · 40 MB per image, 30 at once',
    drop:'Drop images here or choose files.',choose:'Choose images to get started.',
    reading:'Checking files…',selected:'Ready to convert.',format:'Convert to',
    quality:'Quality',qualityHint:'Only affects JPG and WebP. PNG is lossless.',
    convert:'Convert images',working:'Converting',packaging:'Creating ZIP…',
    done:'Converted files are ready.',download:'Download image',zip:'Download ZIP',individual:'Download converted files separately',
    clear:'Clear',cancel:'Stop after current image',stopping:'Stopping after the current image…',
    cancelled:'Conversion stopped. No output was saved.',partial:'Conversion stopped. Finished images are ready to download.',
    max:'Select up to 30 images and 160 MB in total.',
    output:'Converted output',preview:'Preview',previewSource:'Selected original (not the converted result).',empty:'Your selected image appears here.',
    local:'All image processing takes place in this browser. No files are uploaded.',
    failed:'Skipped files',showFiles:'Files selected',check:'Please check the file(s) below.',
    jpeg:'JPG has no transparency; transparent areas are exported white.',
    noOutput:'No images could be converted.',
    note:'Image dimensions stay unchanged; metadata such as EXIF is not preserved. Maximum 32 megapixels per output.',
    progress:'Processed',abort:'You can stop after the current file finishes.',
    paste:'You can paste a screenshot (Ctrl+V / ⌘V).',kept:' Previous images and download are kept.',
  },
  zh: {
    upload:'选择图片',addMore:'继续添加图片',appendHint:'新选图片会加入当前批次；清空可重新开始。',alreadyAdded:'这些图片已经选过，当前批次保持不变。',duplicateSkipped:'已跳过重复选择的图片。',hint:'支持 JPG、PNG、WebP · 单张 40 MB，最多 30 张',
    drop:'可拖入图片，也可直接选择文件。',choose:'请选择需要转换的图片。',
    reading:'正在检查图片…',selected:'图片已准备好。',format:'转换为',
    quality:'画质',qualityHint:'只影响 JPG 和 WebP，PNG 为无损格式。',
    convert:'开始转换',working:'正在转换',packaging:'正在生成 ZIP…',
    done:'转换完成，可以下载。',download:'下载图片',zip:'下载 ZIP 压缩包',individual:'逐张下载转换结果',
    clear:'清空',cancel:'处理完当前图片后停止',stopping:'当前图片处理完后停止…',
    cancelled:'已停止转换，没有生成下载文件。',partial:'已停止转换，已完成的图片可以下载。',
    max:'最多选择 30 张图片，文件总大小不超过 160 MB。',
    output:'转换结果',preview:'预览',previewSource:'当前展示原图预览（不是转换后文件）。',empty:'选择图片后在这里查看。',
    local:'图片仅在当前浏览器中处理，不上传文件。',
    failed:'跳过的图片',showFiles:'已选择的图片',check:'请查看下方文件错误。',
    jpeg:'JPG 不支持透明，原图透明区域会变成白色。',
    noOutput:'没有可以转换的图片。',
    note:'转换时保留原始像素宽高，但不保留 EXIF 等元数据；单张输出最多 3200 万像素。',
    progress:'已处理',abort:'可以在当前图片完成后停止。',
    paste:'也可以直接粘贴截图（Ctrl+V / ⌘V）。',kept:' 已保留之前的图片和下载结果。',
  }
};

function localizedError(error, lang) {
  const message=String(error?.message||error||'Unknown error');
  if(lang!=='zh')return message;
  if(message.includes('Maximum 30 files per batch')||message.includes('Total selected files must be'))return '最多选择 30 张图片，总大小不超过 160 MB（包括已选的）。';
  if(message.includes('Image contents do not match'))return '图片内容与 JPG、PNG 或 WebP 文件格式不一致，请选择原始图片。';
  if(message.includes('Could not verify duplicate image contents'))return '无法检查重复文件的内容，原批次保持不变，请重新选择。';
  if(message.includes('Animated PNG/WebP'))return '暂不支持动画 PNG/WebP：转换会丢失动画帧。';
  if(message.includes('32-megapixel'))return '原图超过单张输出 3200 万像素限制，请先缩小图片尺寸。';
  if(message.includes('128 MB'))return 'ZIP 输出超过 128 MB，请减少图片数量或使用 JPG/WebP。';
  if(message.includes('120-megapixel'))return '本批输出超过 1.2 亿像素限制，请分批转换。';
  if(message.includes('40 MB'))return '单张文件不能超过 40 MB。';
  if(message.includes('Supported images:'))return '仅支持 JPG、PNG 和 WebP 图片，不支持 GIF、SVG 或 HEIC。';
  if(message.includes('80 megapixels'))return '原图超过 8000 万像素，请先缩小图片。';
  if(message.includes('file is empty'))return '所选文件为空，请重新选择图片。';
  if(message.includes('PNG metadata'))return '图片包含过多 PNG 元数据，无法安全确认是否为动画。';
  if(message.includes('Image encoding failed'))return '图片编码失败，请尝试降低尺寸或更换输出格式。';
  if(message.includes('cannot encode the selected output format'))return '当前浏览器不支持该输出格式，请尝试 JPG 或 PNG。';
  if(message.includes('decoded'))return '图片损坏或无法解码。';
  return '图片处理失败，请检查格式或尺寸后重试。';
}

export default function Converter({lang='en'}) {
  const t=language[lang];
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[inspecting,setInspecting]=useState(false);
  const [files,setFiles]=useState([]),[rejected,setRejected]=useState([]);
  const [format,setFormat]=useState('jpeg'),[quality,setQuality]=useState(90);
  const [preview,setPreview]=useState(null),[previewIndex,setPreviewIndex]=useState(0),[result,setResult]=useState(null);
  const [showOriginal,setShowOriginal]=useState(false);
  const [status,setStatus]=useState(''),[phase,setPhase]=useState(''),[processed,setProcessed]=useState(0);
  const [failedAttempt,setFailedAttempt]=useState([]);
  const cancelled=useRef(false),sequence=useRef(0);
  useEffect(()=>{setReady(true);return()=>{sequence.current+=1;};},[]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  useEffect(()=>()=>{
    if(result?.url)URL.revokeObjectURL(result.url);
    result?.succeeded?.forEach(item=>{if(item.downloadUrl)URL.revokeObjectURL(item.downloadUrl);});
  },[result]);
  useEffect(()=>{setResult(null);setFailedAttempt([]);setStatus(prev=>prev.startsWith(t.done)||prev.startsWith(t.partial)?t.selected:prev);},[format,quality]);

  async function choose(chosen) {
    if(busy||inspecting||!chosen.length)return;
    if(chosen.length>MAX_FILES||chosen.reduce((sum,file)=>sum+file.size,0)>MAX_BATCH_BYTES){
      setStatus(t.max+(files.length?t.kept:''));return;
    }
    const request=++sequence.current;
    setInspecting(true);setStatus(t.reading);
    try{
      const valid=[],invalid=[];
      for(const file of chosen){
        try{
          const dim=await inspectImage(file);
          assertDimensions(dim.width,dim.height);
          valid.push({file,...dim});
        }catch(error){
          invalid.push({name:file.name||'image',reason:localizedError(error,lang)});
        }
      }
      if(request!==sequence.current)return;
      setRejected(invalid);
      if(!valid.length){
        setStatus(t.noOutput+' '+t.check+(files.length?t.kept:''));
        return;
      }
      // Appending must never discard previous files or a usable download if
      // the expanded batch exceeds the count/byte limits.
      const merged=await mergeSelectedImages(files,valid);
      if(request!==sequence.current)return;
      if(!merged.added){
        setStatus(t.alreadyAdded+(invalid.length?' '+t.check:''));
        return;
      }
      setFiles(merged.items);setResult(null);setFailedAttempt([]);
      if(!files.length){setPreviewIndex(0);setPreview(URL.createObjectURL(merged.items[0].file));}
      setProcessed(0);
      setStatus(t.selected+(invalid.length?' '+t.check:'')+(merged.duplicates?' '+t.duplicateSkipped:''));
    }catch(error){
      if(request===sequence.current)setStatus(localizedError(error,lang)+(files.length?t.kept:''));
    }finally{
      if(request===sequence.current)setInspecting(false);
    }
  }
  useEffect(()=>{
    const handle=(event)=>{
      if(busy||inspecting)return;
      const images=clipboardImageFiles(event);
      if(!images.length)return;
      event.preventDefault();
      void choose(images);
    };
    document.addEventListener('paste',handle);
    return()=>document.removeEventListener('paste',handle);
  },[busy,inspecting,files,lang]);
  function removeFile(index){
    if(busy||inspecting)return;
    const remaining=files.filter((_,i)=>i!==index);
    sequence.current+=1;
    const nextPreviewIndex=!remaining.length?0:index===previewIndex?Math.min(index,remaining.length-1):index<previewIndex?previewIndex-1:previewIndex;
    setFiles(remaining);
    setPreviewIndex(nextPreviewIndex);
    setPreview(remaining.length?URL.createObjectURL(remaining[nextPreviewIndex].file):null);
    setResult(null);setFailedAttempt([]);setProcessed(0);
    if(!remaining.length)setRejected([]);
    setStatus(remaining.length?t.selected:t.choose);
  }
  function showPreview(index){
    if(busy||inspecting||!files[index]||previewIndex===index)return;
    setPreviewIndex(index);
    setPreview(URL.createObjectURL(files[index].file));
  }
  function reset(){
    if(busy||inspecting)return;
    sequence.current+=1;setFiles([]);setRejected([]);setResult(null);setFailedAttempt([]);
    setPreview(null);setPreviewIndex(0);setStatus('');setProcessed(0);
  }
  async function convert(event){
    event.preventDefault();
    if(!files.length||busy||inspecting)return;
    cancelled.current=false;setShowOriginal(false);setBusy(true);setFailedAttempt([]);
    setPhase('processing');setProcessed(0);setStatus(t.working+'…');
    try{
      let totalPixels=0,totalBytes=0,processedCount=0;
      const succeeded=[],failed=[];
      for(const [index,item] of files.entries()){
        // Keep successfully converted files when the user stops the batch.
        if(cancelled.current)break;
        try{
          const area=item.width*item.height;
          if(totalPixels+area>MAX_BATCH_OUTPUT_PIXELS)
            throw new Error('The batch exceeds the 120-megapixel output limit. Split it into smaller batches.');
          const encoded=await processImage(item.file,{
            mode:'contain',width:item.width,height:item.height,
            format,quality:Number(quality)/100,targetKb:0,allowDownscale:false
          });
          totalBytes=addBatchOutputBytes(totalBytes,encoded.bytes);
          totalPixels+=area;
          succeeded.push({...encoded,sourceBytes:item.file.size,name:exportFilename(item.file.name,format,'converted')});
        }catch(error){
          failed.push({name:item.file.name,reason:localizedError(error,lang)});
        }
        processedCount=index+1;
        setProcessed(processedCount);
      }
      const stoppedEarly=cancelled.current&&processedCount<files.length;
      if(!succeeded.length){
        setFailedAttempt(failed);
        setStatus((stoppedEarly?t.cancelled:t.noOutput+' '+t.check)+(result?.url?t.kept:''));return;
      }
      let blob,name;
      // Download the only successful image directly, even if the original
      // selection contained invalid files or some conversions failed.
      const isZip=succeeded.length>1;
      if(!isZip){
        blob=succeeded[0].blob;name=succeeded[0].name;
      }else{
        setPhase('zip');setStatus(t.packaging);
        const {default: JSZip}=await import('jszip');
        const zip=new JSZip();
        succeeded.forEach((item,i)=>zip.file(String(i+1).padStart(2,'0')+'-'+item.name,item.blob));
        blob=await zip.generateAsync({type:'blob',compression:'STORE'});
        name='plainmile-converted-images.zip';
      }
      setFailedAttempt([]);
      const downloadableSucceeded=isZip?succeeded.map(item=>({...item,downloadUrl:URL.createObjectURL(item.blob)})):succeeded;
      setResult({url:URL.createObjectURL(blob),blob,name,failed,succeeded:downloadableSucceeded,isZip});
      setStatus(stoppedEarly
        ? t.partial+' '+t.progress+' '+processedCount+' / '+files.length+(failed.length?' '+t.check:'')
        : t.done+(failed.length?' '+t.check:''));
    }catch(error){
      setStatus(localizedError(error,lang)+(result?.url?t.kept:''));
    }finally{setBusy(false);setPhase('');}
  }
  const nonJpeg=files.some(item=>inputImageFormat(item.file)!=='jpeg');
  return <section className="editor" data-converter-ready={ready?'true':'false'}>
    <div className="editor-workspace">
      <form className="editor-controls" onSubmit={convert}>
        <div className="control-section">
          <h2 className="panel-title">{t.upload}</h2>
          <label className="upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void choose(Array.from(e.dataTransfer?.files||[]));}}>
            <strong>{files.length?t.addMore:t.drop}</strong>
            <input type="file" data-testid="convert-upload" multiple
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              disabled={!ready||busy||inspecting}
              onChange={e=>{const selected=Array.from(e.target.files||[]);e.target.value='';void choose(selected);}}/>
            <span>{t.hint} · {t.paste}{files.length?' '+t.appendHint:''}</span>
          </label>
          {files.length>0&&<div className="file-summary">
            <strong>{t.showFiles}: {files.length}</strong>
            <ul className={files.length>1?'selected-files':undefined}>{(files.length>1?files:files.slice(0,8)).map((item,i)=><li key={i} className={files.length>1?'selected-file-entry':undefined}>
              <span>{item.file.name} · {item.width}×{item.height} · {formatBytes(item.file.size)}</span>
              {files.length>1&&<span className="selected-file-actions">
                <button type="button" className="secondary selected-file-preview" data-testid="convert-preview-file"
                  aria-label={(lang==='zh'?'预览 ':'Preview ')+item.file.name} aria-pressed={previewIndex===i}
                  disabled={busy||inspecting} onClick={()=>showPreview(i)}>{lang==='zh'?'预览':'Preview'}</button>
                <button type="button" className="secondary selected-file-remove" data-testid="convert-remove-file"
                  aria-label={(lang==='zh'?'移除 ':'Remove ')+item.file.name} disabled={busy||inspecting}
                  onClick={()=>removeFile(i)}>{lang==='zh'?'移除':'Remove'}</button>
              </span>}
            </li>)}</ul>
          </div>}
          {rejected.length>0&&<details open className="batch-errors" data-testid="convert-failed-input">
            <summary>{t.failed} ({rejected.length})</summary>
            <ul>{rejected.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.reason}</span></li>)}</ul>
          </details>}
        </div>
        <div className="control-section">
          <h2 className="panel-title">{lang==='zh'?'输出设置':'Output settings'}</h2>
          <div className="field-grid">
            <label className="wide">{t.format}
              <select data-testid="convert-format" value={format} disabled={busy||inspecting} onChange={e=>setFormat(e.target.value)}>
                <option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option>
              </select>
            </label>
            {format!=='png'&&<label className="wide">{t.quality}: {quality}%
              <input data-testid="convert-quality" type="range" min="5" max="95" value={quality} disabled={busy||inspecting} onChange={e=>setQuality(e.target.value)}/>
              <small>{t.qualityHint}</small>
            </label>}
            {format==='jpeg'&&nonJpeg&&<p className="mode-explain wide" data-testid="convert-alpha-warning">{t.jpeg}</p>}
          </div>
          <p className="notice">{t.note}</p>
        </div>
        <div className="form-actions">
          <button data-testid="convert-process" type="submit" disabled={!ready||!files.length||busy||inspecting}>{t.convert}</button>
          {busy&&phase==='processing'&&<button className="secondary" data-testid="convert-cancel" type="button"
            onClick={()=>{cancelled.current=true;setStatus(t.stopping);}}>{t.cancel}</button>}
          <button className="secondary" type="button" disabled={busy||inspecting} onClick={reset}>{t.clear}</button>
        </div>
        {busy&&<div className="batch-progress" data-testid="convert-progress">
          <label>{phase==='zip'?t.packaging:t.progress+' '+processed+' / '+files.length}</label>
          <progress value={processed} max={Math.max(1,files.length)}/>
          {phase==='processing'&&<small>{t.abort}</small>}
        </div>}
      </form>
      <aside className="editor-preview" aria-label={t.preview}>
        <h2 className="panel-title">{t.preview}</h2>
        <div className="preview-frame">
          {result?.url&&!result.isZip&&files.length===1?<img data-testid="convert-comparison-image" src={showOriginal&&preview?preview:result.url} alt={showOriginal?(lang==='zh'?'原始图片':'Original image'):t.output}/>:
            preview?<img key={preview} src={preview} alt={t.preview}/>:
            <p className="preview-empty">{t.empty}</p>}
        </div>
        {result?.url&&!result.isZip&&files.length===1&&preview&&<div className="preview-compare-controls">
          <button type="button" className="secondary" data-testid="convert-preview-toggle" aria-pressed={showOriginal}
            onClick={()=>setShowOriginal(value=>!value)}>{showOriginal?(lang==='zh'?'查看转换结果':'View result'):(lang==='zh'?'查看原图':'View original')}</button>
          <span role="status">{showOriginal?(lang==='zh'?'正在查看原图':'Showing original'):(lang==='zh'?'正在查看转换结果':'Showing result')}</span>
        </div>}
        {files.length>1&&<p className="preview-caption" data-testid="convert-preview-caption"><strong>{files[previewIndex]?.file.name}</strong> · {t.previewSource}</p>}
        {result?.url&&<div className="result">
          <strong>{t.output}</strong>
          <p data-testid="convert-result-meta">{result.succeeded.length} {lang==='zh'?'张':'image(s)'} · {formatBytes(result.blob.size)} · {result.blob.size} {lang==='zh'?'字节':'bytes'}</p>
           <p data-testid="convert-size-comparison">{result.failed.length?(lang==='zh'?'成功导出图片的原文件':'Original (exported images)'):(lang==='zh'?'原文件合计':'Original total')}: {formatBytes(result.succeeded.reduce((sum,item)=>sum+item.sourceBytes,0))} · {result.isZip?(lang==='zh'?'下载 ZIP 大小':'Download ZIP size'):(lang==='zh'?'转换结果':'Converted output')}: {formatBytes(result.blob.size)}</p>
          {result.isZip&&<details className="batch-export-details" data-testid="convert-export-details">
            <summary>{t.individual} ({result.succeeded.length})</summary>
            <ul>{result.succeeded.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.width}×{item.height} · {item.format.toUpperCase()} · {formatBytes(item.bytes)}</span><a className="batch-file-download" data-testid="convert-download-item" download={item.name} href={item.downloadUrl}>{t.download}</a></li>)}</ul>
          </details>}
          {result.failed.length>0&&!failedAttempt.length&&<details open className="batch-errors" data-testid="convert-failed-output">
            <summary>{t.failed} ({result.failed.length})</summary>
            <ul>{result.failed.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.reason}</span></li>)}</ul>
          </details>}
          <a data-testid="convert-download" className="download" download={result.name} href={result.url}>
            {result.isZip?t.zip:t.download} · {formatBytes(result.blob.size)}
          </a>
        </div>}
        {failedAttempt.length>0&&<details open className="batch-errors" data-testid="convert-failed-output">
          <summary>{t.failed} ({failedAttempt.length})</summary>
          <ul>{failedAttempt.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.reason}</span></li>)}</ul>
        </details>}
      </aside>
    </div>
    <div className="editor-footer"><p role="status" data-testid="convert-status">{status||t.choose}</p><span>{t.local}</span></div>
  </section>;
}
