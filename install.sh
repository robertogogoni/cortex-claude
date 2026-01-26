#!/bin/bash
#
# Claude Memory Orchestrator (CMO) - Installation Script
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/robertogogoni/claude-memory-orchestrator/main/install.sh | bash
#   OR
#   ./install.sh
#
# This script:
#   1. Creates necessary directories
#   2. Registers SessionStart and SessionEnd hooks
#   3. Runs tests to verify installation
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CMO_DIR="${CMO_DIR:-$HOME/.claude/memory}"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Claude Memory Orchestrator (CMO) Installer         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo

# =============================================================================
# Step 1: Check Prerequisites
# =============================================================================
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is required but not installed.${NC}"
    echo "Install Node.js 18+ from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ is required. Found: $(node -v)${NC}"
    exit 1
fi

echo -e "  ✓ Node.js $(node -v)"

# Check if CMO directory exists
if [ ! -d "$CMO_DIR" ]; then
    echo -e "${RED}Error: CMO not found at $CMO_DIR${NC}"
    echo "Clone the repository first:"
    echo "  git clone https://github.com/robertogogoni/claude-memory-orchestrator.git $CMO_DIR"
    exit 1
fi

echo -e "  ✓ CMO found at $CMO_DIR"

# =============================================================================
# Step 2: Create Data Directories
# =============================================================================
echo -e "${YELLOW}[2/5] Creating data directories...${NC}"

mkdir -p "$CMO_DIR/data/memories"
mkdir -p "$CMO_DIR/data/patterns"
mkdir -p "$CMO_DIR/data/configs/history"
mkdir -p "$CMO_DIR/logs"
mkdir -p "$CMO_DIR/cache"

echo -e "  ✓ Data directories created"

# =============================================================================
# Step 3: Initialize Default Config (if not exists)
# =============================================================================
echo -e "${YELLOW}[3/5] Initializing configuration...${NC}"

CONFIG_FILE="$CMO_DIR/data/configs/current.json"
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'EOF'
{
  "version": "1.0.0",
  "sessionStart": {
    "slots": {
      "maxTotal": 5,
      "skills": 2,
      "workingMemory": 2,
      "patterns": 1
    },
    "relevanceThreshold": 0.3,
    "contextWeights": {
      "projectMatch": 0.4,
      "intentMatch": 0.25,
      "tagMatch": 0.2,
      "recency": 0.15
    }
  },
  "sessionEnd": {
    "qualityThreshold": 0.4,
    "maxExtractionsPerSession": 10,
    "minContentLength": 50
  },
  "ladsCore": {
    "evolutionEnabled": true,
    "evolutionInterval": 86400000,
    "minSamplesForEvolution": 10,
    "maxHistoryDays": 90
  }
}
EOF
    echo -e "  ✓ Default configuration created"
else
    echo -e "  ✓ Configuration already exists"
fi

# =============================================================================
# Step 4: Register Hooks in Claude Settings
# =============================================================================
echo -e "${YELLOW}[4/5] Registering hooks in Claude settings...${NC}"

# Create settings file if it doesn't exist
if [ ! -f "$SETTINGS_FILE" ]; then
    echo '{}' > "$SETTINGS_FILE"
fi

# Use Node.js to safely merge hook configuration
node << EOF
const fs = require('fs');
const path = require('path');

const settingsFile = '$SETTINGS_FILE';
const cmoDir = '$CMO_DIR';

// Read existing settings
let settings = {};
try {
    const content = fs.readFileSync(settingsFile, 'utf8');
    settings = JSON.parse(content);
} catch (e) {
    // Start fresh if file doesn't exist or is invalid
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
        command: \`node \${cmoDir}/hooks/session-start.cjs\`
    }]
};

const sessionEndHook = {
    hooks: [{
        type: "command",
        command: \`node \${cmoDir}/hooks/session-end.cjs\`
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
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
console.log('  ✓ SessionStart hook registered');
console.log('  ✓ SessionEnd hook registered');
EOF

# =============================================================================
# Step 5: Run Tests
# =============================================================================
echo -e "${YELLOW}[5/5] Running tests...${NC}"

cd "$CMO_DIR"

# Run tests and capture output
if node tests/test-core.cjs > /dev/null 2>&1 && \
   node tests/test-hooks.cjs > /dev/null 2>&1 && \
   node tests/test-lads.cjs > /dev/null 2>&1; then
    echo -e "  ✓ All tests passed (90/90)"
else
    echo -e "${RED}  ✗ Some tests failed${NC}"
    echo "Run tests manually for details:"
    echo "  node $CMO_DIR/tests/test-core.cjs"
    echo "  node $CMO_DIR/tests/test-hooks.cjs"
    echo "  node $CMO_DIR/tests/test-lads.cjs"
fi

# =============================================================================
# Complete!
# =============================================================================
echo
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Installation Complete!                              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "${BLUE}CMO is now active. Start a new Claude Code session to begin!${NC}"
echo
echo "What happens now:"
echo "  • SessionStart: Relevant memories injected at conversation start"
echo "  • SessionEnd: Learnings extracted when session ends"
echo "  • LADS: System improves over time based on outcomes"
echo
echo "Commands:"
echo "  npm test          - Run all tests"
echo "  npm run status    - Check CMO status"
echo
echo -e "${YELLOW}Tip: The system learns over time. The more you use it, the smarter it gets!${NC}"
