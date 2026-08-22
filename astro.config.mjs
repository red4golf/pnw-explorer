import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The site is served from the ROOT of its own domain. There is deliberately no
// `base` here: the old GitHub Pages subpath (/PNWHistoricalExplorer) had to be
// kept in sync by hand across astro.config, the service worker, and the web
// manifest, and a drift between any two of them silently broke offline mode.
// One origin, one root, no prefix to synchronise.
const site = process.env.SITE_URL || 'https://pnwhistoricalexplorer.com';

export default defineConfig({
  site,
  trailingSlash: 'never',
  integrations: [
    sitemap({ filter: (page) => !page.includes('/admin') }),
  ],
  build: { inlineStylesheets: 'auto', format: 'file' },
});
