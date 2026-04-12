/**
 * Cortex Neural Network - Brain-like Memory Processing System
 * 
 * Implements:
 * - Neuron-like node processing with activation thresholds
 * - Synaptic weight adjustments based on usage
 * - Dream consolidation (REM-like processing)
 * - Hebbian learning (cells that fire together wire together)
 * - Graph node relations with multi-dimensional correlations
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { expandPath } = require('./types.cjs');
const { calculateDecay } = require('./confidence-decay.cjs');

// =============================================================================
// CONSTANTS
// =============================================================================

const ACTIVATION_THRESHOLD = 0.3;
const DECAY_RATE = 0.01;
const LEARNING_RATE = 0.1;
const DREAM_CONSOLIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONNECTIONS_PER_NODE = 100;
const SYNAPTIC_PRING_THRESHOLD = 0.05;

// =============================================================================
// NEURON NODE
// =============================================================================

class NeuronNode {
  constructor(id, data) {
    this.id = id;
    this.type = data.type || 'memory';
    this.content = data.content || '';
    this.summary = data.summary || '';
    this.tags = data.tags || [];
    this.source = data.source || 'unknown';
    
    // Neural properties
    this.activationLevel = 0.5; // Current activation (0-1)
    this.threshold = ACTIVATION_THRESHOLD; // Fire threshold
    this.lastActivated = Date.now();
    this.activationCount = 0;
    this.decayRate = DECAY_RATE;
    
    // Learning properties
    this.weights = {}; // Connection weights to other neurons
    this.strength = 1.0; // Overall node strength
    this.age = 0; // Time since creation (in days)
    
    // Metadata
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    this.validFrom = data.validFrom || data.createdAt || new Date().toISOString();
    this.validTo = data.validTo || null;
    this.projectHash = data.projectHash || null;
    this.extractionConfidence = data.extractionConfidence || 0.5;
  }

  /**
   * Activate this neuron (fire)
   */
  activate(inputStrength = 1.0) {
    this.activationLevel = Math.min(1.0, this.activationLevel + inputStrength);
    this.lastActivated = Date.now();
    this.activationCount++;
    
    // Strengthen with use (Hebbian learning)
    this.strength = Math.min(2.0, this.strength + LEARNING_RATE);
    
    return this.activationLevel >= this.threshold;
  }

  /**
   * Apply decay to activation level
   */
  decay(deltaTime = 1) {
    // We use the exponential decay logic from confidence-decay
    // using the original extractionConfidence as the base and applying the half-life
    const baseConfidence = this.extractionConfidence || 0.5;
    
    this.activationLevel = calculateDecay({
      type: this.type,
      extractionConfidence: baseConfidence,
      lastUsed: this.lastActivated,
      createdAt: this.createdAt
    });
    
    this.age = (Date.now() - new Date(this.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  }

  /**
   * Connect to another neuron with weighted synapse
   */
  connectTo(targetId, weight = 0.5, relationType = 'associative') {
    if (!this.weights[targetId]) {
      this.weights[targetId] = {
        weight: weight,
        relationType,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      };
    } else {
      // Strengthen existing connection
      this.weights[targetId].weight = Math.min(1.0, this.weights[targetId].weight + LEARNING_RATE);
      this.weights[targetId].usageCount++;
    }

    // Limit connections
    if (Object.keys(this.weights).length > MAX_CONNECTIONS_PER_NODE) {
      this.pruneWeakestConnections();
    }
  }

  /**
   * Remove weak connections (synaptic pruning)
   */
  pruneWeakestConnections() {
    const connections = Object.entries(this.weights);
    connections.sort((a, b) => a[1].weight - b[1].weight);
    
    // Remove weakest 10%
    const toRemove = Math.floor(connections.length * 0.1);
    for (let i = 0; i < toRemove; i++) {
      if (connections[i][1].weight < SYNAPTIC_PRING_THRESHOLD) {
        delete this.weights[connections[i][0]];
      }
    }
  }

  /**
   * Get firing status
   */
  isFiring() {
    return this.activationLevel >= this.threshold;
  }

  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      content: this.content,
      summary: this.summary,
      tags: this.tags,
      source: this.source,
      activationLevel: this.activationLevel,
      threshold: this.threshold,
      lastActivated: this.lastActivated,
      activationCount: this.activationCount,
      strength: this.strength,
      age: this.age,
      weights: this.weights,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      validFrom: this.validFrom,
      validTo: this.validTo,
      projectHash: this.projectHash,
      extractionConfidence: this.extractionConfidence,
    };
  }

  static fromJSON(json) {
    const node = new NeuronNode(json.id, json);
    node.activationLevel = json.activationLevel || 0.5;
    node.threshold = json.threshold || ACTIVATION_THRESHOLD;
    node.lastActivated = json.lastActivated || Date.now();
    node.activationCount = json.activationCount || 0;
    node.strength = json.strength || 1.0;
    node.age = json.age || 0;
    node.weights = json.weights || {};
    return node;
  }
}

// =============================================================================
// NEURAL NETWORK
// =============================================================================

class NeuralNetwork {
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory/neural');
    this.nodes = new Map();
    this.connections = [];
    this.dreamLog = [];
    this.initialized = false;
    
    // Network properties
    this.globalActivation = 0;
    this.lastConsolidation = Date.now();
    this.learningMode = options.learningMode || 'continuous';
  }

  /**
   * Initialize network from storage
   */
  async initialize() {
    const nodeFile = path.join(this.basePath, 'nodes.json');
    const connectionFile = path.join(this.basePath, 'connections.json');

    if (fs.existsSync(nodeFile)) {
      const data = JSON.parse(fs.readFileSync(nodeFile, 'utf8'));
      data.forEach(n => this.nodes.set(n.id, NeuronNode.fromJSON(n)));
    }

    if (fs.existsSync(connectionFile)) {
      this.connections = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    }

    this.initialized = true;
    return { success: true, nodeCount: this.nodes.size };
  }

  /**
   * Save network to storage
   */
  async save() {
    fs.mkdirSync(this.basePath, { recursive: true });

    const nodes = Array.from(this.nodes.values()).map(n => n.toJSON());
    fs.writeFileSync(
      path.join(this.basePath, 'nodes.json'),
      JSON.stringify(nodes, null, 2)
    );

    fs.writeFileSync(
      path.join(this.basePath, 'connections.json'),
      JSON.stringify(this.connections, null, 2)
    );
  }

  /**
   * Add a new memory as neuron
   */
  addNeuron(memory) {
    const id = memory.id || this._generateId(memory);
    const node = new NeuronNode(id, memory);
    
    this.nodes.set(id, node);
    
    // Auto-connect to similar neurons
    this._findSimilarNodes(memory).forEach(similar => {
      node.connectTo(similar.id, 0.5, 'semantic');
      similar.connectTo(id, 0.5, 'semantic');
      
      this.connections.push({
        from: id,
        to: similar.id,
        weight: 0.5,
        type: 'semantic',
        createdAt: new Date().toISOString(),
      });
    });

    return node;
  }

  /**
   * Activate a neuron and propagate activation
   */
  activateNeuron(id, inputStrength = 1.0) {
    const node = this.nodes.get(id);
    if (!node) return null;

    node.activate(inputStrength);
    this.globalActivation = Math.max(this.globalActivation, node.activationLevel);

    // Propagate to connected neurons
    Object.entries(node.weights).forEach(([targetId, connection]) => {
      const target = this.nodes.get(targetId);
      if (target) {
        const propagatedStrength = inputStrength * connection.weight * 0.3;
        target.activate(propagatedStrength);
      }
    });

    return node;
  }

  /**
   * Query by semantic similarity (fires neurons above threshold)
   */
  query(prompt, limit = 20) {
    // Activate neurons matching query
    const matchedNodes = [];
    
    for (const [id, node] of this.nodes.entries()) {
      const similarity = this._computeSimilarity(node, prompt);
      if (similarity > 0.3) {
        node.activate(similarity);
        matchedNodes.push({ node, similarity });
      }
    }

    // Sort by activation and similarity
    matchedNodes.sort((a, b) => {
      const aScore = a.node.activationLevel * a.similarity;
      const bScore = b.node.activationLevel * b.similarity;
      return bScore - aScore;
    });

    return matchedNodes.slice(0, limit).map(({ node, similarity }) => ({
      id: node.id,
      title: node.summary || node.content.slice(0, 50),
      similarity,
      activation: node.activationLevel,
      tags: node.tags,
      source: node.source,
    }));
  }

  /**
   * Dream consolidation - process and reorganize memories
   * Simulates REM sleep consolidation
   */
  async dreamConsolidate() {
    console.log('🌙 Starting dream consolidation...');
    
    const dreamLog = {
      startTime: new Date().toISOString(),
      phases: [],
      syntheses: [],
      prunedConnections: 0,
      strengthenedConnections: 0,
    };

    // Phase 1: Apply decay to all neurons
    dreamLog.phases.push('decay');
    for (const node of this.nodes.values()) {
      node.decay(1);
    }

    // Phase 2: Identify co-activated neurons (cells that fire together)
    dreamLog.phases.push('co-activation-analysis');
    const coActivationGroups = this._findCoActivationGroups();
    
    // Phase 3: Strengthen connections within co-activation groups
    dreamLog.phases.push('connection-strengthening');
    coActivationGroups.forEach(group => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const nodeA = this.nodes.get(group[i]);
          const nodeB = this.nodes.get(group[j]);
          
          if (nodeA && nodeB) {
            nodeA.connectTo(nodeB.id, 0.7, 'co-activated');
            nodeB.connectTo(nodeA.id, 0.7, 'co-activated');
            dreamLog.strengthenedConnections++;
          }
        }
      }
    });

    // Phase 4: Prune weak connections
    dreamLog.phases.push('synaptic-pruning');
    for (const node of this.nodes.values()) {
      const oldCount = Object.keys(node.weights).length;
      node.pruneWeakestConnections();
      const newCount = Object.keys(node.weights).length;
      dreamLog.prunedConnections += oldCount - newCount;
    }

    // Phase 5: Synthesize new patterns from clusters
    dreamLog.phases.push('pattern-synthesis');
    const patterns = this._synthesizePatterns(coActivationGroups);
    dreamLog.syntheses = patterns;

    // Phase 6: Create entity nodes from frequent patterns
    dreamLog.phases.push('entity-extraction');
    const entities = this._extractEntities();
    entities.forEach(entity => {
      this.addNeuron({
        id: `entity:${entity.name}`,
        type: 'entity',
        content: entity.description,
        summary: entity.name,
        tags: entity.relatedTags,
        source: 'dream-extraction',
      });
    });

    dreamLog.endTime = new Date().toISOString();
    dreamLog.nodeCount = this.nodes.size;
    dreamLog.connectionCount = this.connections.length;

    this.dreamLog.push(dreamLog);
    await this.save();

    console.log(`✨ Dream complete: ${dreamLog.strengthenedConnections} strengthened, ${dreamLog.prunedConnections} pruned, ${patterns.length} patterns synthesized`);
    
    return dreamLog;
  }

  /**
   * Get network statistics
   */
  getStats() {
    const firingNodes = Array.from(this.nodes.values()).filter(n => n.isFiring());
    const avgActivation = Array.from(this.nodes.values())
      .reduce((sum, n) => sum + n.activationLevel, 0) / this.nodes.size;
    
    const connectionDensity = this.connections.length / (this.nodes.size || 1);
    
    return {
      nodeCount: this.nodes.size,
      connectionCount: this.connections.length,
      firingNodes: firingNodes.length,
      avgActivation: avgActivation.toFixed(3),
      globalActivation: this.globalActivation.toFixed(3),
      connectionDensity: connectionDensity.toFixed(3),
      dreamCount: this.dreamLog.length,
      lastDream: this.dreamLog.length > 0 
        ? this.dreamLog[this.dreamLog.length - 1].endTime 
        : null,
    };
  }

  /**
   * Find similar neurons based on content/tags
   */
  _findSimilarNodes(memory) {
    const similar = [];
    const targetTags = new Set(memory.tags || []);
    const targetContent = (memory.content || '').toLowerCase();
    
    for (const [id, node] of this.nodes.entries()) {
      if (id === memory.id) continue;
      
      let similarity = 0;
      
      // Tag overlap
      const nodeTags = new Set(node.tags || []);
      const tagOverlap = [...targetTags].filter(t => nodeTags.has(t)).length;
      similarity += tagOverlap / Math.max(targetTags.size, nodeTags.size, 1);
      
      // Content keyword overlap
      const keywords = targetContent.split(/\s+/).filter(w => w.length > 4);
      const nodeContent = (node.content || '').toLowerCase();
      const keywordMatches = keywords.filter(k => nodeContent.includes(k)).length;
      similarity += keywordMatches / keywords.length;
      
      if (similarity > 0.2) {
        similar.push(node);
      }
    }
    
    return similar.sort((a, b) => {
      const aScore = a.tags.filter(t => targetTags.has(t)).length;
      const bScore = b.tags.filter(t => targetTags.has(t)).length;
      return bScore - aScore;
    }).slice(0, 5);
  }

  /**
   * Compute similarity between neuron and query
   */
  _computeSimilarity(node, query) {
    const queryLower = query.toLowerCase();
    const content = (node.content + ' ' + node.summary).toLowerCase();
    
    // Simple keyword matching
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const matches = queryWords.filter(w => content.includes(w)).length;
    
    // Tag boost
    const tagMatches = (node.tags || []).filter(t => queryLower.includes(t)).length;
    
    return (matches / queryWords.length) * 0.7 + (tagMatches * 0.3);
  }

  /**
   * Find groups of co-activated neurons
   */
  _findCoActivationGroups() {
    const groups = [];
    const firingNodes = Array.from(this.nodes.values()).filter(n => n.isFiring());
    
    // Group by shared connections
    const connectionMap = new Map();
    firingNodes.forEach(node => {
      Object.keys(node.weights).forEach(targetId => {
        if (!connectionMap.has(targetId)) {
          connectionMap.set(targetId, []);
        }
        connectionMap.get(targetId).push(node.id);
      });
    });
    
    // Groups are neurons connected to same targets
    connectionMap.forEach((nodes, targetId) => {
      if (nodes.length > 1) {
        groups.push(nodes);
      }
    });
    
    return groups;
  }

  /**
   * Synthesize patterns from co-activation groups
   */
  _synthesizePatterns(groups) {
    const patterns = [];
    
    groups.forEach((group, idx) => {
      if (group.length < 2) return;
      
      const nodes = group.map(id => this.nodes.get(id)).filter(Boolean);
      if (nodes.length < 2) return;
      
      // Extract common themes
      const allTags = nodes.flatMap(n => n.tags || []);
      const tagCounts = {};
      allTags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
      
      const commonTags = Object.entries(tagCounts)
        .filter(([_, count]) => count > 1)
        .map(([tag]) => tag);
      
      if (commonTags.length > 0) {
        patterns.push({
          id: `pattern:${idx}`,
          type: 'co-activation-pattern',
          description: `Pattern of ${nodes.length} co-activated memories around: ${commonTags.join(', ')}`,
          commonTags,
          nodeIds: group,
          strength: nodes.reduce((sum, n) => sum + n.strength, 0) / nodes.length,
          createdAt: new Date().toISOString(),
        });
      }
    });
    
    return patterns;
  }

  /**
   * Extract entity nodes from frequent patterns
   */
  _extractEntities() {
    const entities = [];
    const tagFrequency = {};
    
    // Count tag frequency across all neurons
    for (const node of this.nodes.values()) {
      (node.tags || []).forEach(tag => {
        tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
      });
    }
    
    // Create entities for high-frequency tags
    Object.entries(tagFrequency)
      .filter(([_, count]) => count > 3)
      .forEach(([tag, count]) => {
        const relatedNodes = Array.from(this.nodes.values())
          .filter(n => (n.tags || []).includes(tag))
          .slice(0, 10);
        
        entities.push({
          name: tag,
          type: 'concept',
          description: `Concept appearing in ${count} memories`,
          relatedTags: relatedNodes.flatMap(n => n.tags || []).slice(0, 10),
          frequency: count,
        });
      });
    
    return entities;
  }

  _generateId(memory) {
    const hash = crypto
      .createHash('sha256')
      .update(memory.content + memory.source + Date.now())
      .digest('hex')
      .slice(0, 16);
    return `neuron:${hash}`;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  NeuronNode,
  NeuralNetwork,
  ACTIVATION_THRESHOLD,
  DECAY_RATE,
  LEARNING_RATE,
  DREAM_CONSOLIDATION_INTERVAL,
};