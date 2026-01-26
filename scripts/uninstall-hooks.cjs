#!/usr/bin/env node
/**
 * Cortex Hook Uninstaller
 * Removes Cortex hooks from Claude Code settings
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

console.log('Uninstalling Cortex hooks...');

// Read existing settings
let settings = {};
try {
    const content = fs.readFileSync(SETTINGS_FILE, 'utf8');
    settings = JSON.parse(content);
} catch (e) {
    console.log('No settings file found. Nothing to uninstall.');
    process.exit(0);
}

if (!settings.hooks) {
    console.log('No hooks configured. Nothing to uninstall.');
    process.exit(0);
}

// Remove Cortex SessionStart hooks
if (settings.hooks.SessionStart) {
    const before = settings.hooks.SessionStart.length;
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(h =>
        !h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-start'))
    );
    const removed = before - settings.hooks.SessionStart.length;
    if (removed > 0) {
        console.log(`✅ Removed ${removed} SessionStart hook(s)`);
    }
    // Clean up empty array
    if (settings.hooks.SessionStart.length === 0) {
        delete settings.hooks.SessionStart;
    }
}

// Remove Cortex SessionEnd hooks
if (settings.hooks.SessionEnd) {
    const before = settings.hooks.SessionEnd.length;
    settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(h =>
        !h.hooks?.some(hh => hh.command?.includes('memory/hooks/session-end'))
    );
    const removed = before - settings.hooks.SessionEnd.length;
    if (removed > 0) {
        console.log(`✅ Removed ${removed} SessionEnd hook(s)`);
    }
    // Clean up empty array
    if (settings.hooks.SessionEnd.length === 0) {
        delete settings.hooks.SessionEnd;
    }
}

// Clean up empty hooks object
if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
}

// Write updated settings
fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

console.log('');
console.log('Cortex hooks uninstalled. Restart Claude Code for changes to take effect.');
