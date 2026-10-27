export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_FILES = 30;
export const MAX_SOURCE_PIXELS = 80_000_000;
export const MAX_OUTPUT_PIXELS = 32_000_000;
export const MAX_AXIS = 10_000;

export const MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function integer(value, name, max = MAX_AXIS) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(`${name} must be a whole number from 1 to ${max}.`);
  }
  return number;
}

export function assertDimensions(width, height) {
  const w = integer(width, 'Width');
  const h = integer(height, 'Height');
  if (w * h > MAX_OUTPUT_PIXELS) {
    throw new Error('Output exceeds the 32-megapixel browser safety limit.');
  }
  return { width: w, height: h };
}

export function aspectDimension(originalWidth, originalHeight, dimension, changed) {
  const value = integer(dimension, changed === 'width' ? 'Width' : 'Height');
  const ratio = changed === 'width' ? originalHeight / originalWidth : originalWidth / originalHeight;
  return clamp(Math.round(value * ratio), 1, MAX_AXIS);
}

export function drawRect(sourceWidth, sourceHeight, outputWidth, outputHeight, mode = 'contain', zoom = 1, x = 0, y = 0) {
  if (![sourceWidth, sourceHeight, outputWidth, outputHeight].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('Invalid image dimensions.');
  }
  if (mode === 'cover') {
    const scale = Math.max(outputWidth / sourceWidth, outputHeight / sourceHeight) * clamp(zoom, 1, 3);
    const sw = outputWidth / scale;
    const sh = outputHeight / scale;
    return {
      sx: (sourceWidth - sw) * (clamp(x, -1, 1) + 1) / 2,
      sy: (sourceHeight - sh) * (clamp(y, -1, 1) + 1) / 2,
      sw, sh, dx: 0, dy: 0, dw: outputWidth, dh: outputHeight,
    };
  }
  if (mode !== 'contain') throw new Error('Invalid fit mode.');
  const scale = Math.min(outputWidth / sourceWidth, outputHeight / sourceHeight);
  const dw = sourceWidth * scale;
  const dh = sourceHeight * scale;
  return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight,
    dx: (outputWidth - dw) / 2, dy: (outputHeight - dh) / 2, dw, dh };
}

export function validateFile(file) {
  if (!file || typeof file.size !== 'number') throw new Error('Select an image first.');
  if (!file.size) throw new Error('The selected file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Each image must be 40 MB or smaller.');
  const name = String(file.name || '').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
      !/\.(jpe?g|png|webp)$/.test(name)) {
    throw new Error('Supported images: JPEG, PNG and WebP. SVG, GIF and HEIC are not supported yet.');
  }
}

export function sanitizeStem(filename) {
  const withoutExtension = String(filename ?? 'image').replace(/\.[a-z0-9]{1,8}$/i, '');
  const safe = withoutExtension.replace(/[\\/<>:"|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-').replace(/\.+$/g, '').slice(0, 70);
  return safe || 'image';
}

export function exportFilename(filename, format, suffix = 'edited') {
  const extension = format === 'jpeg' ? 'jpg' : format;
  if (!MIME[format]) throw new Error('Unsupported output type.');
  return `${sanitizeStem(filename)}-${suffix}.${extension}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(url);
      if (err) reject(err);
      else if (!img.naturalWidth || !img.naturalHeight) reject(new Error('This image cannot be decoded.'));
      else if (img.naturalWidth * img.naturalHeight > MAX_SOURCE_PIXELS) reject(new Error('The source exceeds 80 megapixels.'));
      else resolve(img);
    };
    img.onload = () => finish(null);
    img.onerror = () => finish(new Error('This image cannot be decoded. It may be damaged or unsupported.'));
    img.src = url;
  });
}

export async function inspectImage(file) {
  validateFile(file);
  const image = await readImage(file);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

function makeCanvas(image, opts, width, height) {
  const { width: w, height: h } = assertDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { alpha: opts.format === 'png' && opts.background === 'transparent' });
  if (!context) throw new Error('The browser cannot create an image canvas.');
  if (opts.format !== 'png' || opts.background !== 'transparent') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, w, h);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const d = drawRect(image.naturalWidth, image.naturalHeight, w, h,
    opts.mode || 'contain', opts.zoom || 1, opts.cropX || 0, opts.cropY || 0);
  context.drawImage(image, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
  return canvas;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Image encoding failed.'));
      if (blob.type !== mime) {
        return reject(new Error('This browser cannot encode the selected output format.'));
      }
      resolve(blob);
    }, mime, quality);
  });
}

async function encodeWithTarget(canvas, format, targetBytes, preferredQuality) {
  const mime = MIME[format];
  if (!targetBytes) {
    const blob = await canvasToBlob(canvas, mime, preferredQuality);
    return { blob, quality: preferredQuality };
  }
  if (format === 'png') {
    const blob = await canvasToBlob(canvas, mime);
    return blob.size <= targetBytes ? { blob, quality: null } : null;
  }
  const first = await canvasToBlob(canvas, mime, preferredQuality);
  if (first.size <= targetBytes) return { blob: first, quality: preferredQuality };
  let low = 0.05, high = preferredQuality, best = null;
  for (let i = 0; i < 11; i += 1) {
    const quality = (low + high) / 2;
    const blob = await canvasToBlob(canvas, mime, quality);
    if (blob.size <= targetBytes) {
      best = { blob, quality };
      low = quality;
    } else {
      high = quality;
    }
  }
  return best;
}

export async function processImage(file, options = {}) {
  validateFile(file);
  const format = options.format || 'jpeg';
  if (!MIME[format]) throw new Error('Unsupported output format.');
  let { width, height } = assertDimensions(options.width, options.height);
  const targetKb = Number(options.targetKb || 0);
  if (!Number.isFinite(targetKb) || targetKb < 0 || targetKb > 20_000) {
    throw new Error('Target size must be between 0 and 20,000 KB.');
  }
  const targetBytes = targetKb ? Math.floor(targetKb * 1024) : 0;
  const preferredQuality = clamp(Number(options.quality ?? 0.9), 0.05, 0.95);
  const image = await readImage(file);
  for (let attempt = 0; attempt < (options.allowDownscale ? 15 : 1); attempt += 1) {
    const canvas = makeCanvas(image, { ...options, format }, width, height);
    const result = await encodeWithTarget(canvas, format, targetBytes, preferredQuality);
    canvas.width = 0;
    canvas.height = 0;
    if (result) {
      if (targetBytes && result.blob.size > targetBytes) throw new Error('Actual file size exceeds the target.');
      return { ...result, width, height, format, bytes: result.blob.size };
    }
    if (width <= 48 || height <= 48) break;
    const nextWidth = Math.max(1, Math.floor(width * 0.82));
    const nextHeight = Math.max(1, Math.floor(height * 0.82));
    if (nextWidth === width || nextHeight === height) break;
    width = nextWidth;
    height = nextHeight;
  }
  throw new Error('Could not reach the file-size target at the chosen dimensions. Raise the KB limit or allow smaller dimensions.');
}

export async function makePassportSheet(file, opts = {}) {
  validateFile(file);
  const image = await readImage(file);
  // 4x6 inches at 300 pixels/inch, six manually framed 2x2 photos.
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1800;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas unavailable.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1200, 1800);
  const rect = drawRect(image.naturalWidth, image.naturalHeight, 600, 600,
    'cover', opts.zoom || 1, opts.cropX || 0, opts.cropY || 0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, col * 600, row * 600, 600, 600);
    }
  }
  const blob = await canvasToBlob(canvas, MIME.jpeg, 0.93);
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width: 1200, height: 1800, format: 'jpeg', bytes: blob.size, quality: 0.93 };
}
