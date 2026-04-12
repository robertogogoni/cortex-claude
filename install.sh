#!/bin/bash
#
# Cortex - Claude's Cognitive Layer - Installation Script
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/robertogogoni/cortex-claude/master/install.sh | bash
#   OR
#   ./install.sh
#
# Options:
#   CORTEX_DIR=/custom/path ./install.sh   # Install to a custom location
#
# This script:
#   1. Clones or updates the repository
#   2. Installs npm dependencies
#   3. Creates data directories
#   4. Registers MCP server and all 4 hooks in Claude settings
#   5. Runs tests to verify installation
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

CORTEX_DIR="${CORTEX_DIR:-$HOME/.local/share/mcp-servers/cortex-claude}"
SETTINGS_FILE="$HOME/.claude/settings.json"
CLAUDE_JSON="$HOME/.claude.json"

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Cortex - Claude's Cognitive Layer           ║${NC}"
echo -e "${BLUE}║       v3.0.1 Installer                            ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo

# =============================================================================
# Step 1: Prerequisites
# =============================================================================
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is required but not installed.${NC}"
    echo "Install Node.js 18+ from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ required. Found: $(node -v)${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is required but not installed.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} git $(git --version | cut -d' ' -f3)"

if ! command -v claude &> /dev/null; then
    echo -e "${YELLOW}  ! Claude Code CLI not found (optional, hooks will activate on next session)${NC}"
fi

# =============================================================================
# Step 2: Clone or Update
# =============================================================================
echo -e "${YELLOW}[2/6] Installing Cortex to ${BLUE}$CORTEX_DIR${NC}..."

if [ -d "$CORTEX_DIR/.git" ]; then
    echo -e "  ${DIM}Existing install found, pulling latest...${NC}"
    cd "$CORTEX_DIR"
    git pull --rebase origin master 2>/dev/null || git pull origin master
    echo -e "  ${GREEN}✓${NC} Updated to $(git describe --tags --always 2>/dev/null || echo 'latest')"
else
    mkdir -p "$(dirname "$CORTEX_DIR")"
    git clone https://github.com/robertogogoni/cortex-claude.git "$CORTEX_DIR"
    cd "$CORTEX_DIR"
    echo -e "  ${GREEN}✓${NC} Cloned $(git describe --tags --always 2>/dev/null || echo 'latest')"
fi

# =============================================================================
# Step 3: Install Dependencies
# =============================================================================
echo -e "${YELLOW}[3/6] Installing dependencies...${NC}"

npm install --production 2>&1 | tail -1
echo -e "  ${GREEN}✓${NC} Dependencies installed"

# =============================================================================
# Step 4: Create Data Directories
# =============================================================================
echo -e "${YELLOW}[4/6] Creating data directories...${NC}"

mkdir -p "$CORTEX_DIR/data/memories"
mkdir -p "$CORTEX_DIR/data/patterns"
mkdir -p "$CORTEX_DIR/data/projects"
mkdir -p "$CORTEX_DIR/data/skills"
mkdir -p "$CORTEX_DIR/data/vector"
mkdir -p "$CORTEX_DIR/data/configs/history"
mkdir -p "$CORTEX_DIR/data/backups"

# Initialize memory JSONL files
for f in working short-term long-term insights learnings; do
    touch "$CORTEX_DIR/data/memories/${f}.jsonl"
done
for f in decisions outcomes; do
    touch "$CORTEX_DIR/data/patterns/${f}.jsonl"
done

echo -e "  ${GREEN}✓${NC} Data directories ready"

# =============================================================================
# Step 5: Register MCP Server + Hooks
# =============================================================================
echo -e "${YELLOW}[5/6] Registering MCP server and hooks...${NC}"

# Register MCP server in .claude.json
node << REGISTER_MCP
const fs = require('fs');
const cj = '$CLAUDE_JSON';
const dir = '$CORTEX_DIR';

let config = {};
try { config = JSON.parse(fs.readFileSync(cj, 'utf8')); } catch {}
if (!config.mcpServers) config.mcpServers = {};

config.mcpServers.cortex = {
  type: 'stdio',
  command: 'node',
  args: [dir + '/cortex/server.cjs'],
  env: {}
};

fs.writeFileSync(cj, JSON.stringify(config, null, 2));
console.log('  ✓ MCP server registered in .claude.json');
REGISTER_MCP

# Register all 4 hooks in settings.json
node << REGISTER_HOOKS
const fs = require('fs');
const sf = '$SETTINGS_FILE';
const dir = '$CORTEX_DIR';

let settings = {};
try { settings = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}
if (!settings.hooks) settings.hooks = {};

const cortexMarker = 'cortex-claude';

function addHook(event, command, matcher) {
  if (!settings.hooks[event]) settings.hooks[event] = [];
  // Remove existing cortex hooks
  settings.hooks[event] = settings.hooks[event].filter(h =>
    !h.hooks?.some(hh => hh.command?.includes(cortexMarker))
  );
  const entry = { hooks: [{ type: 'command', command }] };
  if (matcher) entry.matcher = matcher;
  settings.hooks[event].push(entry);
}

addHook('SessionStart', 'node ' + dir + '/hooks/session-start.cjs');
addHook('SessionEnd',   'node ' + dir + '/hooks/session-end.cjs');
addHook('PreCompact',   'node ' + dir + '/hooks/pre-compact.cjs', '*');
addHook('Stop',         'node ' + dir + '/hooks/stop-hook.cjs', '*');

fs.writeFileSync(sf, JSON.stringify(settings, null, 2));
console.log('  ✓ SessionStart hook registered');
console.log('  ✓ SessionEnd hook registered');
console.log('  ✓ PreCompact hook registered');
console.log('  ✓ Stop hook registered (insight capture)');
REGISTER_HOOKS

# =============================================================================
# Step 6: Verify
# =============================================================================
echo -e "${YELLOW}[6/6] Verifying installation...${NC}"

cd "$CORTEX_DIR"

PASS=0
FAIL=0
for test in test-core test-hooks test-lads test-write-gate test-stop-hook; do
    if node "tests/${test}.cjs" > /dev/null 2>&1; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
    fi
done

if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} All $PASS test suites passed"
else
    echo -e "  ${YELLOW}!${NC} ${PASS} passed, ${FAIL} failed (run 'npm test' for details)"
fi

# =============================================================================
# Done
# =============================================================================
echo
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Cortex installed successfully!              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo
echo -e "  Install path:  ${BLUE}$CORTEX_DIR${NC}"
echo -e "  MCP server:    ${BLUE}cortex${NC} (registered in .claude.json)"
echo -e "  Hooks:         ${BLUE}4 active${NC} (SessionStart, SessionEnd, PreCompact, Stop)"
echo
echo -e "  ${YELLOW}Restart Claude Code to activate.${NC}"
echo
echo -e "  ${DIM}Optional: Set API key for full features (HyDE search, Sonnet reasoning):${NC}"
echo -e "  ${DIM}echo \"ANTHROPIC_API_KEY=sk-ant-api03-YOUR_KEY\" >> ~/.claude/.env${NC}"
echo
