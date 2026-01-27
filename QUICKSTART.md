# Cortex Quick Start

> 🧠 Get Cortex running in 2 minutes

## 1. Install

```bash
git clone https://github.com/robertogogoni/cortex-claude.git ~/.claude/memory
cd ~/.claude/memory && npm install
```

## 2. Register MCP Server

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/home/YOUR_USER/.claude/memory/cortex/server.cjs"],
      "env": {}
    }
  }
}
```

## 3. Register Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/memory/hooks/session-start.cjs" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/memory/hooks/session-end.cjs" }] }]
  }
}
```

## 4. Install Skill (Optional)

```bash
mkdir -p ~/.claude/skills
ln -s ~/.claude/memory/skills/cortex ~/.claude/skills/cortex
```

## 5. Restart Claude Code

Done! Test with:

```
/cortex status
```

---

## Quick Reference

| Command | Description | Cost |
|---------|-------------|------|
| `/cortex` | Status overview | Free |
| `/cortex query "X"` | Search memories | ~$0.001 |
| `/cortex learn "X"` | Store insight | ~$0.01 |
| `/cortex reflect "X"` | Deep analysis | ~$0.01 |
| `/cortex stats` | Usage & costs | Free |

## Natural Language

Just ask naturally:
- "What did I do last time?"
- "Remember: always validate JWT first"
- "What patterns am I seeing in my debugging?"

---

📖 **Full docs:** [README.md](README.md)
