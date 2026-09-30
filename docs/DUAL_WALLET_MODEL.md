# Dual Wallet Model - Documentation

**Branch:** `cursor/staging-payout-hot-wallet-98fc`  
**PR:** https://github.com/machomike70/prize-wheel/pull/2  
**Status:** Staging - Dual Model Implementation

---

## 🎯 Overview

The prize wheel now supports **TWO distinct wallet models** for NFT/token giveaways. Each serves different use cases with different security/custody trade-offs.

### Model A: Client-Side Sponsor Wallets 👤
**Self-Custody** - Sponsors generate and manage their own wallets

### Model B: GOML Shared Hot Wallet 🏦
**GOML Custody** - Shared server-held wallet for simplified deposits

---

## 📋 Model Comparison

| Feature | Model A: Client-Side | Model B: Server-Held |
|---------|---------------------|----------------------|
| **Key Generation** | Browser (xrpl.js) | Server environment |
| **Seed Storage** | Sponsor's browser localStorage | Server env variable |
| **GOML Access to Keys** | ❌ NEVER | ✅ Yes (env only) |
| **Recovery** | ❌ Sponsor only (no GOML recovery) | ✅ GOML can recover |
| **Transaction Signing** | Sponsor's browser | Server |
| **Best For** | SaaS tenants, self-custody sponsors | Simplified deposits, GOML-managed |
| **Security Model** | Non-custodial | Custodial |

---

## 🔐 Model A: Client-Side Sponsor Wallets

### How It Works

1. **Generation** (`/wallet.html`)
   - Sponsor visits wallet generator
   - xrpl.js generates keys CLIENT-SIDE in browser
   - Seed displayed ONCE for backup
   
2. **Mandatory Backup Verification** (BOTH required)
   - ✅ **Random word verification**: App randomly selects 3 word positions from seed phrase
   - ✅ **Confirmation checkbox**: Sponsor must check "I have saved my seed"
   - **AND logic**: BOTH must pass or wallet stays unusable
   
3. **Registration**
   - Only AFTER successful verification
   - Server stores ONLY: `{ address, label, network, publicKey }`
   - Seed/private key NEVER sent to server
   
4. **Usage**
   - Sponsor deposits NFTs/tokens to their own address
   - Sponsor signs transactions in their browser when distributing
   - GOML has zero access to funds

### Security Guarantees

- ✅ **Keys generated client-side** (xrpl.js in browser)
- ✅ **GOML NEVER receives seed/private key**
- ✅ **No server-side key storage**
- ✅ **Mandatory backup verification before use**
- ✅ **Random word position verification** (not just checkbox)
- ✅ **Server rejects any request containing seed/private key**
- ❌ **NO GOML RECOVERY POSSIBLE** (sponsor responsibility)

### Implementation

**File:** `public/wallet.html`

```javascript
// Backup verification flow:
1. Show seed once, require write-down confirmation
2. App randomly selects 3 positions (e.g., words 4, 7, 11)
3. Sponsor must type those specific words correctly
4. Sponsor must check confirmation checkbox
5. BOTH pass → wallet marked usable
6. Server registers ONLY public info
```

**API:** `POST /api/wallets/register`
```json
{
  "address": "rXXXX...",
  "label": "My Sponsor Wallet",
  "network": "testnet",
  "publicKey": "03XXXX..."
  // seed/privateKey rejected with security error
}
```

---

## 🏦 Model B: GOML Shared Hot Wallet

### How It Works

1. **Setup** (one-time)
   - Generate wallet seed: `npx xrpl generate`
   - Add to `.env`: `HOT_WALLET_SEED=sEdV...`
   - Server initializes wallet on startup
   
2. **Deposits**
   - Sponsors send NFTs/tokens to shared address
   - Server tracks via XRPL websocket/polling
   - Admin assigns items to sponsors/giveaways
   
3. **Distributions**
   - Admin selects inventory item
   - Server signs transaction with hot wallet
   - NFT/token sent directly to winner
   
4. **Tracking**
   - Inventory table: available items
   - Distributions table: sent prizes

### Security Guarantees

- ✅ **Seed stored ONLY in server environment**
- ✅ **Private key NEVER exposed to clients**
- ✅ **No client-side key handling**
- ✅ **Admin UI shows only public address**
- ✅ **Logging excludes sensitive data**
- ⚠️ **GOML has full custody** (trade-off for simplicity)

### Implementation

**File:** `server/hotWallet.js`

```javascript
// Initialization (server startup):
const wallet = xrpl.Wallet.fromSeed(HOT_WALLET_SEED);
// Seed NEVER logged, only address

// Distribution (admin action):
await hotWallet.createNFTOffer(nftId, winnerAddress);
// Server signs, submits to XRPL
```

**Admin UI:** `/hotwallet-admin.html`

- View deposit address
- Track inventory
- Assign items to sponsors
- Trigger distributions
- View transaction history

---

## 🚀 Configuration

### Environment Variables

```bash
# Model B: GOML Hot Wallet (optional)
HOT_WALLET_SEED=sEdV19b2X8HgFZSKGE6uqUx9vK3P9AC  # Testnet seed
XRPL_NETWORK=testnet  # or mainnet

# Existing variables (unchanged)
SPIN_SECRET=...
ADMIN_TOKEN=...
```

### Generate Hot Wallet Seed

**Option 1: xrpl CLI**
```bash
npm install -g xrpl
npx xrpl generate
# Copy seed to .env
```

**Option 2: Manual generation**
```javascript
const xrpl = require('xrpl');
const wallet = xrpl.Wallet.generate();
console.log('Seed:', wallet.seed);
console.log('Address:', wallet.address);
```

---

## 📖 User Flows

### Flow 1: Sponsor Uses Client-Side Wallet

```
1. Sponsor → /wallet.html
2. Click "Generate New Wallet"
3. Write down seed phrase (shown once)
4. Check "I have saved my seed"
5. App asks for 3 random words from seed
6. Sponsor types words correctly
7. Check confirmation checkbox
8. BOTH pass → Wallet registered
9. Sponsor deposits NFTs to their address
10. Later: Sponsor signs distribution in browser
```

### Flow 2: Sponsor Deposits to GOML Hot Wallet

```
1. Admin → /hotwallet-admin.html
2. Copy GOML hot wallet address
3. Share address with sponsor
4. Sponsor sends NFTs/tokens to that address
5. Deposit appears in inventory table
6. Admin assigns to giveaway
7. Winner selected via wheel
8. Admin clicks "Distribute"
9. Server signs & sends from hot wallet
10. Winner receives NFT/token
```

---

## 🔌 API Endpoints

### Client-Side Wallets

#### `POST /api/wallets/register`
**Auth:** None  
**Purpose:** Register sponsor wallet (public info only)

**Request:**
```json
{
  "address": "rXXXX...",
  "label": "Sponsor Name",
  "network": "testnet",
  "publicKey": "03XXXX..."
}
```

**Response:**
```json
{
  "success": true,
  "wallet": {
    "id": "wallet_123",
    "address": "rXXXX...",
    "label": "Sponsor Name",
    "network": "testnet"
  }
}
```

**Security:**
- ❌ Rejects requests with `seed` or `privateKey` fields
- ✅ Stores only public information

### Server-Held Hot Wallet

#### `GET /api/hotwallet/info`
**Auth:** Public  
**Purpose:** Get deposit address

**Response:**
```json
{
  "address": "rXXXX...",
  "network": "testnet",
  "enabled": true
}
```

#### `GET /api/hotwallet/account`
**Auth:** Admin  
**Purpose:** View balance and account details

#### `GET /api/hotwallet/inventory`
**Auth:** Admin  
**Purpose:** List available prizes

#### `POST /api/hotwallet/distribute`
**Auth:** Admin  
**Purpose:** Send prize to winner

**Request:**
```json
{
  "itemId": "inv_123",
  "destination": "rWinnerAddress...",
  "spinId": "spin_456"
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "ABC123...",
  "explorerUrl": "https://testnet.xrpl.org/transactions/ABC123..."
}
```

---

## 🧪 Testing

### Test Model A (Client-Side)

1. Visit `/wallet.html`
2. Generate new wallet
3. Write down seed
4. App asks for random words (e.g., words 3, 7, 12)
5. **Test: Enter wrong word** → Should fail
6. **Test: Skip checkbox** → Should fail
7. **Test: Both correct** → Should succeed
8. Check browser localStorage: seed present
9. Check Network tab: NO seed transmitted
10. Verify server store: only public address saved

### Test Model B (Server-Held)

1. Set `HOT_WALLET_SEED` in `.env`
2. Start server: `npm start`
3. Check logs: address displayed, seed NOT logged
4. Visit `/hotwallet-admin.html`
5. Verify deposit address shown
6. Fund wallet via testnet faucet
7. Add test inventory item
8. Trigger distribution
9. Verify transaction on testnet explorer
10. Check inventory: item marked distributed

---

## ⚠️ Security Warnings

### Model A: Client-Side

**CRITICAL:**
- Sponsors are 100% responsible for seed backups
- GOML cannot and will not recover lost seeds
- Lost seed = permanent loss of funds
- Mandatory verification prevents common backup mistakes

**Implementation:**
- Random word verification (not just full seed re-entry)
- Checkbox confirmation (explicit acknowledgment)
- BOTH required (AND logic)

### Model B: Server-Held

**CRITICAL:**
- Seed stored in server environment
- Anyone with access to `.env` has full wallet access
- Production: use secure secret management (AWS Secrets Manager, etc.)
- Regular backups of `HOT_WALLET_SEED`

**Implementation:**
- Seed loaded from env only
- NEVER logged or returned to clients
- Admin UI shows only public address

---

## 📝 Admin UI Guide

### Access

Visit `/hotwallet-admin.html` with admin token.

### Model A Section: Client-Side Wallets

- **Purpose:** View sponsors who generated their own wallets
- **Info Shown:** Address, label, network, registration date
- **Actions:** View only (no control over client-side wallets)
- **Note:** Sponsors manage their wallets at `/wallet.html`

### Model B Section: GOML Hot Wallet

#### Deposit Address Card
- Share this address with sponsors
- Copy address for sponsor communications
- View balance and network

#### Inventory Table
- Lists all deposited NFTs/tokens
- Status: Available / Distributed
- Sponsor attribution
- Distribute button per item

#### Distributions Table
- Recent prize distributions
- Transaction hashes (clickable to explorer)
- Winner addresses
- Timestamps

---

## 🚀 Production Checklist

### Model A: Client-Side

- [x] Mandatory backup verification implemented
- [x] Random word position selection
- [x] Checkbox confirmation
- [x] Both requirements enforced (AND logic)
- [x] Server rejects seed/private key in requests
- [ ] Security audit of client-side code
- [ ] User testing of backup flow
- [ ] Clear warnings about no recovery

### Model B: Server-Held

- [x] Seed environment variable
- [x] Server initialization
- [x] Admin endpoints
- [x] Inventory tracking
- [x] Distribution flow
- [ ] Secret manager integration (AWS/GCP)
- [ ] Backup strategy documented
- [ ] Multi-signature support (future)
- [ ] Access controls for env vars

---

## 📚 Resources

- **xrpl.js Docs:** https://js.xrpl.org/
- **XRPL NFTs:** https://xrpl.org/nft-overview.html
- **Testnet Faucet:** https://test.bithomp.com/faucet/
- **Testnet Explorer:** https://testnet.xrpl.org/

---

## 🔄 Migration Notes

### From Browser-Only to Dual Model

The original staging implementation had **only browser-based signing**. This update adds:

1. **Client-side model enhancement:**
   - Added mandatory backup verification
   - Added random word position verification
   - Added server registration (public info only)

2. **Server-held model addition:**
   - New `server/hotWallet.js` module
   - New admin UI at `/hotwallet-admin.html`
   - New API endpoints for inventory/distribution
   - Environment-based configuration

**Backward Compatibility:** Existing browser wallets in localStorage continue to work.

---

**Implementation Status:** ✅ COMPLETE  
**Testing Status:** ⏳ Manual testing required  
**Production Ready:** ❌ NO - Requires secret management + audit
