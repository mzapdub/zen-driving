import { defineConfig } from 'vite';

/**
 * Project Pages sites are served from /<repo>/, so the build has to be
 * repository-relative. Derive the base from GITHUB_REPOSITORY rather than
 * hard-coding it — the same config works from a fork or after a rename.
 */
const repository = (process.env.GITHUB_REPOSITORY ?? '').split('/')[1] || 'le-painterr';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? `/${repository}/` : '/',
  build: {
    // Every texture is already a compressed WebP; inlining would only bloat the
    // JS bundle and defeat the per-image budget check on dist/.
    assetsInlineLimit: 0,
  },
});
