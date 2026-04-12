# Cortex Implementation Plan

This plan completes the final outstanding features listed in the v2.0 Roadmap.

## 1. Implement `/cortex forget` (Phase 8)
**Goal:** Allow users to selectively delete memories that are wrong, outdated, or sensitive.
**Tasks:**
- Add `delete(id)` to `MemoryStore` and `VectorSearchProvider`.
- Expose `cortex__forget` MCP tool in `cortex/server.cjs`.
- Add `/cortex forget <keyword>` to `skills/cortex/SKILL.md`.

## 2. Implement Backup & Restore (Phase 8)
**Goal:** Prevent data loss of the 7,700+ memories we just created.
**Tasks:**
- Create `bin/cortex-backup.cjs`.
- Implement `tar` or `zip` archiving of `~/.claude/memory/data` and `~/.claude/memory/neural`.
- Add an interactive restore command.

## 3. Implement HTTP API Bridge (Phase 8)
**Goal:** Expose Cortex data to external dashboards (like a web UI or Streamlit).
**Tasks:**
- Create `cortex/api-server.cjs` using a lightweight HTTP server (e.g., Express or native Node HTTP).
- Expose endpoints: `GET /api/memories`, `GET /api/stats`, `POST /api/query`.

## 4. Update the CLI & Roadmap
**Goal:** Mark these phases as complete in the repository.
**Tasks:**
- Add `cortex-backup` to `package.json` bin scripts.
- Mark Phase 8 items as "Done" in `ROADMAP.md`.