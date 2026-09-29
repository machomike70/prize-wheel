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

Host heuristics: `shop.*` → shop, `goml.*` → goml.

## Admin (GOML)

Prize Wheel admin is **not** a separate password allowlist. It accepts the same credentials as GOML Radio:

- `X-Wallet-Token` — JWT signed with shared `SESSION_SECRET`, role `owner` or `admin`
- `X-Admin-Token` — shared `ADMIN_TOKEN`

On GOML, open **Admin → Prize Wheel** (iframe to `/wheel/admin`) after signing in as usual. All current GOML admins automatically have access.

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
