# Pattern Analysis Prompt

Analyze recurring patterns across your memories and sessions.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `domain` | No | Domain to focus on (e.g., "testing", "auth", "performance") |
| `depth` | No | Analysis depth: quick, moderate, or deep |

## Template

```
Analyze recurring patterns in my Cortex memories.

{{#if domain}}
**Domain Focus:** {{domain}}
{{/if}}
**Analysis Depth:** {{depth | default: "moderate"}}

Instructions:
1. Use cortex__query to gather memories {{#if domain}}related to "{{domain}}"{{else}}across all domains{{/if}}
2. Use cortex__reflect with depth "{{depth | default: 'moderate'}}" to analyze:
   - What approaches keep working
   - What approaches keep failing
   - Common root causes of issues
   - Opportunities for improvement
3. Use cortex__infer to find non-obvious connections
4. Provide actionable insights

Pattern analysis helps compound learnings over time.
```

## Usage

```
/mcp__cortex__pattern-analysis
/mcp__cortex__pattern-analysis domain="testing"
/mcp__cortex__pattern-analysis domain="authentication" depth="deep"
```

## When to Use

- Weekly or monthly for general pattern review
- Before starting a new project (domain-specific analysis)
- After a series of similar bugs
- When feeling stuck - patterns may reveal root causes
