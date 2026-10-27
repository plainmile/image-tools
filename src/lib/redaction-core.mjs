import { MAX_FILE_BYTES } from './image-core.mjs';

// No OCR or text extraction: redaction is deliberately manual-only.
export const REDACT_MAX_FILES = 12;
export const REDACT_MAX_BYTES = 100 * 1024 * 1024;
export const REDACT_MAX_PIXELS = 32_000_000;
export const REDACT_MAX_BATCH_PIXELS = 96_000_000;
export const REDACT_EFFECTS = ['solid', 'mosaic', 'blur'];
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
      width * height > REDACT_MAX_PIXELS) {
    throw new Error('Image exceeds the 32-megapixel limit.');
  }
}

export function validateRedactionPixels(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Choose one or more images.');
  let pixels = 0;
  for (const entry of entries) {
    verifyImageSize(entry.width, entry.height);
    pixels += entry.width * entry.height;
    if (pixels > REDACT_MAX_BATCH_PIXELS) {
      throw new Error('Selected images exceed the 96-megapixel batch limit. Choose fewer or smaller images.');
    }
  }
  return pixels;
}

export function clampBox(box, width, height) {
  if (!box || ![width,height,box.x,box.y,box.w,box.h].every(Number.isFinite) ||
      width < 1 || height < 1 || box.w <= 0 || box.h <= 0) return null;
  const x1 = Math.max(0, Math.floor(box.x));
  const y1 = Math.max(0, Math.floor(box.y));
  const x2 = Math.min(width, Math.ceil(box.x + box.w));
  const y2 = Math.min(height, Math.ceil(box.y + box.h));
  if (x2 - x1 < MIN_BOX || y2 - y1 < MIN_BOX) return null;
  return { x:x1, y:y1, w:x2-x1, h:y2-y1 };
}

export function boxBetween(a, b, width, height) {
  return clampBox({
    x:Math.min(a.x,b.x), y:Math.min(a.y,b.y),
    w:Math.abs(a.x-b.x), h:Math.abs(a.y-b.y),
  }, width, height);
}

export function getMaskStyle(mask, fallback='solid') {
  const effect = mask.effect || fallback;
  if (!REDACT_EFFECTS.includes(effect) && effect !== 'white') {
    throw new Error('Unsupported redaction effect.');
  }
  const strength = Number(mask.strength ?? 24);
  if (!Number.isFinite(strength) || strength < 4 || strength > 80) {
    throw new Error('Redaction strength must be between 4 and 80.');
  }
  const color = effect === 'white' ? '#ffffff' : (mask.color || '#000000');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid redaction color.');
  return { effect:effect==='white'?'solid':effect, color, strength };
}

export async function decodeBitmap(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Unsupported image format.');
  }
  const bitmap = await createImageBitmap(file, { imageOrientation:'from-image' });
  try { verifyImageSize(bitmap.width, bitmap.height); }
  catch (error) { bitmap.close(); throw error; }
  return bitmap;
}

export function canvasBlob(canvas, mime='image/png', quality) {
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>blob && blob.type===mime
      ? resolve(blob) : reject(new Error('Image encoding failed.')),mime,quality);
  });
}

/**
 * Paint real effects into pixels. Both the scaled editor preview and the
 * full-resolution export call this function. Solid fills are always painted
 * last: a later blur/pixelate region must never uncover a solid secret cover.
 */
export function paintRedactions(ctx, bitmap, masks, fallback='solid', destWidth=bitmap.width, destHeight=bitmap.height) {
  verifyImageSize(bitmap.width,bitmap.height);
  if (!Number.isFinite(destWidth)||!Number.isFinite(destHeight)||destWidth<=0||destHeight<=0) {
    throw new Error('Invalid rendering dimensions.');
  }
  const sx = destWidth/bitmap.width, sy = destHeight/bitmap.height;
  const rendered = masks.map(mask=>{
    const box=clampBox(mask,bitmap.width,bitmap.height);
    if (!box) throw new Error('Invalid redaction box. Recheck the covered area before exporting.');
    return {box,...getMaskStyle(mask,fallback)};
  });
  const nonSolid=rendered.filter(x=>x.effect!=='solid');
  const solid=rendered.filter(x=>x.effect==='solid');

  for (const {box,effect,strength} of nonSolid) {
    const dx=box.x*sx,dy=box.y*sy,dw=box.w*sx,dh=box.h*sy;
    ctx.save();
    ctx.beginPath();ctx.rect(dx,dy,dw,dh);ctx.clip();
    if (effect==='mosaic') {
      // Intensity is relative to image resolution, not the browser's zoom.
      const block=Math.max(4,Math.round(strength*Math.max(1,Math.min(bitmap.width,bitmap.height)/1000)));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.ceil(box.w/block));
      canvas.height=Math.max(1,Math.ceil(box.h/block));
      const small=canvas.getContext('2d');
      if (!small) {ctx.restore();throw new Error('Canvas unavailable.');}
      small.drawImage(bitmap,box.x,box.y,box.w,box.h,0,0,canvas.width,canvas.height);
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(canvas,0,0,canvas.width,canvas.height,dx,dy,dw,dh);
      canvas.width=0;canvas.height=0;
    } else if (effect==='blur') {
      const radius=Math.max(2,Math.round(strength*Math.max(1,Math.min(bitmap.width,bitmap.height)/1000)));
      const pad=Math.ceil(radius*3);
      const x0=Math.max(0,box.x-pad),y0=Math.max(0,box.y-pad);
      const x1=Math.min(bitmap.width,box.x+box.w+pad);
      const y1=Math.min(bitmap.height,box.y+box.h+pad);
      ctx.filter='blur('+Math.max(1,radius*Math.min(sx,sy)).toFixed(1)+'px)';
      ctx.drawImage(bitmap,x0,y0,x1-x0,y1-y0,x0*sx,y0*sy,(x1-x0)*sx,(y1-y0)*sy);
    }
    ctx.restore();
  }
  for (const {box,color} of solid) {
    ctx.fillStyle=color;
    ctx.fillRect(box.x*sx,box.y*sy,box.w*sx,box.h*sy);
  }
}

export async function flattenRedactedImage(file,masks,fallback='solid',format='png') {
  if (!Array.isArray(masks)||!masks.length) throw new Error('Draw at least one cover before downloading.');
  if (!['png','jpeg','webp'].includes(format)) throw new Error('Unsupported output format.');
  const bitmap=await decodeBitmap(file);
  const canvas=document.createElement('canvas');
  try {
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{alpha:format!=='jpeg'});
    if (!ctx) throw new Error('Canvas unavailable.');
    if(format==='jpeg'){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);}
    ctx.drawImage(bitmap,0,0);
    paintRedactions(ctx,bitmap,masks,fallback);
    const blob=await canvasBlob(canvas,'image/'+format,0.94);
    return {blob,width:bitmap.width,height:bitmap.height,filename:'redacted-image.'+(format==='jpeg'?'jpg':format)};
  } finally {canvas.width=0;canvas.height=0;bitmap.close();}
}
