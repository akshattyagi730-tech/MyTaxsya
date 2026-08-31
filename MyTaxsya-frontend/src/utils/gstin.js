// Shared GSTIN validator — used by Settings (data entry) and GST Center
// (export gating) so both places agree on what "valid" means.
//
// GSTIN structure (15 chars): 2-digit state code + 10-char PAN (5 letters,
// 4 digits, 1 letter) + 1 entity code + fixed 'Z' + 1 checksum character.
const GSTIN_STRUCTURE_REGEX = /^([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z])([1-9A-Z])(Z)([0-9A-Z])$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Standard GSTIN check-digit algorithm (mod-36, alternating 1x/2x weights
// over the first 14 characters).
function computeGstinChecksum(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const charValue = CHARSET.indexOf(first14[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    let product = charValue * factor;
    product = Math.floor(product / 36) + (product % 36);
    sum += product;
  }
  const checkValue = (36 - (sum % 36)) % 36;
  return CHARSET[checkValue];
}

/**
 * Validates a GSTIN. Returns a result object rather than a plain boolean so
 * callers can distinguish a hard format failure (safe to block on) from a
 * checksum mismatch (surfaced as a warning, not a hard block — the checksum
 * algorithm can't be verified against GSTN's live registry from here, so a
 * bug in it should never be able to lock a user out of their own valid
 * GSTIN; a malformed GSTIN, on the other hand, is unambiguous).
 */
export function validateGstin(value) {
  const gstin = String(value || "").trim().toUpperCase();
  if (!gstin) {
    return { valid: false, formatValid: false, checksumValid: false, gstin: "", reason: "GSTIN is required" };
  }
  const match = GSTIN_STRUCTURE_REGEX.exec(gstin);
  if (!match) {
    return { valid: false, formatValid: false, checksumValid: false, gstin, reason: "Invalid GSTIN format (expected e.g. 27ABCDE1234F1Z5)" };
  }
  const expected = computeGstinChecksum(gstin.slice(0, 14));
  const actual = gstin[14];
  const checksumValid = expected === actual;
  return {
    valid: true,
    formatValid: true,
    checksumValid,
    gstin,
    reason: checksumValid ? null : "GSTIN checksum looks unusual — please double-check it was entered correctly",
  };
}

export function isValidGstinFormat(value) {
  return validateGstin(value).formatValid;
}
