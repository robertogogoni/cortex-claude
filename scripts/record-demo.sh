#!/bin/bash
# Record Cortex demo GIF from Alacritty
# Usage: Run this script in an Alacritty terminal
#   ./scripts/record-demo.sh
#
# Prerequisites: wf-recorder, ffmpeg, slurp (all in Arch repos)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_MP4="/tmp/cortex-demo.mp4"
OUTPUT_GIF="$SCRIPT_DIR/assets/demo.gif"

echo "=== Cortex Demo Recorder ==="
echo "This will record your current terminal window."
echo ""

# Get the focused window geometry via hyprctl
WINDOW_INFO=$(hyprctl activewindow -j 2>/dev/null)
if [ -z "$WINDOW_INFO" ]; then
    echo "Error: Could not get window info. Are you running Hyprland?"
    echo "Falling back to slurp (click and drag to select region)..."
    GEOMETRY=$(slurp)
else
    X=$(echo "$WINDOW_INFO" | jq -r '.at[0]')
    Y=$(echo "$WINDOW_INFO" | jq -r '.at[1]')
    W=$(echo "$WINDOW_INFO" | jq -r '.size[0]')
    H=$(echo "$WINDOW_INFO" | jq -r '.size[1]')
    GEOMETRY="${X},${Y} ${W}x${H}"
    echo "Recording window: ${W}x${H} at (${X},${Y})"
fi

echo ""
echo "Starting recording in 2 seconds..."
echo "Commands will run automatically. Recording stops when done."
sleep 2

# Clear terminal
clear

# Start wf-recorder in background
wf-recorder -g "$GEOMETRY" -f "$OUTPUT_MP4" --codec libx264 --codec-param crf=18 &
RECORDER_PID=$!
sleep 0.5

# Run the demo commands
cd "$SCRIPT_DIR"

# Command 1: Session start hook (visual output on stderr)
echo -e "\033[1m\$ node hooks/session-start.cjs 1>/dev/null\033[0m"
node hooks/session-start.cjs 1>/dev/null
sleep 1.5

# Command 2: Status dashboard
echo ""
echo -e "\033[1m\$ node bin/cortex.cjs status\033[0m"
node bin/cortex.cjs status
sleep 2

# Stop recording
kill $RECORDER_PID 2>/dev/null
wait $RECORDER_PID 2>/dev/null || true
sleep 0.5

echo ""
echo "Converting to GIF..."

# Convert MP4 to high-quality GIF using ffmpeg 2-pass
# Pass 1: Generate palette
ffmpeg -y -i "$OUTPUT_MP4" \
    -vf "fps=15,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff" \
    /tmp/cortex-palette.png 2>/dev/null

# Pass 2: Use palette to create GIF
ffmpeg -y -i "$OUTPUT_MP4" -i /tmp/cortex-palette.png \
    -lavfi "fps=15,scale=900:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3" \
    "$OUTPUT_GIF" 2>/dev/null

# Cleanup
rm -f "$OUTPUT_MP4" /tmp/cortex-palette.png

echo ""
echo "Demo GIF saved to: $OUTPUT_GIF"
ls -lh "$OUTPUT_GIF"
echo ""
echo "To commit: git add assets/demo.gif && git commit -m 'update: demo GIF with real Alacritty recording'"
