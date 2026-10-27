# PlainMile Image Tools

Free, private image utilities — designed for **https://image.plainmile.com/** and developed in the public repository https://github.com/plainmile/image-tools.

**Status:** Initial V0 implementation. A passing PR/CI does not imply a public deployment.

All image processing runs in your browser, not on our server. No AI models, uploads, accounts, or paid APIs.

## First release

- Resize to exact width/height, choose crop-to-fill or fit-with-padding; PNG, JPEG and WebP outputs.
- Compress JPEG/WebP to a target KB, optionally reducing pixel dimensions when needed. Verify the **actual** output bytes.
- Resize signatures by pixel size and target KB (application requirements vary).
- Batch resize locally and download a ZIP with individual files.
- Create a 4x6-inch print sheet with six 2x2-inch photos, by manually framing an existing photo. **Not a government approval or compliance check.** Follow the applicable issuing authority's photo rules.
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

Once GHCR package visibility is set to Public, users can pull `ghcr.io/plainmile/image-tools:latest`. This static website does not need databases, volumes or AI.

## netcup production

Use existing Cloudflare + shared Edge Nginx. Preserve other vhosts, containers and the existing external `edge` Docker network.

- Domain: `image.plainmile.com`
- Image: `ghcr.io/plainmile/image-tools:<full-main-commit-sha>`
- Container: `plainmile-image-tools` (internal port 80 only)
- Compose directory: `/opt/compose/image-tools`, file `compose.prod.yaml`.
- Edge upstream: `http://plainmile-image-tools:80`; see `deploy/edge-vhost.example.conf` for a **location snippet only**, not a complete TLS vhost.

New repo GitHub Actions SSH secrets, if deployment is configured: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT` (existing nonstandard port), `DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY` (verified **host public key**, not a guessed fingerprint). Never commit credentials or private keys.

Deploy is deliberately a manual action for the first release. Prepare DNS, edge routing and certificate **before** attempting public validation. GHCR publication is automated after main CI succeeds.

## Privacy and feedback

Images and filenames stay in the page session. ZIP files and outputs are generated in the browser. No image upload endpoint. For bug reports, use https://github.com/plainmile/image-tools/issues with a **synthetic** sample, not your private images.
