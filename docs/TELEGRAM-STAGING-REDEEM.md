# Telegram identity-confirm → staging testnet redeem

**Scope:** Prize Wheel **staging only** (`:3848`, `/opt/prize-wheel-staging`). No prod / no mainnet.

## Flow

1. Micheal opens a **private** chat with `@Get_Off_my_lawn_Bot` and sends `/start`, `/payout`, or `/claim`.
2. With `PRIZE_WHEEL_STAGING_REDEEM=1` on the GOML bot, the bot calls staging  
   `POST /api/admin/ledger-redeem` and replies in that chat with a one-time `STG-…` code.
3. Micheal replies in the **same** private chat with the code **and** his testnet classic address `r…`, e.g.  
   `STG-0123ABCD4567EF89 rN7n7…`
4. Bot calls staging `POST /api/redeem` → testnet Payment from staging hot wallet (when sends are enabled).
5. Bot replies with success + tx hash (no secrets).

## Reply Format

In the private chat with `@Get_Off_my_lawn_Bot`, user receives a one-time code like:

```
STG-0123ABCD4567EF89
```

and replies with:

```
STG-0123ABCD4567EF89 rN7n7otEjBvSjRaBqFh5VCqPLqnHv4xaoqY2A1J
```

The bot matches the code to the chat, validates the classic address, and triggers the testnet payout.

## Fallback UI

- `https://goml.xtremerippleprotocol.online/wheel-staging/redeem.html`  
  Public form POSTs `{ code, address }` to `/api/redeem` (no Telegram binding).

## Env (GOML bot / `scripts/infra/.env`)

| Variable | Purpose |
|----------|---------|
| `PRIZE_WHEEL_STAGING_REDEEM=1` | **Enable bridge** (private chats only) — **required flag** |
| `PRIZE_WHEEL_STAGING_URL` | Default `http://127.0.0.1:3848` |
| `PRIZE_WHEEL_STAGING_ADMIN_TOKEN` | Optional; else uses `ADMIN_TOKEN` |
| `PRIZE_WHEEL_STAGING_PRIZE_LABEL` | Ledger prize label for issue API |

## Wire-in (GOML bot `main.py`)

The GOML bot (currently deployed under `goml-radio/artifacts/telegram-bot/`) imports and calls:

```python
from prize_wheel_staging_redeem import register_handlers, maybe_issue_after_start

# In Application setup:
register_handlers(application)

# In /start handler:
await maybe_issue_after_start(update, context)
```

- `register_handlers(app)` — registers `/payout`, `/claim`, and the `STG-…` + `r…` reply handler (group 0, before ConversationHandler).
- `maybe_issue_after_start(update, context)` — called from `/start` to issue a code on first contact (when flag is on, private chat only).

Reference implementation: `integrations/telegram/prize_wheel_staging_redeem.py` (this repo).

## Safety

- Staging only; gated by env flag; private chats only.
- Code is bound to the Telegram `chat_id` that received it (local state file).
- Never log bot token, admin token, or hot wallet seed.
- Do not message a chat until that user `/start`s (or `/payout` / `/claim`).
