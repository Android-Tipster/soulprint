// license.js — offline, self-validating Pro keys. No server, no account.
// Format: SOULPRINT-XXXX-XXXX-XXXX, Crockford base32, third block is an
// FNV-1a checksum of the first two so any minted key validates without a seed.
//
// Gotcha (shared with the rest of the portfolio): the prefix "SOULPRINT"
// contains O, L and I, which Crockford normalisation maps to 0, 1 and 1.
// So we ALWAYS compare normalised-to-normalised and accept the common
// O/0 and I/L/1 typos a user makes copying a key by hand.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I L O U)

// Map an arbitrary string to the Crockford space: uppercase, O->0, I/L->1,
// strip anything that is not a base32 symbol or a hyphen.
export function normalizeKey(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z-]/g, '')
    .replace(/[^0-9ABCDEFGHJKMNPQRSTVWXYZ-]/g, '');
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function toBase32(num, len) {
  let s = '';
  let n = num >>> 0;
  for (let i = 0; i < len; i++) { s = ALPHABET[n & 31] + s; n = Math.floor(n / 32); }
  return s;
}

// The checksum block for a given (normalised) prefix + two data blocks.
function checksumBlock(normPrefix, b1, b2) {
  return toBase32(fnv1a(normPrefix + '|' + b1 + '|' + b2), 4);
}

const NORM_PREFIX = normalizeKey('SOULPRINT'); // "S0U1PR1NT"

// Validate a key the user pasted. Returns true for any structurally correct,
// checksum-matching SOULPRINT-XXXX-XXXX-XXXX key.
export function validateKey(raw) {
  const norm = normalizeKey(raw);
  const parts = norm.split('-').filter(Boolean);
  if (parts.length !== 4) return false;
  const [prefix, b1, b2, csum] = parts;
  if (prefix !== NORM_PREFIX) return false;
  if (![b1, b2, csum].every(b => b.length === 4)) return false;
  return checksumBlock(NORM_PREFIX, b1, b2) === csum;
}

// Mint a valid key from two 4-char data blocks (used to pre-generate keys for
// the OFFER and to self-check the validator in tests).
export function mintKey(b1, b2) {
  const B1 = normalizeKey(b1).slice(0, 4).padStart(4, '0');
  const B2 = normalizeKey(b2).slice(0, 4).padStart(4, '0');
  return `SOULPRINT-${B1}-${B2}-${checksumBlock(NORM_PREFIX, B1, B2)}`;
}
