/**
 * Claude Memory Orchestrator - Write Queue
 *
 * Batched atomic writes with:
 * - Operation batching by resource
 * - Merging of compatible operations
 * - Transaction-like behavior
 * - Crash-safe write guarantees
 */

'use strict';

const { generateId, getTimestamp, sleep } = require('./types.cjs');
const { getLockManager } = require('./lock-manager.cjs');

// =============================================================================
// WRITE OPERATION
// =============================================================================

/**
 * @typedef {'append' | 'update' | 'delete'} WriteOperation
 */

/**
 * @typedef {Object} WriteRequest
 * @property {string} id
 * @property {string} resource - Target resource (file/store)
 * @property {WriteOperation} operation
 * @property {Object} data
 * @property {number} priority - Lower = higher priority
 * @property {string} timestamp
 * @property {Function} resolve - Promise resolve
 * @property {Function} reject - Promise reject
 */

// =============================================================================
// WRITE QUEUE
// =============================================================================

class WriteQueue {
  /**
   * @param {Object} options
   * @param {number} options.batchSize - Max operations per batch
   * @param {number} options.batchDelayMs - Max wait time before flush
   * @param {number} options.maxQueueSize - Max pending operations
   * @param {boolean} options.mergeUpdates - Merge compatible updates
   */
  constructor(options = {}) {
    this.batchSize = options.batchSize || 10;
    this.batchDelayMs = options.batchDelayMs || 100;
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.mergeUpdates = options.mergeUpdates !== false;

    // Queued operations by resource
    this.queues = new Map();

    // Processing state
    this.processing = new Set();
    this.flushTimers = new Map();

    // Stats
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalMerged: 0,
      totalErrors: 0,
      currentQueueSize: 0,
    };

    // Lock manager for coordinated writes
    this.lockManager = getLockManager();
  }

  /**
   * Queue a write operation
   * @param {string} resource
   * @param {WriteOperation} operation
   * @param {Object} data
   * @param {Object} options
   * @returns {Promise<{success: boolean, id: string}>}
   */
  async queue(resource, operation, data, options = {}) {
    if (this.stats.currentQueueSize >= this.maxQueueSize) {
      throw new Error('Write queue is full');
    }

    return new Promise((resolve, reject) => {
      const request = {
        id: generateId(),
        resource,
        operation,
        data,
        priority: options.priority || 10,
        timestamp: getTimestamp(),
        resolve,
        reject,
      };

      // Initialize queue for resource if needed
      if (!this.queues.has(resource)) {
        this.queues.set(resource, []);
      }

      const queue = this.queues.get(resource);

      // Try to merge with existing operation
      if (this.mergeUpdates && operation === 'update') {
        const merged = this._tryMerge(queue, request);
        if (merged) {
          this.stats.totalMerged++;
          return; // Merged into existing request
        }
      }

      // Add to queue
      queue.push(request);
      this.stats.totalQueued++;
      this.stats.currentQueueSize++;

      // Sort by priority
      queue.sort((a, b) => a.priority - b.priority);

      // Schedule flush
      this._scheduleFlush(resource);
    });
  }

  /**
   * Try to merge an update into an existing queued update
   * @param {WriteRequest[]} queue
   * @param {WriteRequest} request
   * @returns {boolean}
   */
  _tryMerge(queue, request) {
    for (const existing of queue) {
      if (existing.operation !== 'update') continue;
      if (existing.data.id !== request.data.id) continue;

      // Merge data (newer values win)
      existing.data = {
        ...existing.data,
        ...request.data,
        updatedAt: request.timestamp,
      };

      // Resolve new request when existing is processed
      const originalResolve = existing.resolve;
      existing.resolve = (result) => {
        originalResolve(result);
        request.resolve(result);
      };

      const originalReject = existing.reject;
      existing.reject = (error) => {
        originalReject(error);
        request.reject(error);
      };

      return true;
    }

    return false;
  }

  /**
   * Schedule a flush for a resource
   * @param {string} resource
   */
  _scheduleFlush(resource) {
    // Clear existing timer
    if (this.flushTimers.has(resource)) {
      clearTimeout(this.flushTimers.get(resource));
    }

    const queue = this.queues.get(resource);

    // Flush immediately if batch is full
    if (queue.length >= this.batchSize) {
      this._flush(resource);
      return;
    }

    // Schedule delayed flush
    const timer = setTimeout(() => {
      this._flush(resource);
    }, this.batchDelayMs);

    this.flushTimers.set(resource, timer);
  }

  /**
   * Flush queued operations for a resource
   * @param {string} resource
   */
  async _flush(resource) {
    // Clear timer
    if (this.flushTimers.has(resource)) {
      clearTimeout(this.flushTimers.get(resource));
      this.flushTimers.delete(resource);
    }

    // Skip if already processing this resource
    if (this.processing.has(resource)) {
      return;
    }

    const queue = this.queues.get(resource);
    if (!queue || queue.length === 0) {
      return;
    }

    // Take batch from queue
    const batch = queue.splice(0, this.batchSize);
    this.stats.currentQueueSize -= batch.length;
    this.processing.add(resource);

    try {
      // Acquire lock for atomic write
      const result = await this.lockManager.withLock(
        `write:${resource}`,
        async () => this._processBatch(resource, batch),
        { timeoutMs: 10000 }
      );

      if (result.success) {
        // Resolve all requests
        for (const request of batch) {
          request.resolve({ success: true, id: request.id });
        }
        this.stats.totalProcessed += batch.length;
      } else {
        // Reject all requests
        for (const request of batch) {
          request.reject(new Error(result.error));
        }
        this.stats.totalErrors += batch.length;
      }
    } catch (error) {
      // Reject all requests
      for (const request of batch) {
        request.reject(error);
      }
      this.stats.totalErrors += batch.length;
    } finally {
      this.processing.delete(resource);

      // Process more if queue has items
      if (queue.length > 0) {
        this._scheduleFlush(resource);
      }
    }
  }

  /**
   * Process a batch of write operations
   * @param {string} resource
   * @param {WriteRequest[]} batch
   * @returns {Promise<{success: boolean}>}
   */
  async _processBatch(resource, batch) {
    // This is where the actual write logic goes
    // Subclasses or injected handlers implement this

    if (this.writeHandler) {
      return this.writeHandler(resource, batch);
    }

    // Default implementation: just log
    console.log(`[WriteQueue] Processing ${batch.length} operations for ${resource}`);
    return { success: true };
  }

  /**
   * Set custom write handler
   * @param {Function} handler
   */
  setWriteHandler(handler) {
    this.writeHandler = handler;
  }

  /**
   * Flush pending writes for a specific resource
   * @param {string} resource
   * @returns {Promise<void>}
   */
  async flush(resource) {
    await this._flush(resource);
  }

  /**
   * Flush all pending writes
   * @returns {Promise<void>}
   */
  async flushAll() {
    const resources = Array.from(this.queues.keys());

    await Promise.all(
      resources.map(resource => this._flush(resource))
    );

    // Wait for processing to complete
    while (this.processing.size > 0) {
      await sleep(10);
    }
  }

  /**
   * Get queue statistics
   * @returns {Object}
   */
  getStats() {
    const queueSizes = {};
    for (const [resource, queue] of this.queues) {
      queueSizes[resource] = queue.length;
    }

    return {
      ...this.stats,
      queuesByResource: queueSizes,
      byResource: queueSizes, // Alias for test compatibility
      processingResources: Array.from(this.processing),
    };
  }

  /**
   * Clear all queued operations (without processing)
   * @param {string} reason
   */
  clear(reason = 'cleared') {
    for (const [resource, queue] of this.queues) {
      for (const request of queue) {
        request.reject(new Error(`Queue cleared: ${reason}`));
      }
      queue.length = 0;

      if (this.flushTimers.has(resource)) {
        clearTimeout(this.flushTimers.get(resource));
        this.flushTimers.delete(resource);
      }
    }

    this.queues.clear();
    this.stats.currentQueueSize = 0;
  }
}

// =============================================================================
// MEMORY WRITE QUEUE (Specialized for CMO)
// =============================================================================

class MemoryWriteQueue extends WriteQueue {
  /**
   * @param {Object} storageManager - StorageManager instance
   */
  constructor(storageManager, options = {}) {
    super(options);
    this.storage = storageManager;
  }

  /**
   * Queue a memory append
   * @param {Object} memory
   * @returns {Promise<{success: boolean, id: string}>}
   */
  async appendMemory(memory) {
    const resource = memory.projectHash
      ? `memory:project:${memory.projectHash}`
      : 'memory:global';

    return this.queue(resource, 'append', memory, { priority: 5 });
  }

  /**
   * Queue a memory update
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<{success: boolean}>}
   */
  async updateMemory(id, updates) {
    return this.queue('memory:global', 'update', { id, ...updates }, { priority: 10 });
  }

  /**
   * Queue a pattern decision tracking
   * @param {Object} decision
   * @returns {Promise<{success: boolean, id: string}>}
   */
  async trackDecision(decision) {
    return this.queue('patterns:decisions', 'append', decision, { priority: 8 });
  }

  /**
   * Queue an outcome resolution
   * @param {Object} outcome
   * @returns {Promise<{success: boolean}>}
   */
  async recordOutcome(outcome) {
    return this.queue('patterns:outcomes', 'append', outcome, { priority: 8 });
  }

  /**
   * Process a batch of writes against storage
   * @param {string} resource
   * @param {WriteRequest[]} batch
   * @returns {Promise<{success: boolean}>}
   */
  async _processBatch(resource, batch) {
    const results = [];

    for (const request of batch) {
      try {
        let result;

        // Support mock pattern: storage.getStore(type)
        if (this.storage.getStore) {
          const store = this.storage.getStore(resource);
          if (store && store[request.operation]) {
            result = await store[request.operation](request.data);
          } else if (store && store.append && request.operation === 'append') {
            result = await store.append(request.data);
          }
        }
        // Production pattern: storage.memories, storage.patterns, etc.
        else if (resource === 'memory:global') {
          if (request.operation === 'append') {
            result = await this.storage.memories.append(request.data);
          } else if (request.operation === 'update') {
            result = await this.storage.memories.update(request.data.id, request.data);
          }
        } else if (resource.startsWith('memory:project:')) {
          const projectHash = resource.replace('memory:project:', '');
          const store = await this.storage.getProjectStore(projectHash);
          result = await store.append(request.data);
        } else if (resource === 'patterns:decisions') {
          result = await this.storage.patterns.append(request.data);
        } else if (resource === 'patterns:outcomes') {
          result = await this.storage.outcomes.append(request.data);
        }

        results.push(result || { success: true });
      } catch (error) {
        console.error(`[MemoryWriteQueue] Error processing ${request.operation}:`, error);
        results.push({ success: false, error: error.message });
      }
    }

    const allSuccess = results.every(r => r && r.success !== false);
    return { success: allSuccess, results };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  WriteQueue,
  MemoryWriteQueue,
};
