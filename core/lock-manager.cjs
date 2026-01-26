/**
 * Claude Memory Orchestrator - Lock Manager
 *
 * File-based locking for cross-session concurrency:
 * - Lock files with TTL (auto-cleanup on crash)
 * - Wait with timeout for lock acquisition
 * - Stale lock detection and cleanup
 * - Per-resource granular locking
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath, sleep, getTimestamp } = require('./types.cjs');

// =============================================================================
// LOCK MANAGER
// =============================================================================

class LockManager {
  /**
   * @param {Object} options
   * @param {string} options.lockDir - Directory for lock files
   * @param {number} options.defaultTTLMs - Default lock TTL in ms
   * @param {number} options.waitTimeoutMs - Default wait timeout
   * @param {number} options.pollIntervalMs - Poll interval when waiting
   */
  constructor(options = {}) {
    this.lockDir = expandPath(options.lockDir || '~/.claude/memory/.locks');
    this.defaultTTLMs = options.defaultTTLMs || 30000; // 30 seconds
    this.waitTimeoutMs = options.waitTimeoutMs || 5000; // 5 seconds
    this.pollIntervalMs = options.pollIntervalMs || 100;

    // Active locks held by this process
    this.activeLocks = new Map();

    // Stats tracking
    this.totalAcquired = 0;

    // Ensure lock directory exists
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true, mode: 0o700 });
    }

    // Cleanup stale locks on startup
    this._cleanupStaleLocks();
  }

  /**
   * Generate lock file path for a resource
   * @param {string} resource
   * @returns {string}
   */
  _lockPath(resource) {
    // Sanitize resource name for filesystem
    const safeName = resource.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.lockDir, `${safeName}.lock`);
  }

  /**
   * Read lock file content
   * @param {string} lockPath
   * @returns {Object|null}
   */
  _readLock(lockPath) {
    try {
      if (!fs.existsSync(lockPath)) return null;
      const content = fs.readFileSync(lockPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if a lock is stale (expired or from dead process)
   * @param {Object} lock
   * @returns {boolean}
   */
  _isStale(lock) {
    if (!lock) return true;

    // Check TTL expiry
    const expiresAt = new Date(lock.expiresAt).getTime();
    if (Date.now() > expiresAt) {
      return true;
    }

    // Check if holding process is still alive (Linux/macOS only)
    if (process.platform !== 'win32' && lock.pid) {
      try {
        // Sending signal 0 checks if process exists without killing it
        process.kill(lock.pid, 0);
        return false; // Process exists
      } catch (e) {
        return true; // Process doesn't exist
      }
    }

    return false;
  }

  /**
   * Cleanup stale locks in the lock directory
   */
  _cleanupStaleLocks() {
    try {
      const files = fs.readdirSync(this.lockDir);
      for (const file of files) {
        if (!file.endsWith('.lock')) continue;

        const lockPath = path.join(this.lockDir, file);
        const lock = this._readLock(lockPath);

        if (this._isStale(lock)) {
          try {
            fs.unlinkSync(lockPath);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }
    } catch (e) {
      // Lock directory might not exist yet
    }
  }

  /**
   * Try to acquire a lock (non-blocking)
   * @param {string} resource
   * @param {Object} options
   * @param {number} options.ttlMs - Lock TTL
   * @param {string} options.owner - Owner identifier
   * @returns {{acquired: boolean, holder: Object|null}}
   */
  tryAcquire(resource, options = {}) {
    const lockPath = this._lockPath(resource);
    const ttlMs = options.ttlMs || this.defaultTTLMs;
    const owner = options.owner || `pid-${process.pid}`;

    // Check existing lock
    const existingLock = this._readLock(lockPath);

    if (existingLock && !this._isStale(existingLock)) {
      // Already locked by someone else
      return { acquired: false, holder: existingLock };
    }

    // Remove stale lock if present
    if (existingLock) {
      try {
        fs.unlinkSync(lockPath);
      } catch (e) {
        // Ignore
      }
    }

    // Create new lock
    const lockData = {
      resource,
      owner,
      pid: process.pid,
      hostname: require('os').hostname(),
      acquiredAt: getTimestamp(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      ttlMs,
    };

    try {
      // Write lock file atomically
      const tempPath = `${lockPath}.tmp.${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify(lockData, null, 2), { mode: 0o600 });

      // Atomic rename
      fs.renameSync(tempPath, lockPath);

      // Track active lock
      this.activeLocks.set(resource, {
        path: lockPath,
        data: lockData,
        renewTimer: null,
      });

      this.totalAcquired++;
      return { acquired: true, holder: lockData };
    } catch (e) {
      // Another process may have won the race
      return { acquired: false, holder: this._readLock(lockPath) };
    }
  }

  /**
   * Acquire a lock with waiting
   * @param {string} resource
   * @param {Object} options
   * @param {number} options.ttlMs - Lock TTL
   * @param {number} options.timeoutMs - Wait timeout
   * @param {string} options.owner - Owner identifier
   * @returns {Promise<{acquired: boolean, holder: Object|null, waited: number}>}
   */
  async acquire(resource, options = {}) {
    const timeoutMs = options.timeoutMs || this.waitTimeoutMs;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = this.tryAcquire(resource, options);

      if (result.acquired) {
        return { ...result, waited: Date.now() - startTime };
      }

      // Wait before retrying
      await sleep(this.pollIntervalMs);
    }

    // Timeout
    const holder = this._readLock(this._lockPath(resource));
    return {
      acquired: false,
      holder,
      waited: Date.now() - startTime,
      timedOut: true,
    };
  }

  /**
   * Release a lock
   * @param {string} resource
   * @returns {{released: boolean}}
   */
  release(resource) {
    const lockPath = this._lockPath(resource);
    const activeLock = this.activeLocks.get(resource);

    // Only release if we hold the lock
    if (activeLock) {
      const existingLock = this._readLock(lockPath);

      // Verify we still own the lock
      if (existingLock && existingLock.pid === process.pid) {
        try {
          fs.unlinkSync(lockPath);

          // Clear renew timer if set
          if (activeLock.renewTimer) {
            clearInterval(activeLock.renewTimer);
          }

          this.activeLocks.delete(resource);
          return { released: true };
        } catch (e) {
          return { released: false, error: e.message };
        }
      }
    }

    return { released: false, reason: 'not_owner' };
  }

  /**
   * Renew a lock (extend TTL)
   * @param {string} resource
   * @param {number} ttlMs
   * @returns {{renewed: boolean}}
   */
  renew(resource, ttlMs) {
    const lockPath = this._lockPath(resource);
    const activeLock = this.activeLocks.get(resource);

    if (!activeLock) {
      return { renewed: false, reason: 'not_held' };
    }

    const existingLock = this._readLock(lockPath);

    // Verify we still own the lock
    if (!existingLock || existingLock.pid !== process.pid) {
      this.activeLocks.delete(resource);
      return { renewed: false, reason: 'lost_ownership' };
    }

    // Update expiry
    const newLock = {
      ...existingLock,
      expiresAt: new Date(Date.now() + (ttlMs || this.defaultTTLMs)).toISOString(),
    };

    try {
      const tempPath = `${lockPath}.tmp.${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify(newLock, null, 2), { mode: 0o600 });
      fs.renameSync(tempPath, lockPath);

      activeLock.data = newLock;
      return { renewed: true, expiresAt: newLock.expiresAt };
    } catch (e) {
      return { renewed: false, error: e.message };
    }
  }

  /**
   * Setup automatic lock renewal
   * @param {string} resource
   * @param {number} intervalMs - Renewal interval (should be < TTL)
   * @returns {{enabled: boolean}}
   */
  enableAutoRenew(resource, intervalMs) {
    const activeLock = this.activeLocks.get(resource);

    if (!activeLock) {
      return { enabled: false, reason: 'not_held' };
    }

    // Clear existing timer
    if (activeLock.renewTimer) {
      clearInterval(activeLock.renewTimer);
    }

    // Setup renewal timer
    activeLock.renewTimer = setInterval(() => {
      const result = this.renew(resource);
      if (!result.renewed) {
        clearInterval(activeLock.renewTimer);
        this.activeLocks.delete(resource);
      }
    }, intervalMs || this.defaultTTLMs / 2);

    return { enabled: true, intervalMs };
  }

  /**
   * Execute a function while holding a lock
   * @param {string} resource
   * @param {Function} fn - Function to execute
   * @param {Object} options - Lock options
   * @returns {Promise<{success: boolean, result: any, error: any}>}
   */
  async withLock(resource, fn, options = {}) {
    const lockResult = await this.acquire(resource, options);

    if (!lockResult.acquired) {
      return {
        success: false,
        error: 'Failed to acquire lock',
        holder: lockResult.holder,
        waited: lockResult.waited,
      };
    }

    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      this.release(resource);
    }
  }

  /**
   * Check if a resource is locked
   * @param {string} resource
   * @returns {{locked: boolean, holder: Object|null}}
   */
  isLocked(resource) {
    const lock = this._readLock(this._lockPath(resource));

    if (!lock || this._isStale(lock)) {
      return { locked: false, holder: null };
    }

    return { locked: true, holder: lock };
  }

  /**
   * Get list of all active locks
   * @returns {Object[]}
   */
  getActiveLocks() {
    const locks = [];

    try {
      const files = fs.readdirSync(this.lockDir);
      for (const file of files) {
        if (!file.endsWith('.lock')) continue;

        const lockPath = path.join(this.lockDir, file);
        const lock = this._readLock(lockPath);

        if (lock && !this._isStale(lock)) {
          locks.push(lock);
        }
      }
    } catch (e) {
      // Ignore
    }

    return locks;
  }

  /**
   * Release all locks held by this process
   */
  releaseAll() {
    for (const resource of this.activeLocks.keys()) {
      this.release(resource);
    }
  }

  /**
   * Get lock manager statistics
   * @returns {Object}
   */
  getStats() {
    return {
      activeLocksHeld: this.activeLocks.size,
      activeLocks: this.activeLocks.size, // Alias for test compatibility
      totalLocksInSystem: this.getActiveLocks().length,
      totalAcquired: this.totalAcquired || 0, // Track total acquired
      lockDir: this.lockDir,
      defaultTTLMs: this.defaultTTLMs,
      waitTimeoutMs: this.waitTimeoutMs,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let instance = null;

function getLockManager(options) {
  if (!instance) {
    instance = new LockManager(options);
  }
  return instance;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  LockManager,
  getLockManager,
};
