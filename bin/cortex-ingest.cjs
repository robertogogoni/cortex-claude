#!/usr/bin/env node
/**
 * Cortex Ingestion CLI - Import external data into the Neural Network
 * 
 * Supports: Beeper JSON, WhatsApp TXT, Markdown, SimpleNote exports.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath } = require('../core/types.cjs');
const { IngestionPipeline } = require('../core/ingestion-pipeline.cjs');

// Colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgBlue: '\x1b[44m',
};

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
${colors.bgBlue}${colors.bold} CORTEX UNIVERSAL INGESTION CLI ${colors.reset}

Import unstructured data (chats, notes, docs) into the Neural Network.

${colors.bold}USAGE:${colors.reset}
  node cortex-ingest.cjs <file_path> [source_type]

${colors.bold}ARGUMENTS:${colors.reset}
  file_path     Path to the file to ingest (e.g., ~/Downloads/whatsapp.txt)
  source_type   (Optional) Force parser: 'whatsapp', 'beeper', 'markdown', 'generic-text'

${colors.bold}EXAMPLES:${colors.reset}
  node cortex-ingest.cjs ~/exports/_chat.txt whatsapp
  node cortex-ingest.cjs ~/notes/project-ideas.md markdown
    `);
    process.exit(0);
  }

  const filePath = args[0];
  const sourceType = args[1] || 'auto';

  console.log(`${colors.cyan}🧠 Cortex Ingestion Engine${colors.reset}\n`);
  console.log(`File: ${filePath}`);
  console.log(`Mode: ${sourceType}\n`);

  try {
    const pipeline = new IngestionPipeline();
    await pipeline.initialize();

    console.log(`${colors.yellow}⏳ Processing file and extracting memories...${colors.reset}`);
    const result = await pipeline.ingestFile(filePath, sourceType);

    console.log(`\n${colors.green}✓ Ingestion Complete!${colors.reset}`);
    console.log(`  Format Detected: ${colors.bold}${result.sourceType}${colors.reset}`);
    console.log(`  Messages Parsed: ${result.messagesParsed}`);
    console.log(`  Memories Extracted: ${result.memoriesExtracted}`);
    console.log(`  Neurons Created: ${result.neuronsCreated}\n`);

    if (result.neuronsCreated > 0) {
      console.log(`${colors.yellow}⏳ Running Dream Consolidation to wire new neurons...${colors.reset}`);
      const dream = await pipeline.consolidateIngestion();
      
      console.log(`\n${colors.green}✓ Neural Wiring Complete!${colors.reset}`);
      console.log(`  New Patterns Synthesized: ${dream.syntheses.length}`);
      console.log(`  Synapses Strengthened: ${dream.strengthenedConnections}`);
      console.log(`\nRun ${colors.bold}cortex-visualizer.cjs${colors.reset} or ${colors.bold}cortex-obsidian-cli.cjs${colors.reset} to see the new connections.`);
    }

  } catch (error) {
    console.error(`\n${colors.red}✗ Error:${colors.reset} ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
