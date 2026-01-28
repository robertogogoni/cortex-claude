#!/usr/bin/env node
/**
 * Cortex Encryption Module
 *
 * Provides AES-256-GCM encryption for sensitive memory data at rest.
 * Uses PBKDF2 for key derivation from environment variable or config.
 *
 * Security Properties:
 * - AES-256-GCM: Authenticated encryption (confidentiality + integrity)
 * - PBKDF2: 100,000 iterations for key derivation
 * - Random IV: Fresh initialization vector for each encryption
 * - No key storage: Key derived on-demand from secret
 *
 * @version 1.0.0
 */

'use strict';

const crypto = require('crypto');

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Encryption algorithm: AES-256-GCM (authenticated encryption)
 */
const ALGORITHM = 'aes-256-gcm';

/**
 * Key derivation algorithm: PBKDF2
 */
const KEY_DERIVATION = 'sha512';

/**
 * Key derivation iterations (OWASP recommends >= 100,000)
 */
const KDF_ITERATIONS = 100000;

/**
 * Key length in bytes (256 bits for AES-256)
 */
const KEY_LENGTH = 32;

/**
 * IV length in bytes (96 bits recommended for GCM)
 */
const IV_LENGTH = 12;

/**
 * Auth tag length in bytes (128 bits is the maximum for GCM)
 */
const AUTH_TAG_LENGTH = 16;

/**
 * Salt length in bytes
 */
const SALT_LENGTH = 16;

/**
 * Magic header for encrypted data (identifies Cortex encrypted format)
 */
const MAGIC_HEADER = 'CRX1'; // Cortex Encryption v1

// =============================================================================
// ENCRYPTION CLASS
// =============================================================================

/**
 * AES-256-GCM encryption with automatic key management
 */
class CortexEncryption {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.secret - Encryption secret (defaults to env var)
   * @param {boolean} options.enabled - Whether encryption is enabled
   */
  constructor(options = {}) {
    this.secret = options.secret || process.env.CORTEX_ENCRYPTION_SECRET;
    this.enabled = options.enabled !== false && !!this.secret;

    // Cache derived keys by salt (for performance)
    this._keyCache = new Map();
    this._maxCacheSize = 10;
  }

  /**
   * Check if encryption is available
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Derive encryption key from secret using PBKDF2
   * @param {Buffer} salt - Salt for key derivation
   * @returns {Buffer} - Derived key
   * @private
   */
  _deriveKey(salt) {
    const saltHex = salt.toString('hex');

    // Check cache first
    if (this._keyCache.has(saltHex)) {
      return this._keyCache.get(saltHex);
    }

    // Derive key
    const key = crypto.pbkdf2Sync(
      this.secret,
      salt,
      KDF_ITERATIONS,
      KEY_LENGTH,
      KEY_DERIVATION
    );

    // Cache the key
    if (this._keyCache.size >= this._maxCacheSize) {
      // Remove oldest entry
      const firstKey = this._keyCache.keys().next().value;
      this._keyCache.delete(firstKey);
    }
    this._keyCache.set(saltHex, key);

    return key;
  }

  /**
   * Encrypt plaintext data
   * @param {string} plaintext - Data to encrypt
   * @returns {string} - Base64-encoded encrypted data
   * @throws {Error} - If encryption is not enabled or fails
   */
  encrypt(plaintext) {
    if (!this.enabled) {
      throw new EncryptionError('Encryption not enabled. Set CORTEX_ENCRYPTION_SECRET.');
    }

    if (typeof plaintext !== 'string') {
      throw new EncryptionError('Plaintext must be a string');
    }

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key from secret + salt
    const key = this._deriveKey(salt);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Combine: magic + salt + iv + authTag + ciphertext
    const combined = Buffer.concat([
      Buffer.from(MAGIC_HEADER, 'ascii'),
      salt,
      iv,
      authTag,
      encrypted,
    ]);

    return combined.toString('base64');
  }

  /**
   * Decrypt encrypted data
   * @param {string} ciphertext - Base64-encoded encrypted data
   * @returns {string} - Decrypted plaintext
   * @throws {Error} - If decryption fails or data is invalid
   */
  decrypt(ciphertext) {
    if (!this.enabled) {
      throw new EncryptionError('Encryption not enabled. Set CORTEX_ENCRYPTION_SECRET.');
    }

    // Decode from base64
    let combined;
    try {
      combined = Buffer.from(ciphertext, 'base64');
    } catch (error) {
      throw new EncryptionError('Invalid ciphertext: not valid base64');
    }

    // Check minimum length
    const minLength = MAGIC_HEADER.length + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (combined.length < minLength) {
      throw new EncryptionError('Invalid ciphertext: too short');
    }

    // Verify magic header
    const header = combined.slice(0, MAGIC_HEADER.length).toString('ascii');
    if (header !== MAGIC_HEADER) {
      throw new EncryptionError('Invalid ciphertext: wrong format or not encrypted');
    }

    // Extract components
    let offset = MAGIC_HEADER.length;
    const salt = combined.slice(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;
    const iv = combined.slice(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;
    const authTag = combined.slice(offset, offset + AUTH_TAG_LENGTH);
    offset += AUTH_TAG_LENGTH;
    const encrypted = combined.slice(offset);

    // Derive key from secret + salt
    const key = this._deriveKey(salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    // Decrypt
    try {
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      throw new EncryptionError('Decryption failed: invalid key or corrupted data');
    }
  }

  /**
   * Check if a string appears to be encrypted with Cortex encryption
   * @param {string} data - Data to check
   * @returns {boolean}
   */
  isEncrypted(data) {
    if (typeof data !== 'string') return false;

    try {
      const decoded = Buffer.from(data, 'base64');
      if (decoded.length < MAGIC_HEADER.length) return false;
      return decoded.slice(0, MAGIC_HEADER.length).toString('ascii') === MAGIC_HEADER;
    } catch {
      return false;
    }
  }

  /**
   * Encrypt a JSON object
   * @param {Object} obj - Object to encrypt
   * @returns {string} - Encrypted base64 string
   */
  encryptJSON(obj) {
    return this.encrypt(JSON.stringify(obj));
  }

  /**
   * Decrypt to a JSON object
   * @param {string} ciphertext - Encrypted base64 string
   * @returns {Object} - Decrypted object
   */
  decryptJSON(ciphertext) {
    const plaintext = this.decrypt(ciphertext);
    return JSON.parse(plaintext);
  }

  /**
   * Clear the key cache (for security-sensitive operations)
   */
  clearCache() {
    this._keyCache.clear();
  }

  /**
   * Generate a secure random secret (for initial setup)
   * @returns {string} - Base64-encoded random secret
   */
  static generateSecret() {
    return crypto.randomBytes(32).toString('base64');
  }
}

// =============================================================================
// ENCRYPTION ERROR CLASS
// =============================================================================

/**
 * Custom error for encryption failures
 */
class EncryptionError extends Error {
  /**
   * @param {string} message - Error message
   */
  constructor(message) {
    super(message);
    this.name = 'EncryptionError';
    this.code = 'CORTEX_E500'; // Encryption error
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

// Singleton instance for convenience functions
let _defaultInstance = null;

/**
 * Get or create the default encryption instance
 * @returns {CortexEncryption}
 */
function getDefaultInstance() {
  if (!_defaultInstance) {
    _defaultInstance = new CortexEncryption();
  }
  return _defaultInstance;
}

/**
 * Quick encrypt function
 * @param {string} plaintext - Data to encrypt
 * @returns {string} - Encrypted base64 string
 */
function encrypt(plaintext) {
  return getDefaultInstance().encrypt(plaintext);
}

/**
 * Quick decrypt function
 * @param {string} ciphertext - Encrypted base64 string
 * @returns {string} - Decrypted plaintext
 */
function decrypt(ciphertext) {
  return getDefaultInstance().decrypt(ciphertext);
}

/**
 * Check if encryption is available
 * @returns {boolean}
 */
function isEnabled() {
  return getDefaultInstance().isEnabled();
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  CortexEncryption,
  EncryptionError,
  encrypt,
  decrypt,
  isEnabled,
  generateSecret: CortexEncryption.generateSecret,
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
};
