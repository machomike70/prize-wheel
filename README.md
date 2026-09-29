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
3. Embed:

```html
<iframe
  src="https://YOUR_HOST/?mode=prizes&embed=1"
  title="Prize Wheel"
  width="100%"
  height="720"
  style="border:0;max-width:560px"
  allow="autoplay"
></iframe>
```

Listen for wins:

```js
window.addEventListener('message', (e) => {
  if (e.data?.type === 'prize-wheel:win') {
    console.log(e.data.result, e.data.signature);
  }
});
```

## Telegram

Point BotFather’s Web App URL at `https://YOUR_HOST/`. MainButton spins; winner + proof go out via `sendData`.

## Verify a spin

`GET /api/verify?payload=<url-encoded-json>&sig=<hex>` → `{ valid: true|false }`
