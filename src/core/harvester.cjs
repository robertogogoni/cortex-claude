/**
 * Cortex - Claude's Cognitive Layer - Memory Harvester
 * 
 * Orchestrates the extraction of memories from various adapters
 * and persists them into the central MemoryStore.
 * 
 * @version 1.0.0
 */

'use strict';

const { Embedder } = require('./embedder.cjs');

/**
 * Memory Harvester Service
 */
class Harvester {
  /**
   * @param {Object} options
   * @param {import('./memory-store.cjs').MemoryStore} options.store - Central memory store
   * @param {import('./embedder.cjs').Embedder} options.embedder - Shared embedder
   * @param {import('../adapters/base-adapter.cjs').BaseAdapter[]} options.adapters - List of adapters to harvest from
   */
  constructor({ store, embedder, adapters = [] }) {
    this.store = store;
    this.embedder = embedder;
    this.adapters = adapters;
  }

  /**
   * Harvest all enabled adapters
   * @returns {Promise<{totalProcessed: number, inserted: number, updated: number, errors: Array}>}
   */
  async harvestAll() {
    const stats = {
      totalProcessed: 0,
      inserted: 0,
      updated: 0,
      errors: [],
    };

    for (const adapter of this.adapters) {
      if (!adapter.enabled) continue;

      try {
        const available = await adapter.isAvailable();
        if (!available) {
          console.log(`[Harvester] Adapter ${adapter.name} is not available, skipping.`);
          continue;
        }

        console.log(`[Harvester] Harvesting from ${adapter.name}...`);
        const records = await adapter.harvest();
        
        let adapterInserted = 0;
        let adapterUpdated = 0;

        for (const record of records) {
          try {
            // Ensure record has an embedding
            if (!record.embedding && this.embedder) {
              record.embedding = await this.embedder.embed(record.content);
            }

            const result = await this.store.upsert(record);
            
            if (result.action === 'inserted') adapterInserted++;
            else adapterUpdated++;
            
            stats.totalProcessed++;
          } catch (error) {
            stats.errors.push({
              adapter: adapter.name,
              recordId: record.id,
              error: error.message,
            });
          }
        }

        console.log(`[Harvester] ${adapter.name} completed: ${adapterInserted} inserted, ${adapterUpdated} updated.`);
        stats.inserted += adapterInserted;
        stats.updated += adapterUpdated;

      } catch (error) {
        console.error(`[Harvester] Critical error harvesting from ${adapter.name}:`, error.message);
        stats.errors.push({
          adapter: adapter.name,
          error: `Critical: ${error.message}`,
        });
      }
    }

    return stats;
  }
}

module.exports = { Harvester };
