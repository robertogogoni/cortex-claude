#!/bin/bash
# Test terminal color support for Cortex neural visuals

echo ""
echo -e "\x1b[1m=== Cortex Color Test ===\x1b[0m"
echo ""

# Neural nodes theme
echo -e "\x1b[36m●\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m\x1b[90m──\x1b[0m\x1b[33m●\x1b[0m  Neural Nodes (cyan/yellow)"

# Synaptic branches theme
echo -e "\x1b[35m╭──┬──╮\x1b[0m  Synaptic Branches (magenta)"
echo -e "\x1b[35m   ╰──╯\x1b[0m"

# Brain waves theme
echo -e "\x1b[34m∿∿∿\x1b[0m \x1b[97mCORTEX\x1b[0m \x1b[34m∿∿∿\x1b[0m  Brain Waves (blue/white)"

# Minimal neural theme
echo -e "\x1b[90m· · ·\x1b[0m \x1b[36m─\x1b[0m \x1b[90m· · ·\x1b[0m  Minimal Neural (gray/cyan)"

echo ""
echo -e "\x1b[1mPulsing animation preview:\x1b[0m"

# Simulate pulse animation
for i in 1 2 3 4 5; do
  case $i in
    1) echo -e "  \x1b[33m●\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m  \x1b[90msynapses firing...\x1b[0m" ;;
    2) echo -e "  \x1b[36m○\x1b[0m\x1b[90m──\x1b[0m\x1b[33m●\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m  \x1b[90mretrieving patterns...\x1b[0m" ;;
    3) echo -e "  \x1b[36m○\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m\x1b[90m──\x1b[0m\x1b[33m●\x1b[0m  \x1b[90mconnecting memories...\x1b[0m" ;;
    4) echo -e "  \x1b[36m○\x1b[0m\x1b[90m──\x1b[0m\x1b[33m●\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m  \x1b[90mforming associations...\x1b[0m" ;;
    5) echo -e "  \x1b[33m●\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m\x1b[90m──\x1b[0m\x1b[36m○\x1b[0m  \x1b[90mneural pathways active...\x1b[0m" ;;
  esac
done

echo ""
echo -e "\x1b[32m✓ If you see colors above, your terminal supports ANSI colors!\x1b[0m"
echo ""
