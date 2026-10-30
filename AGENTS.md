# Image Tools Agent Instructions

- Repository: `plainmile/image-tools`; official origin: `https://image.plainmile.com/`. Keep it independent from `plainmile/pdf-tools` and the PlainMile paycheck application.
- This is a static, English/Chinese Astro + React image-tool website. **ALL image decoding, resizing, compression, photo print and ZIP generation must occur locally in the visitor's browser**. Never upload, send, log or store visitor image files, image pixels or filenames. No API server, paid API, GPU, or cloud AI inference. Local OCR language models via self-hosted Tesseract WASM are allowed.
- Never claim traditional color-based background removal can reliably isolate arbitrary photographic subjects. Never automatically modify government ID/visa/passport photos in a way that implies compliance with official rules. Provide honest links and disclaimers.
- Redaction is manual only: do not add OCR, text recognition, automatic text detection, third-party AI or false positives. Offer solid black, real pixel mosaic and Gaussian blur with matching live preview and output.
- No host Node/npm: build inside Docker/GitHub Actions. Deploy the Nginx image through GHCR to the existing netcup VPS.
- Production Compose path is `/opt/compose/image-tools/`. Operational scripts, if added, belong in `/opt/data/scripts/<purpose>/`. Use the existing external Docker `edge` network, no host 80/443 published ports and no changes to unrelated containers.
- All changes through feature branches, PRs and green CI. Mandatory unit tests, real binary-output E2E in Chromium, Firefox, and WebKit, build/route smoke tests. Do not merge on failure.
- Public website: both English `/` and Chinese `/zh/`, mirrored tool pages and privacy pages. Static semantic HTML, unique titles/descriptions, canonical, reciprocal hreflang, sitemap, internal links, accessible forms, usable 375px mobile UI. Do not claim pages are indexable solely from a PR.
- Use decimal KB (1,000 B) and MB (1,000,000 B) consistently for all displayed sizes, user-facing limits and file-size targets. Keep exact output byte counts available; test caps at the byte boundary.
- Keep reasonable limits on count, bytes, source pixels and destination canvas area. Invalid, unsupported, animated, enormous and malformed input should fail gently. Display exact output bytes and dimensions; never claim the target KB is met unless verified.
- Output names are sanitized. Ensure object URLs are revoked. No invisible watermark, remote fonts, unnecessary trackers or ad scripts. Follow-system dark mode via CSS is welcome.
- Never claim a published Docker image or successful PR is proof of live netcup deployment. The host proxy, Cloudflare record, origin certificate, GH Actions secrets, and live public browser E2E must be verified independently.
- CI and deploy must not use secrets in untrusted PR jobs. Only deploy SHA-pinned images from tested main. Production health check and rollback should not interrupt other sites.

- Design standard: this is a practical editing utility, not a startup landing page. Keep a compact header, plain task names, file selection, settings, result preview and download near the top. Avoid marketing badges, oversized heroes, decorative gradients, emoji logos, unnecessary cards and repetitive privacy/AI slogans. Browser-local operation is a factual note, not a headline.
- Public E2E must explicitly wait for the client-side editor to hydrate before setting synthetic file inputs, so fast test interactions cannot race Astro/React hydration over HTTPS.

- Redaction safety invariant: opaque masks must permanently replace original pixels in newly encoded exports; reject invalid masks and do not export completely unredacted images in the ZIP.
- Privacy on public HTTPS: prevent analytics auto-injection using `Cache-Control: public, no-transform`; public E2E must ensure no image bytes leave the origin.


