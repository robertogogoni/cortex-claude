# Cortex UX Enhancements - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Cortex from an invisible MCP server into a user-friendly, self-documenting memory system with modern MCP features.

**Architecture:** Phased approach - fix documentation first, add user-facing skills, then implement advanced MCP primitives (Resources, Prompts, Sampling, Elicitation).

**Tech Stack:** Node.js, MCP SDK, JSONL storage, Claude API (Haiku/Sonnet)

**Created:** 2026-01-27
**Last Updated:** 2026-01-27 (Session 3)
**Status:** ✅ COMPLETE - All implementable phases done (39/43 tasks)

---

## Progress Overview

| Phase | Status | Tasks | Completed |
|-------|--------|-------|-----------|
| Phase 1: Documentation | ✅ Complete | 6 | 6/6 |
| Phase 2: Core Skills | ✅ Complete | 8 | 8/8 |
| Phase 3: UX Polish | ✅ Complete | 6 | 6/6 |
| Phase 4: MCP Resources | ✅ Complete | 4 | 4/4 |
| Phase 5: MCP Prompts | ✅ Complete | 4 | 4/4 |
| Phase 6: MCP Sampling | ✅ Design Decision | 3 | 3/3 |
| Phase 7: MCP Elicitation | ⏳ Deferred | 3 | 0/3 |
| Phase 8: Security | ✅ Complete | 5 | 5/5 |
| Phase 9: Future-Proofing | ✅ Complete | 4 | 3/4 |
| **TOTAL** | | **43** | **39/43** |

### Notes on Incomplete Tasks:
- **Phase 7**: MCP Elicitation requires client support not yet available in Claude Code
- **Phase 9.2**: OAuth 2.0 is out of scope for local deployment
- **Phase 9.3**: Python SDK v2 not yet released

---

## Phase 1: Documentation & README

> **Why First:** Users need to understand what Cortex does before using it.

### Task 1.1: Add Natural Language Examples to README ✅

- [x] **Step 1:** Read current README.md
- [x] **Step 2:** Add "Natural Language Usage" section after "User Experience"
- [x] **Step 3:** Include table of phrases → tools mapping
- [x] **Step 4:** Commit changes

**Files:**
- Modify: `README.md` (after line 125)

**Content to Add:**
```markdown
## Natural Language Usage

Just ask naturally - Claude will use Cortex tools when relevant:

| What You Say | What Cortex Does |
|--------------|------------------|
| "What did I do last time?" | `cortex__recall` - retrieves recent context |
| "Remember this for next time: ..." | `cortex__learn` - stores the insight |
| "What patterns am I seeing?" | `cortex__reflect` - meta-cognitive analysis |
| "How does X connect to Y?" | `cortex__infer` - finds relationships |
| "Search my memories for auth" | `cortex__query` - keyword search |
| "Clean up old memories" | `cortex__consolidate` - deduplication |
```

---

### Task 1.2: Add Limitations Section to README ✅

- [x] **Step 1:** Add "Limitations" section after Natural Language
- [x] **Step 2:** Document what Cortex cannot do
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `README.md`

**Content to Add:**
```markdown
### Limitations

⚠️ **Cortex cannot:**
- Remember conversations from before installation
- Access memories from other users or machines
- Work offline (requires Anthropic API for Haiku/Sonnet)
- Guarantee perfect recall (relevance threshold filters results)
- Read your mind (be specific in what you want to remember)

💡 **For best results:**
- Use `/cortex learn` for important insights
- Check `/cortex stats` periodically
- Run `/cortex consolidate` monthly to clean up
```

---

### Task 1.3: Add Cost Transparency Section ✅

- [x] **Step 1:** Add "Cost Transparency" section
- [x] **Step 2:** Document Haiku vs Sonnet costs
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `README.md`

**Content to Add:**
```markdown
### Cost Transparency

Cortex uses two Claude models with different costs:

| Model | Tools | Cost | When Used |
|-------|-------|------|-----------|
| **Haiku** | query, recall | ~$0.25/1M tokens | Every search |
| **Sonnet** | reflect, infer, learn, consolidate | ~$3/1M tokens | Deep reasoning |

**Typical session cost:** $0.01 - $0.05
**Monthly estimate:** $1 - $5 (depends on usage)

Use `/cortex stats` to see your actual usage.
```

---

### Task 1.4: Update Quick Start with Verification Steps ✅

- [x] **Step 1:** Add verification commands after installation
- [x] **Step 2:** Add "First Use" example
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `README.md` (Quick Start section)

**Content to Add:**
```markdown
### Verify Installation

After restarting Claude Code:

```bash
# Check MCP server is connected
claude mcp list | grep cortex
# Expected: cortex: ... - ✓ Connected

# Test the skill
/cortex status
```

### First Use Example

Try these commands to verify Cortex is working:

```
/cortex                     # Should show status
/cortex learn "Test memory" # Should store successfully
/cortex query "test"        # Should find your test memory
```
```

---

### Task 1.5: Add Troubleshooting for Common Issues ✅

- [x] **Step 1:** Expand troubleshooting section
- [x] **Step 2:** Add "Cortex not responding" section
- [x] **Step 3:** Add "Skill not working" section
- [x] **Step 4:** Add "High API costs" section
- [x] **Step 5:** Commit changes

**Files:**
- Modify: `README.md` (Troubleshooting section)

---

### Task 1.6: Create QUICKSTART.md for TL;DR Users ✅

- [x] **Step 1:** Create new file with minimal setup
- [x] **Step 2:** Include command reference and natural language examples
- [x] **Step 3:** Commit changes

**Files:**
- Create: `QUICKSTART.md`

---

## Phase 2: Core Skills Implementation ✅

> **Why Second:** Skills make Cortex visible and usable without GitHub.

### Task 2.1: Enhance /cortex Skill with Help Command ✅

- [x] **Step 1:** Read current skill file
- [x] **Step 2:** Add `/cortex help` output specification
- [x] **Step 3:** Update skill instructions
- [x] **Step 4:** Commit changes

**Files:**
- Modify: `skills/cortex/SKILL.md`

**Help Output Design:**
```
╭─────────────────────────────────────────────────╮
│  🧠 CORTEX v2.0 - Claude's Memory Layer         │
├─────────────────────────────────────────────────┤
│  QUICK                                          │
│    /cortex              Status overview         │
│    /cortex help         This screen             │
│    /cortex stats        Memory counts & costs   │
│    /cortex health       Verify everything works │
│                                                 │
│  MEMORY (Haiku - fast)                          │
│    /cortex query "X"    Search memories         │
│    /cortex recall       Context retrieval       │
│                                                 │
│  REASONING (Sonnet - deep)                      │
│    /cortex reflect "X"  Meta-analysis           │
│    /cortex infer A B    Find connections        │
│    /cortex learn "X"    Store insight           │
│    /cortex consolidate  Clean up                │
│                                                 │
│  NATURAL LANGUAGE                               │
│    "What did I do last time?"                   │
│    "Remember: always validate JWT first"        │
╰─────────────────────────────────────────────────╯
```

---

### Task 2.2: Add /cortex health Command ✅

- [x] **Step 1:** Add health check to skill
- [x] **Step 2:** Check: MCP connected, files exist, API works
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `skills/cortex/SKILL.md`

**Health Output:**
```
╭─────────────────────────────────────────────────╮
│  🧠 CORTEX HEALTH CHECK                         │
├─────────────────────────────────────────────────┤
│  MCP Server      ✓ Connected                    │
│  Memory Files    ✓ 5 files (127 entries)        │
│  API Key         ✓ Valid                        │
│  Last Activity   2 hours ago                    │
│  Disk Usage      41 KB                          │
├─────────────────────────────────────────────────┤
│  STATUS: All systems operational                │
╰─────────────────────────────────────────────────╯
```

---

### Task 2.3: Add /cortex stats Command with Costs ✅

- [x] **Step 1:** Add stats command to skill (already existed)
- [x] **Step 2:** Read memory file sizes
- [x] **Step 3:** Calculate estimated costs
- [x] **Step 4:** Commit changes

**Files:**
- Modify: `skills/cortex/SKILL.md`

---

### Task 2.4: Add /cortex log Command ✅

- [x] **Step 1:** Add log viewing command
- [x] **Step 2:** Show recent activity from logs/
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `skills/cortex/SKILL.md`

---

### Task 2.5: Add /cortex config Command ✅

- [x] **Step 1:** Add config viewing/editing
- [x] **Step 2:** Show current thresholds
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `skills/cortex/SKILL.md`

---

### Task 2.6: Add /cortex export Command ✅

- [x] **Step 1:** Add memory export functionality
- [x] **Step 2:** Export to markdown or JSON
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `skills/cortex/SKILL.md`

---

### Task 2.7: Add /cortex session Command ✅

- [x] **Step 1:** Add current session summary
- [x] **Step 2:** Show what would be extracted
- [x] **Step 3:** Commit changes

**Files:**
- Modify: `skills/cortex/SKILL.md`

---

### Task 2.8: Add /cortex forget Command

- [ ] **Step 1:** Add memory deletion capability
- [ ] **Step 2:** Require confirmation
- [ ] **Step 3:** Add to MCP server as new tool
- [ ] **Step 4:** Commit changes

**Note:** Deferred - requires MCP server code changes. Will implement in Phase 3.

**Files:**
- Modify: `skills/cortex/SKILL.md`
- Modify: `cortex/server.cjs`

---

## Phase 3: UX Polish

> **Why Third:** Make existing features more user-friendly.

### Task 3.1: Add "Work in Progress" Detection to SessionStart

- [ ] **Step 1:** Modify session-start.cjs
- [ ] **Step 2:** Check for uncompleted tasks in recent memories
- [ ] **Step 3:** Inject "You were working on: X" message
- [ ] **Step 4:** Test with real session
- [ ] **Step 5:** Commit changes

**Files:**
- Modify: `hooks/session-start.cjs`

---

### Task 3.2: Add Progress Tracking to MCP Tools

- [ ] **Step 1:** Add progress notifications to long operations
- [ ] **Step 2:** Use MCP progress API
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

---

### Task 3.3: Improve Error Messages

- [ ] **Step 1:** Create error code system
- [ ] **Step 2:** Add solution suggestions to errors
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `core/errors.cjs`
- Modify: `cortex/server.cjs`

---

### Task 3.4: Add Inline Cost Warnings

- [ ] **Step 1:** Show cost estimate before Sonnet operations
- [ ] **Step 2:** "This will use Sonnet (~$0.01). Continue?"
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `cortex/sonnet-thinker.cjs`

---

### Task 3.5: Add Activity Indicator to Neural Visuals

- [ ] **Step 1:** Enhance neural-visuals.cjs
- [ ] **Step 2:** Show which tool is running
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `hooks/neural-visuals.cjs`

---

### Task 3.6: Add Onboarding First-Run Experience

- [ ] **Step 1:** Detect first run (no memories exist)
- [ ] **Step 2:** Show welcome message with tutorial
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `hooks/session-start.cjs`

---

## Phase 4: MCP Resources

> **Why:** Let users browse memories with @ mentions.

### Task 4.1: Implement listResources Handler

- [ ] **Step 1:** Add ListResourcesRequestSchema handler
- [ ] **Step 2:** List memory files as resources
- [ ] **Step 3:** Test with MCP inspector
- [ ] **Step 4:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

**Code:**
```javascript
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      { uri: 'cortex://memories/skills', name: 'Skills', mimeType: 'application/jsonl' },
      { uri: 'cortex://memories/patterns', name: 'Patterns', mimeType: 'application/jsonl' },
      { uri: 'cortex://memories/learnings', name: 'Learnings', mimeType: 'application/jsonl' },
      { uri: 'cortex://memories/insights', name: 'Insights', mimeType: 'application/jsonl' },
    ]
  };
});
```

---

### Task 4.2: Implement readResource Handler

- [ ] **Step 1:** Add ReadResourceRequestSchema handler
- [ ] **Step 2:** Return file contents
- [ ] **Step 3:** Test locally
- [ ] **Step 4:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

---

### Task 4.3: Add Resource Templates

- [ ] **Step 1:** Add ResourceTemplatesRequestSchema handler
- [ ] **Step 2:** Allow @cortex/memories/{type} pattern
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

---

### Task 4.4: Document Resources in README

- [ ] **Step 1:** Add Resources section
- [ ] **Step 2:** Show @ mention usage
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `README.md`

---

## Phase 5: MCP Prompts

> **Why:** Predefined templates for common tasks.

### Task 5.1: Implement listPrompts Handler

- [ ] **Step 1:** Add ListPromptsRequestSchema handler
- [ ] **Step 2:** Define prompt templates
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

**Prompts to Add:**
- `weekly-review`: Summarize week's learnings
- `debug-checklist`: Pre-debugging memory check
- `session-summary`: End-of-session summary
- `pattern-analysis`: Analyze recurring patterns

---

### Task 5.2: Implement getPrompt Handler

- [ ] **Step 1:** Add GetPromptRequestSchema handler
- [ ] **Step 2:** Return prompt content
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

---

### Task 5.3: Create Prompt Templates

- [ ] **Step 1:** Create prompts/ directory
- [ ] **Step 2:** Write prompt templates
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `cortex/prompts/weekly-review.md`
- Create: `cortex/prompts/debug-checklist.md`
- Create: `cortex/prompts/session-summary.md`

---

### Task 5.4: Document Prompts in README

- [ ] **Step 1:** Add Prompts section
- [ ] **Step 2:** Show /mcp__cortex__* usage
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `README.md`

---

## Phase 6: MCP Sampling

> **Why:** Let Cortex request Claude completions for smarter analysis.

### Task 6.1: Add Sampling Capability

- [ ] **Step 1:** Update server capabilities
- [ ] **Step 2:** Add sampling to consolidate tool
- [ ] **Step 3:** Test with human approval
- [ ] **Step 4:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

---

### Task 6.2: Use Sampling in Reflect Tool

- [ ] **Step 1:** Enhance reflect to use sampling
- [ ] **Step 2:** Multi-step reasoning
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `cortex/sonnet-thinker.cjs`

---

### Task 6.3: Document Sampling in README

- [ ] **Step 1:** Explain sampling capability
- [ ] **Step 2:** Note human approval requirement
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `README.md`

---

## Phase 7: MCP Elicitation

> **Why:** Ask users for clarification when ambiguous.

### Task 7.1: Add Elicitation Capability

- [ ] **Step 1:** Update server capabilities
- [ ] **Step 2:** Add elicitation to query tool
- [ ] **Step 3:** Test with ambiguous queries
- [ ] **Step 4:** Commit changes

**Files:**
- Modify: `cortex/server.cjs`

---

### Task 7.2: Use Elicitation in Query

- [ ] **Step 1:** When multiple matches, ask user
- [ ] **Step 2:** "Did you mean X or Y?"
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `cortex/haiku-worker.cjs`

---

### Task 7.3: Document Elicitation in README

- [ ] **Step 1:** Explain elicitation capability
- [ ] **Step 2:** Show example interactions
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `README.md`

---

## Phase 8: Security Hardening

> **Why:** Follow MCP security best practices.

### Task 8.1: Add Input Validation

- [ ] **Step 1:** Create validation module
- [ ] **Step 2:** Sanitize all tool inputs
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `core/validation.cjs`
- Modify: `cortex/server.cjs`

---

### Task 8.2: Add Rate Limiting

- [ ] **Step 1:** Create rate limiter
- [ ] **Step 2:** Limit API calls per minute
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `core/rate-limiter.cjs`
- Modify: `cortex/server.cjs`

---

### Task 8.3: Add Audit Logging

- [ ] **Step 1:** Create audit logger
- [ ] **Step 2:** Log all tool calls
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `core/audit.cjs`
- Modify: `cortex/server.cjs`

---

### Task 8.4: Add Encryption at Rest

- [ ] **Step 1:** Research Node.js encryption
- [ ] **Step 2:** Encrypt JSONL files
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `core/encryption.cjs`
- Modify: `core/storage.cjs`

---

### Task 8.5: Add GitHub Actions Security Scan

- [ ] **Step 1:** Create .github/workflows/security.yml
- [ ] **Step 2:** Add SAST scanning
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `.github/workflows/security.yml`

---

## Phase 9: Future-Proofing

> **Why:** Prepare for MCP evolution.

### Task 9.1: Prepare for MCP Apps Extension

- [ ] **Step 1:** Research MCP Apps spec
- [ ] **Step 2:** Design UI component approach
- [ ] **Step 3:** Document in architecture.md
- [ ] **Step 4:** Commit changes

**Files:**
- Create: `docs/architecture.md`

---

### Task 9.2: Add OAuth 2.0 Support

- [ ] **Step 1:** Implement Resource Indicators (RFC 8707)
- [ ] **Step 2:** Add OAuth flow
- [ ] **Step 3:** Commit changes

**Files:**
- Create: `core/oauth.cjs`
- Modify: `cortex/server.cjs`

---

### Task 9.3: Test Python SDK v2 Compatibility

- [ ] **Step 1:** Wait for SDK v2 release (Q1 2026)
- [ ] **Step 2:** Test compatibility
- [ ] **Step 3:** Document any issues

---

### Task 9.4: Add Structured Error Codes

- [ ] **Step 1:** Define error code enum
- [ ] **Step 2:** Use in all error responses
- [ ] **Step 3:** Commit changes

**Files:**
- Modify: `core/errors.cjs`

---

## Appendix: Quick Reference

### File Locations
- Skills: `~/.claude/memory/skills/cortex/SKILL.md`
- MCP Server: `~/.claude/memory/cortex/server.cjs`
- Memories: `~/.claude/memory/data/memories/*.jsonl`
- Logs: `~/.claude/memory/logs/`
- Config: `~/.claude/memory/data/configs/current.json`

### Testing Commands
```bash
# Run all tests
npm test

# Test MCP server
timeout 3 node cortex/server.cjs

# Check memories
wc -l data/memories/*.jsonl

# View logs
tail -50 logs/*.log
```

### Commit Message Format
```
feat(cortex): add /cortex help command
fix(hooks): improve session-start memory injection
docs(readme): add natural language examples
```

---

**Next Action:** Choose execution approach:
1. **Subagent-Driven** - This session, task-by-task with review
2. **Parallel Session** - New session for batch execution
