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
  if (![originalWidth, originalHeight, scanWidth, scanHeight].every(
    v => Number.isFinite(v) && v > 0)) return [];
  const zone = region || {x:0,y:0,w:originalWidth,h:originalHeight};
  const sx = zone.w / scanWidth, sy = zone.h / scanHeight;
  const words = [];
  for (const block of data?.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const terms = line.words?.length ? line.words : [line];
        for (const word of terms) {
          const label = String(word.text || '').trim();
          const b = word.bbox;
          if (!label || !b) continue;
          const confidence=Number(word.confidence ?? line.confidence);
          if (!Number.isFinite(confidence)) continue;
          const readable=Array.from(label).filter(ch => /[\p{L}\p{N}]/u.test(ch));
          if (!readable.length) continue;
          const han=/[\p{Script=Han}]/u.test(label);
          const minConfidence=readable.length === 1 ? (han ? 85 : 92) :
            readable.length === 2 ? 77 : 65;
          if (confidence < minConfidence) continue;
          const rawW=(b.x1-b.x0)*sx,rawH=(b.y1-b.y0)*sy;
          if (!Number.isFinite(rawW) || !Number.isFinite(rawH) ||
              rawW < 4 || rawH < 5 ||
              rawH > rawW*2.6 || rawH > originalHeight*.28 ||
              rawW * rawH > originalWidth*originalHeight*.15) continue;
          const rect=clampBox({
            x:zone.x+b.x0*sx,y:zone.y+b.y0*sy,w:rawW,h:rawH
          },originalWidth,originalHeight,3);
          if (rect)words.push({id:'ocr-'+words.length,text:label,...rect,source:'ocr',confidence});
        }
      }
    }
  }
  return words.slice(0,250);
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
  const scale = Math.min(1, 2400 / Math.max(zone.w, zone.h),
    Math.sqrt(3_000_000 / (zone.w * zone.h)));
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
