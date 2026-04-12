'use strict';

/**
 * Confidence Decay Module
 *
 * Implements exponential decay with type-specific half-lives,
 * inspired by Memento MCP and FSRS-6. Memories lose confidence
 * over time unless reinforced by access.
 *
 * Formula: decayed = confidence * (0.5 ^ (daysSinceAccess / halfLife))
 * Result is clamped to minimum floor per type.
 */

const DECAY_HALF_LIVES = {
  decision: 90,    // Architectural decisions persist longest
  pattern: 60,     // Patterns evolve but stay relevant
  skill: 45,       // Commands change with versions
  learning: 30,    // General learnings decay faster
  insight: 30,     // Same as learning
  preference: 60,  // User preferences persist
  correction: 45,  // Corrections stay relevant
};

const MINIMUM_CONFIDENCE_FLOORS = {
  decision: 0.3,   // Decisions never fully forgotten
  pattern: 0.2,    // Patterns retain some value
  skill: 0.1,      // Skills may become obsolete
  learning: 0.05,  // General learnings can fade
  insight: 0.05,
  preference: 0.2,
  correction: 0.1,
};

/**
 * Calculate decayed confidence for a memory
 * @param {Object} memory - Memory record with type, extractionConfidence, createdAt, lastUsed
 * @returns {number} Decayed confidence score (0.0 - 1.0)
 */
function calculateDecay(memory) {
  const lastAccess = memory.lastUsed || memory.updatedAt || memory.createdAt;
  if (!lastAccess) return memory.extractionConfidence || 0.5;

  const daysSinceAccess = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceAccess < 0.1) return memory.extractionConfidence || 0.5; // Accessed today

  const halfLife = DECAY_HALF_LIVES[memory.type] || 30;
  const floor = MINIMUM_CONFIDENCE_FLOORS[memory.type] || 0.05;
  const confidence = memory.extractionConfidence || 0.5;

  const decayed = confidence * Math.pow(0.5, daysSinceAccess / halfLife);
  return Math.max(decayed, floor);
}

/**
 * Apply decay to an array of memories (mutates decayScore field)
 * @param {Array} memories - Array of memory records
 * @returns {Array} Same array with updated decayScore fields
 */
function applyDecayBatch(memories) {
  for (const memory of memories) {
    memory.decayScore = calculateDecay(memory);
  }
  return memories;
}

module.exports = {
  calculateDecay,
  applyDecayBatch,
  DECAY_HALF_LIVES,
  MINIMUM_CONFIDENCE_FLOORS,
};
