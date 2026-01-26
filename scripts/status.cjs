#!/usr/bin/env node
/**
 * CMO Status Script
 * Shows the current status of Claude Memory Orchestrator
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CMO_DIR = process.env.CMO_DIR || path.join(os.homedir(), '.claude', 'memory');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║     Claude Memory Orchestrator - Status                 ║');
console.log('╚════════════════════════════════════════════════════════╝');
console.log();

// Check installation
console.log('📁 Installation:');
console.log(`   Location: ${CMO_DIR}`);
console.log(`   Exists: ${fs.existsSync(CMO_DIR) ? '✅ Yes' : '❌ No'}`);
console.log();

// Check hooks
console.log('🪝 Hooks:');
try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const sessionStart = settings.hooks?.SessionStart?.some(h =>
        h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-start'))
    );
    const sessionEnd = settings.hooks?.SessionEnd?.some(h =>
        h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-end'))
    );

    console.log(`   SessionStart: ${sessionStart ? '✅ Registered' : '❌ Not registered'}`);
    console.log(`   SessionEnd: ${sessionEnd ? '✅ Registered' : '❌ Not registered'}`);
} catch (e) {
    console.log('   ❌ Could not read settings.json');
}
console.log();

// Check data directories
console.log('💾 Data Directories:');
const dataDirs = [
    'data/memories',
    'data/patterns',
    'data/configs',
    'logs',
    'cache'
];
for (const dir of dataDirs) {
    const fullPath = path.join(CMO_DIR, dir);
    const exists = fs.existsSync(fullPath);
    console.log(`   ${dir}: ${exists ? '✅' : '❌'}`);
}
console.log();

// Check memory files
console.log('📊 Memory Stats:');
try {
    const memoriesDir = path.join(CMO_DIR, 'data', 'memories');
    if (fs.existsSync(memoriesDir)) {
        const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
            const content = fs.readFileSync(path.join(memoriesDir, file), 'utf8');
            const lines = content.trim().split('\n').filter(l => l).length;
            console.log(`   ${file}: ${lines} memories`);
        }
        if (files.length === 0) {
            console.log('   No memories yet (start using Claude Code!)');
        }
    } else {
        console.log('   Memories directory not created yet');
    }
} catch (e) {
    console.log(`   Error reading memories: ${e.message}`);
}
console.log();

// Check config
console.log('⚙️  Configuration:');
try {
    const configPath = path.join(CMO_DIR, 'data', 'configs', 'current.json');
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log(`   Version: ${config.version || 'unknown'}`);
        console.log(`   Max slots: ${config.sessionStart?.slots?.maxTotal || 'N/A'}`);
        console.log(`   Quality threshold: ${config.sessionEnd?.qualityThreshold || 'N/A'}`);
        console.log(`   LADS evolution: ${config.ladsCore?.evolutionEnabled ? 'enabled' : 'disabled'}`);
    } else {
        console.log('   ❌ No configuration found');
    }
} catch (e) {
    console.log(`   Error: ${e.message}`);
}
console.log();

// Overall status
const allGood = fs.existsSync(CMO_DIR);
console.log(allGood
    ? '✅ CMO is installed and ready!'
    : '❌ CMO needs to be installed. Run: ./install.sh'
);
