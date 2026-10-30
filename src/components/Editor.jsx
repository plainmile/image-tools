import React,{useEffect,useRef,useState} from 'react';
import {clipboardImageFiles} from '../lib/clipboard.mjs';
import { MAX_FILES,MAX_BATCH_BYTES,MAX_AXIS,MAX_OUTPUT_PIXELS,assertDimensions,fitWithin,validateBatchPixels,addBatchOutputBytes,inspectImage,processImage,makePassportSheet,fitLockedAspectDimensions,drawRect,inputImageFormat,exportFilename,formatBytes,mergeSelectedImages } from '../lib/image-core.mjs';

const dict = {
  en: {
    upload:'Choose image', addMore:'Add more images', appendHint:'New images are added to this batch. Clear to start over.', alreadyAdded:'These images were already selected; nothing changed.', duplicateSkipped:'Duplicate selections were skipped.', hint:'JPG, PNG or WebP · up to 40 MB each',
    width:'Width (px)',height:'Height (px)',keep:'Sync width and height',
    mode:'Resize method',within:'Keep proportions (recommended)',contain:'Keep whole image, add space',cover:'Crop edges to fit',format:'Format',originalFormat:'Same as original',
    target:'Maximum size (KB; 0 = no limit)',targetHint:'100 KB = 100,000 bytes. Actual output bytes are checked.',quality:'Quality',
    advancedResize:'Need exact width and height? More options',activeResize:'Current method',modeWithinHelp:'Default: keep the original proportions without cropping or borders. Width and height are maximums, not exact output dimensions.',modeContainHelp:'Keep everything and use the exact width and height you entered. Empty space may appear around the picture.',modeCoverHelp:'Fill the exact width and height you entered without empty borders. Some edges of the picture may be cut off.',
    downscale:'Allow smaller dimensions if needed',exactSizeNotice:'Exact width and height will be preserved. If the KB limit cannot be met, processing stops instead of changing the dimensions.',
    run:'Resize image',runCompress:'Compress image',runSignature:'Resize signature',runBatch:'Resize images',working:'Processing…',download:'Download file',
    done:'Ready to download',error:'Could not process image',
    files:'Files',settings:'Settings',preview:'Preview',original:'Original',
    reset:'Clear',zoom:'Crop zoom',x:'Horizontal position',y:'Vertical position',
    sheet:'Make print sheet',notice:'Six identical copies of one cropped 2×2-inch photo on a 4×6-inch sheet. Check the issuing authority’s requirements before applying.',
    choose:'Choose a file to start.',pending:'File selected.',local:'Processed in this browser tab.',
    batch:'Resize up to 30 images. By default, images keep their proportions without white borders, and smaller images are not enlarged. Download one image directly, or multiple as a ZIP.',empty:'The selected image will appear here.',
    single:'Choose one image for this tool.',count:'Output files',
    loading:'Reading image…',loadingPreview:'Rendering image preview…',previewFailed:'Preview unavailable. Check the dimensions or choose another image.',limit:'Total selected files must be 160 MB or less.',
    drop:'You can also drop images here.',cropPreview:'Crop preview; the downloaded sheet has six copies.',
    estimate:'Planned dimensions (before optional KB downscaling)',noPadding:'No borders, no cropping, no upscaling',mayPad:'Exact size; may add padding',mayCrop:'Exact size; may crop edges',zipDownload:'Download ZIP',formatWarning:'JPEG cannot keep transparency; transparent PNG/WebP pixels become white.',pngSizeWarning:'PNG uses lossless encoding. For very small KB limits, choose a supported JPG/WebP format or enable smaller dimensions.',qualityNote:'Quality changes JPEG/WebP only.',batchPreview:'Original preview with the current resize settings, not the final encoded bytes. Select another file to check it before downloading.',optionalSize:'File-size and quality (optional)',batchItems:'View each exported image',batchPlan:'Planned sizes (before optional KB downscaling)',skippedInputs:'Skipped invalid files',skippedOutputs:'Not exported',attemptErrors:'Failed in this attempt',exported:'Exported',failedCount:'Failed',notProcessed:'Not processed after stopping',someSkipped:'Some files were skipped; review details below.',noExport:'No files could be exported.',processed:'Processed',cancel:'Stop after current image',stopping:'Stopping after the current image…',cancelled:'Batch stopped. No output was saved.',partial:'Batch stopped. Finished images are ready to download.',packaging:'Creating ZIP…',paste:'Paste a screenshot with Ctrl+V / ⌘V.',kept:' Your previous image and download are still available.',aspectLimited:'To keep the original proportions within browser limits, both dimensions were reduced together.'
  },
  zh: {
    upload:'选择图片',addMore:'继续添加图片',appendHint:'新选图片会加入当前批次；清空可重新开始。',alreadyAdded:'这些图片已经选过，当前批次保持不变。',duplicateSkipped:'已跳过重复选择的图片。',hint:'支持 JPG、PNG、WebP，单张不超过 40 MB',
    width:'宽度（像素）',height:'高度（像素）',keep:'同步修改宽高',
    mode:'缩放方式',within:'按比例缩放（推荐）',contain:'保留整张图，空白补齐',cover:'裁剪边缘，填满尺寸',format:'输出格式',originalFormat:'保持原始格式',
    target:'最大大小（KB；0 表示不限）',targetHint:'100 KB 按 100,000 字节计算，并检查实际输出字节数。',quality:'画质',
    advancedResize:'需要固定宽高？展开其他方式',activeResize:'当前方式',modeWithinHelp:'默认按比例缩放：不裁剪、不加白边，宽高是上限，实际尺寸可能更小。',modeContainHelp:'完整保留图片，并补齐到填写的宽高。四周可能出现空白（PNG 可能是透明的）。',modeCoverHelp:'裁成填写的宽高，不会有白边，但图片边缘可能被裁掉。',
    downscale:'必要时允许减小像素',exactSizeNotice:'已选择固定宽高：即使设置了 KB 上限，也不会偷偷缩小图片。无法同时满足时会提示失败。',
    run:'调整尺寸',runCompress:'压缩图片',runSignature:'调整签名',runBatch:'批量调整',working:'正在处理…',download:'下载文件',
    done:'可以下载',error:'图片处理失败',
    files:'文件',settings:'参数设置',preview:'预览',original:'原图',
    reset:'清空',zoom:'裁剪缩放',x:'水平位置',y:'垂直位置',
    sheet:'生成打印排版',notice:'把同一张裁剪后的 2×2 英寸照片重复六份，排版在 4×6 英寸相纸上。用于证件申请前，请核对相关机构要求。',
    choose:'请选择图片。',pending:'已选择图片。',local:'图片仅在当前浏览器标签页处理。',
    batch:'一次最多处理 30 张图片。默认保持每张图片比例、不留白，也不会放大小图。成功导出一张时直接下载，多张时打包 ZIP。',empty:'选择图片后在这里查看预览。',
    single:'该工具一次只能处理一张图片。',count:'输出文件',
    loading:'正在读取图片…',loadingPreview:'正在生成图片预览…',previewFailed:'无法生成预览，请检查尺寸或换一张图片。',limit:'所选文件总大小不能超过 160 MB。',
    drop:'也可以把图片拖到这里。',cropPreview:'裁剪预览；下载的打印排版包含六张照片。',
    estimate:'预计输出像素（不含可选的 KB 缩小）',noPadding:'按原图比例，无白边、不裁剪、不放大小图',mayPad:'固定尺寸，可能添加留白',mayCrop:'固定尺寸，可能裁掉边缘',zipDownload:'下载 ZIP 压缩包',formatWarning:'JPG 不支持透明背景。透明 PNG/WebP 转 JPG 时，透明区域会变为白色。',pngSizeWarning:'PNG 为无损编码，较小的 KB 限制可能无法达到；可按接收要求改用 JPG/WebP，或允许缩小尺寸。',qualityNote:'画质只影响 JPG/WebP。',batchPreview:'按当前设置预览所选原图（不是最终编码文件）；可切换图片检查，最终结果请下载核对。',optionalSize:'文件大小与画质（可选）',batchItems:'逐张查看输出结果',batchPlan:'预计各图片输出尺寸（不含可选的 KB 缩小）',skippedInputs:'已跳过无效图片',skippedOutputs:'未能导出的图片',attemptErrors:'本次导出失败的图片',exported:'成功导出',failedCount:'失败',notProcessed:'停止后未处理',someSkipped:'部分文件已跳过，请查看下方原因。',noExport:'没有可以导出的图片。',processed:'已处理',cancel:'当前图片处理完后停止',stopping:'当前图片处理完后停止…',cancelled:'已停止批量处理，没有生成下载文件。',partial:'已停止批量处理，已完成的图片可以下载。',packaging:'正在生成 ZIP…',paste:'也可以用 Ctrl+V / ⌘V 粘贴截图。',kept:' 已保留之前的图片和下载结果。',aspectLimited:'为保持原图比例并符合浏览器尺寸上限，已同时缩小宽度和高度。'
  }
};
function localizedImageError(error,lang) {
  const message=String(error?.message||error||'');
  if(lang!=='zh')return message;
  const translations=[
    ['Image contents do not match','图片内容与 JPG、PNG 或 WebP 文件格式不一致，请选择原始图片。'],
    ['Could not verify duplicate image contents','无法检查重复文件的内容，原批次保持不变，请重新选择。'],
    ['Maximum 30 files per batch','每批最多选择 30 张图片，包括已选图片。'],
    ['Total selected files must be','已选图片总大小不能超过 160 MB。'],
    ['Animated PNG/WebP','暂不支持动画 PNG/WebP，避免导出时遗漏动画帧。'],
    ['cannot be decoded','图片无法解码，可能已损坏或格式不受支持。'],
    ['80 megapixels','原图超过 8000 万像素，请先缩小图片。'],
    ['file is empty','所选文件为空，请重新选择图片。'],
    ['40 MB','单张图片不能超过 40 MB。'],
    ['Supported images:','仅支持 JPG、PNG 和 WebP，不支持 GIF、SVG 或 HEIC。'],
    ['32-megapixel','输出超过 3200 万像素，请减小尺寸。'],
    ['120-megapixel','本批图片的输出总像素超过 1.2 亿，请减小尺寸或分批处理。'],
    ['128 MB','输出文件累计超过 128 MB，请减少图片数量或输出尺寸。'],
    ['whole number','宽高必须填写 1 到 10000 之间的整数。'],
    ['Invalid source dimensions','原图像素尺寸无效，请更换图片。'],
    ['Target size must','文件大小限制必须在 0 到 20000 KB 之间。'],
    ['Could not reach the file-size target','无法达到指定 KB 限制，请提高上限、更换格式，或允许缩小像素。'],
    ['Actual file size exceeds','处理后的文件仍超过指定 KB 限制，请调整设置。'],
    ['cannot encode the selected output format','当前浏览器不支持选择的导出格式。'],
    ['Image encoding failed','图片编码失败，请尝试更换输出格式或减小尺寸。'],
    ['Invalid image dimensions','图片像素尺寸无效，请检查输入。']
  ];
  const translation=translations.find(([match])=>message.includes(match));
  return translation?translation[1]:'图片处理失败，请检查格式、尺寸或文件完整性后重试。';
}

export default function Editor({lang='en',tool='resize'}) {
  const t=dict[lang],sheet=tool==='passport-photo-print',batch=tool==='bulk-image-resizer';
  const [files,setFiles]=useState([]),[width,setWidth]=useState(sheet?600:800),[height,setHeight]=useState(sheet?600:800);
  const [keep,setKeep]=useState(false),[mode,setMode]=useState(sheet?'cover':'within');
  const [format,setFormat]=useState(tool==='compress-image-to-size'?'jpeg':'original'),[target,setTarget]=useState(tool==='compress-image-to-size'?100:0);
  const [quality,setQuality]=useState(90),[downscale,setDownscale]=useState(tool==='compress-image-to-size');
  const [zoom,setZoom]=useState(100),[cropX,setCropX]=useState(0),[cropY,setCropY]=useState(0);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[output,setOutput]=useState(null);
  const [rejected,setRejected]=useState([]),[failedAttempt,setFailedAttempt]=useState([]);
  const [progress,setProgress]=useState(0),[phase,setPhase]=useState('');
  const cancelRequested=useRef(false);
  const [preview,setPreview]=useState(null),[previewIndex,setPreviewIndex]=useState(0),[ready,setReady]=useState(false);
  const previewEntry=files[previewIndex]||files[0]||null;
  // A rendered preview belongs to one file AND one set of settings.
  // Reusing a canvas before a new image has decoded can show old pixels.
  const [previewState,setPreviewState]=useState({key:null,state:'loading'});
  const previewKey=preview?[preview,width,height,mode,format,zoom,cropX,cropY].join('|'):null;
  const previewReady=previewState.key===previewKey&&previewState.state==='ready';
  const previewFailed=previewState.key===previewKey&&previewState.state==='error';
  const [inspecting,setInspecting]=useState(false);
  const canvasRef=useRef(null),selectionId=useRef(0);
  useEffect(()=>{setReady(true);return ()=>{selectionId.current+=1;};},[]);
  useEffect(()=>{setOutput(null);setFailedAttempt([]);setStatus(prev=>prev.startsWith(t.done)||prev.startsWith(t.partial)?t.pending:prev);},[width,height,mode,format,target,quality,downscale,zoom,cropX,cropY]);
  useEffect(()=>{
    if (!preview || !canvasRef.current || (output&&!batch)) return;
    let active=true;
    const fail=()=>{
      if(!active)return;
      setPreviewState({key:previewKey,state:'error'});
      setStatus(t.previewFailed);
    };
    const image=new Image();
    image.onload=()=>{
      if(!active || !canvasRef.current)return;
      try{
        const canvas=canvasRef.current;
        let requestedW=sheet?600:Number(width),requestedH=sheet?600:Number(height);
        if(!Number.isFinite(requestedW)||!Number.isFinite(requestedH)||requestedW<=0||requestedH<=0)throw new Error('Invalid preview dimensions');
        if(mode==='within'){
          const fitted=fitWithin(image.naturalWidth,image.naturalHeight,requestedW,requestedH);
          requestedW=fitted.width; requestedH=fitted.height;
        }
        const scale=Math.min(1,440/requestedW,440/requestedH);
        const w=Math.max(1,Math.round(requestedW*scale)),h=Math.max(1,Math.round(requestedH*scale));
        canvas.width=w;canvas.height=h;
        const context=canvas.getContext('2d');
        if(!context)throw new Error('Canvas unavailable');
        context.clearRect(0,0,w,h);
        if(format==='jpeg'||sheet||(format==='original'&&previewEntry&&inputImageFormat(previewEntry.file)==='jpeg')){context.fillStyle='#fff';context.fillRect(0,0,w,h);}
        const region=drawRect(image.naturalWidth,image.naturalHeight,w,h,
          sheet?'cover':mode,Number(zoom)/100,Number(cropX)/100,Number(cropY)/100);
        context.imageSmoothingEnabled=true;
        context.imageSmoothingQuality='high';
        context.drawImage(image,region.sx,region.sy,region.sw,region.sh,region.dx,region.dy,region.dw,region.dh);
        setPreviewState({key:previewKey,state:'ready'});
        setStatus(previous=>previous===t.previewFailed?t.pending:previous);
      }catch{fail();}
    };
    image.onerror=fail;
    image.src=preview;
    return ()=>{active=false;image.onload=null;image.onerror=null;};
  },[preview,output,width,height,mode,format,zoom,cropX,cropY,sheet,batch,previewEntry,files]);
  useEffect(()=>()=>{if(output?.url)URL.revokeObjectURL(output.url);},[output]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  async function selectFiles(chosen){
    if(busy||inspecting||!chosen.length)return;
    if(chosen.length>MAX_FILES){
      setStatus((lang==='zh'?'最多选择 30 张图片。':'Maximum 30 files.')+(files.length?t.kept:''));return;
    }
    if(!batch&&chosen.length>1){setStatus(t.single+(files.length?t.kept:''));return;}
    if(chosen.reduce((sum,f)=>sum+f.size,0)>MAX_BATCH_BYTES){
      setStatus(t.limit+(files.length?t.kept:''));return;
    }
    const id=++selectionId.current;
    setInspecting(true);setStatus(t.loading);
    try{
      const valid=[],invalid=[];
      for(const file of chosen){
        try{
          const dimensions=await inspectImage(file);
          valid.push({file,...dimensions});
        }catch(err){
          if(!batch)throw err;
          invalid.push({name:file.name||'image',reason:localizedImageError(err,lang)||t.error});
        }
      }
      if(id!==selectionId.current)return;
      setRejected(invalid);
      if(!valid.length){
        setStatus((invalid[0]?.reason||t.choose)+(files.length?t.kept:''));
        return;
      }
      // Commit only after the entire new batch passes limits. File picker and
      // drop append rather than silently replacing earlier selected images.
      const merged=batch?await mergeSelectedImages(files,valid):{items:valid,added:valid.length,duplicates:0};
      if(id!==selectionId.current)return;
      if(!merged.added){
        setStatus(t.alreadyAdded+(invalid.length?' '+t.someSkipped:''));
        return;
      }
      setFiles(merged.items);setOutput(null);setFailedAttempt([]);
      if(!batch||!files.length){setPreviewIndex(0);setPreview(URL.createObjectURL(merged.items[0].file));}
      if(!sheet&&!batch&&valid.length===1){
        const {width:w,height:h}=valid[0];
        const scale=Math.min(1,MAX_AXIS/w,MAX_AXIS/h,Math.sqrt(MAX_OUTPUT_PIXELS/(w*h)));
        setWidth(Math.max(1,Math.floor(w*scale)));
        setHeight(Math.max(1,Math.floor(h*scale)));
      }
      setStatus(invalid.length?t.pending+' '+t.someSkipped:merged.duplicates?t.pending+' '+t.duplicateSkipped:t.pending);
    }catch(err){
      if(id===selectionId.current)setStatus((localizedImageError(err,lang)||t.error)+(files.length?t.kept:''));
    }finally{if(id===selectionId.current)setInspecting(false);}
  }
  function removeBatchFile(index){
    if(!batch||busy||inspecting)return;
    const remaining=files.filter((_,i)=>i!==index);
    selectionId.current+=1;
    const nextPreviewIndex=!remaining.length?0:index===previewIndex?Math.min(index,remaining.length-1):index<previewIndex?previewIndex-1:previewIndex;
    setFiles(remaining);
    setPreviewIndex(nextPreviewIndex);
    setPreview(remaining.length?URL.createObjectURL(remaining[nextPreviewIndex].file):null);
    setOutput(null);setFailedAttempt([]);
    if(!remaining.length)setRejected([]);
    setStatus(remaining.length?t.pending:t.choose);
  }
  function showBatchPreview(index){
    if(!batch||busy||inspecting||!files[index]||previewIndex===index)return;
    setPreviewIndex(index);
    setPreview(URL.createObjectURL(files[index].file));
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
    if(busy||inspecting)return;
    const images=clipboardImageFiles(e);
    if(!images.length)return;
    e.preventDefault();
    void selectFiles(images);
  }
  useEffect(()=>{
    document.addEventListener('paste',paste);
    return()=>document.removeEventListener('paste',paste);
  },[busy,inspecting,batch,lang,files]);
  function changeDimension(value,changed){
    const valid=value!==''&&Number.isInteger(Number(value))&&Number(value)>0&&Number(value)<=MAX_AXIS;
    if(keep&&files[0]&&valid){
      const next=fitLockedAspectDimensions(files[0].width,files[0].height,value,changed);
      setWidth(next.width);setHeight(next.height);
      setStatus(previous=>next.limited?t.aspectLimited:previous===t.aspectLimited?t.pending:previous);
    }else if(changed==='width')setWidth(value);
    else setHeight(value);
  }
  function changeWidth(v){changeDimension(v,'width');}
  function changeHeight(v){changeDimension(v,'height');}
  async function run(e){
    e.preventDefault();if(!files.length||busy||inspecting)return;
    cancelRequested.current=false;
    // Retain the previous usable download until this reprocessing attempt succeeds.
    setBusy(true);setFailedAttempt([]);setStatus(t.working);
    if(batch){setProgress(0);setPhase('processing');}
    try{
      const options={width:Number(width),height:Number(height),mode,format,targetKb:Number(target),
        quality:Number(quality)/100,allowDownscale:mode==='within'&&downscale,zoom:Number(zoom)/100,cropX:Number(cropX)/100,cropY:Number(cropY)/100};
      if(batch)validateBatchPixels(files,options.width,options.height,mode);
      const results=[],failed=[];
      let totalOutputBytes=0,processedCount=0;
      for(const [index,item] of files.entries()){
        // Stop means keep completed work; only remaining files are skipped.
        if(batch&&cancelRequested.current)break;
        try{
          const result=sheet?await makePassportSheet(item.file,options):await processImage(item.file,options);
          if(batch)totalOutputBytes=addBatchOutputBytes(totalOutputBytes,result.bytes);
          results.push({sourceBytes:item.file.size,name:exportFilename(item.file.name,result.format,sheet?'print-sheet':'edited'),...result});
        }catch(err){
          if(!batch)throw err;
          failed.push({name:item.file.name,reason:localizedImageError(err,lang)||t.error});
        }
        processedCount=index+1;
        if(batch)setProgress(processedCount);
      }
      const stoppedEarly=batch&&cancelRequested.current&&processedCount<files.length;
      if(!results.length){
        if(batch&&failed.length)setFailedAttempt(failed);
        if(stoppedEarly){setStatus(t.cancelled+(output?.url?t.kept:''));return;}
        throw new Error(t.noExport+(failed[0]?' '+failed[0].reason:''));
      }
      let blob,name;
      const isZip=results.length>1;
      if(!isZip){blob=results[0].blob;name=results[0].name;}
      else{
        if(batch){setPhase('zip');setStatus(t.packaging);}
        const {default: JSZip}=await import('jszip');
        const zip=new JSZip();results.forEach((r,i)=>zip.file(String(i+1).padStart(2,'0')+'-'+r.name,r.blob));
        blob=await zip.generateAsync({type:'blob',compression:'STORE'});name='plainmile-images.zip';
      }
      const url=URL.createObjectURL(blob);
      setOutput({url,blob,name,results,failed,isZip,inputCount:files.length,processedCount});
      setStatus(stoppedEarly
        ? t.partial+' '+t.processed+' '+processedCount+' / '+files.length+(failed.length?' '+t.someSkipped:'')
        : failed.length?t.done+' '+t.someSkipped:t.done);
    }catch(err){setStatus((localizedImageError(err,lang)||t.error)+(output?.url?t.kept:''));}
    finally{setBusy(false);setPhase('');}
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
    <label className="wide">{t.target}<input data-testid="target" type="number" min="0" max="20000" step="1" value={target} disabled={busy||inspecting} onChange={e=>setTarget(e.target.value)}/><small data-testid="target-kb-hint">{t.targetHint}</small></label>
    <label>{t.quality}: {quality}%<input type="range" min="5" max="95" value={quality} disabled={losslessOutput||busy||inspecting} onChange={e=>setQuality(e.target.value)}/><small>{t.qualityNote}</small></label>
    {mode==='within'?<label className="check"><input type="checkbox" checked={downscale} disabled={busy||inspecting} onChange={e=>setDownscale(e.target.checked)}/>{t.downscale}</label>:<p className="resize-mode-help wide" data-testid="exact-size-note">{t.exactSizeNotice}</p>}
  </>;
  return <section className="editor" data-editor-ready={ready?'true':'false'} aria-label={t.settings}>
    <div className="editor-workspace">
      <form className="editor-controls" onSubmit={run}>
        <div className="control-section">
          <h2 className="panel-title">{t.files}</h2>
          <label className="upload" onDragOver={e=>e.preventDefault()} onDrop={drop}>
            <strong>{batch&&files.length?t.addMore:t.upload}</strong>
            <input aria-label={batch&&files.length?t.addMore:t.upload} data-testid="upload" type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              disabled={!ready||busy||inspecting} multiple={batch} onChange={pick}/>
            <span>{t.hint}{batch?' · '+MAX_FILES+' max':''}. {t.drop} {t.paste}{batch&&files.length?' '+t.appendHint:''}</span>
          </label>
          {rejected.length>0&&<details className="batch-errors" data-testid="skipped-inputs" open>
            <summary>{t.skippedInputs} ({rejected.length})</summary>
            <ul>{rejected.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.reason}</span></li>)}</ul>
          </details>}
          {!!files.length&&<div className="file-summary">
            <strong>{files.length} {lang==='zh'?'个文件':'file(s)'}</strong>
            <ul className={batch?'selected-files':undefined}>{(batch?files:files.slice(0,6)).map((f,i)=><li key={i} className={batch?'selected-file-entry':undefined}>
              <span>{f.file.name} · {f.width}×{f.height} · {formatBytes(f.file.size)}</span>
              {batch&&<span className="selected-file-actions">
                {files.length>1&&<button type="button" className="secondary selected-file-preview" data-testid="batch-preview-file"
                  disabled={busy||inspecting} aria-pressed={previewIndex===i} aria-label={(lang==='zh'?'预览 ':'Preview ')+f.file.name}
                  onClick={()=>showBatchPreview(i)}>{lang==='zh'?'预览':'Preview'}</button>}
                <button type="button" className="secondary selected-file-remove" data-testid="remove-batch-file"
                  disabled={busy||inspecting} aria-label={(lang==='zh'?'移除 ':'Remove ')+f.file.name}
                  onClick={()=>removeBatchFile(i)}>{lang==='zh'?'移除':'Remove'}</button>
              </span>}
            </li>)}</ul>
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
                  if(e.target.checked&&files[0]&&Number.isInteger(Number(width))&&Number(width)>0&&Number(width)<=MAX_AXIS){
                    const next=fitLockedAspectDimensions(files[0].width,files[0].height,width,'width');
                    setWidth(next.width);setHeight(next.height);
                    setStatus(previous=>next.limited?t.aspectLimited:previous===t.aspectLimited?t.pending:previous);
                  }
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
          <button data-testid="process" disabled={!files.length||busy||inspecting} type="submit">{busy?t.working:sheet?t.sheet:batch?t.runBatch:tool==='compress-image-to-size'?t.runCompress:tool==='signature-resizer'?t.runSignature:t.run}</button>
          {batch&&busy&&phase==='processing'&&<button type="button" className="secondary" data-testid="batch-cancel" onClick={()=>{cancelRequested.current=true;setStatus(t.stopping);}}>{t.cancel}</button>}
          <button type="button" disabled={busy||inspecting} className="secondary" onClick={()=>{selectionId.current+=1;setFiles([]);setRejected([]);setFailedAttempt([]);setPreview(null);setPreviewIndex(0);setOutput(null);setStatus('');const el=document.querySelector('[data-testid=upload]');if(el)el.value='';}}>{t.reset}</button>
        </div>
        {batch&&busy&&<div className="batch-progress" data-testid="batch-progress">
          <span role="status">{phase==='zip'?t.packaging:t.processed+' '+progress+' / '+files.length}</span>
          <progress aria-label={t.processed} max={Math.max(1,files.length)} value={progress}/>
        </div>}
      </form>
      <aside className="editor-preview" aria-label={t.preview}>
        <h2 className="panel-title">{t.preview}</h2>
        <div className="preview-frame">
          {output&&!output.isZip&&!batch ? <img alt={lang==='zh'?'处理后的图片':'Processed image'} src={output.url}/> :
           preview ? <>
             <canvas key={previewKey} ref={canvasRef} role="img" data-testid="editor-preview-canvas"
               aria-label={sheet?t.cropPreview:t.preview} aria-busy={!previewReady&&!previewFailed}/>
             {!previewReady&&<p className="image-preview-status" data-testid="editor-preview-status" role="status">{previewFailed?t.previewFailed:t.loadingPreview}</p>}
           </> :
           <p className="preview-empty">{t.empty}</p>}
        </div>
        {batch&&!!files.length?<p className="preview-caption" data-testid="batch-preview-caption"><strong>{previewEntry?.file.name}</strong> · {t.batchPreview}</p>:
         !!files.length&&!output&&<p className="preview-caption">{sheet?t.cropPreview:files[0].file.name+' · '+files[0].width+'×'+files[0].height}</p>}
        {output&&<div className="result">
          <strong>{t.done}</strong>
          {batch&&<p data-testid="batch-outcome">{t.exported}: {output.results.length} · {t.failedCount}: {output.failed.length}{output.inputCount>output.processedCount?' · '+t.notProcessed+': '+(output.inputCount-output.processedCount):''}</p>}
          <p data-testid="result-meta">{output.isZip?
            output.results.length+' '+t.count+' · ZIP '+formatBytes(output.blob.size):
            output.results.map(r=>r.width+'×'+r.height+' · '+r.format.toUpperCase()+' · '+formatBytes(r.bytes)).join(' | ')}</p>
          <p data-testid="exact-bytes">{lang==='zh'?'实际文件大小：':'Exact file size: '}{output.blob.size} {lang==='zh'?'字节':'bytes'}</p>
           <p data-testid="size-comparison">{output.failed.length?(lang==='zh'?'成功导出图片的原文件':'Original (exported images)'):(lang==='zh'?'原文件合计':'Original total')}: {formatBytes(output.results.reduce((sum,item)=>sum+item.sourceBytes,0))} · {output.isZip?(lang==='zh'?'下载 ZIP 大小':'Download ZIP size'):(lang==='zh'?'结果文件':'Output file')}: {formatBytes(output.blob.size)}</p>
          {batch&&output.failed.length>0&&<details className="batch-errors" data-testid="skipped-outputs" open>
            <summary>{t.skippedOutputs} ({output.failed.length})</summary>
            <ul>{output.failed.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.reason}</span></li>)}</ul>
          </details>}
          {batch&&<details className="batch-export-details" data-testid="batch-export-details">
            <summary>{t.batchItems} ({output.results.length})</summary>
            <ul>{output.results.map((r,i)=><li key={i}><span>{r.name}</span><span>{r.width}×{r.height} · {r.format.toUpperCase()} · {formatBytes(r.bytes)}</span></li>)}</ul>
          </details>}
          <a data-testid="download" className="download" href={output.url} download={output.name}>{output.isZip?t.zipDownload:t.download} · {formatBytes(output.blob.size)}</a>
        </div>}
        {batch&&failedAttempt.length>0&&<details open className="batch-errors" data-testid="batch-attempt-errors">
          <summary>{t.attemptErrors} ({failedAttempt.length})</summary>
          <ul>{failedAttempt.map((item,i)=><li key={i}><span>{item.name}</span><span>{item.reason}</span></li>)}</ul>
        </details>}
      </aside>
    </div>
    <div className="editor-footer"><p role="status" data-testid="status">{status||t.choose}</p><span>{t.local}</span></div>
  </section>;
}
