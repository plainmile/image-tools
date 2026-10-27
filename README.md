# PlainMile Image Tools

Free, browser-local image utilities for **https://image.plainmile.com/**, with English and Chinese pages.

The tools process selected image files directly in the visitor's browser. Images are never uploaded to our server. No accounts, OCR, cloud inference, paid API or image server are required.

## Tools

- Resize a single image to exact pixel dimensions, preserving the full image or cropping to fill.
- Compress JPG/WebP under a target KB limit and verify the actual byte count.
- Resize signature images for upload forms.
- Batch-resize up to 30 images with a local ZIP export.
- Generate a 4x6-inch 300-DPI print sheet containing six 2x2-inch tiles. This does not certify compliance with photo rules.
- **Manual image redaction**: draw rectangles to hide any part of a screenshot or photo with opaque black, white, a custom solid color, actual pixelation or blur. The preview renders the real selected effect. Each new cover stores its style, color and effect strength, and previously drawn covers are not silently changed. Undo/Redo, remove, English/Chinese UI, single image export and batch ZIP export are supported.

### Redaction privacy and safety

- There is **no automatic text recognition, OCR or automatic redaction**. The previous OCR experiment produced false positives on photographs with busy backgrounds, so it has been removed from the production website.
- Use opaque solid color to hide passwords, identity numbers, financial information and other sensitive content. Blur and pixelation are visual effects, **not reliable protection for secrets**.
- Exported images are freshly rasterized PNG/JPG/WebP files; original metadata is not carried over. Opaque covers replace original pixels. Solid covers take priority if regions overlap.
- Each batch image must have at least one manually placed cover before ZIP export, and ZIP members use generic names rather than private source filenames.
- Maximum 12 images / 100 MB per redaction batch, 32 MP per image and 96 MP total.
- Site HTML opts out of Cloudflare script injection with Cache-Control: public, no-transform. Also disable Cloudflare analytics automatic injection at the zone level.

## Development

Unit tests and build can be run in an isolated Node container:

```sh
docker run --rm -v "$PWD:/app" -w /app node:22-bookworm-slim \
  sh -lc 'npm install --no-audit --no-fund && npm run test:unit && npm run build'
```

Browser E2E exercises Chromium, Firefox and WebKit, including exported pixel data, the actual preview effects, mobile layout, batch ZIP and SEO routes.

## Deployment

- Image origin: https://image.plainmile.com/
- Docker image: ghcr.io/plainmile/image-tools:<full-main-commit-sha>
- Production Compose directory: /opt/compose/image-tools/ (compose.prod.yaml)
- Container: plainmile-image-tools (only internal port 80, external edge network)
- Netcup updates are automated after a green main CI and successful GHCR publish, then verify HTTPS and public browser E2E.

No separate image storage, database, OCR language packs or WebAssembly inference runtime are deployed.

## Privacy / feedback

For problems, create a synthetic reproducer and file it at https://github.com/plainmile/image-tools/issues. Do not upload personal images or private documents to public issues.
