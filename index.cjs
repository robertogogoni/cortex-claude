/**
 * Cortex - Claude's Cognitive Layer (Cortex) - Main Entry Point
 *
 * A 100% persistent memory system for Claude Code that achieves
 * true cross-session memory through:
 * - Auto-extraction: Captures learnings from every session
 * - Auto-recall: Injects relevant context at session start
 * - Compounding learnings: LADS principles make the system smarter
 * - Multi-source integration: JSONL, Episodic Memory MCP, Knowledge Graph MCP, CLAUDE.md
 *
 * LADS: Learnable, Adaptive, Documenting, Self-improving
 *
 * @version 1.1.0
 */

'use strict';

// Core exports
const core = require('./core/index.cjs');

// Hook exports
const hooks = require('./hooks/index.cjs');

// Adapter exports (v1.1.0 - Multi-source integration)
const adapters = require('./adapters/index.cjs');

// =============================================================================
// COMBINED EXPORTS
// =============================================================================

module.exports = {
  // ============= CORE =============
  // Main orchestrator
  CMOCore: core.CMOCore,
  getCMO: core.getCMO,

  // Storage
  JSONLStore: core.JSONLStore,
  MemoryIndex: core.MemoryIndex,
  StorageManager: core.StorageManager,

  // Concurrency
  LockManager: core.LockManager,
  getLockManager: core.getLockManager,
  WriteQueue: core.WriteQueue,
  MemoryWriteQueue: core.MemoryWriteQueue,

  // Error handling
  CircuitBreaker: core.CircuitBreaker,
  RetryHandler: core.RetryHandler,
  GracefulDegradationManager: core.GracefulDegradationManager,
  ErrorLogger: core.ErrorLogger,
  ErrorHandler: core.ErrorHandler,
  getErrorHandler: core.getErrorHandler,

  // Config
  ConfigValidator: core.ConfigValidator,
  ConfigManager: core.ConfigManager,
  getConfigManager: core.getConfigManager,
  DEFAULT_CONFIG: core.DEFAULT_CONFIG,

  // LADS
  LADSCore: core.LADSCore,
  getLADSCore: core.getLADSCore,
  PatternTracker: core.PatternTracker,
  OutcomeScorer: core.OutcomeScorer,
  ConfigEvolver: core.ConfigEvolver,
  DocsWriter: core.DocsWriter,
  SIGNAL_TYPES: core.SIGNAL_TYPES,
  EVOLUTION_RULES: core.EVOLUTION_RULES,

  // Vector Search (semantic + BM25 hybrid search)
  Embedder: core.Embedder,
  LRUCache: core.LRUCache,
  EMBEDDING_DIM: core.EMBEDDING_DIM,
  VectorIndex: core.VectorIndex,
  MemoryStore: core.MemoryStore,
  HybridSearch: core.HybridSearch,
  VectorSearchProvider: core.VectorSearchProvider,
  getVectorSearchProvider: core.getVectorSearchProvider,

  // Types and utilities
  generateId: core.generateId,
  getTimestamp: core.getTimestamp,
  expandPath: core.expandPath,
  sleep: core.sleep,
  clamp: core.clamp,
  ERROR_CODES: core.ERROR_CODES,

  // ============= HOOKS =============
  // Hook classes
  SessionStartHook: hooks.SessionStartHook,
  SessionEndHook: hooks.SessionEndHook,
  runHook: hooks.runHook,

  // Context analysis
  ContextAnalyzer: hooks.ContextAnalyzer,
  INTENT_PATTERNS: hooks.INTENT_PATTERNS,
  FILE_DOMAINS: hooks.FILE_DOMAINS,

  // Query orchestration
  QueryOrchestrator: hooks.QueryOrchestrator,

  // Extraction
  ExtractionEngine: hooks.ExtractionEngine,
  EXTRACTION_PATTERNS: hooks.EXTRACTION_PATTERNS,
  QUALITY_SIGNALS: hooks.QUALITY_SIGNALS,

  // ============= ADAPTERS =============
  // v1.1.0 - Multi-source integration
  AdapterRegistry: adapters.AdapterRegistry,
  createDefaultRegistry: adapters.createDefaultRegistry,
  BaseAdapter: adapters.BaseAdapter,
  JSONLAdapter: adapters.JSONLAdapter,
  EpisodicMemoryAdapter: adapters.EpisodicMemoryAdapter,
  KnowledgeGraphAdapter: adapters.KnowledgeGraphAdapter,
  ClaudeMdAdapter: adapters.ClaudeMdAdapter,
  VectorSearchAdapter: adapters.VectorSearchAdapter,

  // ============= NAMESPACES =============
  // For organized access
  core,
  hooks,
  adapters,
};
