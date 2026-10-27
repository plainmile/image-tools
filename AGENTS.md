# Image Tools Agent Instructions

- Repository: `plainmile/image-tools`; official origin: `https://image.plainmile.com/`. Keep it independent from `plainmile/pdf-tools` and the PlainMile paycheck application.
- This is a static, English/Chinese Astro + React image-tool website. **ALL image decoding, resizing, compression, photo print and ZIP generation must occur locally in the visitor's browser**. Never upload, send, log or store visitor image files, image pixels or filenames. No API server, paid API, AI models or GPU.
- Never claim traditional color-based background removal can reliably isolate arbitrary photographic subjects. Never automatically modify government ID/visa/passport photos in a way that implies compliance with official rules. Provide honest links and disclaimers.
- No host Node/npm: build inside Docker/GitHub Actions. Deploy the Nginx image through GHCR to the existing netcup VPS.
- Production Compose path is `/opt/compose/image-tools/`. Operational scripts, if added, belong in `/opt/data/scripts/<purpose>/`. Use the existing external Docker `edge` network, no host 80/443 published ports and no changes to unrelated containers.
- All changes through feature branches, PRs and green CI. Mandatory unit tests, real binary-output E2E in Chromium, Firefox, and WebKit, build/route smoke tests. Do not merge on failure.
- Public website: both English `/` and Chinese `/zh/`, mirrored tool pages and privacy pages. Static semantic HTML, unique titles/descriptions, canonical, reciprocal hreflang, sitemap, internal links, accessible forms, usable 375px mobile UI. Do not claim pages are indexable solely from a PR.
- Keep reasonable limits on count, bytes, source pixels and destination canvas area. Invalid, unsupported, animated, enormous and malformed input should fail gently. Display exact output bytes and dimensions; never claim the target KB is met unless verified.
- Output names are sanitized. Ensure object URLs are revoked. No invisible watermark, remote fonts, unnecessary trackers or ad scripts. Follow-system dark mode via CSS is welcome.
- Never claim a published Docker image or successful PR is proof of live netcup deployment. The host proxy, Cloudflare record, origin certificate, GH Actions secrets, and live public browser E2E must be verified independently.
- CI and deploy must not use secrets in untrusted PR jobs. Only deploy SHA-pinned images from tested main. Production health check and rollback should not interrupt other sites.
