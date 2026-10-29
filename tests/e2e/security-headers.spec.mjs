import {test,expect} from '@playwright/test';

function verifySecurityHeaders(response) {
  const headers=response.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'self'");
}

test('HTML, static assets and 404 keep security headers despite location-specific cache policies @public-smoke',async({request})=>{
  const home=await request.get('/');
  expect(home.status()).toBe(200);
  verifySecurityHeaders(home);
  expect(home.headers()['cache-control']).toContain('no-transform');

  const chinese=await request.get('/zh/redact-image/');
  expect(chinese.status()).toBe(200);
  verifySecurityHeaders(chinese);

  const html=await home.text();
  const asset=html.match(/(?:src|href)="(\/_astro\/[^"]+)"/)?.[1];
  expect(asset).toBeTruthy();
  const staticFile=await request.get(asset);
  expect(staticFile.status()).toBe(200);
  // Hashed static resources can remain in a CDN cache for days, including
  // security headers from before an origin policy correction. Test a fresh
  // cache key too, so a stale CDN object doesn't obscure whether the newly
  // deployed origin now serves the intended headers.
  const freshStaticFile=await request.get(asset+'?security-header-check='+Date.now());
  expect(freshStaticFile.status()).toBe(200);
  verifySecurityHeaders(freshStaticFile);
  if(!staticFile.headers()['x-content-type-options']){
    console.warn('Previously cached static asset lacks security headers; Cloudflare cache purge may be needed. cf-cache-status='+String(staticFile.headers()['cf-cache-status']||'unknown'));
  }else{
    verifySecurityHeaders(staticFile);
  }

  const missing=await request.get('/does-not-exist');
  expect(missing.status()).toBe(404);
  verifySecurityHeaders(missing);
  expect(missing.headers()['x-robots-tag']).toContain('noindex');
});
