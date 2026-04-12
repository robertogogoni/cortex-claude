#!/usr/bin/env node
/**
 * Cortex Migration Script
 * Retroactively upgrades legacy flat memories into the Memory Palace Topology
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { Anthropic } = require('@anthropic-ai/sdk');
const { JSONLStore } = require('../core/storage.cjs');

async function migrate() {
  console.log('\x1b[36m============================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m  🏰  CORTEX MEMORY PALACE - LEGACY BACKFILL \x1b[0m');
  console.log('\x1b[36m============================================================\x1b[0m\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("\x1b[31m[ERROR]\x1b[0m ANTHROPIC_API_KEY is not defined in your environment.");
    console.error("Please export it before running the backfill (e.g. export ANTHROPIC_API_KEY='sk-ant...')");
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });
  const storesToCheck = [
    new JSONLStore(path.resolve(__dirname, '../data/skills/index.jsonl')),
    new JSONLStore(path.resolve(__dirname, '../data/memories/working.jsonl')),
    new JSONLStore(path.resolve(__dirname, '../data/memories/short-term.jsonl')),
    new JSONLStore(path.resolve(__dirname, '../data/memories/long-term.jsonl'))
  ];

  let migratedCount = 0;

  for (const store of storesToCheck) {
    if (!fs.existsSync(store.filePath)) continue;
    await store.load();
    const records = store.getAll();

    for (const record of records) {
      if (!record.wing || !record.hall || !record.room) {
        console.log(`\x1b[33m[Found Legacy Record]\x1b[0m Investigating Node ID [${record.id.slice(0, 8)}]...`);

        const prompt = `Classify this verbatim memory fact into a Memory Palace Wing, Hall, and Room structure.\n\nType: ${record.type}\nContent: ${record.content || record.summary || "General Knowledge"}\nTags: ${(record.tags || []).join(', ')}`;

        const tools = [{
          name: "create_memory_palace_nodes",
          description: "Extract specific concepts into structural Memory Palace topological nodes.",
          input_schema: {
            type: "object",
            properties: {
              nodes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    wing: { type: "string" },
                    hall: { type: "string" },
                    room: { type: "string" }
                  },
                  required: ["wing", "hall", "room"]
                }
              }
            },
            required: ["nodes"]
          }
        }];

        try {
          const response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            temperature: 0.1,
            system: "You are identifying missing spatial topology domains for legacy memory facts. Provide concise labels for the Wing, Hall, and Room.",
            messages: [{ role: "user", content: prompt }],
            tools: tools,
            tool_choice: { type: "tool", name: "create_memory_palace_nodes" }
          });

          let extraction;
          for (const block of response.content) {
            if (block.type === 'tool_use' && block.name === 'create_memory_palace_nodes') {
              extraction = block.input.nodes?.[0];
            }
          }

          if (extraction && extraction.wing) {
            await store.update(record.id, {
              wing: extraction.wing,
              hall: extraction.hall,
              room: extraction.room
            });
            console.log(`  \x1b[32m✔ Upgraded\x1b[0m -> [${extraction.wing} / ${extraction.hall} / ${extraction.room}]`);
            migratedCount++;
          }
        } catch (e) {
          console.error(`  \x1b[31m✖ LLM Error:\x1b[0m ${e.message}`);
        }
      }
    }
  }

  console.log(`\n\x1b[32mLegacy Migration Complete!\x1b[0m Successfully backfilled ${migratedCount} nodes.\nRun the Vault Export command again to rebuild the Obsidian topology.`);
}

migrate().catch(console.error);
