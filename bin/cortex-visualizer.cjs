#!/usr/bin/env node
/**
 * Cortex Neural Visualizer - Mermaid Generator
 * 
 * Generates a Mermaid.js graph representation of the neural network
 * that renders natively in Obsidian, GitHub, and supported terminals.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath } = require('../core/types.cjs');

const NEURAL_PATH = expandPath('~/.claude/memory/neural');
const VAULT_PATH = expandPath('~/.obsidian-vault/Cortex Atlas');
const OUTPUT_PATH = path.join(VAULT_PATH, 'Neural Topology.md');

function sanitizeNodeName(name) {
  // Mermaid node names can't have certain special characters
  return String(name)
    .replace(/["\[\]{}()<>]/g, '')
    .replace(/;/g, ',')
    .slice(0, 40);
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, '_');
}

async function generateMermaid() {
  console.log('🧠 Generating Native Mermaid Topology...');

  const nodesPath = path.join(NEURAL_PATH, 'nodes.json');
  const linksPath = path.join(NEURAL_PATH, 'connections.json');

  if (!fs.existsSync(nodesPath) || !fs.existsSync(linksPath)) {
    console.error('❌ Neural network not found. Run cortex-neural-cli.cjs first.');
    process.exit(1);
  }

  const nodesData = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
  const linksData = JSON.parse(fs.readFileSync(linksPath, 'utf8'));

  // Get top firing nodes to keep the graph readable
  const topNodes = nodesData
    .sort((a, b) => (b.activationLevel || 0) - (a.activationLevel || 0))
    .slice(0, 50);
    
  const topNodeIds = new Set(topNodes.map(n => n.id));

  // Filter links to only show connections between top nodes
  const relevantLinks = linksData.filter(l => 
    topNodeIds.has(l.from) && topNodeIds.has(l.to)
  );

  let mermaid = '```mermaid\ngraph TD\n\n';
  mermaid += '  %% Styling Classes\n';
  mermaid += '  classDef entity fill:#f43f5e,stroke:#9f1239,stroke-width:2px,color:#fff,rx:5px,ry:5px;\n';
  mermaid += '  classDef preference fill:#8b5cf6,stroke:#5b21b6,stroke-width:2px,color:#fff;\n';
  mermaid += '  classDef memory fill:#0ea5e9,stroke:#0369a1,stroke-width:2px,color:#fff;\n\n';

  mermaid += '  %% Nodes\n';
  topNodes.forEach(n => {
    const id = sanitizeId(n.id);
    const label = sanitizeNodeName(n.summary || n.id);
    
    // Different shapes based on type
    if (n.type === 'entity') {
      mermaid += `  ${id}(["${label}"]):::entity\n`;
    } else if (n.type === 'preference') {
      mermaid += `  ${id}{"${label}"}:::preference\n`;
    } else {
      mermaid += `  ${id}["${label}"]:::memory\n`;
    }
  });

  mermaid += '\n  %% Synaptic Connections\n';
  relevantLinks.forEach(l => {
    const from = sanitizeId(l.from);
    const to = sanitizeId(l.to);
    const type = l.type || 'linked';
    
    // Line style based on connection type
    if (type === 'co-activated') {
      mermaid += `  ${from} ==>|dream| ${to}\n`;
    } else if (type === 'semantic') {
      mermaid += `  ${from} -.->|semantic| ${to}\n`;
    } else {
      mermaid += `  ${from} --> ${to}\n`;
    }
  });

  mermaid += '```\n';

  const markdown = [
    '---',
    'title: Neural Network Topology',
    'kind: visualization',
    '---',
    '',
    '# 🧠 Neural Network Topology',
    '',
    '> **Auto-generated Mermaid Graph** showing the top 50 most active neurons and their synaptic connections.',
    '',
    '## Legend',
    '- 🔴 **Rounded**: Extracted Entities (Concepts)',
    '- 🟣 **Diamond**: Learned Preferences',
    '- 🔵 **Rectangle**: Standard Memories',
    '- **Thick Arrows** (`==>`): Co-activated during Dream Consolidation',
    '- **Dotted Arrows** (`-.->`): Semantic similarities',
    '',
    mermaid
  ].join('\n');

  // Ensure Vault exists before writing
  if (fs.existsSync(VAULT_PATH)) {
    fs.writeFileSync(OUTPUT_PATH, markdown);
    console.log(`✅ Native Obsidian Graph generated at: ${OUTPUT_PATH}`);
    console.log(`👁️  Open Obsidian and view the "Neural Topology" file to see the interactive diagram.`);
  } else {
    // Fallback if vault isn't available
    const fallbackPath = expandPath('~/.claude/memory/neural-topology.md');
    fs.writeFileSync(fallbackPath, markdown);
    console.log(`✅ Mermaid Markdown generated at: ${fallbackPath}`);
  }
}

generateMermaid().catch(err => {
  console.error('Failed to generate visualizer:', err);
  process.exit(1);
});