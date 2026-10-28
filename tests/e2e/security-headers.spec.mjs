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

test('HTML, static assets and 404 keep security headers despite location-specific cache policies',async({request})=>{
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
  verifySecurityHeaders(staticFile);

  const missing=await request.get('/does-not-exist');
  expect(missing.status()).toBe(404);
  verifySecurityHeaders(missing);
  expect(missing.headers()['x-robots-tag']).toContain('noindex');
});
