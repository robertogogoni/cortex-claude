/**
 * Cortex - API Key Resolver
 *
 * Single source of truth for the Anthropic API key.
 * Resolution order:
 *   1. ~/.claude/.env file (ANTHROPIC_API_KEY=...)
 *   2. Environment variable ANTHROPIC_API_KEY
 *   3. null (Cortex degrades gracefully — local-only mode)
 *
 * Usage:
 *   const { getApiKey, hasApiKey } = require('../core/api-key.cjs');
 *   const key = getApiKey();  // Returns key or null
 *
 * @version 1.0.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Cache the resolved key for the process lifetime
let _cachedKey = undefined;
let _keySource = null;

const ENV_FILE = path.join(process.env.HOME || '', '.claude', '.env');

/**
 * Resolve the Anthropic API key from available sources.
 * @returns {string|null} The API key, or null if not available
 */
function getApiKey() {
  if (_cachedKey !== undefined) return _cachedKey;

  // Strategy 1: Read from ~/.claude/.env
  try {
    if (fs.existsSync(ENV_FILE)) {
      const content = fs.readFileSync(ENV_FILE, 'utf8');
      const match = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (match && match[1].trim()) {
        const key = match[1].trim();
        if (_isValidKey(key)) {
          _cachedKey = key;
          _keySource = 'file:~/.claude/.env';
          return _cachedKey;
        }
      }
    }
  } catch {
    // File read failed, continue to next strategy
  }

  // Strategy 2: Environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && _isValidKey(envKey)) {
    _cachedKey = envKey;
    _keySource = 'env:ANTHROPIC_API_KEY';
    return _cachedKey;
  }

  // No valid key found — Cortex will run in local-only mode
  _cachedKey = null;
  _keySource = 'none';
  return null;
}

/**
 * Check if a valid API key is available.
 * @returns {boolean}
 */
function hasApiKey() {
  return getApiKey() !== null;
}

/**
 * Get the source where the key was found.
 * @returns {string} 'file:~/.claude/.env' | 'env:ANTHROPIC_API_KEY' | 'none'
 */
function getKeySource() {
  getApiKey(); // Ensure resolved
  return _keySource;
}

/**
 * Validate API key format.
 * Real keys start with 'sk-ant-' and are 90+ characters.
 * Rejects common placeholders.
 */
function _isValidKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.length < 20) return false;
  if (key.startsWith('your-')) return false;
  if (key === 'sk-ant-xxx' || key.includes('placeholder')) return false;
  // Real Anthropic keys start with sk-ant-api
  return key.startsWith('sk-ant-');
}

/**
 * Clear cached key (for testing).
 */
function clearCache() {
  _cachedKey = undefined;
  _keySource = null;
}

/**
 * Get diagnostic info for status display.
 * @returns {Object}
 */
function getDiagnostics() {
  const key = getApiKey();
  return {
    available: key !== null,
    source: _keySource,
    keyPrefix: key ? key.slice(0, 12) + '...' : null,
    envFileExists: fs.existsSync(ENV_FILE),
    envFilePath: ENV_FILE,
  };
}

module.exports = { getApiKey, hasApiKey, getKeySource, getDiagnostics, clearCache };
