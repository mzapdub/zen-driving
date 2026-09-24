# Zen Driving

An endless procedural road runner built with Three.js and WebGPU/WebGL fallback.

Play the public build at **https://mzapdub.github.io/zen-driving/**.

## Extra: Three AI Futures

`public/ai-futures.html` is a self-contained 30-second canvas film about three possible outcomes of the AI revolution (2030–2040): The Garden, The Mirror and The Fracture, narrated by an AI. It deploys alongside the game at **https://mzapdub.github.io/zen-driving/ai-futures.html**. Append `?t=12` to open a paused still at any moment.

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

The deployment is static. Shared leaderboard writes require a separate hosted datastore/API with authentication, validation, rate limiting, and abuse controls.
