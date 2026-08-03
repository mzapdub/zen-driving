# Zen Driving

An endless procedural road runner built with Three.js and WebGPU/WebGL fallback.

Play the public build at **https://mzapdub.github.io/zen-driving/**.

## Deployment

GitHub Pages deploys the locked Vite production build from `main` through `.github/workflows/deploy-pages.yml`. The workflow validates repository-relative asset paths before publishing.

Local development:

```powershell
npm ci
npm run dev
```

Production-equivalent deployment check:

```powershell
$env:GITHUB_ACTIONS = 'true'
npm run build
npm run smoke:deployment
```

## Texture assets

Every shipped texture is WebP. The bark and foliage atlases are awaited during
scene build, so image weight delays the first playable frame rather than merely
costing bandwidth — `npm run smoke:deployment` enforces a 768 KB per-image and
4 MB total budget on the built output to keep that from regressing.

After replacing a source texture, re-encode before committing:

```powershell
npm run assets:optimize
```

The script reads any PNG named in `scripts/optimize-assets.mjs` and writes the
WebP beside it. Source PNGs are not kept in the working tree; earlier revisions
remain recoverable from git history.

The deployment is static. Shared leaderboard writes require a separate hosted datastore/API with authentication, validation, rate limiting, and abuse controls.
