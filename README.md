# Prize Wheel

Vegas-style roulette for names or prizes, with **server-committed fair spins** (HMAC-signed), iframe embed, and Telegram Mini App hooks.

## Quick start

```bash
cp .env.example .env
# set SPIN_SECRET to a long random string
npm install
npm start
```

Open http://127.0.0.1:3847/ — embed demo at `/embed-demo.html`.

## Deploy to your site

This is a **Node** app (Express), not static-only GitHub Pages.

1. Host on Railway, Render, Fly.io, or any Node VPS.
2. Set env: `SPIN_SECRET`, `PORT`, `CORS_ORIGINS` (your site origins).
3. Embed with an iframe pointing at `https://YOUR_HOST/?mode=prizes&embed=1`.

Listen for `prize-wheel:win` postMessage events for the signed result.

## Telegram

Point BotFather’s Web App URL at `https://YOUR_HOST/`.

## Verify a spin

`GET /api/verify?payload=<url-encoded-json>&sig=<hex>` → `{ valid: true|false }`
