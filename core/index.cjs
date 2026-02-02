/**
 * Cortex - Claude's Cognitive Layer - Core Index
 *
 * Main entry point for Cortex core functionality.
 * Initializes and exports all core components.
 */

'use strict';

// Core components
const types = require('./types.cjs');
const { JSONLStore, MemoryIndex, StorageManager } = require('./storage.cjs');
const { LockManager, getLockManager } = require('./lock-manager.cjs');
const { WriteQueue, MemoryWriteQueue } = require('./write-queue.cjs');
const {
  CircuitBreaker,
  RetryHandler,
  GracefulDegradationManager,
  ErrorLogger,
  ErrorHandler,
  getErrorHandler,
} = require('./error-handler.cjs');
const { ConfigValidator, ConfigManager, getConfigManager, DEFAULT_CONFIG } = require('./config.cjs');

// Vector search components
const { Embedder, LRUCache, EMBEDDING_DIM } = require('./embedder.cjs');
const { VectorIndex } = require('./vector-index.cjs');
const { MemoryStore } = require('./memory-store.cjs');
const { HybridSearch } = require('./hybrid-search.cjs');
const { VectorSearchProvider, getVectorSearchProvider } = require('./vector-search-provider.cjs');

// LADS components
const {
  LADSCore,
  getLADSCore,
  PatternTracker,
  OutcomeScorer,
  ConfigEvolver,
  DocsWriter,
  SIGNAL_TYPES,
  EVOLUTION_RULES,
} = require('./lads/index.cjs');

// =============================================================================
// Cortex CORE
// =============================================================================

class CMOCore {
  /**
   * Main orchestrator class that initializes and coordinates all components
   * @param {Object} options
   */
  constructor(options = {}) {
    this.basePath = types.expandPath(options.basePath || '~/.claude/memory');
    this.initialized = false;

    // Components (lazy-initialized)
    this._storage = null;
    this._config = null;
    this._errorHandler = null;
    this._lockManager = null;
    this._writeQueue = null;
    this._lads = null;
    this._vectorSearch = null;
  }

  /**
   * Get storage manager (lazy)
   * @returns {StorageManager}
   */
  get storage() {
    if (!this._storage) {
      this._storage = new StorageManager(this.basePath);
    }
    return this._storage;
  }

  /**
   * Get config manager (lazy)
   * @returns {ConfigManager}
   */
  get config() {
    if (!this._config) {
      this._config = getConfigManager({
        configPath: `${this.basePath}/data/configs/current.json`,
        historyDir: `${this.basePath}/data/configs/history`,
      });
    }
    return this._config;
  }

  /**
   * Get error handler (lazy)
   * @returns {ErrorHandler}
   */
  get errorHandler() {
    if (!this._errorHandler) {
      this._errorHandler = getErrorHandler({
        circuitBreaker: this.config.get('errorHandling.circuitBreaker'),
        retry: this.config.get('errorHandling.retry'),
        logDir: `${this.basePath}/logs`,
      });
    }
    return this._errorHandler;
  }

  /**
   * Get lock manager (lazy)
   * @returns {LockManager}
   */
  get lockManager() {
    if (!this._lockManager) {
      this._lockManager = getLockManager({
        lockDir: `${this.basePath}/.locks`,
      });
    }
    return this._lockManager;
  }

  /**
   * Get write queue (lazy)
   * @returns {MemoryWriteQueue}
   */
  get writeQueue() {
    if (!this._writeQueue) {
      this._writeQueue = new MemoryWriteQueue(this.storage, {
        batchSize: 10,
        batchDelayMs: 100,
      });
    }
    return this._writeQueue;
  }

  /**
   * Get LADS core (lazy)
   * @returns {LADSCore}
   */
  get lads() {
    if (!this._lads) {
      this._lads = getLADSCore({
        basePath: this.basePath,
        enabled: this.config.get('ladsCore.evolution.enabled'),
      });
    }
    return this._lads;
  }

  /**
   * Get Vector Search Provider (lazy)
   * Provides hybrid search combining BM25 + semantic vector search
   * @returns {VectorSearchProvider}
   */
  get vectorSearch() {
    if (!this._vectorSearch) {
      this._vectorSearch = getVectorSearchProvider({
        basePath: this.basePath,
        // Config-driven options
        vectorWeight: this.config.get('vectorSearch.vectorWeight') || 0.6,
        bm25Weight: this.config.get('vectorSearch.bm25Weight') || 0.4,
        rrfK: this.config.get('vectorSearch.rrfK') || 60,
        minScore: this.config.get('vectorSearch.minScore') || 0.1,
      });
    }
    return this._vectorSearch;
  }

  /**
   * Initialize all components
   * @returns {Promise<{success: boolean, components: Object}>}
   */
  async initialize() {
    const results = {
      config: { success: false },
      storage: { success: false },
      lads: { success: false },
      vectorSearch: { success: false },
      errorHandler: { success: true },
      lockManager: { success: true },
    };

    try {
      // Load config first
      results.config = this.config.load();

      // Initialize storage
      results.storage = await this.storage.initialize();

      // Initialize LADS core
      results.lads = await this.lads.initialize();

      // Initialize Vector Search (optional - may fail if dependencies missing)
      try {
        const vectorResult = await this.vectorSearch.initialize();
        results.vectorSearch = {
          success: true,
          ...vectorResult,
        };
        console.log(`[Cortex] Vector search initialized: ${vectorResult.vectorCount} vectors`);
      } catch (vectorError) {
        // Vector search is optional - don't fail entire init
        results.vectorSearch = {
          success: false,
          error: vectorError.message,
          optional: true,
        };
        console.warn(`[Cortex] Vector search unavailable: ${vectorError.message}`);
      }

      this.initialized = true;

      console.log('[Cortex] Core initialized successfully');

      return {
        success: results.config.success && results.storage.success && results.lads.success,
        components: results,
      };
    } catch (error) {
      this.errorHandler.handleError(error, {
        component: 'cmo-core',
        operation: 'initialize',
      });

      return {
        success: false,
        error: error.message,
        components: results,
      };
    }
  }

  /**
   * Shutdown all components cleanly
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('[Cortex] Shutting down...');

    // Flush pending writes
    if (this._writeQueue) {
      await this._writeQueue.flushAll();
    }

    // Shutdown vector search (saves indices)
    if (this._vectorSearch) {
      try {
        await this._vectorSearch.shutdown();
        console.log('[Cortex] Vector search shutdown complete');
      } catch (error) {
        console.error(`[Cortex] Vector search shutdown error: ${error.message}`);
      }
    }

    // Release all locks
    if (this._lockManager) {
      this._lockManager.releaseAll();
    }

    this.initialized = false;
    console.log('[Cortex] Shutdown complete');
  }

  /**
   * Get overall system status
   * @returns {Object}
   */
  getStatus() {
    return {
      initialized: this.initialized,
      basePath: this.basePath,
      storage: this._storage?.getStats() || null,
      config: this._config ? {
        loaded: this._config.loaded,
        version: this._config.get('version'),
      } : null,
      errorHandler: this._errorHandler?.getStatus() || null,
      lockManager: this._lockManager?.getStats() || null,
      writeQueue: this._writeQueue?.getStats() || null,
      lads: this._lads?.getStats() || null,
      vectorSearch: this._vectorSearch?.getStats() || null,
    };
  }

  /**
   * Health check
   * @returns {Promise<{healthy: boolean, checks: Object}>}
   */
  async healthCheck() {
    const checks = {
      config: { healthy: false, message: '' },
      storage: { healthy: false, message: '' },
      locks: { healthy: false, message: '' },
      vectorSearch: { healthy: false, message: '', optional: true },
    };

    // Config check
    try {
      const config = this.config.getAll();
      checks.config.healthy = !!config.version;
      checks.config.message = checks.config.healthy ? 'OK' : 'No version';
    } catch (e) {
      checks.config.message = e.message;
    }

    // Storage check
    try {
      const stats = this.storage.getStats();
      checks.storage.healthy = stats.initialized;
      checks.storage.message = checks.storage.healthy ? 'OK' : 'Not initialized';
    } catch (e) {
      checks.storage.message = e.message;
    }

    // Lock check
    try {
      const testLock = await this.lockManager.acquire('__health_check__', { timeoutMs: 1000 });
      if (testLock.acquired) {
        this.lockManager.release('__health_check__');
        checks.locks.healthy = true;
        checks.locks.message = 'OK';
      } else {
        checks.locks.message = 'Could not acquire test lock';
      }
    } catch (e) {
      checks.locks.message = e.message;
    }

    // Vector Search check (optional - degraded mode OK)
    try {
      if (this._vectorSearch?.initialized) {
        const vectorStats = this._vectorSearch.getStats();
        checks.vectorSearch.healthy = vectorStats.initialized;
        checks.vectorSearch.message = checks.vectorSearch.healthy
          ? `OK (${vectorStats.vectorCount} vectors)`
          : 'Not initialized';
      } else {
        checks.vectorSearch.message = 'Not loaded (optional)';
      }
    } catch (e) {
      checks.vectorSearch.message = e.message;
    }

    // Core components must be healthy, vectorSearch is optional
    const coreChecks = ['config', 'storage', 'locks'];
    const healthy = coreChecks.every(name => checks[name].healthy);

    // Report to degradation manager
    for (const [name, check] of Object.entries(checks)) {
      this.errorHandler.degradation.reportHealth(name, check.healthy, check.message);
    }

    return { healthy, checks };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let cmoInstance = null;

function getCMO(options) {
  if (!cmoInstance) {
    cmoInstance = new CMOCore(options);
  }
  return cmoInstance;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Main class
  CMOCore,
  getCMO,

  // Storage
  JSONLStore,
  MemoryIndex,
  StorageManager,

  // Concurrency
  LockManager,
  getLockManager,
  WriteQueue,
  MemoryWriteQueue,

  // Error handling
  CircuitBreaker,
  RetryHandler,
  GracefulDegradationManager,
  ErrorLogger,
  ErrorHandler,
  getErrorHandler,

  // Config
  ConfigValidator,
  ConfigManager,
  getConfigManager,
  DEFAULT_CONFIG,

  // LADS (Learnable, Adaptive, Documenting, Self-improving)
  LADSCore,
  getLADSCore,
  PatternTracker,
  OutcomeScorer,
  ConfigEvolver,
  DocsWriter,
  SIGNAL_TYPES,
  EVOLUTION_RULES,

  // Vector Search (semantic + BM25 hybrid search)
  Embedder,
  LRUCache,
  EMBEDDING_DIM,
  VectorIndex,
  MemoryStore,
  HybridSearch,
  VectorSearchProvider,
  getVectorSearchProvider,

  // Types and utilities
  ...types,
};
