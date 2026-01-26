#!/usr/bin/env node
/**
 * CMO Hook Installer
 * Registers CMO hooks in Claude Code settings
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CMO_DIR = process.env.CMO_DIR || path.join(os.homedir(), '.claude', 'memory');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

console.log('Installing CMO hooks...');

// Read existing settings
let settings = {};
try {
    const content = fs.readFileSync(SETTINGS_FILE, 'utf8');
    settings = JSON.parse(content);
} catch (e) {
    settings = {};
}

// Ensure hooks object exists
if (!settings.hooks) {
    settings.hooks = {};
}

// Define CMO hooks
const sessionStartHook = {
    hooks: [{
        type: "command",
        command: `node ${CMO_DIR}/hooks/session-start.cjs`
    }]
};

const sessionEndHook = {
    hooks: [{
        type: "command",
        command: `node ${CMO_DIR}/hooks/session-end.cjs`
    }]
};

// Add/update SessionStart hooks
if (!settings.hooks.SessionStart) {
    settings.hooks.SessionStart = [];
}
// Remove any existing CMO hooks first
settings.hooks.SessionStart = settings.hooks.SessionStart.filter(h =>
    !h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-start'))
);
settings.hooks.SessionStart.push(sessionStartHook);

// Add/update SessionEnd hooks
if (!settings.hooks.SessionEnd) {
    settings.hooks.SessionEnd = [];
}
// Remove any existing CMO hooks first
settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(h =>
    !h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-end'))
);
settings.hooks.SessionEnd.push(sessionEndHook);

// Write updated settings
fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

console.log('✅ SessionStart hook registered');
console.log('✅ SessionEnd hook registered');
console.log('');
console.log('CMO hooks installed! Restart Claude Code for changes to take effect.');
