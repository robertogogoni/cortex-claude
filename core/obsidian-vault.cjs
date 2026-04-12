/**
 * Cortex - Claude's Cognitive Layer - Obsidian Vault Exporter v2
 *
 * Exports normalized MemoryRecords into a Graph-Optimized Obsidian vault.
 * Implements a "Local-First" Knowledge Graph where entities are first-class citizens.
 *
 * @version 2.0.0
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { expandPath } = require('./types.cjs');

class ObsidianVaultExporter {
  constructor(options = {}) {
    this.vaultPath = expandPath(options.vaultPath || '~/.claude/memory/obsidian-vault');
    this.clean = options.clean || false;
    this.rootFolder = options.rootFolder || 'Cortex Atlas';
    this.maxBodyChars = options.maxBodyChars || 20000;
    this.hostname = os.hostname();
  }

  export(records) {
    const exportRoot = path.join(this.vaultPath, this.rootFolder);

    if (this.clean && fs.existsSync(exportRoot)) {
      fs.rmSync(exportRoot, { recursive: true, force: true });
    }

    this._ensureDir(exportRoot);
    this._ensureDir(path.join(exportRoot, '00 Nodes'));
    this._ensureDir(path.join(exportRoot, '10 Records'));
    this._ensureDir(path.join(exportRoot, '20 Sources'));
    this._ensureDir(path.join(exportRoot, '30 Types'));
    this._ensureDir(path.join(exportRoot, '40 Tags'));

    const counts = { records: records.length, bySource: {}, byType: {}, byTag: {} };
    const entityMap = new Map();

    for (const record of records) {
      const source = record._source || 'unknown';
      const type = record.type || 'learning';
      const tags = record.tags || [];

      counts.bySource[source] = (counts.bySource[source] || 0) + 1;
      counts.byType[type] = (counts.byType[type] || 0) + 1;
      for (const tag of tags) { counts.byTag[tag] = (counts.byTag[tag] || 0) + 1; }

      const entities = [...tags, source, type];
      if (record.projectHash) entities.push('Project:' + record.projectHash);

      for (const ent of entities) {
        if (!entityMap.has(ent)) entityMap.set(ent, { records: [], relations: [] });
        entityMap.get(ent).records.push(record);
      }
    }

    for (const record of records) { this._writeRecordNote(exportRoot, record); }
    for (const [entity, data] of entityMap.entries()) { this._writeEntityNode(exportRoot, entity, data); }
    for (const [source, count] of Object.entries(counts.bySource)) { this._writeSourceNote(exportRoot, source, count); }
    for (const [type, count] of Object.entries(counts.byType)) { this._writeTypeNote(exportRoot, type, count); }
    for (const [tag, count] of Object.entries(counts.byTag)) { this._writeTagNote(exportRoot, tag, count); }
    this._writeAtlasHome(exportRoot, counts);

    const manifest = {
      generatedAt: new Date().toISOString(),
      hostname: this.hostname,
      rootFolder: this.rootFolder,
      counts: { ...counts, entities: counts.entities || 0 },
    };
    fs.writeFileSync(path.join(exportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return { success: true, exportRoot, manifest };
  }

  _writeAtlasHome(exportRoot, counts) {
    const lines = [
      '---',
      'cssclasses: ["dashboard", "cortex-anatomy"]',
      '---',
      '# <span style="background: linear-gradient(90deg, #00d2ff 0%, #3a7bd5 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">🧠 Cortex Memory Palace</span>', 
      '',
      '<div style="text-align: center; border-bottom: 2px solid #3a7bd5; padding-bottom: 10px; margin-bottom: 20px;">',
      '  <em>The central nervous system of your digital intelligence.</em>',
      '</div>',
      '',
      '> [!abstract] The Central Core',
      '> Welcome to the **Cortex Atlas**. This vault acts as the autonomous, bi-temporal memory for your AI agent. It represents a persistent, non-volatile mapping of every interaction, decision, pattern, and skill inferred over time. Structured anatomically to mirror the human nervous system.', 
      '',
      '---', 
      '',
      '## 🩻 The Anatomy of the Network',
      '',
      '<div style="display: flex; gap: 20px; flex-wrap: wrap;">',
      '',
      '<div style="flex: 1 1 300px; padding: 20px; border-left: 4px solid #00d2ff; background: rgba(0, 210, 255, 0.05); border-radius: 0 8px 8px 0; margin-bottom: 15px;">',
      '### 🦴 The Spinal Cord (Topology)',
      'As data is ingested, unstructured artifacts are geometrically routed to specific <strong>Lobes</strong> and <strong>Regions</strong>. Navigate through <a href="Cortex Atlas/05 Cortex Morphology">Cortex Morphology</a> to see your mental architecture.',
      '</div>',
      '',
      '<div style="flex: 1 1 300px; padding: 20px; border-left: 4px solid #ff007f; background: rgba(255, 0, 127, 0.05); border-radius: 0 8px 8px 0; margin-bottom: 15px;">',
      '### 🧬 Neurons (Records)',
      'The atomic units. Each memory is a unique neuron holding verbatim facts and code. Check your <a href="Cortex Atlas/10 Records">Raw Observations</a> to witness individual firings.',
      '</div>',
      '',
      '</div>',
      '<div style="padding: 20px; border-left: 4px solid #a200ff; background: rgba(162, 0, 255, 0.05); border-radius: 0 8px 8px 0;">',
      '### 🕸️ Synaptic Pathways (Graphs)',
      'Memories intertwine automatically based on contextual embeddings. These cross-connections ensure that a solution found months ago triggers effortlessly on modern problems. Open the <strong>Graph View</strong> to explore semantic branching.',
      '</div>',
      '',
      '---',
      '',
      '## 📊 Neurochemistry Statistics',
      '',
      '> [!example] System Load',
      '> - **Axons Fired (Total Memories):** `' + counts.records + '`',
      '> - **Sensory Inputs (Sources):** `' + Object.keys(counts.bySource).length + '`',
      '> - **Semantic Proteins (Tags):** `' + Object.keys(counts.byTag).length + '`',
      '',
      '---',
      '',
      '## 💡 Recent Synaptic Activity',
      '',
      '```dataview',
      'TABLE memory_type as "Classification", source as "Sensory Origin", confidence as "Confidence", updated_at as "Last Fired"',
      'FROM "Cortex Atlas/10 Records" OR "Cortex Atlas/05 Cortex Morphology"',
      'WHERE file.name != "00 Welcome"',
      'SORT updated_at DESC',
      'LIMIT 10',
      '```',
      '',
      '---',
      '',
      '<div style="text-align: center; font-size: 0.8em; color: gray;">',
      '  <em>Auto-generated by the Cortex Extraction Engine.</em>',
      '</div>'
    ];
    fs.writeFileSync(path.join(exportRoot, '00 Welcome.md'), lines.join('\n'));
    if(fs.existsSync(path.join(exportRoot, '00 Home.md'))) {
      fs.unlinkSync(path.join(exportRoot, '00 Home.md'));
    }
  }

  _writeEntityNode(exportRoot, entity, data) {
    const safeName = this._safeName(entity);
    
    // Generate a contextual summary of what this entity actually means to the user
    // by aggregating the summaries of the top memories associated with it.
    const topMemories = data.records
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 5);
      
    let contextualSummary = '> [!quote] Synthesized Knowledge\n';
    if (topMemories.length > 0) {
      contextualSummary += '> Based on recent neural activity, this concept is primarily associated with:\n';
      topMemories.forEach(m => {
        if (m.summary) {
          contextualSummary += '> - ' + m.summary.replace(/\n/g, ' ') + '\n';
        }
      });
    } else {
      contextualSummary += '> A nascent concept in the neural network, currently forming initial connections.\n';
    }

    const records = data.records
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(r => {
        let cleanName = r._noteTitle || r.summary || '';
        cleanName = cleanName.split(' ').slice(0, 7).join(' ').replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'Memory Record';
        const typePrefix = (r.type || 'memory').toUpperCase();
        const fileName = `[${typePrefix}] ${cleanName} - ${this._safeName(r.id).slice(0, 6)}`;
        
        // Add context to the link display
        return `- [[${this.rootFolder}/10 Records/${this._safeName(r._source || 'unknown')}/${fileName}|${r._noteTitle || r.summary || r.id}]]`;
      })
      .join('\n');

    const content = [
      '---',
      'entity: "' + entity.replace(/"/g, '\\"') + '"',
      'observation_count: ' + data.records.length,
      'kind: entity-node',
      'tags: [entity, ' + this._safeName(entity) + ']',
      '---', '',
      '# 🌐 Concept: ' + entity, '',
      '> [!abstract] Neural Hub',
      '> This node represents a central concept dynamically extracted from the cognitive memory stream.', '',
      contextualSummary, '',
      '***', '',
      '## 📊 Entity Statistics', '',
      '> [!info] Synaptic Profile',
      '> **Direct Connections:** ' + data.records.length,
      '> **Dominant Type:** ' + (data.records[0]?.type || 'memory'),
      '> **First Encountered:** ' + (data.records[data.records.length - 1]?.createdAt || 'Unknown').split('T')[0],
      '> **Last Activated:** ' + (data.records[0]?.createdAt || 'Unknown').split('T')[0], '',
      '***', '',
      '## 🔗 Linked Cognitive Memories', '',
      records || '_No observations linked_', '',
      '***', '',
      '## 🕸️ Dynamic Graph', '',
      '```dataview',
      'TABLE memory_type as "Type", confidence as "Confidence", created_at as "Date"',
      'FROM "Cortex Atlas/10 Records"',
      'WHERE contains(file.outlinks, this.file.link)',
      'SORT created_at DESC',
      '```',
    ].join('\n');

    fs.writeFileSync(path.join(exportRoot, '00 Nodes', safeName + '.md'), content);
  }

  _writeSourceNote(exportRoot, source, count) {
    const content = [
      '---', 'source: "' + source.replace(/"/g, '\\"') + '"', 'record_count: ' + count, 'kind: source-index', '---', '',
      '# 🔌 Source: ' + source, '',
      '> [!note] Data Origin',
      '> Aggregates all cognitive memories emitted by the `' + source + '` adapter.', '', 
      '**Total Memories:** ' + count,
    ].join('\n');
    fs.writeFileSync(path.join(exportRoot, '20 Sources', this._safeName(source) + '.md'), content);
  }

  _writeTypeNote(exportRoot, type, count) {
    const content = [
      '---', 'memory_type: "' + type.replace(/"/g, '\\"') + '"', 'record_count: ' + count, 'kind: type-index', '---', '',
      '# 🧬 Taxonomy: ' + type, '', 
      '> [!example] Knowledge Type',
      '> Classifies cognitive memories of type `' + type + '`.', '', 
      '**Total Memories:** ' + count,
    ].join('\n');
    fs.writeFileSync(path.join(exportRoot, '30 Types', this._safeName(type) + '.md'), content);
  }

  _writeTagNote(exportRoot, tag, count) {
    const content = [
      '---', 'tag: "' + tag.replace(/"/g, '\\"') + '"', 'record_count: ' + count, 'kind: tag-index', '---', '',
      '# 🏷️ Marker: ' + tag, '', 
      '> [!quote] Semantic Tag',
      '> Marker for distributed knowledge associated with the concept `' + tag + '`.', '', 
      '**Total Memories:** ' + count,
    ].join('\n');
    fs.writeFileSync(path.join(exportRoot, '40 Tags', this._safeName(tag) + '.md'), content);
  }

  _writeRecordNote(exportRoot, record) {
    let targetDir;
    let fileName;

    if (record.lobe && record.region && record.cluster) {
      // Neural Anatomical Spatial Routing
      const lobeDir = this._safeName(record.lobe);
      const regionDir = this._safeName(record.region);
      targetDir = path.join(exportRoot, '05 Cortex Morphology', lobeDir, regionDir);
      this._ensureDir(targetDir);

      fileName = `[CLUSTER] ${this._safeName(record.cluster)} - ${this._safeName(record.id).slice(0, 6)}.md`;
    } else {
      // Legacy Source-based Routing
      const sourceName = record._source || 'unknown';
      targetDir = path.join(exportRoot, '10 Records', this._safeName(sourceName));
      this._ensureDir(targetDir);

      // Generate a beautiful, human-readable file name
      let cleanName = record._noteTitle || record.summary || '';
      cleanName = cleanName.split(' ').slice(0, 7).join(' ').replace(/[^a-zA-Z0-9\s]/g, '').trim();
      if (!cleanName || cleanName.length < 3) cleanName = 'Memory Record';
      
      const typePrefix = (record.type || 'memory').toUpperCase();
      fileName = `[${typePrefix}] ${cleanName} - ${this._safeName(record.id).slice(0, 6)}.md`;
    }

    const frontmatter = this._buildFrontmatter(record);
    const body = this._buildBody(record);

    fs.writeFileSync(path.join(targetDir, fileName), frontmatter + '\n' + body + '\n');
  }

  _buildFrontmatter(record) {
    const lines = [
      '---',
      'id: "' + record.id + '"',
      'title: "' + (record._noteTitle || record.summary || record.id).replace(/"/g, '\\"') + '"',
      'source: "' + (record._source || 'unknown') + '"',
      'memory_type: "' + (record.type || 'learning') + '"',
      'intent: "' + (record.intent || 'general') + '"',
      'confidence: ' + (record.extractionConfidence || 0),
      'created_at: "' + (record.createdAt || record.sourceTimestamp || new Date().toISOString()) + '"',
      'updated_at: "' + (record.updatedAt || record.createdAt || record.sourceTimestamp || new Date().toISOString()) + '"',
      'origin_path: "' + (record._sourceFile || 'null').replace(/"/g, '\\"') + '"',
    ];

    // Neural specific properties if available
    if (record.activationLevel !== undefined) {
      lines.push('activation: ' + record.activationLevel);
      lines.push('strength: ' + record.strength);
    }

    lines.push('tags:');
    const tags = (record.tags || []).slice().sort();
    if (tags.length === 0) { lines.push('  - cortex'); }
    else { for (const tag of tags) { lines.push('  - ' + tag.replace(/"/g, '\\"')); } }

    lines.push('---');
    return lines.join('\n');
  }

  _buildBody(record) {
    const title = record._noteTitle || record.summary || record.id;
    const sourceLink = '[[' + this.rootFolder + '/20 Sources/' + this._safeName(record._source || 'unknown') + '|' + (record._source || 'unknown') + ']]';
    const typeLink = '[[' + this.rootFolder + '/30 Types/' + this._safeName(record.type || 'learning') + '|' + (record.type || 'learning') + ']]';
    const tagLinks = (record.tags || []).map(tag => '[[' + this.rootFolder + '/00 Nodes/' + this._safeName(tag) + '|' + tag + ']]');
    
    const truncatedContent = (record.content || '').slice(0, this.maxBodyChars);
    const wasTruncated = (record.content || '').length > this.maxBodyChars;

    // Pick callout type based on memory type
    const typeCalloutMap = {
      'learning': 'tip',
      'pattern': 'abstract',
      'decision': 'success',
      'skill': 'example',
      'correction': 'warning',
      'preference': 'bookmark',
      'insight': 'idea',
      'error': 'bug',
      'memory': 'note'
    };
    const calloutType = typeCalloutMap[record.type?.toLowerCase()] || 'note';

    // Build Obsidian Callouts for beautiful UI
    const lines = [
      '# ' + title, '',
      `> [!${calloutType}] Memory Overview`,
      '> ' + (record.summary ? record.summary.replace(/\n/g, '\n> ') : 'Cortex cognitive memory record.'), '',
      '> [!info]- Metadata & Origin',
      '> - **Source**: ' + sourceLink,
      '> - **Type**: ' + typeLink,
      '> - **Project**: ' + (record.projectHash || 'global'),
      '> - **Origin Path**: ' + (record._sourceFile ? '`' + record._sourceFile + '`' : 'N/A'),
    ];

    if (record.activationLevel !== undefined) {
      const actPct = Math.round(record.activationLevel * 100);
      const strPct = Math.round(record.strength * 50); // relative to max 2.0
      lines.push('> - **Activation**: ' + actPct + '%');
      lines.push('> - **Synaptic Strength**: ' + strPct + '%');
    }

    lines.push('');
    
    if (tagLinks.length > 0) {
      lines.push('## 🌐 Neural Entities');
      lines.push(tagLinks.join(' • '));
      lines.push('');
    }

    lines.push('## 🧠 Cognitive Context', '');
    
    // Parse the raw content to make it beautiful
    const parsedBlocks = this._parseContentBlocks(truncatedContent);
    lines.push(parsedBlocks);

    if (wasTruncated) { lines.push('', '> [!warning] Content Truncated', '> Content exceeded export limits. Use Cortex local search for the full record.'); }

    return lines.join('\n');
  }

  _parseContentBlocks(content) {
    if (!content) return '_No descriptive context available._';

    let formatted = content;
    const codeBlocks = [];
    
    // 1. Extract code blocks and replace with placeholders
    formatted = formatted.replace(/```([\w-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const id = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push({ id, lang: lang || 'text', code: code.trim() });
      return id;
    });

    // 2. Format Error/Exception blocks as Callouts
    const errorRegex = /(?:Error|Exception|Traceback|Failed).*?:.*?(?=\n\n|$)/gis;
    formatted = formatted.replace(errorRegex, (match) => {
      return `\n> [!bug] Error Trace\n> ${match.trim().replace(/\n/g, '\n> ')}\n`;
    });

    // 3. Restore and format code blocks into a dedicated technical section
    codeBlocks.forEach(block => {
      formatted = formatted.replace(block.id, `\n\n### 💻 Technical Implementation (${block.lang})\n\`\`\`${block.lang}\n${block.code}\n\`\`\`\n`);
    });

    return formatted.trim();
  }

  _ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }

  _safeName(value) {
    return String(value || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'unknown';
  }
}

module.exports = { ObsidianVaultExporter };