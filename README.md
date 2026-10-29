# PlainMile Image Tools

Free, private image utilities — designed for **https://image.plainmile.com/** and developed in the public repository https://github.com/plainmile/image-tools.

**Status:** V0 runs on the existing netcup deployment. CI and public-HTTPS E2E must pass independently for each subsequent release.

Image processing and manual redaction run entirely in your browser. There is no OCR, image upload, account, cloud inference or paid API.

## First release

- Convert one or up to 30 JPG/PNG/WebP still images without changing pixel dimensions. One successful conversion downloads directly even when other selected files were invalid or failed to encode; two or more successful outputs use ZIP. Skipped files are listed separately. Animated APNG/WebP files are rejected before canvas export rather than silently losing frames. Conversion re-encodes pixels and strips original EXIF/metadata.

- Crop JPG/PNG/WebP locally with draggable selection, optional aspect-ratio presets and exact coordinates. Rotate/flip images by 90-degree steps with a live preview and no EXIF retention.
- Resize proportionally without padding, borders or cropping by default (fit within maximum dimensions, no upscaling); exact-size fit-with-padding and crop-to-fill remain explicit choices. By default, regular resize and bulk resize retain the original JPG, PNG or WebP format (including existing alpha). Explicit JPEG output converts transparency to white; this is disclosed in the editor. In single-image exact-size modes, the optional Sync width and height control reduces both dimensions together when the requested aspect-locked size would exceed the 10,000-pixel edge or 32-megapixel browser budget; the editor explains the adjustment.
- Compress an image to a target KB (default JPG), optionally reducing pixel dimensions when needed. JPEG cannot retain PNG/WebP transparency, so the editor warns before export. PNG is lossless and may fail strict size targets. Verify the **actual** output bytes.
- Resize signatures by pixel size and an optional KB target (unlimited by default; application requirements vary).
- Batch resize locally and **always** download a ZIP, even when one file is selected. Output files have individually reviewable dimensions and format information. Fit-within maximum dimensions is the default and does not add borders or enlarge small originals; original formats are retained by default; exact-size Fit and crop-to-fill remain available.
- Redact images manually in-browser using solid black, real pixelation or blur with live preview, undo/redo and ZIP export.
- Create a 4x6-inch 300-DPI JPEG print sheet with six identical copies of one manually framed 2x2-inch photo. **Not a government approval or compliance check.** Follow the applicable issuing authority's photo rules.
- The real file header must match the declared JPG, PNG or WebP format. This prevents a renamed GIF or other mislabeled file from being silently decoded as a still image and losing animation frames.
- In bulk resize and multi-image conversion, remove one mistaken file directly from the selected list without clearing the other selections. Trimming a conversion batch down to one output switches to direct image download.
- English/Chinese SEO pages and a non-indexed 404. UI can be used on mobile.

## Development (without installing Node on your host)

```sh
docker run --rm -v "$PWD:/app" -w /app -p 4321:4321 node:22-bookworm-slim sh -lc 'npm install --no-audit --no-fund && npm run dev'
```

For local unit + build:
```sh
docker run --rm -v "$PWD:/app" -w /app node:22-bookworm-slim sh -lc 'npm install --no-audit --no-fund && npm run test:unit && npm run build'
```

The `Image Tools CI` GitHub Action builds the production Docker image and runs real Playwright browser E2E before main can be merged. See `tests/`.

## Self-host

```sh
docker compose -f compose.selfhost.yaml up -d
# http://127.0.0.1:8082
```

Once GHCR package visibility is set to Public, users can pull `ghcr.io/plainmile/image-tools:latest`. This static website does not need databases, volumes or cloud inference.

## netcup production

Use existing Cloudflare + shared Edge Nginx. Preserve other vhosts, containers and the existing external `edge` Docker network.

- Domain: `image.plainmile.com`
- Image: `ghcr.io/plainmile/image-tools:<full-main-commit-sha>`
- Container: `plainmile-image-tools` (internal port 80 only)
- Compose directory: `/opt/compose/image-tools`, file `compose.prod.yaml`.
- Edge upstream: `http://plainmile-image-tools:80`; see `deploy/edge-vhost.example.conf` for a **location snippet only**, not a complete TLS vhost.

New repo GitHub Actions SSH secrets, if deployment is configured: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT` (existing nonstandard port), `DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY` (verified **host public key**, not a guessed fingerprint). Never commit credentials or private keys.

After tested main CI passes, the image is published to GHCR and a separate workflow deploys the immutable SHA to netcup. A manual deploy trigger is also available. Deployment verifies container health, public HTTPS and real browser E2E; **do not regard deployment as fully verified until the final production workflow passes**. Keep existing DNS, Edge Nginx routing and Origin CA.

## Privacy and feedback

Images and filenames stay in the page session. ZIP files and outputs are generated in the browser. No image upload endpoint. For bug reports, use https://github.com/plainmile/image-tools/issues with a **synthetic** sample, not your private images.

### Privacy-focused redaction notes

- HTML responses set `Cache-Control: public, no-transform` to prevent Cloudflare automatic analytics script injection. Keep **Web Analytics automatic injection disabled** for `image.plainmile.com` in Cloudflare as defense in depth.
- Manual covers have per-image Undo/Redo (up to 40 edits). Adding another batch of images keeps existing covers. An accidentally selected image can be removed individually without disturbing other masks; deleting an image that has masks requires confirmation, and the previous ZIP download is invalidated. The clear-all action also asks for confirmation before destroying edits.
- Black/white previews are fully opaque; exports are flattened into new image pixels. Blur and mosaic must not be used to hide secrets.
- Batch redaction is capped at 96 megapixels total to bound browser memory use. A failed image selection must release temporary object URLs.

- Redacted single-image and ZIP member filenames are generic rather than copies of original filenames, which might contain private names or account IDs.

## Manual-only redaction

OCR has been removed. Users draw every cover themselves. The live preview uses the same pixel effects as export. Solid black is recommended for confidential data; mosaic and blur only visually obscure content.

### Cloudflare static-asset cache after security-header changes

The origin adds CSP and other security headers to HTML and hashed `/_astro/` assets. Cloudflare can retain an older copy of an unchanged asset URL after the origin's headers are updated. The public browser E2E requests a fresh query-string cache key to validate the deployed origin, and logs a warning when the original cached URL still lacks these headers. If that warning persists, purge the **affected static-asset URL** in Cloudflare rather than assuming the origin is misconfigured; the browser's HTML security policy still needs to pass on the normal URL. No private image files are involved in this check.
