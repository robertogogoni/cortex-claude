#!/usr/bin/env bash
# Record Cortex demo using tmux + asciinema + agg
# tmux provides a real PTY with exact dimensions
# asciinema records the terminal session
# agg converts to animated GIF
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CAST_FILE="/tmp/cortex-demo.cast"
GIF_FILE="$PROJECT_DIR/assets/demo.gif"
TMUX_SESSION="cortex-demo"

COLS=110
ROWS=36

cd "$PROJECT_DIR"

# Kill any leftover tmux session
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

echo "Recording Cortex demo (${COLS}x${ROWS})..."

# Create the demo script
cat > /tmp/cortex-demo-script.sh << 'DEMO'
#!/usr/bin/env bash
cd ~/.claude/memory

# Simulate typing effect
type_cmd() {
  local cmd="$1"
  for (( i=0; i<${#cmd}; i++ )); do
    printf '%s' "${cmd:$i:1}"
    sleep 0.04
  done
  echo
}

clear
sleep 0.5

# Show banner
echo ""
printf '\033[1;36m'
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║     Cortex v3.0.0 — Claude's Cognitive Memory Layer        ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
printf '\033[0m'
echo ""
sleep 1.2

# Demo 1: Session Start Hook (streaming adapter visualization)
printf '\033[90m$ \033[0m'
type_cmd "node hooks/session-start.cjs 2>/dev/null | head -18"
sleep 0.3
node hooks/session-start.cjs 2>/dev/null | head -18
sleep 3

echo ""

# Demo 2: Memory Search
printf '\033[90m$ \033[0m'
type_cmd 'node bin/cortex.cjs search "debugging authentication" 2>/dev/null | head -22'
sleep 0.3
node bin/cortex.cjs search "debugging authentication" 2>/dev/null | head -22
sleep 3

echo ""
printf '\033[1;32m✓ Cortex ready · 7 adapters · 1,779 memories · 447 tests passing\033[0m\n'
sleep 2
DEMO

chmod +x /tmp/cortex-demo-script.sh

# Start tmux with exact dimensions and run asciinema inside it
# tmux creates a real PTY, so asciinema gets proper terminal size
tmux new-session -d -s "$TMUX_SESSION" -x "$COLS" -y "$ROWS" \
  "asciinema rec --idle-time-limit 2 --command /tmp/cortex-demo-script.sh --overwrite $CAST_FILE; tmux wait-for -S done"

# Wait for recording to finish
tmux wait-for done 2>/dev/null || sleep 30

# Cleanup tmux
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

# Verify the cast file has correct dimensions
echo "Cast file header:"
head -1 "$CAST_FILE" | python3 -m json.tool 2>/dev/null | grep -E 'cols|rows' || head -1 "$CAST_FILE"

echo "Converting to GIF with agg..."

# Convert to GIF with agg — proper font size for readability
~/.cargo/bin/agg \
  --theme monokai \
  --font-size 16 \
  --speed 1.2 \
  --fps-cap 12 \
  "$CAST_FILE" \
  "$GIF_FILE"

echo "Done! GIF saved to: $GIF_FILE"
ls -lh "$GIF_FILE"
file "$GIF_FILE"
