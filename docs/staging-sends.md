# Staging testnet SENDS (prize-wheel)

Staging-only feature: after a winner claims a one-time redeem code, the server
may submit a real **XRPL Testnet** Payment from a staging hot wallet.

Production must keep sends disabled. There is no mainnet code path in
`server/stagingSender.js`.

## Required environment (staging `.env`)

Set these on the staging host only. Never commit real values or seeds.

| Variable | Purpose | Example / notes |
|---|---|---|
| `STAGING_SENDS_ENABLED` | Master gate | `true` to allow sends; anything else blocks |
| `XRPL_NETWORK` | Network gate | must be `testnet` |
| `STAGING_HOT_WALLET_ADDRESS` | Expected classic address | must match address derived from credential seed |
| `STAGING_PAYOUT_XRP` | XRP amount per prize | positive number; hard-capped at 25 in code |

Optional / related (already used elsewhere; not required by stagingSender gates):

- `HOT_WALLET_SEED` — legacy env seed used by older `hotWallet.js`; staging SENDS
  prefer systemd credentials (see below). Do not put the send seed in git.
- `DATA_DIR` — store path for redeem rows (`claimed_pending` / `sending` / `sent` / `send_failed`).

Suggested `.env.example` additions (empty placeholders only):

```bash
# Staging-only testnet SENDS (see docs/staging-sends.md)
# STAGING_SENDS_ENABLED=false
# XRPL_NETWORK=testnet
# STAGING_HOT_WALLET_ADDRESS=
# STAGING_PAYOUT_XRP=1
```

## Systemd credential (preferred seed delivery)

Do **not** put the seed in the unit file or in git. Use a drop-in that loads a
root-owned seed file as a credential. Example template:

`systemd/prize-wheel-staging.service.d/sends.conf.template`

```ini
# Staging-only: expose testnet hot wallet seed as a systemd credential
# (readable only by this unit at $CREDENTIALS_DIRECTORY/hot_wallet_seed).
# Seed file stays root:600 and is never committed.
[Service]
LoadCredential=hot_wallet_seed:/path/to/staging-hot-wallet-seed
```

On the host:

1. Write the seed file with mode `600`, owner `root`.
2. Install the drop-in under `/etc/systemd/system/prize-wheel-staging.service.d/sends.conf`
   with the real absolute path substituted for `/path/to/staging-hot-wallet-seed`.
3. `systemctl daemon-reload && systemctl restart prize-wheel-staging`.

The process reads `$CREDENTIALS_DIRECTORY/hot_wallet_seed`. The seed is never
logged, returned in API responses, or written to the store.

Base unit still uses `EnvironmentFile=/opt/prize-wheel-staging/.env` for the
non-secret flags and the expected address / payout amount.

## Runtime gates (all must pass)

1. `STAGING_SENDS_ENABLED=true`
2. `XRPL_NETWORK=testnet`
3. Valid `STAGING_PAYOUT_XRP` (finite, >0, ≤25)
4. Credential seed present and parseable
5. Derived address === `STAGING_HOT_WALLET_ADDRESS`
6. Before each send: connected server `network_id === 1` (testnet)

If any gate fails, `/api/redeem` still accepts the claim as `claimed_pending`
and nothing is sent.

## API surface (staging)

- `POST /api/redeem` — claim; when gates pass, one-shot send (`beginSend` → Payment → `finishSend`)
- `GET /api/redeem/status?code=...` — public status for a code
- `GET /api/admin/redeems` — admin list + hot-wallet public status
- Hot-wallet public status includes `sendsEnabled`, `sendBlockedReason`, `payoutXrp`

Failed or ambiguous sends mark `send_failed` and **never auto-retry**.

## Files in this pack

See `MANIFEST.txt`. Source of truth for the enablement change:

- `server/stagingSender.js` (new)
- `server/redeem.js` (send state helpers)
- `server/index.js` (route wiring)
