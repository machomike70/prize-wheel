"""
Prize Wheel STAGING Telegram redeem bridge (identity-confirm → testnet payout).

Gated by PRIZE_WHEEL_STAGING_REDEEM=1. Private chats only.
Issues a ledger redeem code via staging admin API, binds it to chat_id locally,
and on reply (STG-… + r…) calls POST /api/redeem. Never logs tokens/seeds.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Optional

from telegram import Update
from telegram.ext import (
    ApplicationHandlerStop,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

_FLAG = str(os.environ.get("PRIZE_WHEEL_STAGING_REDEEM", "")).strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
_BASE = (
    os.environ.get("PRIZE_WHEEL_STAGING_URL", "http://127.0.0.1:3848")
    .strip()
    .rstrip("/")
)
# Prefer dedicated token; fall back to shared ADMIN_TOKEN (same value on this host).
_ADMIN = (
    os.environ.get("PRIZE_WHEEL_STAGING_ADMIN_TOKEN")
    or os.environ.get("ADMIN_TOKEN")
    or ""
).strip()
_PRIZE = (
    os.environ.get("PRIZE_WHEEL_STAGING_PRIZE_LABEL")
    or "STAGING ONLY example ledger prize (sends disabled)"
).strip()
_STATE_PATH = os.environ.get(
    "PRIZE_WHEEL_STAGING_REDEEM_STATE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".prize-wheel-staging-redeems.json"),
)
_FALLBACK_UI = os.environ.get(
    "PRIZE_WHEEL_STAGING_REDEEM_UI",
    "https://goml.xtremerippleprotocol.online/wheel-staging/redeem.html",
).strip()

_CODE_RE = re.compile(r"\b(STG-[A-F0-9]{16})\b", re.IGNORECASE)
# XRPL classic address (rough; server validates properly)
_ADDR_RE = re.compile(r"\b(r[1-9A-HJ-NP-Za-km-z]{24,34})\b")

_lock = threading.Lock()


def enabled() -> bool:
    return _FLAG and bool(_BASE) and bool(_ADMIN)


def _load_state() -> dict:
    try:
        with open(_STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("by_chat"), dict):
            return data
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[pw-stg-redeem] state load error: {type(e).__name__}")
    return {"by_chat": {}}


def _save_state(data: dict) -> None:
    tmp = _STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, _STATE_PATH)


def _http_json(method: str, path: str, body: Optional[dict] = None, admin: bool = False) -> tuple[int, dict]:
    url = _BASE + path
    data = None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if admin:
        headers["X-Admin-Token"] = _ADMIN
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw[:200]}
            return resp.status, parsed if isinstance(parsed, dict) else {"ok": False}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"error": raw[:200] or e.reason}
        if not isinstance(parsed, dict):
            parsed = {"error": str(e.reason)}
        return e.code, parsed
    except Exception as e:
        return 0, {"ok": False, "error": f"request failed: {type(e).__name__}"}


def issue_code_for_chat(chat_id: int) -> dict[str, Any]:
    status, data = _http_json(
        "POST",
        "/api/admin/ledger-redeem",
        body={"prizeLabel": _PRIZE},
        admin=True,
    )
    code = (data or {}).get("redeemCode")
    if status != 200 or not code:
        err = (data or {}).get("error") or f"HTTP {status}"
        return {"ok": False, "error": err}
    code = str(code).strip().upper()
    with _lock:
        state = _load_state()
        state["by_chat"][str(chat_id)] = {
            "code": code,
            "status": "issued",
            "issuedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "prize": (data or {}).get("prize") or _PRIZE,
        }
        _save_state(state)
    # Never include admin token; code is meant for this chat only.
    return {
        "ok": True,
        "code": code,
        "prize": (data or {}).get("prize") or _PRIZE,
        "notice": (data or {}).get("notice"),
    }


def _instructions(code: str) -> str:
    return (
        "🎰 *Prize Wheel STAGING redeem*\n\n"
        f"Your one-time code:\n`{code}`\n\n"
        "Reply in *this private chat* with the code *and* your XRPL *testnet* classic address, e.g.:\n"
        f"`{code} rYourTestnetAddressHere`\n\n"
        "Or two lines:\n"
        f"`{code}`\n"
        "`rYourTestnetAddressHere`\n\n"
        "On match, staging will send a *testnet* Payment from the staging hot wallet.\n"
        f"Fallback UI: {_FALLBACK_UI}"
    )


async def cmd_issue(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not enabled():
        return
    if not update.effective_chat or update.effective_chat.type != "private":
        if update.message:
            await update.message.reply_text("Open a private chat with this bot, then use /payout or /claim.")
        return
    if not update.message:
        return
    await update.message.reply_text("Issuing staging redeem code…")
    result = issue_code_for_chat(update.effective_chat.id)
    if not result.get("ok"):
        await update.message.reply_text(f"Could not issue code: {result.get('error', 'unknown')}")
        return
    await update.message.reply_text(
        _instructions(result["code"]),
        parse_mode="Markdown",
        disable_web_page_preview=True,
    )


async def maybe_issue_after_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Called from /start when flag is on — private chat only."""
    if not enabled():
        return
    if not update.effective_chat or update.effective_chat.type != "private":
        return
    if not update.message:
        return
    result = issue_code_for_chat(update.effective_chat.id)
    if not result.get("ok"):
        await update.message.reply_text(
            f"(Staging redeem) Could not issue code: {result.get('error', 'unknown')}"
        )
        return
    await update.message.reply_text(
        _instructions(result["code"]),
        parse_mode="Markdown",
        disable_web_page_preview=True,
    )


def _open_code_for_chat(chat_id: int) -> Optional[str]:
    with _lock:
        state = _load_state()
        row = state.get("by_chat", {}).get(str(chat_id))
        if not row or row.get("status") != "issued":
            return None
        return str(row.get("code") or "").upper() or None


def _mark_chat(chat_id: int, **fields: Any) -> None:
    with _lock:
        state = _load_state()
        row = state.setdefault("by_chat", {}).get(str(chat_id)) or {}
        row.update(fields)
        state["by_chat"][str(chat_id)] = row
        _save_state(state)


async def on_redeem_reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not enabled():
        return
    if not update.effective_chat or update.effective_chat.type != "private":
        return
    msg = update.message
    if not msg or not msg.text:
        return
    text = msg.text.strip()
    code_m = _CODE_RE.search(text)
    addr_m = _ADDR_RE.search(text)
    if not code_m or not addr_m:
        return  # not our message; let other handlers run
    code = code_m.group(1).upper()
    address = addr_m.group(1)
    expected = _open_code_for_chat(update.effective_chat.id)
    if not expected:
        await msg.reply_text(
            "No open staging code for this chat. Send /payout or /claim (or /start) first."
        )
        raise ApplicationHandlerStop
    if code != expected:
        await msg.reply_text(
            "That code does not match the open code issued to this chat. "
            "Use the code I sent you, or request a new one with /payout."
        )
        raise ApplicationHandlerStop
    await msg.reply_text("Submitting staging redeem (testnet)…")
    status, data = _http_json(
        "POST",
        "/api/redeem",
        body={"code": code, "address": address},
        admin=False,
    )
    ok = bool(data.get("ok")) and status == 200 and data.get("sent") is True
    if ok:
        tx = data.get("txHash") or ""
        explorer = data.get("explorer") or (
            f"https://testnet.xrpl.org/transactions/{tx}" if tx else ""
        )
        _mark_chat(
            update.effective_chat.id,
            status="sent",
            redeemedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            # store address only for audit of this bridge; no secrets
            winnerAddress=address,
            txHash=tx,
        )
        await msg.reply_text(
            "✅ *Staging payout sent (testnet)*\n"
            f"Amount: `{data.get('amountXrp', '?')} XRP`\n"
            f"Tx: `{tx}`\n"
            + (f"[Explorer]({explorer})" if explorer else ""),
            parse_mode="Markdown",
            disable_web_page_preview=False,
        )
    else:
        err = data.get("error") or data.get("message") or f"HTTP {status}"
        st = data.get("status")
        _mark_chat(
            update.effective_chat.id,
            status=str(st or "failed"),
            lastError=str(err)[:200],
        )
        # Do not leak internal details beyond safe API message
        extra = ""
        if data.get("txHash"):
            extra = f"\nTx hash (check explorer): `{data.get('txHash')}`"
        if st == "claimed_pending":
            await msg.reply_text(
                f"Claim recorded but sends are disabled on staging right now.\n{err}{extra}"
            )
        else:
            await msg.reply_text(f"Redeem failed: {err}{extra}", parse_mode="Markdown")
    raise ApplicationHandlerStop


def register_handlers(app) -> None:
    if not enabled():
        print("INFO: Prize Wheel staging redeem bridge OFF (PRIZE_WHEEL_STAGING_REDEEM not set).")
        return
    # Before ConversationHandler so STG- replies are not eaten by AI chat.
    app.add_handler(CommandHandler("payout", cmd_issue), group=0)
    app.add_handler(CommandHandler("claim", cmd_issue), group=0)
    app.add_handler(
        MessageHandler(
            filters.ChatType.PRIVATE
            & filters.TEXT
            & filters.Regex(r"(?i)\bSTG-[A-F0-9]{16}\b")
            & ~filters.COMMAND,
            on_redeem_reply,
        ),
        group=0,
    )
    print(
        "INFO: Prize Wheel staging redeem bridge ON "
        f"(base={_BASE}, private /start|/payout|/claim → issue; reply STG-… + r… → redeem)."
    )


def extra_bot_commands() -> list[tuple[str, str]]:
    if not enabled():
        return []
    return [
        ("payout", "Staging: get Prize Wheel redeem code"),
        ("claim", "Staging: get Prize Wheel redeem code"),
    ]
