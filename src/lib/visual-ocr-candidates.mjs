/**
 * Conservative visual text-area proposals for complex photographs.
 * Finds high-contrast light captions at the top/bottom, and red labels
 * in the image body. Proposals are ONLY suggestions, never automatic masks.
 */
function sweepHorizontal(src, w, h, radius, dilation) {
  const out = new Uint8Array(src.length), outside = dilation ? 0 : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let value = dilation ? 0 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        const pixel = xx < 0 || xx >= w ? outside : src[y * w + xx];
        if (dilation && pixel) { value = 1; break; }
        if (!dilation && !pixel) { value = 0; break; }
      }
      out[y * w + x] = value;
    }
  }
  return out;
}
function sweepVertical(src, w, h, radius, dilation) {
  const out = new Uint8Array(src.length), outside = dilation ? 0 : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let value = dilation ? 0 : 1;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        const pixel = yy < 0 || yy >= h ? outside : src[yy * w + x];
        if (dilation && pixel) { value = 1; break; }
        if (!dilation && !pixel) { value = 0; break; }
      }
      out[y * w + x] = value;
    }
  }
  return out;
}
function closeMask(src, w, h) {
  const expanded = sweepVertical(sweepHorizontal(src, w, h, 6, true), w, h, 1, true);
  return sweepVertical(sweepHorizontal(expanded, w, h, 6, false), w, h, 1, false);
}
function clusters(mask, raw, w, h, kind) {
  const seen = new Uint8Array(mask.length), found = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let left = w, top = h, right = 0, bottom = 0, area = 0;
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const pos = stack.pop(), y = (pos / w) | 0, x = pos - y * w;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y); area++;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const p = yy * w + xx;
          if (!seen[p] && mask[p]) { seen[p] = 1; stack.push(p); }
        }
      }
    }
    const bw = right - left + 1, bh = bottom - top + 1;
    if (bw < 20 || bh < 9 || bh > 110) continue;
    if (kind === 'color' && (bw / bh < 1.1 || area < 180)) continue;
    let foreground = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) foreground += raw[y * w + x];
    }
    const density = foreground / (bw * bh);
    if (density < .04) continue;
    found.push({ x: left, y: top, w: bw, h: bh, score: area * density });
  }
  // Subtitle words often form separate connected components. Merge only
  // same-baseline bottom components; do not merge top beams into timestamps.
  if (kind === 'bottom') {
    let merging = true;
    while (merging) {
      merging = false;
      outer: for (let i = 0; i < found.length; i++) {
        for (let j = i+1; j < found.length; j++) {
          const a = found[i], b = found[j];
          const overlap = Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
          const gap = Math.max(0,Math.max(a.x,b.x)-Math.min(a.x+a.w,b.x+b.w));
          if (overlap > Math.min(a.h,b.h)*.55 && gap <= 35) {
            const left = Math.min(a.x,b.x), right = Math.max(a.x+a.w,b.x+b.w);
            const top = Math.min(a.y,b.y), lower = Math.max(a.y+a.h,b.y+b.h);
            found[i] = {x:left,y:top,w:right-left,h:lower-top,score:a.score+b.score};
            found.splice(j,1); merging = true; break outer;
          }
        }
      }
    }
  }
  const filtered = found.filter(b => b.w >= 40 && b.h >= 10 &&
    b.w/b.h >= (kind === 'color' ? 1.1 : 4));
  filtered.sort((a,b) => b.score-a.score);
  return filtered.slice(0,1);
}
export function detectReviewRegions(rgba, w, h, originalWidth = w, originalHeight = h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
      !rgba || rgba.length < w * h * 4) return [];
  const top = new Uint8Array(w*h), bottom = new Uint8Array(w*h), color = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4, r = rgba[p], g = rgba[p+1], b = rgba[p+2];
      const neutral = Math.min(r,g,b) > 175 && Math.max(r,g,b) - Math.min(r,g,b) < 55;
      if (y >= 8 && y < Math.floor(h*.16) && neutral) top[i] = 1;
      if (y >= Math.floor(h*.85) && neutral) bottom[i] = 1;
      if (y >= Math.floor(h*.12) && y < Math.floor(h*.86) &&
          r > 105 && r > g + 29 && r > b + 30) color[i] = 1;
    }
  }
  const proposals = [];
  for (const [kind, mask] of [['top', top], ['bottom', bottom], ['color', color]]) {
    for (const b of clusters(closeMask(mask, w, h), mask, w, h, kind)) {
      const pad = kind === 'color' ? 8 : 6;
      const x = Math.max(0, Math.floor((b.x-pad)*originalWidth/w));
      const y = Math.max(0, Math.floor((b.y-pad)*originalHeight/h));
      const right = Math.min(originalWidth, Math.ceil((b.x+b.w+pad)*originalWidth/w));
      const lower = Math.min(originalHeight, Math.ceil((b.y+b.h+pad)*originalHeight/h));
      proposals.push({x,y,w:right-x,h:lower-y,kind});
    }
  }
  return proposals;
}
export function proposeReviewRegions(bitmap) {
  const scale = Math.min(1, 960 / bitmap.width, 720 / bitmap.height);
  const w = Math.max(1, Math.floor(bitmap.width * scale));
  const h = Math.max(1, Math.floor(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Cannot analyze the selected image.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const proposals = detectReviewRegions(ctx.getImageData(0,0,w,h).data,w,h,bitmap.width,bitmap.height);
  canvas.width = 0; canvas.height = 0;
  return proposals;
}
