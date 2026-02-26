#!/usr/bin/env node
/**
 * Shared Embedder Provider
 *
 * Provides a singleton Embedder instance across all adapters to prevent
 * duplicate model loading and improve cache efficiency.
 *
 * @version 1.0.0
 */

'use strict';

let sharedInstance = null;

/**
 * Get or create the shared Embedder instance.
 * First caller's options are used for initialization; subsequent calls
 * return the existing instance (options ignored).
 *
 * @param {Object} [options] - Embedder constructor options (model, cacheSize, cacheTTL, verbose)
 * @returns {import('./embedder.cjs').Embedder}
 */
function getSharedEmbedder(options = {}) {
  if (!sharedInstance) {
    const { Embedder } = require('./embedder.cjs');
    sharedInstance = new Embedder(options);
  }
  return sharedInstance;
}

/**
 * Reset the shared instance (for testing only).
 */
function resetSharedEmbedder() {
  sharedInstance = null;
}

module.exports = {
  getSharedEmbedder,
  resetSharedEmbedder,
};
