# Session Summary Prompt

Generate a summary of the current session for future reference.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `accomplishments` | No | What was accomplished this session |

## Template

```
Please summarize this session for future reference.

{{#if accomplishments}}
**Accomplishments:** {{accomplishments}}
{{/if}}

Instructions:
1. Summarize the key tasks completed
2. Identify any insights worth preserving with cortex__learn
3. Note any unfinished work or TODOs
4. Capture any decisions made and their rationale
5. Extract patterns that might be useful later

This summary helps maintain continuity across sessions.
```

## Usage

```
/mcp__cortex__session-summary
/mcp__cortex__session-summary accomplishments="Implemented auth flow and wrote tests"
```

## Best Practices

Run this prompt at the end of productive sessions to:
- Capture what was accomplished
- Extract learnings into Cortex memory
- Document decisions for future reference
- Note unfinished work for next session
