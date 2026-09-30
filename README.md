# Prize Wheel

Vegas-style roulette with **server-committed fair spins** (HMAC-signed), iframe embed, Telegram Mini App hooks, **shop spin codes**, and **GOML wallet entitlements**.

## Quick start

```bash
cp .env.example .env
# set SPIN_SECRET; for GOML admin copy SESSION_SECRET + ADMIN_TOKEN (+ Xaman keys) from GOML
npm install
npm start
```

Open http://127.0.0.1:3847/

## Sites

| Mode | URL | Access |
|------|-----|--------|
| Open / demo | `/?mode=prizes` | Free spins (dev) |
| Shop | `/?site=shop&code=XXXX` | One unused ticket code → one spin, then locked |
| GOML | `/?site=goml` | XRPL wallet (Xaman) → one pre-checkout spin per wallet |
| Admin | `/admin` | **Same GOML admin session** (`goml_wallet_token` / `goml_admin_token`) |
| Live watch | `/?watch=1` or `/live` | **Public** — no wallet/shop gate; watches admin giveaway spins |

Host heuristics: `shop.*` → shop, `goml.*` → goml.

## Shop split (Xaman vs Square)

| Checkout | Spin | How |
|----------|------|-----|
| **Xaman / XRP** | Optional **pre-checkout** | Embed `/?site=shop&pre=1&embed=1` — wallet SignIn → one `site=shop` wallet entitlement spin. Discount prizes (`10% Off`, `$5 Off`, `Free Shipping`, or `discount:percent:N`) are returned as `discount` on spin/lookup; shop applies via `prize_ticket_code` at checkout. |
| **Square / card** | **Thank-you** (unchanged) | Shop mints `POST /api/tickets` on fulfill; order page embeds `/?site=shop&code=…`. |

Xaman orders **do not** mint a post-purchase code (no double spin).



## Admin (GOML)

Prize Wheel admin is **not** a separate password allowlist. It accepts the same credentials as GOML Radio:

- `X-Wallet-Token` — JWT signed with shared `SESSION_SECRET`, role `owner` or `admin`
- `X-Admin-Token` — shared `ADMIN_TOKEN`

On GOML, open **Admin → Prize Wheel** (iframe to `/wheel/admin`) after signing in as usual. All current GOML admins automatically have access.

### X Space Live Giveaways

The admin page opens with **X Space Giveaway** at the top. It auto-syncs **everyone in the room** (hosts, speakers, AND listeners) from the configured Space.

**Flow:**
1. Open `/wheel/admin` — auto-scrapes the saved/default Space URL on load
2. Shows participant count with breakdown: "X in room: N hosts, N speakers, N listeners"
3. **Go Live / Spin** button: re-scrapes → syncs Names list (add new arrivals, remove who left) → fair-spins only current participants
4. Winner is broadcast to public watch page (`/?watch=1`) and recorded

**Space URL:** defaults to `https://twitter.com/i/spaces/1AKEmvzOBeeKL` (saved per session). Paste any live Space URL or bare ID.

**Setup:** requires `X_BEARER_TOKEN` in `.env` — get from [X Developer Portal](https://developer.twitter.com/en/portal/dashboard).

**Scraping Strategy:**
- **Primary**: AudioSpace GraphQL (unofficial X endpoint) — fetches hosts + speakers + **listeners** (full room)
- **Fallback**: Official X API v2 — only hosts + speakers if GraphQL fails
- **Safety**: When listeners unavailable, UI shows warning and blocks spinning unless admin explicitly overrides with "I understand — spin hosts/speakers only" checkbox

**GraphQL Details:**
The scraper uses X's AudioSpaceById GraphQL endpoint (same method used by community Space tools). This is an **unofficial endpoint** but widely used and stable. Requires only a valid bearer token (same as official API). If X changes the GraphQL schema, the query ID in `server/spaces.js` may need updating.

**Manual giveaways:** use the **Giveaway spin** section below — paste contestant names (Names mode) or spin the prize list (Prizes mode). Spins are fair HMAC-signed and do **not** consume shop codes or wallet entitlements. Optionally record the winner.

Optional `ADMIN_PASSWORD` is only for shop/API tooling via `X-Admin-Token`, not a GOML gate.

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/tickets` | GOML admin | Mint tickets `{ site, count?, codes?, orderId?, walletAddress? }` |
| GET | `/api/tickets` | GOML admin | List (`?site=&unused=1`) |
| GET | `/api/tickets/lookup?code=` | public | Peek used/unused |
| PUT | `/api/prizes` | GOML admin | Replace server prize list |
| GET | `/api/prizes` | public | Current prize list |
| POST | `/api/spin` | site-dependent | Fair HMAC spin; shop needs `code`; goml needs wallet session |
| GET/POST | `/api/verify` | public | Verify HMAC proof |
| POST | `/api/auth/xaman/payload` | public | Start Xaman SignIn |
| GET | `/api/auth/xaman/payload/:uuid` | session | Poll + issue member JWT |
| POST | `/api/auth/xrpl/challenge` | public | Challenge for browser wallets |
| POST | `/api/auth/xrpl/verify` | public | Verify signature → JWT |
| GET | `/api/entitlement` | wallet | GOML spin entitlement status |
| GET | `/api/admin/status` | GOML admin | Counts + prizes |
| POST | `/api/admin/spin` | GOML admin | Live giveaway — no ticket/wallet burn; `{ mode, items?, record?, note? }` |
| GET | `/api/admin/giveaways` | GOML admin | Recent recorded giveaway winners |

## Embed

Shop:

```html
<iframe
  src="https://shop.bwtz.online/wheel/?site=shop&code=TICKET&mode=prizes&embed=1"
  title="Prize Wheel"
  width="100%" height="720"
  style="border:0;max-width:560px"
  allow="autoplay"
></iframe>
```

GOML:

```html
<iframe
  src="https://goml.xtremerippleprotocol.online/wheel/?site=goml&embed=1"
  title="Prize Wheel"
  width="100%" height="720"
  style="border:0;max-width:560px"
  allow="autoplay"
></iframe>
```

Behind Caddy `handle_path /wheel*`, the app prefixes API calls with `/wheel`.

## Env

See `.env.example`. Never commit `.env` or `data/`.

## Proxy path note (GOML / shop)

When mounted under Caddy `handle_path /wheel*`, always use a trailing slash:
`/wheel/?site=goml` (not `/wheel?site=goml`). Without it, relative assets resolve to the
host root and the GOML SPA HTML is served instead of `script.js`. Caddy redirects
`/wheel` → `/wheel/?…` (query preserved) and `index.html` also self-corrects.


## Live giveaway (homepage watch)

Public viewers embed `/wheel/?watch=1&embed=1&controls=0` (GOML homepage section). Admins spin from **Admin → Prize Wheel → Giveaway spin**; the server broadcasts via SSE (`GET /api/live/stream`) and persists state in `data/store.json` (`live`).

- `GET /api/live` — current giveaway state (items, spinning/done, winner)
- `POST /api/admin/spin` — fair spin; `broadcast` defaults on so homepage watchers animate the same outcome
- `POST /api/admin/live/ready` — push names/prizes to watchers before spinning
- `POST /api/admin/live/clear` — clear live state

Shop/GOML wallet and spin-code gates still apply to non-watch URLs (`/?site=goml`, `/?site=shop&code=…`).
