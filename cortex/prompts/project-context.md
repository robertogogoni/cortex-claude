# Project Context Prompt

Load all relevant context for the current project.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `projectPath` | No | Path to the project (defaults to current directory) |

## Template

```
Load all relevant Cortex context for this project.

{{#if projectPath}}
**Project Path:** {{projectPath}}
{{else}}
**Project:** Current directory
{{/if}}

Instructions:
1. Use cortex__recall with the project context to find project-specific memories
2. Use cortex__query to search for related patterns and decisions
3. Summarize:
   - Key decisions made for this project
   - Patterns that apply to this codebase
   - Past issues and their solutions
   - Important context for continuing work

This provides a comprehensive project briefing.
```

## Usage

```
/mcp__cortex__project-context
/mcp__cortex__project-context projectPath="/home/user/myproject"
```

## When to Use

- When returning to a project after time away
- When joining an existing project with Cortex history
- Before making significant architectural decisions
- When onboarding to a project's context
