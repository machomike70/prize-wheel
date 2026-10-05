# E2E Testing Guide - Prize Wheel with Hot Wallet & Payout Codes

## 🎯 Overview

This staging branch adds:
1. **Client-side XRPL hot wallet generation** (keys never touch server)
2. **Cryptographic one-time payout codes** (≥128 bits entropy, hash-only storage)
3. **Browser-based NFT transaction signing** (after code redemption)

**Network:** Use XRPL **Testnet** for all E2E tests.

---

## 📋 E2E Test Checklist

### Phase 1: Hot Wallet Setup

#### Test 1.1: Generate Hot Wallet
- [ ] Navigate to `/wallet.html`
- [ ] Select "Testnet" network
- [ ] Enter label: "Test Giveaway Wallet"
- [ ] Click "Generate New Wallet"
- [ ] **Verify:** Wallet displays with address, seed (blurred), public key
- [ ] **Verify:** Seed starts with 's' (e.g., `sEdV...`)
- [ ] Click "Download Backup" button
- [ ] **Verify:** JSON file downloads with seed
- [ ] **Verify:** Wallet appears in "Stored Wallets" section
- [ ] **Security Check:** Open browser DevTools → Network tab, refresh page
  - [ ] **Verify:** No seed or private key transmitted to server
  - [ ] **Verify:** Only public address stored (if any server storage)

#### Test 1.2: Fund Testnet Wallet
- [ ] Copy generated wallet address (starts with 'r')
- [ ] Click "Fund on Testnet" button (opens Bithomp faucet)
- [ ] Request test XRP from faucet
- [ ] **Verify:** Wallet receives ~1000 test XRP
- [ ] Check balance at: `https://testnet.xrpl.org/accounts/{ADDRESS}`

#### Test 1.3: Import Existing Wallet
- [ ] Click "Import Seed" button
- [ ] Enter previously generated seed
- [ ] **Verify:** Wallet imported with same address
- [ ] **Verify:** No duplicate wallet created

---

### Phase 2: Giveaway Spin with Payout Code

#### Test 2.1: Admin Authentication
- [ ] Navigate to `/giveaway.html`
- [ ] **Verify:** Auth prompt displayed
- [ ] Enter admin token from `.env` (X-Admin-Token)
- [ ] **Verify:** Main panel displays after auth
- [ ] **Verify:** Invalid token rejected

#### Test 2.2: Run Giveaway Spin
- [ ] Enter participant names (one per line):
  ```
  @alice
  @bob
  @charlie
  @diana
  ```
- [ ] Click "Run Fair Spin"
- [ ] **Verify:** Confetti animation plays
- [ ] **Verify:** Winner selected (e.g., "@bob")
- [ ] **Verify:** Payout code displayed in format: `XXXXXX-XXXXXX-XXXXXX-XXXXXX`
- [ ] **Verify:** Code contains 26 characters (excluding dashes)
- [ ] **Verify:** Code uses only A-Z (no O, I, L) and 2-9 (no 0, 1)
- [ ] **Verify:** Warning shows: "This code will be shown only once!"
- [ ] **Verify:** Expiry time shown (5 minutes from now)
- [ ] Click "Copy Code" button
- [ ] **Verify:** Code copied to clipboard

#### Test 2.3: Verify Code Entropy
- [ ] Generate 5 different codes
- [ ] **Verify:** All codes are unique
- [ ] **Verify:** No obvious patterns
- [ ] Calculate entropy:
  - Alphabet: 31 chars (A-Z minus O,I,L + 2-9)
  - Length: 26 chars
  - Entropy: 26 × log₂(31) ≈ **128.8 bits** ✓

---

### Phase 3: Code Redemption

#### Test 3.1: Valid Code Claim
- [ ] Open **new browser tab** (simulating winner)
- [ ] Navigate to `/claim.html`
- [ ] Paste payout code (with or without dashes)
- [ ] Click "Claim Prize"
- [ ] **Verify:** Success message displays
- [ ] **Verify:** Winner name matches spin result
- [ ] **Verify:** Prize/name matches
- [ ] **Verify:** Spin ID matches
- [ ] **Verify:** "Sign & Send NFT" button appears

#### Test 3.2: Code Validation Errors
- [ ] **Test expired code:**
  - [ ] Wait 5+ minutes after code generation
  - [ ] Try to claim
  - [ ] **Verify:** Error: "Code expired"
  
- [ ] **Test reused code:**
  - [ ] Try to claim same code twice
  - [ ] **Verify:** Error: "Code already used"
  
- [ ] **Test invalid code:**
  - [ ] Enter random code: `AAAAAA-BBBBBB-CCCCCC-DDDDDD`
  - [ ] **Verify:** Error: "Unknown or invalid code"
  
- [ ] **Test malformed code:**
  - [ ] Enter short code: `ABC123`
  - [ ] **Verify:** Error: "Invalid code format"

#### Test 3.3: Timing-Safe Comparison
- [ ] Generate code, copy it
- [ ] Modify one character: `ABCDEF-...` → `ABCDEG-...`
- [ ] Try to claim
- [ ] **Verify:** Rejected (timing-safe comparison working)
- [ ] **Verify:** Response time similar for all invalid codes (~no timing leak)

---

### Phase 4: NFT Transaction Signing

#### Test 4.1: Client-Side Transaction Signing
- [ ] After successful code claim, click "Sign & Send NFT"
- [ ] **Prompt:** Select network → Enter "testnet"
- [ ] **Prompt:** Enter hot wallet seed → Paste seed from Phase 1
- [ ] **Prompt:** Enter destination address → Use any funded testnet address
  - (For testing, can use your own testnet wallet)
- [ ] **Verify:** Transaction preparation message
- [ ] **Verify:** Transaction signed CLIENT-SIDE (check DevTools Network)
  - [ ] **Security Check:** Seed never sent to server
  - [ ] **Security Check:** Private key never sent to server
- [ ] **Verify:** Transaction submitted to Testnet
- [ ] **Verify:** Transaction hash displayed
- [ ] **Verify:** Explorer link shown
- [ ] Click explorer link
- [ ] **Verify:** Transaction visible on Testnet explorer
- [ ] **Verify:** Memo contains spin data

#### Test 4.2: Invalid Seed Handling
- [ ] Try signing with invalid seed: `sInvalidSeed123`
- [ ] **Verify:** Error message displayed
- [ ] **Verify:** Transaction not submitted

#### Test 4.3: Network Selection
- [ ] Test with "mainnet" selection (but don't submit!)
- [ ] **Verify:** Different WebSocket endpoint used
- [ ] **Verify:** Warning about mainnet displayed (if implemented)

---

### Phase 5: Server-Side Security

#### Test 5.1: Code Storage Verification
- [ ] Generate payout code
- [ ] Check `data/store.json`
- [ ] **Verify:** Only `codeHash` stored (SHA-256 hex, 64 chars)
- [ ] **Verify:** Plaintext code NOT stored
- [ ] **Verify:** `burned: false` initially
- [ ] Redeem code successfully
- [ ] Check `data/store.json` again
- [ ] **Verify:** `burned: true`
- [ ] **Verify:** `burnedAt` timestamp set

#### Test 5.2: Rate Limiting
- [ ] Make 10+ rapid claim attempts in 1 minute
- [ ] **Verify:** Rate limit triggered (~10 requests/minute)
- [ ] **Verify:** Error: "Too many claim attempts"
- [ ] Wait 1 minute
- [ ] **Verify:** Requests allowed again

#### Test 5.3: Admin Endpoint Protection
- [ ] Try `/api/giveaway/spin` without X-Admin-Token header
- [ ] **Verify:** 403 Forbidden
- [ ] **Verify:** Error: "Admin access required"
- [ ] Try with wrong token
- [ ] **Verify:** 403 Forbidden

---

### Phase 6: Existing Features (Non-Regression)

#### Test 6.1: Regular Wheel Spins
- [ ] Navigate to `/` (main wheel)
- [ ] Add names: Alice, Bob, Charlie
- [ ] Click "SPIN"
- [ ] **Verify:** Fair spin works (HMAC proof)
- [ ] **Verify:** Confetti displays
- [ ] **Verify:** Winner overlay shows
- [ ] **Verify:** Signature displayed

#### Test 6.2: Verify Endpoint
- [ ] Copy spin result + signature
- [ ] POST to `/api/verify` with payload + sig
- [ ] **Verify:** `{ valid: true }` response

---

## 🔒 Security Verification

### Client-Side Key Security
1. **Browser DevTools Test:**
   ```
   1. Open wallet.html
   2. Open DevTools → Network tab
   3. Generate new wallet
   4. Filter for "POST" or "PUT" requests
   5. Verify: NO seed or privateKey in ANY request
   ```

2. **LocalStorage Inspection:**
   ```javascript
   // In browser console:
   const wallets = JSON.parse(localStorage.getItem('prize-wheel:wallets:v1'));
   console.log(wallets);
   // Verify: seeds stored in localStorage (browser-only)
   // Verify: seeds NOT encrypted (user warned to backup)
   ```

3. **Server Storage Verification:**
   ```bash
   # Check server store
   cat data/store.json | jq '.payoutCodes'
   # Verify: Only codeHash present
   # Verify: No plaintext codes
   ```

---

## 🚫 Known Limitations (Staging)

1. **Hot Wallet Security:**
   - Seeds stored in browser localStorage (not encrypted)
   - Production should use secure key management (HSM, KMS, etc.)
   - Clear warnings displayed to users

2. **NFT Flow:**
   - Current implementation uses simple Payment transaction
   - Production needs proper NFTokenCreateOffer/NFTokenAcceptOffer
   - Requires NFT minting setup (not included)

3. **Network:**
   - Testnet only for E2E tests
   - Mainnet support exists but requires caution

4. **Code Cleanup:**
   - Old codes (>24h) auto-cleaned when store hits 100 entries
   - Production needs scheduled cleanup job

---

## 📝 Test Results Template

```
Date: ___________
Tester: ___________
Environment: Local / Staging URL

| Test ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| 1.1     | Generate Hot Wallet | ☐ PASS ☐ FAIL | |
| 1.2     | Fund Testnet Wallet | ☐ PASS ☐ FAIL | |
| 1.3     | Import Existing Wallet | ☐ PASS ☐ FAIL | |
| 2.1     | Admin Authentication | ☐ PASS ☐ FAIL | |
| 2.2     | Run Giveaway Spin | ☐ PASS ☐ FAIL | |
| 2.3     | Verify Code Entropy | ☐ PASS ☐ FAIL | |
| 3.1     | Valid Code Claim | ☐ PASS ☐ FAIL | |
| 3.2     | Code Validation Errors | ☐ PASS ☐ FAIL | |
| 3.3     | Timing-Safe Comparison | ☐ PASS ☐ FAIL | |
| 4.1     | Client-Side TX Signing | ☐ PASS ☐ FAIL | |
| 4.2     | Invalid Seed Handling | ☐ PASS ☐ FAIL | |
| 4.3     | Network Selection | ☐ PASS ☐ FAIL | |
| 5.1     | Code Storage Verification | ☐ PASS ☐ FAIL | |
| 5.2     | Rate Limiting | ☐ PASS ☐ FAIL | |
| 5.3     | Admin Endpoint Protection | ☐ PASS ☐ FAIL | |
| 6.1     | Regular Wheel Spins | ☐ PASS ☐ FAIL | |
| 6.2     | Verify Endpoint | ☐ PASS ☐ FAIL | |

Overall Status: ☐ PASS ☐ FAIL
Blockers: _________________________________
```

---

## 🚀 Quick Test Script

```bash
#!/bin/bash
# Quick E2E validation script

echo "=== Prize Wheel E2E Test ==="

# 1. Start server
echo "Starting server..."
npm start &
SERVER_PID=$!
sleep 3

# 2. Test admin endpoint (requires ADMIN_TOKEN in .env)
echo "Testing admin endpoint..."
curl -X POST http://localhost:3847/api/giveaway/spin \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  -d '{"mode":"names","items":["Alice","Bob","Charlie"]}' \
  | jq '.'

# 3. Test claim endpoint (manual - need code from step 2)
echo "Test claim manually at: http://localhost:3847/claim.html"

# 4. Verify regular spin still works
echo "Testing regular spin..."
curl -X POST http://localhost:3847/api/spin \
  -H "Content-Type: application/json" \
  -d '{"mode":"names","items":["Test1","Test2","Test3"]}' \
  | jq '.signature'

# Cleanup
kill $SERVER_PID
echo "✅ Tests complete"
```

Save as `test-e2e.sh`, run with:
```bash
chmod +x test-e2e.sh
export ADMIN_TOKEN="your-admin-token-here"
./test-e2e.sh
```

---

## 📚 Additional Resources

- **XRPL Testnet Explorer:** https://testnet.xrpl.org/
- **Testnet Faucet:** https://test.bithomp.com/faucet/
- **XRPL.js Docs:** https://js.xrpl.org/
- **NFT Docs:** https://xrpl.org/nft-overview.html

---

## ⚠️ Production Readiness Checklist

Before merging to production:

- [ ] Replace localStorage wallet storage with secure key management
- [ ] Implement proper NFTokenCreateOffer/NFTokenAcceptOffer flow
- [ ] Add server-side NFT minting setup
- [ ] Implement scheduled cleanup job for expired codes
- [ ] Add comprehensive error logging
- [ ] Set up monitoring for failed redemptions
- [ ] Add analytics for giveaway metrics
- [ ] Implement backup/recovery for hot wallets
- [ ] Add multi-signature support for high-value wallets
- [ ] Review and lock down CORS policies
- [ ] Add HTTPS enforcement
- [ ] Implement session management improvements
- [ ] Add audit logging for all admin actions
- [ ] Security audit by third party
- [ ] Penetration testing
- [ ] Load testing for high-traffic giveaways
