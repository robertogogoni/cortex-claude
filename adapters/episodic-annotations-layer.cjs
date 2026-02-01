/**
 * Cortex - Claude's Cognitive Layer - Episodic Annotations Layer
 *
 * Enables write operations on episodic memory without corrupting the
 * read-only conversation archives. Annotations are stored separately
 * in JSONL format.
 *
 * Architecture:
 * ```
 * Episodic Memory (Read-Only)     Annotations Layer (Read-Write)
 * ┌─────────────────────────┐     ┌─────────────────────────┐
 * │ conversation-archive/   │     │ ~/.claude/memory/       │
 * │   session-1.jsonl       │────▶│   annotations/          │
 * │   session-2.jsonl       │     │     episodic.jsonl      │
 * └─────────────────────────┘     └─────────────────────────┘
 *          │                                │
 *          └────────────┬───────────────────┘
 *                       │
 *               ┌───────▼───────┐
 *               │ Merged Results│
 *               │ + enrichments │
 *               └───────────────┘
 * ```
 *
 * Annotation Types:
 * - tag: Add searchable tags to conversations
 * - note: Add user notes to specific messages
 * - correction: Mark corrections or clarifications
 * - highlight: Mark important sections
 * - link: Connect related conversations
 *
 * @version 1.0.0
 */

'use strict';

const path = require('path');
const { BaseAdapter } = require('./base-adapter.cjs');
const { JSONLStore } = require('../core/storage.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

const VALID_ANNOTATION_TYPES = ['tag', 'note', 'correction', 'highlight', 'link'];
const VALID_TARGET_TYPES = ['conversation', 'message', 'snippet'];

// =============================================================================
// EPISODIC ANNOTATIONS LAYER
// =============================================================================

/**
 * Layer for managing annotations on episodic memory records
 * Provides write capability on top of read-only conversation archives
 */
class EpisodicAnnotationsLayer extends BaseAdapter {
  /**
   * @param {Object} config - Configuration options
   * @param {string} config.basePath - Base path for storage (default: ~/.claude/memory)
   * @param {number} [config.priority=0.95] - Priority for ranking
   * @param {boolean} [config.enabled=true] - Whether adapter is enabled
   */
  constructor(config = {}) {
    super({
      name: 'episodic-annotations',
      priority: config.priority ?? 0.95,
      timeout: config.timeout ?? 500,
      enabled: config.enabled !== false,
    });

    this.basePath = config.basePath || '~/.claude/memory';
    this.storePath = path.join(this.basePath, 'annotations', 'episodic.jsonl');

    /** @type {JSONLStore|null} */
    this.store = null;
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  /**
   * Initialize the annotations store
   * @returns {Promise<{success: boolean, count?: number}>}
   */
  async initialize() {
    if (this.initialized) {
      return { success: true };
    }

    this.store = new JSONLStore(this.storePath, {
      indexFn: (record) => record.id,
      autoCreate: true,
    });

    const result = await this.store.load();
    this.initialized = result.success;

    return {
      success: result.success,
      count: result.count,
    };
  }

  // ---------------------------------------------------------------------------
  // BASE ADAPTER INTERFACE
  // ---------------------------------------------------------------------------

  /**
   * Check if annotations layer is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return this.initialized;
  }

  /**
   * This adapter supports write operations
   * @returns {boolean}
   */
  supportsWrite() {
    return true;
  }

  /**
   * Query annotations (implements BaseAdapter interface)
   * @param {Object} context - Analysis context
   * @param {Object} [options] - Query options
   * @returns {Promise<Object[]>}
   */
  async query(context, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this._executeQuery(async () => {
      const all = this.store.getAll();
      return all
        .filter(a => a.status === 'active')
        .map(a => this.normalize(a));
    });
  }

  /**
   * Normalize an annotation to MemoryRecord format
   * @param {Object} rawData - Raw annotation data
   * @returns {Object}
   */
  normalize(rawData) {
    return this._createBaseRecord({
      id: rawData.id,
      type: this._mapAnnotationTypeToMemoryType(rawData.annotationType),
      content: rawData.content,
      summary: rawData.content.slice(0, 100),
      tags: [rawData.annotationType, rawData.targetType],
      intent: 'annotation',
      sourceSessionId: rawData.targetId,
      extractionConfidence: 1.0, // User-created = high confidence
      status: rawData.status === 'active' ? 'active' : 'archived',
      createdAt: rawData.createdAt,
      updatedAt: rawData.updatedAt,
      _annotationType: rawData.annotationType,
      _targetId: rawData.targetId,
      _targetType: rawData.targetType,
    });
  }

  // ---------------------------------------------------------------------------
  // CRUD OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Add a new annotation
   * @param {Object} params - Annotation parameters
   * @param {string} params.targetId - ID of the annotated record
   * @param {string} params.targetType - Type: 'conversation' | 'message' | 'snippet'
   * @param {string} params.annotationType - Type: 'tag' | 'note' | 'correction' | 'highlight' | 'link'
   * @param {string} params.content - Annotation content
   * @param {Object} [params.metadata] - Additional metadata
   * @returns {Promise<{success: boolean, id?: string, error?: string}>}
   */
  async addAnnotation({ targetId, targetType, annotationType, content, metadata }) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Validate required fields
    if (!targetId) {
      return { success: false, error: 'targetId is required' };
    }
    if (!targetType) {
      return { success: false, error: 'targetType is required' };
    }
    if (!annotationType) {
      return { success: false, error: 'annotationType is required' };
    }
    if (!content || content.trim() === '') {
      return { success: false, error: 'content is required and cannot be empty' };
    }

    // Validate annotation type
    if (!VALID_ANNOTATION_TYPES.includes(annotationType)) {
      return {
        success: false,
        error: `Invalid annotationType: ${annotationType}. Must be one of: ${VALID_ANNOTATION_TYPES.join(', ')}`,
      };
    }

    // Validate target type
    if (!VALID_TARGET_TYPES.includes(targetType)) {
      return {
        success: false,
        error: `Invalid targetType: ${targetType}. Must be one of: ${VALID_TARGET_TYPES.join(', ')}`,
      };
    }

    return this._executeWrite(async () => {
      const now = new Date().toISOString();
      const annotation = {
        id: this._generateAnnotationId(),
        targetId,
        targetType,
        annotationType,
        content: content.trim(),
        metadata: metadata || {},
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      const result = await this.store.append(annotation);
      return {
        success: result.success,
        id: annotation.id,
        error: result.error,
      };
    });
  }

  /**
   * Get all annotations for a target
   * @param {string} targetId - ID of the target record
   * @returns {Promise<Object[]>}
   */
  async getAnnotations(targetId) {
    if (!this.initialized) {
      await this.initialize();
    }

    const all = this.store.getAll();
    return all.filter(a => a.targetId === targetId && a.status === 'active');
  }

  /**
   * Get all annotations of a specific type
   * @param {string} annotationType - Annotation type to filter by
   * @returns {Promise<Object[]>}
   */
  async getAnnotationsByType(annotationType) {
    if (!this.initialized) {
      await this.initialize();
    }

    const all = this.store.getAll();
    return all.filter(a => a.annotationType === annotationType && a.status === 'active');
  }

  /**
   * Update an existing annotation
   * @param {string} id - Annotation ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateAnnotation(id, updates) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this._executeWrite(async () => {
      const existing = this.store.get(id);
      if (!existing || existing.status === 'deleted') {
        return { success: false, error: 'Annotation not found' };
      }

      const allowedUpdates = {};
      if (updates.content !== undefined) {
        allowedUpdates.content = updates.content;
      }
      if (updates.metadata !== undefined) {
        allowedUpdates.metadata = { ...existing.metadata, ...updates.metadata };
      }

      const result = await this.store.update(id, allowedUpdates);
      return { success: result.success, error: result.error };
    });
  }

  /**
   * Delete an annotation (soft delete)
   * @param {string} id - Annotation ID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteAnnotation(id) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this._executeWrite(async () => {
      const existing = this.store.get(id);
      if (!existing || existing.status === 'deleted') {
        return { success: false, error: 'Annotation not found' };
      }

      const result = await this.store.softDelete(id);
      return { success: result.success, error: result.error };
    });
  }

  // ---------------------------------------------------------------------------
  // SEARCH OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Search annotations by content
   * @param {string} query - Search query
   * @returns {Promise<Object[]>}
   */
  async searchAnnotations(query) {
    if (!this.initialized) {
      await this.initialize();
    }

    const queryLower = query.toLowerCase();
    const all = this.store.getAll();

    return all.filter(a =>
      a.status === 'active' &&
      a.content.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Get all tags with counts (tag cloud data)
   * @returns {Promise<Array<{tag: string, count: number}>>}
   */
  async getAllTags() {
    if (!this.initialized) {
      await this.initialize();
    }

    const tags = await this.getAnnotationsByType('tag');
    const tagCounts = new Map();

    for (const annotation of tags) {
      const tag = annotation.content;
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  // ---------------------------------------------------------------------------
  // ENRICHMENT
  // ---------------------------------------------------------------------------

  /**
   * Enrich memory records with their annotations
   * @param {Object[]} records - Memory records to enrich
   * @returns {Promise<Object[]>}
   */
  async enrichRecords(records) {
    if (!this.initialized) {
      await this.initialize();
    }

    const all = this.store.getAll();
    const annotationsByTarget = new Map();

    // Group annotations by target ID
    for (const annotation of all) {
      if (annotation.status !== 'active') continue;

      const targetId = annotation.targetId;
      if (!annotationsByTarget.has(targetId)) {
        annotationsByTarget.set(targetId, []);
      }
      annotationsByTarget.get(targetId).push(annotation);
    }

    // Enrich each record
    return records.map(record => {
      const annotations = annotationsByTarget.get(record.id) || [];
      const annotatedTags = annotations
        .filter(a => a.annotationType === 'tag')
        .map(a => a.content);

      return {
        ...record,
        _annotations: annotations,
        _annotationCount: annotations.length,
        _annotatedTags: annotatedTags,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // STATS
  // ---------------------------------------------------------------------------

  /**
   * Get statistics about annotations
   * @returns {Promise<{total: number, byType: Object}>}
   */
  async getStats() {
    if (!this.initialized) {
      await this.initialize();
    }

    const all = this.store.getAll();
    const active = all.filter(a => a.status === 'active');

    const byType = {};
    for (const annotation of active) {
      const type = annotation.annotationType;
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      total: active.length,
      byType,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Generate a unique annotation ID
   * @private
   * @returns {string}
   */
  _generateAnnotationId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `ann:${timestamp}:${random}`;
  }

  /**
   * Map annotation type to memory type
   * @private
   * @param {string} annotationType
   * @returns {string}
   */
  _mapAnnotationTypeToMemoryType(annotationType) {
    const mapping = {
      tag: 'preference',
      note: 'learning',
      correction: 'correction',
      highlight: 'learning',
      link: 'pattern',
    };
    return mapping[annotationType] || 'learning';
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  EpisodicAnnotationsLayer,
  VALID_ANNOTATION_TYPES,
  VALID_TARGET_TYPES,
};
