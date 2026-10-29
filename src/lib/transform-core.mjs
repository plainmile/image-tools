import {
  MIME, MAX_SOURCE_PIXELS, MAX_OUTPUT_PIXELS, MAX_AXIS, assertDimensions, clamp, inputImageFormat,
  isAnimatedImage, validateFile
} from './image-core.mjs';

// Keep an interactive selection within browser canvas safety limits.
// A too-large drag should yield a valid crop, never a stuck disabled editor.
function safeCropSize(width, height) {
  const scale = Math.min(1, MAX_AXIS / width, MAX_AXIS / height,
    Math.sqrt(MAX_OUTPUT_PIXELS / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  };
}

export function cropPreset(sourceWidth, sourceHeight, aspect = 'free') {
  const width = Number(sourceWidth), height = Number(sourceHeight);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error('Invalid image dimensions.');
  const ratio = aspect === 'free' ? null : Number(aspect);
  if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0)) throw new Error('Invalid crop ratio.');
  let w = Math.max(1, Math.floor(width * 0.85));
  let h = Math.max(1, Math.floor(height * 0.85));
  if (ratio !== null) {
    w = Math.max(1, Math.floor(Math.min(width * 0.85, height * 0.85 * ratio)));
    h = Math.max(1, Math.min(height, Math.round(w / ratio)));
    // Preserve an exact 1:1 crop for a square where practical.
    if (ratio === 1) w = h = Math.min(w, h);
  }
  // Initial selections and later drag/resize operations obey the same output limit.
  const safe = safeCropSize(w, h);
  w = safe.width;
  h = safe.height;
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
}

export function validateCrop(rect, sourceWidth, sourceHeight) {
  const { width: sw, height: sh } = assertSource(sourceWidth, sourceHeight);
  if (!rect) throw new Error('Select a crop area.');
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isInteger) ||
      x < 0 || y < 0 || width < 1 || height < 1 ||
      x + width > sw || y + height > sh) throw new Error('Crop area must be inside the source image.');
  return assertDimensions(width, height);
}

function assertSource(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width * height > MAX_SOURCE_PIXELS)
    throw new Error('Invalid source image dimensions.');
  return { width, height };
}

export function moveCrop(rect, dx, dy, sw, sh) {
  validateCrop(rect, sw, sh);
  return {
    ...rect,
    x: clamp(Math.round(rect.x + dx), 0, sw - rect.width),
    y: clamp(Math.round(rect.y + dy), 0, sh - rect.height)
  };
}

export function resizeCrop(rect, desiredWidth, desiredHeight, sw, sh, aspect = 'free', axis = 'width') {
  validateCrop(rect, sw, sh);
  let width = clamp(Math.round(desiredWidth), 1, sw - rect.x);
  let height = clamp(Math.round(desiredHeight), 1, sh - rect.y);
  if (aspect !== 'free') {
    const ratio = Number(aspect);
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Invalid crop ratio.');
    if (axis !== 'width' && axis !== 'height') throw new Error('Invalid crop resize axis.');
    // A fixed-ratio corner can be dragged vertically as well as horizontally.
    // The caller chooses the dominant drag axis; otherwise a vertical-only
    // gesture would change height but leave the width-driven rectangle static.
    if (axis === 'height') width = Math.max(1, Math.round(height * ratio));
    width = Math.min(width, sw - rect.x, Math.max(1, Math.floor((sh - rect.y) * ratio)));
    height = Math.max(1, Math.round(width / ratio));
    if (height > sh - rect.y) { height = sh - rect.y; width = Math.max(1, Math.round(height * ratio)); }
  }
  return { ...rect, ...safeCropSize(width, height) };
}

export function drawCrop(start, end, sw, sh, aspect = 'free') {
  const a = { x: clamp(Math.round(start.x), 0, sw - 1), y: clamp(Math.round(start.y), 0, sh - 1) };
  const b = { x: clamp(Math.round(end.x), 0, sw), y: clamp(Math.round(end.y), 0, sh) };
  const signX = b.x < a.x ? -1 : 1, signY = b.y < a.y ? -1 : 1;
  let width = Math.max(1, Math.abs(b.x - a.x));
  let height = Math.max(1, Math.abs(b.y - a.y));
  const maxWidth = signX > 0 ? sw - a.x : a.x;
  const maxHeight = signY > 0 ? sh - a.y : a.y;
  if (aspect !== 'free') {
    const ratio = Number(aspect);
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Invalid crop ratio.');
    width = Math.max(1, Math.round(Math.max(width, height * ratio)));
    width = Math.min(width, maxWidth, Math.max(1, Math.floor(maxHeight * ratio)));
    height = Math.max(1, Math.round(width / ratio));
  } else {
    width = Math.min(width, Math.max(1, maxWidth));
    height = Math.min(height, Math.max(1, maxHeight));
  }
  // Pointer dragging can otherwise create a >32 MP or >10,000 px crop.
  // Such a crop cannot be exported and cannot subsequently be resized because
  // resizeCrop validates the existing rectangle before applying new dimensions.
  ({width, height} = safeCropSize(width, height));
  const x = clamp(signX > 0 ? a.x : a.x - width, 0, sw - width);
  const y = clamp(signY > 0 ? a.y : a.y - height, 0, sh - height);
  return { x, y, width, height };
}

export function rotationDimensions(width, height, degrees = 0) {
  const angle = Number(degrees);
  if (!Number.isInteger(angle) || angle % 90 !== 0) throw new Error('Rotation must be in 90-degree steps.');
  const normalized = ((angle % 360) + 360) % 360;
  return assertDimensions(normalized === 90 || normalized === 270 ? height : width,
    normalized === 90 || normalized === 270 ? width : height);
}

export function drawRotation(ctx, image, width, height, degrees, flipH = false, flipV = false) {
  const result = rotationDimensions(width, height, degrees);
  ctx.save();
  ctx.translate(result.width / 2, result.height / 2);
  // Flips are relative to the screen, even after a 90-degree rotation.
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
  return result;
}

export async function exportTransform(file, options) {
  validateFile(file);
  if (await isAnimatedImage(file))
    throw new Error('Animated PNG/WebP is not supported. Editing would discard animation frames.');
  const format = options.format === 'original' ? inputImageFormat(file) : options.format;
  if (!MIME[format]) throw new Error('Unsupported output format.');
  const source = URL.createObjectURL(file);
  let canvas;
  try {
    const image = new Image();
    image.src = source;
    try { await image.decode(); }
    catch { throw new Error('The image cannot be decoded. It may be damaged or unsupported.'); }
    const sw = image.naturalWidth, sh = image.naturalHeight;
    assertSource(sw, sh);
    let dims;
    if (options.tool === 'crop') dims = validateCrop(options.crop, sw, sh);
    else if (options.tool === 'rotate') dims = rotationDimensions(sw, sh, options.degrees ?? 0);
    else throw new Error('Unknown editing operation.');
    canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d', {alpha: format !== 'jpeg'});
    if (!ctx) throw new Error('The browser could not create the image canvas.');
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dims.width, dims.height);
    }
    if (options.tool === 'crop') {
      const {x,y,width,height} = options.crop;
      ctx.drawImage(image,x,y,width,height,0,0,width,height);
    } else {
      drawRotation(ctx,image,sw,sh,options.degrees??0,Boolean(options.flipH),Boolean(options.flipV));
    }
    const preferredQuality = clamp(Number(options.quality ?? 0.9),0.05,0.95);
    const blob = await new Promise((resolve,reject) =>
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image encoding failed.')),
        MIME[format],preferredQuality));
    if (blob.type !== MIME[format]) throw new Error('This browser does not support the output format.');
    return { blob, format, bytes: blob.size, ...dims };
  } finally {
    URL.revokeObjectURL(source);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
