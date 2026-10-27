import { MAX_FILE_BYTES, MAX_SOURCE_PIXELS } from './image-core.mjs';

export const REDACT_MAX_FILES = 12;
export const REDACT_MAX_BYTES = 100 * 1024 * 1024;
export const REDACT_MAX_PIXELS = 32_000_000;
export const REDACT_MAX_BATCH_PIXELS = 96_000_000;

const MIN_BOX = 2;
export function validateRedactionFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Choose one or more images.');
  if (files.length > REDACT_MAX_FILES) throw new Error('Select at most 12 images.');
  if (files.reduce((size, f) => size + Number(f?.size || 0), 0) > REDACT_MAX_BYTES) {
    throw new Error('Selected files exceed the 100 MB batch limit.');
  }
  for (const f of files) {
    if (!f || f.size <= 0 || f.size > MAX_FILE_BYTES) throw new Error('Each image must be at most 40 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      throw new Error('Only JPEG, PNG and WebP are supported.');
    }
  }
}
export function verifyImageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width * height > Math.min(MAX_SOURCE_PIXELS, REDACT_MAX_PIXELS)) {
    throw new Error('Image exceeds the 32-megapixel limit.');
  }
}
// Bound aggregate full-resolution canvas work to avoid exhausting memory
// during ZIP export, particularly on mobile browsers.
export function validateRedactionPixels(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Choose one or more images.');
  let pixels = 0;
  for (const image of entries) {
    verifyImageSize(image.width, image.height);
    pixels += image.width * image.height;
    if (pixels > REDACT_MAX_BATCH_PIXELS) {
      throw new Error('Selected images exceed the 96-megapixel batch limit. Choose fewer or smaller images.');
    }
  }
  return pixels;
}

export function clampBox(box, width, height, padding = 0) {
  if (![width, height, box.x, box.y, box.w, box.h].every(Number.isFinite) ||
      width < 1 || height < 1) return null;
  const x1 = Math.max(0, Math.floor(box.x - padding));
  const y1 = Math.max(0, Math.floor(box.y - padding));
  const x2 = Math.min(width, Math.ceil(box.x + box.w + padding));
  const y2 = Math.min(height, Math.ceil(box.y + box.h + padding));
  if (x2 - x1 < MIN_BOX || y2 - y1 < MIN_BOX) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
export function boxBetween(a, b, width, height) {
  return clampBox({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
  }, width, height);
}
/**
 * OCR is an untrusted suggestion source, never an automatic mask generator.
 * Reject punctuation, low-confidence tokens and implausibly tall/wide
 * glyphs produced by machinery, fences, cables and architectural textures.
 * This heuristic intentionally trades recall for reviewable precision;
 * users must be able to draw any missing cover manually.
 */
export function extractOcrBoxes(data, originalWidth, originalHeight, scanWidth, scanHeight, region=null) {
  if (![originalWidth,originalHeight,scanWidth,scanHeight].every(n=>Number.isFinite(n)&&n>0))return [];
  const zone=region||{x:0,y:0,w:originalWidth,h:originalHeight};
  const sx=zone.w/scanWidth, sy=zone.h/scanHeight, found=[];
  // Use real Tesseract text + bounding boxes. Never infer "text" from a
  // location, color or high-contrast stripe in an arbitrary photograph.
  for(const block of data?.blocks||[]){
    for(const para of block.paragraphs||[]){
      for(const line of para.lines||[]){
        const terms=line.words?.length?line.words:[line];
        const accepted=[];
        for(const word of terms){
          const text=String(word.text||'').trim();
          const bbox=word.bbox;
          if(!text||!bbox)continue;
          const legible=Array.from(text).filter(c=>/[\p{L}\p{N}]/u.test(c));
          if(!legible.length)continue;
          const conf=Number(word.confidence??line.confidence);
          if(!Number.isFinite(conf))continue;
          // A confidence cut-off of 65 discarded legible photographed
          // labels; retain weaker multi-character candidates for review.
          const han=/\p{Script=Han}/u.test(text);
          const minimum=legible.length===1?(han?58:85):legible.length===2?40:28;
          if(conf<minimum)continue;
          const width=(bbox.x1-bbox.x0)*sx,height=(bbox.y1-bbox.y0)*sy;
          if(!Number.isFinite(width)||!Number.isFinite(height)||width<3||height<5||
             height>width*3.5||height>Math.max(90,originalHeight*.4)||
             width*height>originalWidth*originalHeight*.20)continue;
          const rect=clampBox({x:zone.x+bbox.x0*sx,y:zone.y+bbox.y0*sy,w:width,h:height},
                              originalWidth,originalHeight,3);
          if(rect)accepted.push({text,confidence:conf,...rect});
        }
        accepted.sort((a,b)=>a.y-b.y||a.x-b.x);
        let group=null;
        function commit(){
          if(group){
            found.push({id:'ocr-'+found.length,text:group.text.trim(),
              x:group.x,y:group.y,w:group.w,h:group.h,
              confidence:Math.round(group.weight/group.count),source:'ocr'});
          }
        }
        for(const part of accepted){
          const sameY=group&&
            (Math.min(group.y+group.h,part.y+part.h)-Math.max(group.y,part.y))/
            Math.min(group.h,part.h)>.55;
          const gap=group?part.x-(group.x+group.w):Infinity;
          if(group&&sameY&&gap>=-part.w*.3&&gap<=Math.max(22,part.h*1.4)){
            const x=Math.min(group.x,part.x),y=Math.min(group.y,part.y);
            group={...group,x,y,w:Math.max(group.x+group.w,part.x+part.w)-x,
              h:Math.max(group.y+group.h,part.y+part.h)-y,
              text:group.text+' '+part.text,
              weight:group.weight+part.confidence,count:group.count+1};
          }else{
            commit();
            group={...part,weight:part.confidence,count:1};
          }
        }
        commit();
      }
    }
  }
  return found.sort((a,b)=>a.y-b.y||a.x-b.x).slice(0,350);
}

export async function decodeBitmap(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Unsupported image format.');
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    verifyImageSize(bitmap.width, bitmap.height);
  } catch (error) {
    bitmap.close();
    throw error;
  }
  return bitmap;
}
export function scanCanvas(bitmap,region=null) {
  const zone=region ? clampBox(region,bitmap.width,bitmap.height) :
    {x:0,y:0,w:bitmap.width,h:bitmap.height};
  if(!zone)throw new Error('Invalid OCR selection area.');
  // Upscale small text where possible, but stay within a 4 MP OCR canvas.
  const scale = Math.min(2, 3000 / Math.max(zone.w, zone.h),
    Math.sqrt(4_000_000 / (zone.w * zone.h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(zone.w * scale));
  canvas.height = Math.max(1, Math.floor(zone.h * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas unavailable.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, zone.x, zone.y, zone.w, zone.h,0,0,canvas.width,canvas.height);
  return canvas;
}
export function canvasBlob(canvas, mime='image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob && blob.type === mime ?
      resolve(blob) : reject(new Error('Image encoding failed.')), mime, quality);
  });
}
export function paintRedactions(ctx, bitmap, masks, effect) {
  for (const item of masks) {
    const box = clampBox(item, bitmap.width, bitmap.height);
    if (!box) throw new Error('Invalid redaction box. Recheck the covered area before exporting.');
    if (effect === 'solid' || effect === 'white') {
      ctx.fillStyle = effect === 'white' ? '#fff' : '#000';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    } else if (effect === 'mosaic') {
      const sample = document.createElement('canvas');
      sample.width = Math.max(1, Math.ceil(box.w / 16));
      sample.height = Math.max(1, Math.ceil(box.h / 16));
      const sctx = sample.getContext('2d');
      if (!sctx) throw new Error('Canvas unavailable.');
      sctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, sample.width, sample.height);
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sample, 0, 0, sample.width, sample.height, box.x, box.y, box.w, box.h);
      ctx.restore();
      sample.width = 0; sample.height = 0;
    } else if (effect === 'blur') {
      ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      ctx.filter = 'blur(20px)';
      ctx.drawImage(bitmap, 0, 0);
      ctx.restore();
    } else {
      throw new Error('Unsupported redaction effect.');
    }
  }
}
export async function flattenRedactedImage(file, masks, effect='solid', format='png') {
  if (!Array.isArray(masks) || masks.length === 0) {
    throw new Error('Add at least one redaction box before downloading.');
  }
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('Unsupported output format.');
  const bitmap = await decodeBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: format !== 'jpeg' });
    if (!ctx) throw new Error('Canvas unavailable.');
    if (format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bitmap, 0, 0);
    paintRedactions(ctx, bitmap, masks, effect);
    const blob = await canvasBlob(canvas, 'image/' + format, 0.94);
    canvas.width = 0; canvas.height = 0;
    return { blob, filename: 'redacted-image.' + (format === 'jpeg' ? 'jpg' : format) };
  } finally {
    bitmap.close();
  }
}
