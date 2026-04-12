#!/usr/bin/env node
/**
 * Cortex Backup & Restore CLI
 *
 * Safely archives the memory dataset to prevent catastrophic data loss.
 * Packages `~/.claude/memory/data/` and `~/.claude/memory/neural/`
 * into a single compressed .tar.gz archive.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { expandPath } = require('../core/types.cjs');

const CORTEX_HOME = expandPath('~/.claude/memory');
const DATA_DIR = path.join(CORTEX_HOME, 'data');
const NEURAL_DIR = path.join(CORTEX_HOME, 'neural');
const DEFAULT_ARCHIVE_DIR = expandPath('~/cortex-backups');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bgBlue: '\x1b[44m',
};

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  console.log(`\n${colors.bgBlue}${colors.bold} CORTEX BACKUP UTILITY ${colors.reset}\n`);

  if (command === 'backup') {
    await performBackup();
  } else if (command === 'restore') {
    const archivePath = args[1];
    if (!archivePath) {
      console.log(`${colors.red}✗ Missing archive path. Usage: cortex-backup.cjs restore <path_to_archive>${colors.reset}`);
      process.exit(1);
    }
    await performRestore(archivePath);
  } else {
    console.log(`${colors.bold}USAGE:${colors.reset}`);
    console.log(`  node cortex-backup.cjs backup    - Create a new backup snapshot`);
    console.log(`  node cortex-backup.cjs restore   - Restore from an existing snapshot\n`);
  }
}

async function performBackup() {
  if (!fs.existsSync(DEFAULT_ARCHIVE_DIR)) {
    fs.mkdirSync(DEFAULT_ARCHIVE_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `cortex-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(DEFAULT_ARCHIVE_DIR, archiveName);

  console.log(`${colors.cyan}⏳ Packing data into archive...${colors.reset}`);
  
  // Use tar to compress the directories
  const pathsToBackup = [];
  if (fs.existsSync(DATA_DIR)) pathsToBackup.push('data');
  if (fs.existsSync(NEURAL_DIR)) pathsToBackup.push('neural');

  if (pathsToBackup.length === 0) {
    console.log(`${colors.yellow}⚠ No data found to backup. Have you started using Cortex?${colors.reset}`);
    process.exit(0);
  }

  const tarArgs = ['-czf', archivePath, '-C', CORTEX_HOME, ...pathsToBackup];

  return new Promise((resolve, reject) => {
    const tarProc = spawn('tar', tarArgs);
    
    tarProc.on('close', (code) => {
      if (code === 0) {
        const stats = fs.statSync(archivePath);
        const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`${colors.green}✓ Backup complete!${colors.reset}`);
        console.log(`  Archive: ${colors.bold}${archivePath}${colors.reset}`);
        console.log(`  Size: ${sizeMb} MB\n`);
        resolve();
      } else {
        console.log(`${colors.red}✗ Backup failed with exit code ${code}${colors.reset}`);
        reject(new Error('tar process failed'));
      }
    });
  });
}

async function performRestore(archivePath) {
  const fullPath = expandPath(archivePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`${colors.red}✗ Archive not found: ${fullPath}${colors.reset}`);
    process.exit(1);
  }

  console.log(`${colors.yellow}⚠ WARNING: This will overwrite your current memory data!${colors.reset}`);
  console.log(`${colors.cyan}⏳ Extracting archive...${colors.reset}`);

  const tarArgs = ['-xzf', fullPath, '-C', CORTEX_HOME];

  return new Promise((resolve, reject) => {
    const tarProc = spawn('tar', tarArgs);
    
    tarProc.on('close', (code) => {
      if (code === 0) {
        console.log(`${colors.green}✓ Restore complete! Cortex memory state reverted to snapshot.${colors.reset}\n`);
        resolve();
      } else {
        console.log(`${colors.red}✗ Restore failed with exit code ${code}${colors.reset}`);
        reject(new Error('tar process failed'));
      }
    });
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error(`${colors.red}Fatal Error:${colors.reset}`, err);
    process.exit(1);
  });
}