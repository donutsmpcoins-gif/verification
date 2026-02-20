const crypto = require('crypto');
const { ENCRYPTION_ALGORITHM, IV_LENGTH, AUTH_TAG_LENGTH } = require('../utils/constants');
const config = require('../config');

/**
 * Encryption service for securing OAuth tokens at rest.
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Format: base64(iv + authTag + ciphertext)
 * - IV: 16 bytes
 * - Auth Tag: 16 bytes
 * - Ciphertext: variable
 */

function getKey() {
  return Buffer.from(config.encryption.key, 'hex');
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @returns {string} Base64-encoded encrypted payload
 */
function encrypt(plaintext) {
  if (!plaintext) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Combine: IV (16) + AuthTag (16) + Ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt an encrypted payload string.
 * @param {string} encryptedPayload Base64-encoded encrypted payload
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedPayload) {
  if (!encryptedPayload) return null;

  const combined = Buffer.from(encryptedPayload, 'base64');

  // Extract components
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Generate a cryptographically secure random state string.
 * @param {number} bytes Number of random bytes (default 32)
 * @returns {string} Hex-encoded random string
 */
function generateState(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  generateState,
};
