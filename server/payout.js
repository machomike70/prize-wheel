'use strict';

const crypto = require('crypto');

/**
 * One-time payout code system for NFT release after giveaway spins.
 * 
 * ENTROPY REQUIREMENTS:
 * - Minimum 128 bits of entropy required
 * - Alphabet: uppercase letters + digits, excluding: 0, O, 1, I, L (to avoid confusion)
 * - Available chars: A-Z minus O,I,L = 23 letters + 2-9 = 8 digits = 31 chars total
 * - Entropy per char: log2(31) ≈ 4.954 bits
 * - For 128 bits: 128 / 4.954 ≈ 25.84 → need 26 characters
 * - Since 6-8 chars is too short (max ~39.6 bits), we use 26 chars internally
 * - Display format: 26 chars shown as 4 groups of 6-7 chars: XXXXXX-XXXXXX-XXXXXX-XXXXXX (26 total)
 * 
 * This ensures cryptographic strength while remaining human-readable.
 */

// Alphabet: uppercase + digits, excluding easily confused characters
// Removed: 0 (zero), O (letter O), 1 (one), I (letter I), L (letter L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars
const CODE_LENGTH = 26; // Provides ~128.8 bits of entropy (26 × 4.954)
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Verify our entropy calculation at module load
const ENTROPY_PER_CHAR = Math.log2(ALPHABET.length);
const TOTAL_ENTROPY = CODE_LENGTH * ENTROPY_PER_CHAR;
if (TOTAL_ENTROPY < 128) {
  throw new Error(
    `Insufficient entropy: ${TOTAL_ENTROPY.toFixed(1)} bits < 128 bits required. ` +
    `Alphabet size: ${ALPHABET.length}, Code length: ${CODE_LENGTH}`
  );
}

console.log(
  `[Payout] Code entropy: ${TOTAL_ENTROPY.toFixed(1)} bits ` +
  `(${CODE_LENGTH} chars × log2(${ALPHABET.length}) = ${ENTROPY_PER_CHAR.toFixed(3)} bits/char)`
);

/**
 * Generate a cryptographically secure payout code.
 * @returns {string} A 26-character code from the safe alphabet
 */
function generateCode() {
  const randomBytes = crypto.randomBytes(CODE_LENGTH * 2); // Plenty of random material
  let code = '';
  
  for (let i = 0; i < CODE_LENGTH; i++) {
    // Use rejection sampling to avoid modulo bias
    let value;
    let byteIndex = i * 2;
    do {
      if (byteIndex >= randomBytes.length) {
        // Need more random bytes (very unlikely)
        const moreBytes = crypto.randomBytes(2);
        value = moreBytes.readUInt16BE(0);
      } else {
        value = randomBytes.readUInt16BE(byteIndex);
      }
    } while (value >= 65536 - (65536 % ALPHABET.length)); // Reject biased values
    
    code += ALPHABET[value % ALPHABET.length];
  }
  
  return code;
}

/**
 * Format code for display: XXXXXX-XXXXXX-XXXXXX-XXXXXX
 * @param {string} code - Raw 26-character code
 * @returns {string} Formatted code with dashes
 */
function formatCodeForDisplay(code) {
  if (code.length !== CODE_LENGTH) {
    throw new Error(`Invalid code length: ${code.length}, expected ${CODE_LENGTH}`);
  }
  // Split into groups: 6-7-6-7 = 26
  return `${code.slice(0, 6)}-${code.slice(6, 13)}-${code.slice(13, 19)}-${code.slice(19, 26)}`;
}

/**
 * Normalize user input (remove dashes, uppercase, trim)
 * @param {string} input - User-entered code
 * @returns {string} Normalized code
 */
function normalizeCode(input) {
  return String(input)
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .trim();
}

/**
 * Hash a code using SHA-256.
 * Store only the hash, never the plaintext.
 * @param {string} code - The plaintext code
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashCode(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Timing-safe comparison of two hash strings.
 * Prevents timing attacks that could reveal partial hash matches.
 * @param {string} a - First hash (hex)
 * @param {string} b - Second hash (hex)
 * @returns {boolean} True if hashes match
 */
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    
    if (bufA.length !== bufB.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Create a new payout code record for storage.
 * @param {object} params
 * @param {string} params.spinId - Unique spin identifier
 * @param {string} params.winner - Winner X handle or identifier
 * @param {string} params.mode - Spin mode (names/prizes)
 * @param {string} params.label - Prize/name that was won
 * @returns {{ code: string, codeDisplay: string, record: object }}
 */
function createPayoutCode({ spinId, winner, mode, label }) {
  const code = generateCode();
  const codeHash = hashCode(code);
  const now = Date.now();
  
  const record = {
    codeHash,
    spinId,
    winner,
    mode,
    label,
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
    burned: false,
    burnedAt: null,
  };
  
  return {
    code, // Plaintext - return ONCE only, never store
    codeDisplay: formatCodeForDisplay(code),
    record, // Store this (contains only hash)
  };
}

/**
 * Validate and burn a payout code.
 * @param {object} params
 * @param {string} params.inputCode - User-provided code
 * @param {object[]} params.payoutCodes - Array of stored payout code records
 * @returns {{ valid: boolean, error?: string, record?: object }}
 */
function validateAndBurn({ inputCode, payoutCodes }) {
  const normalized = normalizeCode(inputCode);
  
  if (normalized.length !== CODE_LENGTH) {
    return { valid: false, error: 'Invalid code format' };
  }
  
  const inputHash = hashCode(normalized);
  const now = Date.now();
  
  // Find matching code using timing-safe comparison
  let matchedRecord = null;
  for (const record of payoutCodes) {
    if (timingSafeCompare(inputHash, record.codeHash)) {
      matchedRecord = record;
      break;
    }
  }
  
  if (!matchedRecord) {
    return { valid: false, error: 'Unknown or invalid code' };
  }
  
  if (matchedRecord.burned) {
    return { valid: false, error: 'Code already used' };
  }
  
  if (now > matchedRecord.expiresAt) {
    return { valid: false, error: 'Code expired' };
  }
  
  // Valid and ready to burn
  matchedRecord.burned = true;
  matchedRecord.burnedAt = now;
  
  return { valid: true, record: matchedRecord };
}

/**
 * Check if a code is valid without burning it (for preview/status check).
 * @param {object} params
 * @param {string} params.inputCode - User-provided code
 * @param {object[]} params.payoutCodes - Array of stored payout code records
 * @returns {{ exists: boolean, burned?: boolean, expired?: boolean }}
 */
function checkCodeStatus({ inputCode, payoutCodes }) {
  const normalized = normalizeCode(inputCode);
  
  if (normalized.length !== CODE_LENGTH) {
    return { exists: false };
  }
  
  const inputHash = hashCode(normalized);
  const now = Date.now();
  
  for (const record of payoutCodes) {
    if (timingSafeCompare(inputHash, record.codeHash)) {
      return {
        exists: true,
        burned: record.burned,
        expired: now > record.expiresAt,
      };
    }
  }
  
  return { exists: false };
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  TOTAL_ENTROPY,
  generateCode,
  formatCodeForDisplay,
  normalizeCode,
  hashCode,
  timingSafeCompare,
  createPayoutCode,
  validateAndBurn,
  checkCodeStatus,
};
