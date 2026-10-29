import { MAX_FILE_BYTES, MAX_SOURCE_PIXELS, MAX_BATCH_OUTPUT_BYTES, isAnimatedImage, inputImageFormat } from './image-core.mjs';

export const REDACT_MAX_FILES = 12;
export const REDACT_MAX_BYTES = 100 * 1024 * 1024;
export const REDACT_MAX_PIXELS = 32_000_000;
export const REDACT_MAX_BATCH_PIXELS = 96_000_000;
export const REDACT_MAX_ZIP_BYTES = MAX_BATCH_OUTPUT_BYTES;

// Bound uncompressed redacted image data before JSZip copies it into a ZIP.
export function addRedactionOutputBytes(total, next) {
  if (![total,next].every(value => Number.isSafeInteger(value) && value >= 0))
    throw new Error('Invalid redaction output size.');
  if (total + next > REDACT_MAX_ZIP_BYTES)
    throw new Error('Redacted output exceeds 128 MB. Export fewer images at once or choose JPG/WebP.');
  return total + next;
}

const MIN_BOX = 2;
export function validateRedactionFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Choose one or more images.');
  if (files.length > REDACT_MAX_FILES) throw new Error('Select at most 12 images.');
  if (files.reduce((size, f) => size + Number(f?.size || 0), 0) > REDACT_MAX_BYTES) {
    throw new Error('Selected files exceed the 100 MB batch limit.');
  }
  for (const f of files) {
    if (!f || f.size <= 0) throw new Error('The selected image file is empty.');
    if (f.size > MAX_FILE_BYTES) throw new Error('Each image must be at most 40 MB.');
    // Some operating systems and clipboard sources leave File.type empty.
    // Use the same conservative extension fallback as every other image tool.
    // A mismatched explicit MIME (e.g. SVG renamed .png) is still rejected.
    try { inputImageFormat(f); }
    catch { throw new Error('Only JPEG, PNG and WebP are supported.'); }
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
export async function decodeBitmap(file) {
  try { inputImageFormat(file); }
  catch { throw new Error('Unsupported image format.'); }
  // createImageBitmap only decodes a still frame. Accepting animated PNG/WebP
  // here would silently discard other frames and misrepresent privacy redaction.
  if (await isAnimatedImage(file)) {
    throw new Error('Animated PNG/WebP is not supported. Only the first frame would be redacted.');
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
export function canvasBlob(canvas, mime='image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob && blob.type === mime ?
      resolve(blob) : reject(new Error('Image encoding failed.')), mime, quality);
  });
}
export function paintRedactions(ctx, bitmap, masks, effect, strength=24) {
  // Solid privacy covers must be rendered last. Otherwise an overlapping
  // blur/mosaic drawn later from the ORIGINAL bitmap can reveal a covered secret.
  const ordered=[...masks.filter(item=>(item.effect??effect)!=='solid'),
                 ...masks.filter(item=>(item.effect??effect)==='solid')];
  for (const item of ordered) {
    const box = clampBox(item, bitmap.width, bitmap.height);
    if (!box) throw new Error('Invalid redaction box. Recheck the covered area before exporting.');
    const style = item.effect ?? effect;
    const amount = item.strength ?? strength;
    if (!['solid','mosaic','blur'].includes(style) ||
        (style !== 'solid' && (!Number.isFinite(amount) || amount < 8 || amount > 64))) {
      throw new Error('Unsupported redaction style or strength.');
    }
    if (style === 'solid') {
      ctx.fillStyle = '#000';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    } else if (style === 'mosaic') {
      const sample = document.createElement('canvas');
      sample.width = Math.max(1, Math.ceil(box.w / amount));
      sample.height = Math.max(1, Math.ceil(box.h / amount));
      const sctx = sample.getContext('2d');
      if (!sctx) throw new Error('Canvas unavailable.');
      sctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, sample.width, sample.height);
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sample, 0, 0, sample.width, sample.height, box.x, box.y, box.w, box.h);
      ctx.restore();
      sample.width = 0; sample.height = 0;
    } else if (style === 'blur') {
      ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      ctx.filter = 'blur(' + amount + 'px)';
      ctx.drawImage(bitmap, 0, 0);
      ctx.restore();
    } else {
      throw new Error('Unsupported redaction effect.');
    }
  }
}
export async function flattenRedactedImage(file, masks, effect='solid', format='png', strength=24) {
  if (!Array.isArray(masks) || masks.length === 0) {
    throw new Error('Add at least one redaction box before downloading.');
  }
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('Unsupported output format.');
  const bitmap = await decodeBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    try {
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { alpha: format !== 'jpeg' });
      if (!ctx) throw new Error('Canvas unavailable.');
      if (format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(bitmap, 0, 0);
      paintRedactions(ctx, bitmap, masks, effect, strength);
      const blob = await canvasBlob(canvas, 'image/' + format, 0.94);
      return { blob, filename: 'redacted-image.' + (format === 'jpeg' ? 'jpg' : format) };
    } finally {
      // Release full-resolution canvas storage on encoding failure as well.
      canvas.width = 0; canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}
