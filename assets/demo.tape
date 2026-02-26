# Cortex v3.0 Demo - Claude's Cognitive Memory Layer
# Records installer + status + search as an animated GIF

Output assets/demo.gif
Set Theme "Catppuccin Mocha"
Set FontSize 14
Set Width 1100
Set Height 700
Set Padding 20
Set TypingSpeed 35ms
Set Shell "bash"

# Step 1: Run the installer
Type "cd ~/.claude/memory && bash install.sh"
Enter
Sleep 6s

# Pause to admire
Sleep 2s

# Step 2: Show the status dashboard
Type "node bin/cortex.cjs status"
Enter
Sleep 5s

# Pause to admire
Sleep 2s

# Step 3: Search memory
Type 'node bin/cortex.cjs search "debugging authentication"'
Enter
Sleep 6s

# Final pause
Sleep 3s
