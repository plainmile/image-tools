import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://image.plainmile.com',
  integrations: [react(), sitemap({ filter: (page) => !page.endsWith('/404/') })],
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
