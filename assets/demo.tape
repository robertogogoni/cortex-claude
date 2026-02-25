# Cortex v3.0 Demo - Claude's Cognitive Layer
# Records CortexRenderer output as an animated GIF

Output assets/demo.gif
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1000
Set Height 600
Set Padding 20
Set TypingSpeed 40ms
Set Shell "bash"

# Show the real session-start hook
Type "cd ~/.claude/memory && node hooks/session-start.cjs 1>/dev/null"
Enter
Sleep 8s

# Show status dashboard
Type "node bin/cortex.cjs status"
Enter
Sleep 5s
