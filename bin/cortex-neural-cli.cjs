#!/usr/bin/env node
/**
 * Cortex Neural CLI - Interactive Brain-like Memory Processing
 * 
 * Guided workflow:
 * 1. Import memories from all sources
 * 2. Convert to neuron nodes
 * 3. Build synaptic connections
 * 4. Visualize neural network
 * 5. Run dream consolidation
 * 6. Export to Obsidian with graph relations
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const { NeuralNetwork, NeuronNode } = require('../src/core/neural-network.cjs');
const { ObsidianVaultExporter } = require('../src/core/obsidian-vault.cjs');
const { createDefaultRegistry } = require('../src/adapters/index.cjs');
const { expandPath } = require('../src/core/types.cjs');

const CORTEX_HOME = expandPath('~/.claude/memory');
const NEURAL_PATH = expandPath('~/.claude/memory/neural');
const OBSIDIAN_VAULT = expandPath('~/.obsidian-vault');

// Colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

// =============================================================================
// MAIN CLI
// =============================================================================

async function main() {
  printHeader(' CORTEX NEURAL INTEGRATION CLI ');
  console.log();
  console.log(`${colors.cyan}Building brain-like neural network from your memories...${colors.reset}`);
  console.log();

  const network = new NeuralNetwork({ basePath: NEURAL_PATH });
  await network.initialize();

  // Step 1: Import
  console.log(`${colors.bold}Step 1: Import Memories${colors.reset}`);
  const records = await importMemories();
  console.log(`${colors.green}✓ Imported ${records.length} memories${colors.reset}`);
  console.log();

  // Step 2: Convert to Neurons
  console.log(`${colors.bold}Step 2: Convert to Neurons${colors.reset}`);
  const neurons = convertToNeurons(records, network);
  console.log(`${colors.green}✓ Created ${neurons.length} neuron nodes${colors.reset}`);
  console.log();

  // Step 3: Build Connections
  console.log(`${colors.bold}Step 3: Build Synaptic Connections${colors.reset}`);
  const connections = buildConnections(network);
  console.log(`${colors.green}✓ Established ${connections.length} synaptic connections${colors.reset}`);
  console.log();

  // Step 4: Visualize
  console.log(`${colors.bold}Step 4: Neural Network Visualization${colors.reset}`);
  visualizeNetwork(network);
  console.log();

  // Step 5: Dream Consolidation
  console.log(`${colors.bold}Step 5: Dream Consolidation${colors.reset}`);
  const dreamResult = await network.dreamConsolidate();
  console.log(`${colors.green}✓ Dream complete: ${dreamResult.syntheses.length} patterns synthesized${colors.reset}`);
  console.log();

  // Step 6: Export to Obsidian
  console.log(`${colors.bold}Step 6: Export to Obsidian with Graph Relations${colors.reset}`);
  await exportToObsidian(network);
  console.log();

  // Final Stats
  printHeader(' NEURAL NETWORK COMPLETE ');
  const stats = network.getStats();
  console.log(`${colors.cyan}Nodes: ${stats.nodeCount}${colors.reset}`);
  console.log(`${colors.cyan}Connections: ${stats.connectionCount}${colors.reset}`);
  console.log(`${colors.cyan}Firing Nodes: ${stats.firingNodes}${colors.reset}`);
  console.log(`${colors.cyan}Dreams: ${stats.dreamCount}${colors.reset}`);
  console.log();

  await network.save();
}

// =============================================================================
// STEP 1: IMPORT
// =============================================================================

async function importMemories() {
  printSection('Collecting memories from all adapters...');
  
  const registry = createDefaultRegistry({ basePath: CORTEX_HOME });
  const context = { tags: [], intent: 'general', projectHash: null };
  const result = await registry.queryAll(context, { limit: 5000 });
  
  return result.results;
}

// =============================================================================
// STEP 2: CONVERT TO NEURONS
// =============================================================================

function convertToNeurons(records, network) {
  printSection('Converting memories to neuron nodes...');
  
  const neurons = [];
  records.forEach((record, idx) => {
    const neuron = network.addNeuron(record);
    neurons.push(neuron);
    
    if (idx % 100 === 0 && idx > 0) {
      console.log(`  ${colors.cyan}Processed ${idx}/${records.length} memories${colors.reset}`);
    }
  });
  
  return neurons;
}

// =============================================================================
// STEP 3: BUILD CONNECTIONS
// =============================================================================

function buildConnections(network) {
  printSection('Building synaptic connections...');
  
  const connections = [];
  const nodes = Array.from(network.nodes.values());
  
  // Build connections based on:
  // 1. Tag overlap
  // 2. Content similarity
  // 3. Temporal proximity
  // 4. Source correlation
  
  for (let i = 0; i < nodes.length; i++) {
    const nodeA = nodes[i];
    
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeB = nodes[j];
      
      let weight = 0;
      let relationType = 'weak';
      
      // Tag overlap
      const sharedTags = nodeA.tags.filter(t => nodeB.tags.includes(t));
      if (sharedTags.length > 0) {
        weight += sharedTags.length * 0.2;
        relationType = 'semantic';
      }
      
      // Content similarity
      const contentA = nodeA.content.toLowerCase();
      const contentB = nodeB.content.toLowerCase();
      const sharedKeywords = contentA.split(/\s+/).filter(w => 
        w.length > 4 && contentB.includes(w)
      ).length;
      
      if (sharedKeywords > 3) {
        weight += Math.min(sharedKeywords * 0.05, 0.5);
        relationType = 'content';
      }
      
      // Temporal proximity (within 7 days)
      const dateA = new Date(nodeA.createdAt).getTime();
      const dateB = new Date(nodeB.createdAt).getTime();
      const daysDiff = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);
      
      if (daysDiff < 7) {
        weight += 0.1;
        relationType = 'temporal';
      }
      
      // Source correlation
      if (nodeA.source === nodeB.source) {
        weight += 0.1;
      }
      
      // Create connection if weight exceeds threshold
      if (weight > 0.2) {
        nodeA.connectTo(nodeB.id, weight, relationType);
        nodeB.connectTo(nodeA.id, weight, relationType);
        
        connections.push({
          from: nodeA.id,
          to: nodeB.id,
          weight: weight.toFixed(3),
          type: relationType,
        });
      }
    }
    
    if (i % 50 === 0 && i > 0) {
      console.log(`  ${colors.cyan}Processed ${i}/${nodes.length} nodes${colors.reset}`);
    }
  }
  
  return connections;
}

// =============================================================================
// STEP 4: VISUALIZE
// =============================================================================

function visualizeNetwork(network) {
  printSection('Neural Network Topology:');
  
  const stats = network.getStats();
  
  // Network summary
  console.log();
  console.log(`  ${colors.bold}Total Nodes:${colors.reset} ${stats.nodeCount}`);
  console.log(`  ${colors.bold}Total Connections:${colors.reset} ${stats.connectionCount}`);
  console.log(`  ${colors.bold}Firing (Active):${colors.reset} ${stats.firingNodes}`);
  console.log(`  ${colors.bold}Avg Activation:${colors.reset} ${stats.avgActivation}`);
  console.log(`  ${colors.bold}Connection Density:${colors.reset} ${stats.connectionDensity}`);
  console.log();
  
  // Top firing neurons
  console.log(`${colors.bold}Top Active Neurons:${colors.reset}`);
  const firingNodes = Array.from(network.nodes.values())
    .filter(n => n.isFiring())
    .sort((a, b) => b.activationLevel - a.activationLevel)
    .slice(0, 10);
  
  firingNodes.forEach((node, idx) => {
    const activationBar = '█'.repeat(Math.round(node.activationLevel * 10));
    console.log(`  ${idx + 1}. ${colors.magenta}${node.summary?.slice(0, 40)}${colors.reset}`);
    console.log(`     ${colors.cyan}${activationBar}${colors.reset} (${node.activationLevel.toFixed(2)})`);
    console.log(`     Tags: ${node.tags.slice(0, 5).join(', ')}`);
    console.log();
  });
  
  // Connection types distribution
  console.log(`${colors.bold}Connection Types:${colors.reset}`);
  const typeCounts = {};
  for (const node of network.nodes.values()) {
    Object.values(node.weights).forEach(conn => {
      typeCounts[conn.relationType] = (typeCounts[conn.relationType] || 0) + 1;
    });
  }
  
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${colors.cyan}${type}:${colors.reset} ${count}`);
  });
  console.log();
  
  // Entity clusters
  console.log(`${colors.bold}Entity Clusters (from dream extraction):${colors.reset}`);
  const entityNodes = Array.from(network.nodes.values()).filter(n => n.type === 'entity');
  entityNodes.slice(0, 5).forEach((node, idx) => {
    console.log(`  ${idx + 1}. ${colors.yellow}${node.summary}${colors.reset} (${node.activationCount} activations)`);
  });
}

// =============================================================================
// STEP 5: EXPORT TO OBSIDIAN
// =============================================================================

async function exportToObsidian(network) {
  printSection('Exporting neural network to Obsidian vault...');
  
  // Convert neurons to records for export
  const records = Array.from(network.nodes.values()).map(node => ({
    id: node.id,
    type: node.type,
    content: node.content,
    summary: node.summary,
    tags: node.tags,
    source: node.source,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    extractionConfidence: node.extractionConfidence,
    _source: 'neural-network',
    _noteTitle: node.summary || node.id,
    projectHash: node.projectHash,
    // Neural-specific fields
    activationLevel: node.activationLevel,
    strength: node.strength,
    connections: Object.keys(node.weights).length,
  }));
  
  const exporter = new ObsidianVaultExporter({
    vaultPath: OBSIDIAN_VAULT,
    clean: true,
    rootFolder: 'Cortex Neural Atlas',
  });
  
  const result = exporter.export(records);
  
  console.log(`${colors.green}✓ Vault created: ${result.exportRoot}${colors.reset}`);
  console.log(`${colors.green}✓ Exported ${result.manifest.counts.records} records${colors.reset}`);
  
  // Create neural-specific index
  createNeuralIndex(result.exportRoot, network);
}

function createNeuralIndex(exportRoot, network) {
  const neuralIndex = path.join(exportRoot, 'Neural Index.md');
  
  const stats = network.getStats();
  const firingNodes = Array.from(network.nodes.values()).filter(n => n.isFiring());
  
  let content = `# 🧠 Neural Network Index\n\n`;
  content += '**Generated**: ' + new Date().toISOString() + '\n';
  content += `\n## Statistics\n\n`;
  content += `- Total Nodes: ${stats.nodeCount}\n`;
  content += `- Connections: ${stats.connectionCount}\n`;
  content += `- Active (Firing): ${stats.firingNodes}\n`;
  content += `- Avg Activation: ${stats.avgActivation}\n`;
  content += `- Dreams: ${stats.dreamCount}\n`;
  content += `\n## Active Neurons (Firing)\n\n`;
  
  firingNodes.slice(0, 20).forEach((node, idx) => {
    const safeName = node.summary?.replace(/[^a-z0-9]/gi, '-').slice(0, 50) || node.id;
    content += `${idx + 1}. [[${safeName}|${node.summary?.slice(0, 50) || node.id}]]`;
    content += ` (Activation: ${node.activationLevel.toFixed(2)})\n`;
    content += `   Tags: ${node.tags.join(', ')}\n\n`;
  });
  
  content += `\n## Connection Types\n\n`;
  const typeCounts = {};
  for (const node of network.nodes.values()) {
    Object.values(node.weights).forEach(conn => {
      typeCounts[conn.relationType] = (typeCounts[conn.relationType] || 0) + 1;
    });
  }
  
  Object.entries(typeCounts).forEach(([type, count]) => {
    content += `- ${type}: ${count}\n`;
  });
  
  fs.writeFileSync(neuralIndex, content);
  console.log(`${colors.green}✓ Neural index created${colors.reset}`);
}

// =============================================================================
// UTILITIES
// =============================================================================

function printHeader(text) {
  console.log(`${colors.bgBlue}${colors.bold}${text.padEnd(60)}${colors.reset}`);
}

function printSection(text) {
  console.log(`${colors.cyan}${colors.bold}${text}${colors.reset}`);
}

// =============================================================================
// RUN
// =============================================================================

if (require.main === module) {
  main().catch(err => {
    console.error(`${colors.red}Error:${colors.reset}`, err.message);
    process.exit(1);
  });
}

module.exports = { main };