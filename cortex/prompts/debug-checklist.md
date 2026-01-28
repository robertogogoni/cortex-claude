# Debug Checklist Prompt

Pre-debugging memory check - recall relevant past solutions before starting.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `error` | Yes | The error or problem you're debugging |
| `context` | No | Additional context about the codebase or situation |

## Template

```
Before debugging, let me check my memory for relevant context.

**Error/Problem:** {{error}}
{{#if context}}
**Additional Context:** {{context}}
{{/if}}

Instructions:
1. Use cortex__query to search for similar errors or problems I've encountered
2. Use cortex__recall with the error context to find relevant past solutions
3. Check patterns using cortex__query for "debugging {{error}}"
4. Summarize:
   - Similar issues I've seen before
   - What worked previously
   - What to try first
   - What to avoid

This pre-debugging check helps avoid reinventing solutions.
```

## Usage

```
/mcp__cortex__debug-checklist error="TypeError: Cannot read property 'map' of undefined"
/mcp__cortex__debug-checklist error="Auth token expired" context="React app with JWT"
```

## Why Use This?

Debugging is often solved with solutions we've already used. This prompt:
- Searches memory for similar errors
- Recalls past successful approaches
- Identifies patterns to avoid
- Saves time by not repeating past mistakes
