#!/usr/bin/env node
/**
 * CMO Command Line Interface
 *
 * Usage:
 *   cmo status     - Show CMO status
 *   cmo install    - Install hooks
 *   cmo uninstall  - Uninstall hooks
 *   cmo test       - Run tests
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0];

const CMO_DIR = path.dirname(__dirname);

const commands = {
    status: () => {
        require('./status.cjs');
    },

    install: () => {
        require('./install-hooks.cjs');
    },

    uninstall: () => {
        require('./uninstall-hooks.cjs');
    },

    test: () => {
        console.log('Running CMO tests...\n');
        try {
            execSync(`node ${path.join(CMO_DIR, 'tests', 'test-core.cjs')}`, { stdio: 'inherit' });
            execSync(`node ${path.join(CMO_DIR, 'tests', 'test-hooks.cjs')}`, { stdio: 'inherit' });
            execSync(`node ${path.join(CMO_DIR, 'tests', 'test-lads.cjs')}`, { stdio: 'inherit' });
        } catch (e) {
            process.exit(1);
        }
    },

    help: () => {
        console.log(`
Claude Memory Orchestrator (CMO) CLI

Usage:
  cmo <command>

Commands:
  status      Show CMO installation and configuration status
  install     Register CMO hooks in Claude Code settings
  uninstall   Remove CMO hooks from Claude Code settings
  test        Run all tests
  help        Show this help message

Examples:
  cmo status          # Check if CMO is properly installed
  cmo install         # Register hooks
  cmo test            # Run test suite
`);
    }
};

if (!command || !commands[command]) {
    commands.help();
    process.exit(command ? 1 : 0);
} else {
    commands[command]();
}
