// Only respond to image clipboard content outside editable text controls.
// Pasting text into a dimension field must never replace the current image.
export function clipboardImageFiles(event) {
  const target = event?.target;
  if (typeof target?.closest === 'function' &&
      target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return [];
  const data = event?.clipboardData;
  if (!data) return [];
  const files = Array.from(data.files || []).filter(file =>
    typeof file?.type === 'string' && file.type.toLowerCase().startsWith('image/'));
  if (files.length) return files;
  return Array.from(data.items || []).filter(item =>
    item?.kind === 'file' && typeof item?.type === 'string' &&
    item.type.toLowerCase().startsWith('image/')).map(item => item.getAsFile?.()).filter(Boolean);
}
