# Prize Wheel - Staging: Hot Wallet + Payout Codes

**Branch:** `staging/payout-hot-wallet-98fc`  
**Status:** 🚧 Experimental / Testing Only  
**Network:** XRPL Testnet Recommended

---

## 🎯 What's New in This Branch

This staging branch adds a complete **NFT giveaway flow** with cryptographic security:

### 1. Client-Side Hot Wallet Generation
- ✅ Generate XRPL wallets **in the browser** (keys never touch server)
- ✅ Import existing seeds
- ✅ LocalStorage persistence with clear warnings
- ✅ Backup download (JSON file)
- ✅ Testnet faucet integration
- 🔒 **Security:** Private keys/seeds NEVER transmitted to server

### 2. Cryptographic Payout Codes
- ✅ **128+ bits entropy** (26-char codes from 31-char alphabet)
- ✅ Alphabet: A-Z (no O, I, L) + 2-9 (no 0, 1) for clarity
- ✅ Format: `ABCDEF-GHKMNPQ-RSTUVW-XYZ234` (26 chars total)
- ✅ **Hash-only storage** (SHA-256, never plaintext)
- ✅ **5-minute expiry** from creation
- ✅ **Single-use** (burned after redemption)
- ✅ **Timing-safe comparison** (prevents timing attacks)

### 3. Browser-Based NFT Signing
- ✅ Winner enters payout code → validates & burns
- ✅ Hot wallet owner signs transaction **in browser**
- ✅ XRPL transaction submitted from client
- ✅ Full transaction transparency (explorer links)
- 🔒 **Security:** Seed used only in browser memory, never persisted during signing

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Git
- Modern browser (Chrome, Firefox, Safari)
- XRPL Testnet account (optional, can generate in-app)

### Setup

1. **Clone and switch to staging branch:**
   ```bash
   git clone https://github.com/machomike70/prize-wheel.git
   cd prize-wheel
   git checkout staging/payout-hot-wallet-98fc
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   nano .env  # or your preferred editor
   ```
   
   **Required:**
   ```env
   SPIN_SECRET=your-long-random-hex-string-here
   ADMIN_TOKEN=your-admin-token-here
   ```

4. **Start server:**
   ```bash
   npm start
   ```

5. **Open in browser:**
   - Main wheel: http://localhost:3847/
   - Hot wallet manager: http://localhost:3847/wallet.html
   - Giveaway admin: http://localhost:3847/giveaway.html
   - Claim page: http://localhost:3847/claim.html

---

## 📖 User Flows

### Flow 1: Generate Hot Wallet (One-Time Setup)

1. Navigate to `/wallet.html`
2. Select **Testnet** network
3. Enter project label (e.g., "GOML Giveaway")
4. Click **"Generate New Wallet"**
5. **⚠️ CRITICAL:** Download backup immediately
6. Fund wallet via Testnet faucet
7. Wallet stored in browser localStorage

**Security Notes:**
- Private key generated client-side using `xrpl.js`
- Seed stored in localStorage (clear warnings displayed)
- Server never sees private key or seed
- Production: use HSM or secure key management

### Flow 2: Run Giveaway Spin (Admin)

1. Navigate to `/giveaway.html`
2. Enter admin token (from `.env`)
3. Paste participant list (one name/handle per line):
   ```
   @alice
   @bob
   @charlie
   ```
4. Click **"Run Fair Spin"**
5. System performs HMAC fair spin
6. Winner selected + payout code generated
7. **⚠️ COPY CODE NOW** (shown only once)
8. Code format: `ABCDEF-GHKMNP-QRSTUV-WXYZ23`
9. Valid for 5 minutes

**Behind the scenes:**
- Fair spin uses existing HMAC proof system
- Code generated with crypto.randomBytes
- Only SHA-256 hash stored on server
- Code plaintext returned once, then gone

### Flow 3: Winner Claims NFT

#### Part A: Code Redemption
1. Winner navigates to `/claim.html`
2. Enters payout code (dashes optional)
3. Clicks **"Claim Prize"**
4. Code validated against hash
5. If valid + not expired + not used:
   - Code marked as burned
   - Success message displayed
   - "Sign & Send NFT" button appears

#### Part B: NFT Transfer (Client-Side Signing)
1. Click **"Sign & Send NFT"**
2. Select network: `testnet`
3. Enter hot wallet seed (from Flow 1)
4. Enter destination address (winner's XRPL address)
5. Transaction prepared client-side
6. Transaction signed with wallet (in browser memory)
7. Submitted to XRPL
8. Explorer link displayed

**Security Notes:**
- Seed entered in prompt (never stored)
- Signing happens in browser RAM
- No server round-trip with seed
- Transaction visible on Testnet explorer

---

## 🗂️ File Structure

```
prize-wheel/
├── public/
│   ├── claim.html          ← Winner claim page + NFT signing
│   ├── giveaway.html       ← Admin giveaway spin
│   ├── wallet.html         ← Hot wallet manager (NEW)
│   ├── index.html          ← Main wheel (unchanged)
│   ├── script.js           ← Wheel logic (unchanged)
│   └── style.css           ← Styles
├── server/
│   ├── index.js            ← Main server + new endpoints
│   ├── spin.js             ← Fair spin logic (unchanged)
│   ├── payout.js           ← Payout code system (NEW)
│   ├── auth.js             ← Admin auth middleware (NEW)
│   ├── store.js            ← Storage (updated for codes)
│   └── config.js           ← Configuration
├── docs/
│   └── E2E_TESTING.md      ← Complete test checklist (NEW)
├── package.json            ← Updated (added xrpl dependency)
└── README.staging.md       ← This file
```

---

## 🔌 API Endpoints

### New Endpoints

#### `POST /api/giveaway/spin`
**Auth:** X-Admin-Token header required  
**Purpose:** Run giveaway spin + generate payout code

**Request:**
```json
{
  "mode": "names",
  "items": ["@alice", "@bob", "@charlie"]
}
```

**Response:**
```json
{
  "result": {
    "mode": "names",
    "items": ["@alice", "@bob", "@charlie"],
    "index": 1,
    "label": "@bob",
    "nonce": "f3a5...",
    "ts": 1727682000000
  },
  "signature": "a3f2...",
  "payoutCode": "ABCDEF2GHKMNPQRSTUV3WXYZ456",
  "payoutCodeDisplay": "ABCDEF-2GHKMNP-QRSTUV3-WXYZ456",
  "payoutExpiresAt": 1727682300000,
  "notice": "Save this code securely - it will not be shown again"
}
```

#### `POST /api/claim`
**Auth:** Public (rate-limited: 10/min)  
**Purpose:** Validate and burn payout code

**Request:**
```json
{
  "code": "ABCDEF-2GHKMNP-QRSTUV3-WXYZ456"
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "Code redeemed successfully",
  "winner": "@bob",
  "prize": "@bob",
  "spinId": "f3a5...",
  "nftRelease": {
    "status": "pending",
    "message": "NFT release queued for hot wallet processing"
  }
}
```

**Response (error):**
```json
{
  "error": "Code expired"
}
```

Possible errors:
- `"Invalid code format"` - wrong length
- `"Unknown or invalid code"` - hash doesn't match
- `"Code already used"` - burned flag set
- `"Code expired"` - past 5-minute TTL

#### `GET /api/claim/check?code=XXX`
**Auth:** Public  
**Purpose:** Check code status without burning

**Response:**
```json
{
  "exists": true,
  "burned": false,
  "expired": false
}
```

### Existing Endpoints (Unchanged)

- `POST /api/spin` - Regular fair spin
- `GET /api/verify` - Verify HMAC proof
- `POST /api/verify` - Verify HMAC proof (POST)

---

## 🔐 Security Model

### Client-Side (Browser)
```
┌─────────────────────────────────────────┐
│  Browser (User's Computer)              │
│                                         │
│  1. xrpl.js generates wallet            │
│     ├─ Private key (RAM only)           │
│     ├─ Seed phrase (localStorage)       │
│     └─ Public address                   │
│                                         │
│  2. Transaction signing                 │
│     ├─ Seed from prompt (RAM only)      │
│     ├─ Sign with wallet.sign()          │
│     └─ Submit signed tx to XRPL         │
│                                         │
│  ❌ NEVER sent to server:                │
│     - Private key                       │
│     - Seed phrase                       │
└─────────────────────────────────────────┘
```

### Server-Side
```
┌─────────────────────────────────────────┐
│  Server (prize-wheel backend)           │
│                                         │
│  1. Payout code generation              │
│     ├─ crypto.randomBytes(52)           │
│     ├─ Encode to 31-char alphabet       │
│     ├─ Hash with SHA-256                │
│     └─ Store only hash                  │
│                                         │
│  2. Code validation                     │
│     ├─ Hash input code                  │
│     ├─ Timing-safe compare              │
│     ├─ Check expiry (5 min)             │
│     └─ Mark burned if valid             │
│                                         │
│  ✅ Server knows:                        │
│     - Public wallet addresses (maybe)   │
│     - Code hashes (SHA-256)             │
│     - Burn status + timestamps          │
│                                         │
│  ❌ Server NEVER knows:                  │
│     - Private keys                      │
│     - Seed phrases                      │
│     - Plaintext payout codes (after gen)│
└─────────────────────────────────────────┘
```

### XRPL Network
```
┌─────────────────────────────────────────┐
│  XRPL Ledger (Testnet/Mainnet)          │
│                                         │
│  - Receives signed transactions         │
│  - Validates signatures                 │
│  - Executes transfers                   │
│  - Public transparency                  │
│                                         │
│  ✅ On-chain data:                       │
│     - Transaction hashes                │
│     - Source/destination addresses      │
│     - Amounts + memos                   │
│     - Fully verifiable                  │
└─────────────────────────────────────────┘
```

---

## ⚙️ Configuration

### Environment Variables

```env
# Required
SPIN_SECRET=long-random-hex-string-min-16-chars
ADMIN_TOKEN=your-secret-admin-token

# Optional
PORT=3847
CORS_ORIGINS=*
DATA_DIR=./data
```

### Network Selection

Default: **Testnet** (recommended for staging)

**Testnet:**
- WebSocket: `wss://s.altnet.rippletest.net:51233`
- Faucet: https://test.bithomp.com/faucet/
- Explorer: https://testnet.xrpl.org/

**Mainnet:**
- WebSocket: `wss://xrplcluster.com`
- Explorer: https://livenet.xrpl.org/

---

## 🧪 Testing

See **[docs/E2E_TESTING.md](docs/E2E_TESTING.md)** for complete test checklist.

### Quick Smoke Test

```bash
# 1. Start server
npm start

# 2. Generate wallet
open http://localhost:3847/wallet.html
# Follow UI to generate + fund testnet wallet

# 3. Run giveaway
open http://localhost:3847/giveaway.html
# Enter admin token, add names, spin

# 4. Claim prize
open http://localhost:3847/claim.html
# Enter code from step 3, claim, sign transaction

# 5. Verify transaction
# Check Testnet explorer link from step 4
```

### Automated Tests (Partial)

```bash
# Test admin endpoint
export ADMIN_TOKEN="your-token"
curl -X POST http://localhost:3847/api/giveaway/spin \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"mode":"names","items":["Alice","Bob","Charlie"]}' \
  | jq '.'

# Test regular spin (non-regression)
curl -X POST http://localhost:3847/api/spin \
  -H "Content-Type: application/json" \
  -d '{"mode":"names","items":["Test1","Test2"]}' \
  | jq '.signature'
```

---

## 🚨 Known Limitations

### 1. Hot Wallet Storage
- **Current:** LocalStorage (unencrypted)
- **Risk:** Browser cache/history exposure
- **Mitigation:** Clear warnings, backup downloads
- **Production:** Needs secure key management (HSM, KMS, hardware wallet)

### 2. NFT Transaction Type
- **Current:** Simple Payment with memo
- **Production:** Should use `NFTokenCreateOffer` / `NFTokenAcceptOffer`
- **Requires:** Pre-minted NFTs or minting flow

### 3. Code Cleanup
- **Current:** Auto-clean when store exceeds 100 codes
- **Production:** Needs scheduled job (e.g., daily cron)

### 4. Rate Limiting
- **Current:** In-memory (resets on restart)
- **Production:** Needs Redis or similar for distributed rate limiting

### 5. No Multi-Sig
- **Current:** Single-key hot wallets
- **Production:** High-value wallets should use multi-signature

---

## 🛑 DO NOT Deploy to Production

This is a **staging/experimental branch**. Before production:

1. ✅ Complete E2E testing (see docs/E2E_TESTING.md)
2. ✅ Security audit by third party
3. ✅ Implement secure key management
4. ✅ Add proper NFT minting/transfer flow
5. ✅ Add monitoring & alerting
6. ✅ Add audit logging
7. ✅ Penetration testing
8. ✅ Load testing
9. ✅ Legal review (especially for giveaways)
10. ✅ User acceptance testing

---

## 📞 Support

**For testing issues:**
- Check [docs/E2E_TESTING.md](docs/E2E_TESTING.md)
- Review browser console for errors
- Check server logs: `npm start` output

**For XRPL issues:**
- Testnet status: https://testnet.xrpl.org/
- XRPL.js docs: https://js.xrpl.org/
- Community: https://xrpldevs.org/

---

## 📄 License

Same as main prize-wheel project (check parent LICENSE file).

---

## ✅ Testing Status

| Component | Status | Notes |
|-----------|--------|-------|
| Client-side wallet generation | ✅ Implemented | Using xrpl.js |
| Payout code generation | ✅ Implemented | 128.8 bits entropy |
| Hash-only storage | ✅ Implemented | SHA-256 |
| Code expiry (5 min) | ✅ Implemented | Timestamp-based |
| Burn-on-use | ✅ Implemented | Single-use flag |
| Timing-safe comparison | ✅ Implemented | crypto.timingSafeEqual |
| Admin giveaway UI | ✅ Implemented | /giveaway.html |
| Claim UI | ✅ Implemented | /claim.html |
| Client-side TX signing | ✅ Implemented | xrpl.js in browser |
| Testnet integration | ✅ Implemented | Default network |
| E2E test docs | ✅ Implemented | docs/E2E_TESTING.md |
| Security audit | ⏳ Pending | Required before prod |
| Load testing | ⏳ Pending | Required before prod |

---

**Last Updated:** 2026-09-30  
**Branch:** staging/payout-hot-wallet-98fc  
**Maintainer:** Cursor AI Cloud Agent

## Prize codes (purchase / discount prizes)

Admin UI: `/wheel-staging/prizes.html` — add/edit prizes (5% off, 10% off, free shipping, free tee, …),
issue codes, mint spin tickets, look up / redeem. Full guide: `docs/PRIZE-CODES.md`.
