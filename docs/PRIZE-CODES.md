# Prize codes (wheel purchase / discount prizes) — STAGING

Scope: Prize Wheel **staging** (`/opt/prize-wheel-staging`, port 3848,
`https://goml.xtremerippleprotocol.online/wheel-staging/`). Production is untouched.

## What a "prize code" is

| Record | How it's created | What the code does |
|---|---|---|
| **Spin ticket** | Admin UI §4 / `POST /api/tickets` (the shop calls this after a paid order) | Customer opens `/wheel-staging/?code=XXXX-XXXX-XX&mode=prizes&site=shop` and gets **one** spin. The server spins over the configured prize list, signs it (HMAC), and the **same code becomes their prize code**. |
| **Direct prize code** | Admin UI §3 / `POST /api/admin/prize-codes` | Code is already bound to a chosen prize (no spin). Handy for giveaways and support. |
| **XRP prize (STG-…)** | Spin lands on an `xrp` prize, or direct issue of an `xrp` prize | Winner redeems with an XRPL address at `/redeem.html` (or the Telegram bridge). Staging sends a **testnet** Payment. |

Redeem is **one-time**: Admin UI §5 / `POST /api/admin/prize-codes/redeem` stamps `redeemedAt`
(and an optional order ID). A second redeem returns 409.

The shop (bear-witness-shop) already reads `GET /api/tickets/lookup?code=…&site=shop` and applies
`discount` with `apply_prize_discount`. The discount shape is the same one it expects:

| Prize type | `discount` in lookup | Shop effect |
|---|---|---|
| `percent` (5% Off, 10% Off) | `{type:"percent", value:5}` | % off merch subtotal |
| `fixed` ($5 Off) | `{type:"fixed_cents", value:500}` | USD off merch subtotal |
| `free_shipping` | `{type:"free_shipping", value:100}` | shipping = $0 |
| `free_item` (Free 1st Edition T-Shirt) | `{type:"free_item", value:0, sku:"first-edition-tee"}` | $0 cash effect; order records `discount_type=free_item`, tee added at fulfilment |
| `token`, `nft`, `mystery`, `manual` | `null` | fulfilled by hand; redeem the code when delivered |
| `xrp` | `null` (+ `ledgerRedeemCode`) | testnet Payment via `/api/redeem` on staging |
| `none` (Try Again) | `null` | no code to redeem |

## Configured list (staging, seeded from the live wheel + the required purchase codes)

1. 5% Off — percent 5
2. 10% Off — percent 10
3. Free Shipping — free_shipping
4. Free 1st Edition T-Shirt — free_item, sku `first-edition-tee`
5. Mystery Gift — mystery (manual)
6. 1000 BWTZ Tokens — token (manual), value 1000
7. Liquid Apes — nft (manual)
8. VIP Drop — manual
9. Try Again — none
10. STAGING ONLY example ledger prize (sends disabled) — xrp (testnet; the label is kept because the Telegram bridge looks it up by name)

## How Micheal adds a new prize code (admin UI)

1. Open `https://goml.xtremerippleprotocol.online/wheel-staging/prizes.html`
   (also linked from the Spaces admin page as "Prize codes").
2. Paste the staging admin token once → **Unlock** (remembered in this browser).
3. Section **2 · Add a prize code**:
   - *Wheel label*: what shows on the wheel, e.g. `15% Off`
   - *Type*: `percent` / `fixed` / `free_shipping` / `free_item` / `token` / `nft` / `mystery` / `manual` / `xrp` / `none`
   - *Value*: percent (1–100) for `percent`, USD for `fixed` (leave blank otherwise)
   - *SKU*: optional, for `free_item`
   - keep **Show on wheel** ticked → **Add prize**
4. The prize is live immediately: it appears in the table, on the public wheel (`GET /api/prizes`), and in
   every new ticket spin. Untick **On wheel** to pause it, **Edit** to change it, **Delete** to remove it
   (codes already issued keep working).
5. To hand out a code directly: section **3 · Issue codes** → pick the prize, count → **Issue code(s)**.
6. To let someone spin: section **4 · Mint spin tickets** → copy the link shown next to each code.
7. To apply / fulfil: section **5** → paste the code → **Look up** (shows prize + checkout quote) → **Redeem**.

### Same thing via API (curl on the VPS)

```bash
set -a; . /opt/prize-wheel-staging/.env; set +a   # loads ADMIN_TOKEN, never echo it
B=http://127.0.0.1:3848; H="X-Admin-Token: $ADMIN_TOKEN"
curl -s -X POST $B/api/admin/prizes -H "$H" -H 'Content-Type: application/json' \
  -d '{"label":"15% Off","type":"percent","value":15}'
curl -s $B/api/admin/prizes -H "$H"                       # list (ids)
curl -s -X PUT $B/api/admin/prizes/15pct-off -H "$H" -H 'Content-Type: application/json' -d '{"enabled":false}'
curl -s -X POST $B/api/admin/prize-codes -H "$H" -H 'Content-Type: application/json' -d '{"prizeId":"15pct-off","count":3}'
curl -s -X POST $B/api/tickets -H "$H" -H 'Content-Type: application/json' -d '{"site":"shop","count":1,"orderId":"BW-123"}'
curl -s "$B/api/tickets/lookup?code=ABCD-EFGH-JK&subtotalCents=5000&shippingCents=800"
curl -s -X POST $B/api/admin/prize-codes/redeem -H "$H" -H 'Content-Type: application/json' -d '{"code":"ABCD-EFGH-JK","orderId":"BW-123"}'
```

### Storage / config file

Everything lives in `/opt/prize-wheel-staging/data/store.json`: `prizes` (the catalog) and `tickets`
(spin tickets + prize codes). Prefer the UI/API — the server caches the store in memory, so a hand edit
of the file must be followed by `systemctl restart prize-wheel-staging` (and is overwritten if the
server writes first). The first-time seed only runs once (`prizeCatalogVersion`), so deletions stick.

## Testing

`scripts/prize-codes-e2e.py` (stdlib only) exercises add/edit/disable/delete, direct issue + lookup/quote +
redeem for every prize, real ticket spins until every enabled prize has been hit, HMAC verify, double-spend
protection, the admin wheel spin, and the XRP testnet path.

```bash
set -a; . /opt/prize-wheel-staging/.env; set +a
python3 /opt/prize-wheel-staging/scripts/prize-codes-e2e.py --base http://127.0.0.1:3848
```

## Limits / open items

- Free tee: the shop has no `free_item` math yet; it records the prize on the order and the tee must be added
  at fulfilment (or the shop gets a small change to add the SKU line item at $0).
- Shop staging `PRIZE_WHEEL_URL` is blank (no-op by design), so the shop does not call staging yet.
- Production wheel is still on the old label-parsing code; promoting this needs a prod deploy decision.
