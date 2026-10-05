#!/usr/bin/env python3
"""
Prize-code E2E test for Prize Wheel STAGING (stdlib only).

Usage (on the VPS, token read from env, never printed):
  set -a; . /opt/prize-wheel-staging/.env; set +a
  python3 scripts/prize-codes-e2e.py --base http://127.0.0.1:3848 [--xrp-dest rXXXX] [--max-spins 90]

Covers: add/update/disable/delete a prize via admin API, direct-issue + lookup/quote + redeem for
every prize type, ticket spins until every enabled type is hit, HMAC verify, admin /api/spin prize
codes, double-spend protection. XRP prizes redeem via /api/redeem (TESTNET only on staging).
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:3848")
ap.add_argument("--xrp-dest", default="r9637RuQhx7GVx6xYmtgEyaR4V31xxnvAY")
ap.add_argument("--max-spins", type=int, default=120)
ap.add_argument("--no-xrp-send", action="store_true")
ap.add_argument("--keep-test-prize", action="store_true")
a = ap.parse_args()
TOKEN = os.environ.get("ADMIN_TOKEN", "")
if not TOKEN:
    sys.exit("ADMIN_TOKEN not in env")

results = []  # (name, ok, detail)
def rec(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (" — " + detail if detail else ""), flush=True)

def http(method, path, body=None, admin=False):
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if admin:
        h["X-Admin-Token"] = TOKEN
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(a.base + path, data=data, headers=h, method=method)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(20); continue
            try:
                return e.code, json.loads(e.read() or b"{}")
            except Exception:
                return e.code, {}
    return 0, {}

SUB, SHIP = 5000, 800  # $50.00 merch, $8.00 shipping
def expected_quote(ptype, value):
    if ptype == "percent":
        off = round(SUB * value / 100); return {"subtotalCents": SUB - off, "shippingCents": SHIP, "discountCents": off}
    if ptype == "fixed":
        off = min(round(value * 100), SUB); return {"subtotalCents": SUB - off, "shippingCents": SHIP, "discountCents": off}
    if ptype == "free_shipping":
        return {"subtotalCents": SUB, "shippingCents": 0, "discountCents": SHIP}
    return {"subtotalCents": SUB, "shippingCents": SHIP, "discountCents": 0}

def check_coupon(code, ptype, value, label, tag):
    s, lk = http("GET", f"/api/tickets/lookup?code={code}&site=shop&subtotalCents={SUB}&shippingCents={SHIP}")
    ok = s == 200 and lk.get("used") is True and lk.get("prizeType") == ptype and lk.get("redeemed") is False
    ok = ok and lk.get("quote") == expected_quote(ptype, value)
    d = lk.get("discount")
    if ptype in ("percent", "fixed", "free_shipping", "free_item"):
        ok = ok and isinstance(d, dict)
    else:
        ok = ok and d is None
    rec(f"{tag} lookup+quote [{label}]", ok, f"code={code} discount={json.dumps(d)} quote={json.dumps(lk.get('quote'))}")
    s, rd = http("POST", "/api/admin/prize-codes/redeem", {"code": code, "orderId": f"TEST-{tag}-{int(time.time())}",
                                                         "subtotalCents": SUB, "shippingCents": SHIP}, admin=True)
    rec(f"{tag} redeem [{label}]", s == 200 and rd.get("ok") and rd["ticket"]["redeemed"], f"redeemedAt={rd.get('ticket',{}).get('redeemedAt')}")
    s, rd2 = http("POST", "/api/admin/prize-codes/redeem", {"code": code}, admin=True)
    rec(f"{tag} double-redeem blocked [{label}]", s == 409, rd2.get("error", ""))

def redeem_xrp(stg, tag):
    if a.no_xrp_send:
        rec(f"{tag} xrp STG code issued", stg.startswith("STG-"), stg); return
    s, r = http("POST", "/api/redeem", {"code": stg, "address": a.xrp_dest})
    ok = s == 200 and r.get("sent") is True and r.get("txResult") == "tesSUCCESS" and r.get("validated") is True
    rec(f"{tag} xrp redeem → testnet Payment", ok, f"code={stg} tx={r.get('txHash')} result={r.get('txResult')} err={r.get('error')}")

# ── 1. Admin: add / validate / update / disable / delete ─────────────────────
s, cat = http("GET", "/api/admin/prizes", admin=True)
rec("admin list prizes", s == 200 and len(cat.get("prizes", [])) >= 4, f"{len(cat.get('prizes', []))} prizes")
s, noauth = http("GET", "/api/admin/prizes")
rec("admin list requires token", s == 403)
TEST_LABEL = "15% Off (E2E test)"
s, add = http("POST", "/api/admin/prizes", {"label": TEST_LABEL, "type": "percent", "value": 15}, admin=True)
test_id = (add.get("prize") or {}).get("id")
rec("add new code via admin API", s == 201 and test_id, f"id={test_id}")
s, _ = http("POST", "/api/admin/prizes", {"label": TEST_LABEL, "type": "percent", "value": 15}, admin=True)
rec("duplicate label rejected", s == 409)
s, bad = http("POST", "/api/admin/prizes", {"label": "Bad 150%", "type": "percent", "value": 150}, admin=True)
rec("invalid percent rejected", s == 400, bad.get("error", ""))
s, bad = http("POST", "/api/admin/prizes", {"label": "Bad type", "type": "bogus"}, admin=True)
rec("invalid type rejected", s == 400)
s, pub = http("GET", "/api/prizes")
rec("new code appears on public wheel", s == 200 and TEST_LABEL in pub.get("labels", []))
s, ic = http("POST", "/api/admin/prize-codes", {"prizeId": test_id, "site": "shop"}, admin=True)
new_code = (ic.get("codes") or [None])[0]
rec("issue code for new prize", s == 201 and new_code, f"code={new_code}")
if new_code:
    check_coupon(new_code, "percent", 15, TEST_LABEL, "new-prize")
s, up = http("PUT", f"/api/admin/prizes/{test_id}", {"enabled": False}, admin=True)
s2, pub = http("GET", "/api/prizes")
rec("disable hides from wheel", s == 200 and TEST_LABEL not in pub.get("labels", []))
s, up = http("PUT", f"/api/admin/prizes/{test_id}", {"value": 20, "label": "20% Off (E2E test)", "enabled": True}, admin=True)
rec("edit value+label", s == 200 and up.get("prize", {}).get("value") == 20 and up["prize"]["discount"]["value"] == 20)
if not a.keep_test_prize:
    s, dl = http("DELETE", f"/api/admin/prizes/{test_id}", admin=True)
    s2, pub = http("GET", "/api/prizes")
    rec("delete test prize", s == 200 and "20% Off (E2E test)" not in pub.get("labels", []))

# ── 2. Direct issue + redeem for EVERY configured prize ─────────────────────
s, cat = http("GET", "/api/admin/prizes", admin=True)
prizes = [p for p in cat["prizes"] if p["enabled"]]
for p in prizes:
    s, ic = http("POST", "/api/admin/prize-codes", {"prizeId": p["id"], "site": "shop", "orderId": "E2E-DIRECT"}, admin=True)
    if p["type"] == "none":
        rec(f"direct issue refused for no-prize [{p['label']}]", s == 400, ic.get("error", "")); continue
    if p["type"] == "xrp":
        stg = (ic.get("redeemCodes") or [""])[0]
        rec(f"direct issue xrp [{p['label']}]", s == 201 and stg.startswith("STG-"), stg)
        if stg: redeem_xrp(stg, "direct")
        continue
    code = (ic.get("codes") or [None])[0]
    rec(f"direct issue [{p['label']}]", s == 201 and code, f"code={code}")
    if code:
        check_coupon(code, p["type"], p.get("value"), p["label"], "direct")

# ── 3. Ticket spins until every enabled PRIZE (each label) is hit ───────────
need = {p["label"] for p in prizes}
hit = {}
xrp_redeemed = 0
spins = 0
minted = 0
pending = []
while not need.issubset(hit.keys()) and spins < a.max_spins:
    if not pending:
        s, mint = http("POST", "/api/tickets", {"site": "shop", "count": 10, "orderId": "E2E-SPIN"}, admin=True)
        pending = [t["code"] for t in mint.get("tickets", [])]
        if minted == 0:
            rec("mint spin tickets (shop-compatible POST /api/tickets)", s == 201 and len(pending) == 10, f"{len(pending)} tickets/batch")
        minted += len(pending)
        if not pending: break
    code = pending.pop(0)
    spins += 1
    s, sp = http("POST", "/api/tickets/spin", {"code": code, "site": "shop"})
    if s != 200:
        rec("ticket spin", False, f"HTTP {s} {sp.get('error')}"); time.sleep(2); continue
    ptype = sp["prize"]["type"]; label = sp["prize"]["label"]
    first = label not in hit
    hit.setdefault(label, []).append(code)
    if first:
        res = sp["result"]
        s, v = http("POST", "/api/verify", {"payload": {k: res[k] for k in ("mode", "items", "index", "nonce", "ts")}, "sig": sp["signature"]})
        rec(f"spin HMAC verify [{label}]", s == 200 and v.get("valid") is True, f"ticket={code} index={res['index']}")
        s, again = http("POST", "/api/tickets/spin", {"code": code, "site": "shop"})
        rec(f"re-spin same ticket blocked [{label}]", s == 409)
        if ptype == "none":
            s, rd = http("POST", "/api/admin/prize-codes/redeem", {"code": code}, admin=True)
            rec(f"spin Try Again → no redeem [{label}]", s == 409 and sp.get("prizeCode") is None, rd.get("error", ""))
        elif ptype == "xrp":
            stg = sp.get("redeemCode") or ""
            rec(f"spin xrp → STG code [{label}]", stg.startswith("STG-"), f"ticket={code} stg={stg}")
            if stg and xrp_redeemed < 1:
                redeem_xrp(stg, "spin"); xrp_redeemed += 1
        else:
            rec(f"spin → prize code [{label}]", sp.get("prizeCode") == code, f"ticket={code}")
            check_coupon(code, ptype, sp["prize"].get("value"), label, "spin")
    time.sleep(2.1)
missing = need - set(hit.keys())
rec("every enabled prize hit by a real ticket spin", not missing,
    f"{spins} spins; hits=" + json.dumps({k: len(v) for k, v in hit.items()}) + (f" missing={sorted(missing)}" if missing else ""))

# ── 4. Admin wheel spin (prizes mode) yields a prize code ───────────────────
labels = [p["label"] for p in prizes if p["type"] in ("percent", "free_shipping")]
s, asp = http("POST", "/api/spin", {"mode": "prizes", "items": labels, "site": "shop"}, admin=True)
rec("admin /api/spin prizes-mode issues prize code", s == 200 and asp.get("prizeCode"), f"landed={asp.get('result',{}).get('label')} code={asp.get('prizeCode')}")

# ── 5. Negative paths ───────────────────────────────────────────────────────
s, _ = http("GET", "/api/tickets/lookup?code=ZZZZ-ZZZZ-ZZ")
rec("unknown code lookup 404", s == 404)
s, _ = http("POST", "/api/tickets/spin", {"code": "ZZZZ-ZZZZ-ZZ"})
rec("unknown ticket spin 404", s == 404)
s, _ = http("POST", "/api/tickets", {"site": "shop", "count": 1})
rec("mint requires admin", s == 403)

fails = [r for r in results if not r[1]]
print(f"\nSUMMARY: {len(results) - len(fails)}/{len(results)} PASS")
sys.exit(1 if fails else 0)
