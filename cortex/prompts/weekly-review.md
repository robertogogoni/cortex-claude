# Weekly Review Prompt

Summarizes the week's learnings and identifies patterns across all sessions.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `focus` | No | Optional focus area (e.g., "debugging", "architecture") |

## Template

```
Please provide a weekly review of my Cortex memories.

{{#if focus}}
Focus area: {{focus}}
{{/if}}

Instructions:
1. Use cortex__query to search for memories from the past 7 days
2. Use cortex__reflect with depth "deep" to analyze patterns
3. Identify:
   - Key learnings and insights
   - Recurring challenges or themes
   - Successful approaches worth repeating
   - Areas needing improvement
4. Provide actionable recommendations for next week

Format your response with clear sections and bullet points.
```

## Usage

```
/mcp__cortex__weekly-review
/mcp__cortex__weekly-review focus="debugging"
```
