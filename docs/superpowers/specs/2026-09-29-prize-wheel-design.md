# Prize Wheel MVP Design

Date: 2026-09-29  
Status: Approved for build after user review of this doc

## Goal

A prize / name spinner hosted on Grok Bot's computer for development, later migratable to Micheal's server. Works as:

1. Standalone web page
2. Embeddable iframe on merch / discount / campaign sites
3. Telegram Mini App

Spins are **server-committed and verifiable** so outcomes are not client-spoofable.

## Scope (MVP)

In:

- Names mode and Prizes mode (toggle)
- Add / remove items; persist lists in `localStorage`
- Spin animation that lands on the **server-chosen** segment
- Confetti + winner banner
- iframe embed (query params + `postMessage`)
- Fair-spin API with HMAC-signed proof + public verify endpoint
- Telegram WebApp expand, MainButton spin, `sendData` of winner + proof when inside Telegram
- Static UI + small Node API co-hosted locally

Out (post-MVP):

- Multi-tenant admin UI / accounts
- Weighted odds UI (API can accept weights later)
- BotFather bot creation (user configures Web App URL when ready)
- Production DB / analytics
- CDN deploy (GitHub Pages alone cannot host the fair API)

## Architecture

```
[Browser / iframe / Telegram WebApp]
        |  GET static assets
        |  POST /api/spin  { mode, items[] }
        |  GET  /api/verify?payload&sig
        v
[Node server on box]
  - express.static(public/)
  - /api/spin   → crypto.randomInt + HMAC-SHA256
  - /api/verify → recompute HMAC, return { ok }
```

Stack: Node 20+, Express, plain HTML/CSS/JS, Winwheel (canvas), canvas-confetti. No frontend build step for MVP.

Layout on disk:

```
/workspace/prize-wheel/
  public/          # index.html, style.css, script.js, tg.js, vendor/
  server/          # index.js, spin.js, config.js
  docs/superpowers/specs/
  package.json
  .env.example     # SPIN_SECRET
```

## Fair spin protocol

1. Client sends ordered `items` (non-empty strings, ≥ 2) and `mode` (`names` | `prizes`).
2. Server normalizes (trim, reject empties/duplicates policy: allow duplicates), builds canonical JSON: `{ mode, items, index, nonce, ts }` where `index = crypto.randomInt(0, items.length)`, `nonce` is 16 random bytes hex, `ts` is Unix ms.
3. Server signs canonical UTF-8 string with HMAC-SHA256 using `SPIN_SECRET`; returns `{ result: { mode, items, index, label, nonce, ts }, signature }`.
4. Client animates Winwheel to segment `index + 1` (Winwheel is 1-based) using `animation.stopAngle` / `prizeNumber` so the visual match is forced to the server result — **client never picks the winner**.
5. Anyone can `GET /api/verify?payload=<url-encoded-json>&sig=<hex>` (or POST body) and get `{ valid: true|false }`.
6. iframe parent receives `postMessage({ type: 'prize-wheel:win', result, signature }, parentOrigin)` after animation finishes.
7. Telegram: `Telegram.WebApp.sendData(JSON.stringify({ result, signature }))` after win when WebApp is present; do not force-close unless embed param `autoclose=1`.

Security notes:

- `SPIN_SECRET` stays server-only; rotate by changing env.
- CORS: allow configured origins (`CORS_ORIGINS`, default `*` in local MVP with note to lock down on migrate).
- Rate-limit `/api/spin` lightly (e.g. 30/min/IP) to reduce abuse.
- Proof binds the exact item list; changing labels after the fact invalidates verification.

## UI / UX

- Centered wheel, pointer at top
- Mode tabs: Names | Prizes
- Input + Add; list with remove
- Spin button (disabled while spinning or &lt; 2 items)
- Winner overlay with label + "Verified spin" badge linking conceptually to verify (show truncated sig)
- Embed mode (`?embed=1`): hide page chrome/title padding; keep wheel + essential controls (optional `?controls=0` for spin-only when parent triggers via `postMessage` `prize-wheel:spin`)
- Query: `?mode=names|prizes`, `?embed=1`, `?autoclose=1`

Default seed lists:

- Names: empty (placeholder segment "Add names")
- Prizes: sample discounts e.g. `10% Off`, `Free Shipping`, `Mystery Gift`, `Try Again`

## Telegram

- Load Telegram WebApp script from `telegram.org`
- On ready: `expand()`, theme params optional
- MainButton = Spin when ≥ 2 items
- Outside Telegram, page still works fully

## Hosting (now vs later)

**Now:** `npm start` on the box; open via desktop browser / share URL if box exposes one. Micheal tests iframe by pointing a local HTML page at the same origin or using a test harness page under `/public/embed-demo.html`.

**Later migrate:** copy repo + set `SPIN_SECRET`, `PORT`, `CORS_ORIGINS` on his server; point BotFather Web App URL and site iframes at that host.

## Success criteria

- Adding names/prizes updates the wheel
- Spin requests server first; animation always lands on returned index
- Verify endpoint confirms a real spin and rejects tampered payload
- iframe demo receives win message
- Telegram hooks no-op safely in normal browser
- App runs with one `npm start` on the box

## Testing

- Manual: spin 20×, check index distribution roughly uniform
- Unit: sign/verify round-trip; reject bad sig; reject &lt; 2 items
- Manual embed-demo.html parent listener
