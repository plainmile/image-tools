# PlainMile Image Tools

Free, private image utilities — designed for **https://image.plainmile.com/** and developed in the public repository https://github.com/plainmile/image-tools.

**Status:** V0 runs on the existing netcup deployment. CI and public-HTTPS E2E must pass independently for each subsequent release.

Image processing and OCR run in your browser, not on our server. The OCR engine uses self-hosted language and WebAssembly models, downloaded from this site only when the user requests recognition. No image uploads, accounts, cloud inference or paid APIs.

## First release

- Resize to exact width/height, choose crop-to-fill or fit-with-padding; PNG and WebP preserve source transparency and JPEG has a white background.
- Compress JPEG/WebP to a target KB, optionally reducing pixel dimensions when needed. Verify the **actual** output bytes.
- Resize signatures by pixel size and target KB (application requirements vary).
- Batch resize locally and download a ZIP. Fit-within maximum dimensions is the default and does not add borders or enlarge small originals; exact-size Fit and crop-to-fill remain available.
- Redact pictures and screenshots in-browser: English/Chinese OCR proposes boxes, manually add/remove and batch ZIP export. Solid black/white boxes permanently replace the covered pixels; mosaic/blur are for appearance only and not guaranteed private.
- Create a 4x6-inch 300-DPI JPEG print sheet with six 2x2-inch photos, by manually framing an existing photo. **Not a government approval or compliance check.** Follow the applicable issuing authority's photo rules.
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
