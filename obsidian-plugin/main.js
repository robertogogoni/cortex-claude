"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => CortexPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/api.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var import_child_process = require("child_process");
var CortexAPI = class {
  constructor(cortexPath) {
    this.cortexPath = cortexPath.replace("~", process.env.HOME || "");
    this.memoryPath = path2.join(this.cortexPath, "data/memories");
  }
  /**
   * Search memories using Cortex hybrid search
   */
  async search(query, options) {
    return new Promise((resolve, reject) => {
      const args = [
        path2.join(this.cortexPath, "bin/cortex.cjs"),
        "search",
        "--query",
        query,
        "--json"
      ];
      if (options.limit) {
        args.push("--limit", String(options.limit));
      }
      const proc = (0, import_child_process.spawn)("node", args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let output = "";
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const results = JSON.parse(output);
            resolve(results);
          } catch (e) {
            resolve([]);
          }
        } else {
          reject(new Error("Search failed"));
        }
      });
      proc.on("error", reject);
    });
  }
  /**
   * Import a note into Cortex memory
   */
  async importNote(note) {
    return new Promise((resolve) => {
      const workingFile = path2.join(this.memoryPath, "working.jsonl");
      const line = JSON.stringify({
        ...note,
        importedAt: (/* @__PURE__ */ new Date()).toISOString(),
        _source: "obsidian-plugin"
      }) + "\n";
      fs2.appendFile(workingFile, line, (err) => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }
  /**
   * Export Cortex memories to Obsidian vault
   */
  async exportVault(vaultPath) {
    return new Promise((resolve, reject) => {
      const args = [
        path2.join(this.cortexPath, "bin/cortex.cjs"),
        "export-vault",
        "--vault-path",
        vaultPath.replace("~", process.env.HOME || ""),
        "--root-folder",
        "Cortex Atlas",
        "--json"
      ];
      const proc = (0, import_child_process.spawn)("node", args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let output = "";
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output);
            resolve(result);
          } catch (e) {
            resolve({
              success: true,
              exportRoot: path2.join(vaultPath.replace("~", process.env.HOME || ""), "Cortex Atlas"),
              recordCount: 0,
              entityCount: 0
            });
          }
        } else {
          reject(new Error("Export failed"));
        }
      });
      proc.on("error", reject);
    });
  }
  /**
   * Get memory statistics
   */
  async getStats() {
    const stats = {
      totalRecords: 0,
      byType: {},
      bySource: {},
      vectorCount: 0
    };
    const memoryFiles = ["working.jsonl", "short-term.jsonl", "long-term.jsonl", "insights.jsonl", "learnings.jsonl"];
    for (const file of memoryFiles) {
      const filePath = path2.join(this.memoryPath, file);
      if (fs2.existsSync(filePath)) {
        const content = fs2.readFileSync(filePath, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        stats.totalRecords += lines.length;
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record.type) {
              stats.byType[record.type] = (stats.byType[record.type] || 0) + 1;
            }
            if (record._source) {
              stats.bySource[record._source] = (stats.bySource[record._source] || 0) + 1;
            }
          } catch (e) {
          }
        }
      }
    }
    const vectorIndex = path2.join(this.cortexPath, "data/vector/index.bin");
    if (fs2.existsSync(vectorIndex)) {
      const mappingFile = path2.join(this.cortexPath, "data/vector/mapping.json");
      if (fs2.existsSync(mappingFile)) {
        const mapping = JSON.parse(fs2.readFileSync(mappingFile, "utf8"));
        stats.vectorCount = Object.keys(mapping).length;
      }
    }
    return stats;
  }
  /**
   * Get recent memories
   */
  async getRecent(limit = 10) {
    const workingFile = path2.join(this.memoryPath, "working.jsonl");
    if (!fs2.existsSync(workingFile)) {
      return [];
    }
    const content = fs2.readFileSync(workingFile, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  }
  /**
   * Get entities from knowledge graph
   */
  async getEntities() {
    const kgFile = path2.join(this.cortexPath, "knowledge-graph.jsonl");
    if (!fs2.existsSync(kgFile)) {
      return [];
    }
    const content = fs2.readFileSync(kgFile, "utf8");
    try {
      const graph = JSON.parse(content);
      return graph.entities || [];
    } catch (e) {
      return [];
    }
  }
  /**
   * Trigger Cortex reflection on a topic
   */
  async reflect(topic) {
    return new Promise((resolve, reject) => {
      const args = [
        path2.join(this.cortexPath, "bin/cortex.cjs"),
        "reflect",
        "--topic",
        topic,
        "--json"
      ];
      const proc = (0, import_child_process.spawn)("node", args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let output = "";
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output);
            resolve(result.summary || result.content || "");
          } catch (e) {
            resolve(output);
          }
        } else {
          reject(new Error("Reflection failed"));
        }
      });
      proc.on("error", reject);
    });
  }
};

// src/view.ts
var import_obsidian = require("obsidian");
var CORTEX_VIEW_TYPE = "cortex-view";
var CortexView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.api = plugin.api;
  }
  getViewType() {
    return CORTEX_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u{1F9E0} Cortex Memory";
  }
  getIcon() {
    return "cortex";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    const headerEl = container.appendChild(document.createElement("div"));
    headerEl.className = "cortex-header";
    headerEl.innerHTML = "<h2>Cortex Memory</h2>";
    const searchContainer = container.appendChild(document.createElement("div"));
    searchContainer.className = "cortex-search";
    this.searchEl = searchContainer.appendChild(document.createElement("input"));
    this.searchEl.type = "text";
    this.searchEl.placeholder = "Search memories...";
    this.searchEl.className = "cortex-search-input";
    this.searchEl.addEventListener("input", async () => {
      if (this.searchEl.value.length > 2) {
        await this.search(this.searchEl.value);
      }
    });
    this.statsEl = container.appendChild(document.createElement("div"));
    this.statsEl.className = "cortex-stats";
    await this.updateStats();
    const recentHeader = container.appendChild(document.createElement("div"));
    recentHeader.className = "cortex-section-header";
    recentHeader.textContent = "Recent Memories";
    this.recentEl = container.appendChild(document.createElement("div"));
    this.recentEl.className = "cortex-recent";
    await this.updateRecent();
    const actionsEl = container.appendChild(document.createElement("div"));
    actionsEl.className = "cortex-actions";
    const syncBtn = actionsEl.appendChild(document.createElement("button"));
    syncBtn.textContent = "Sync Vault";
    syncBtn.onclick = () => this.plugin.syncVault();
    const exportBtn = actionsEl.appendChild(document.createElement("button"));
    exportBtn.textContent = "Export Current";
    exportBtn.onclick = () => this.plugin.exportCurrentNote();
    const graphBtn = actionsEl.appendChild(document.createElement("button"));
    graphBtn.textContent = "Open Graph";
    graphBtn.onclick = () => this.openGraphView();
  }
  async onClose() {
  }
  async search(query) {
    var _a;
    (_a = this.resultsEl) == null ? void 0 : _a.empty();
    try {
      const results = await this.api.search(query, { limit: 10 });
      if (!this.resultsEl) {
        this.resultsEl = this.containerEl.children[1].appendChild(document.createElement("div"));
        this.resultsEl.className = "cortex-results";
      }
      this.resultsEl.empty();
      if (results.length === 0) {
        this.resultsEl.textContent = "No results found";
        return;
      }
      results.forEach((result) => {
        var _a2;
        const item = this.resultsEl.appendChild(document.createElement("div"));
        item.className = "cortex-result-item";
        const title = item.appendChild(document.createElement("div"));
        title.className = "cortex-result-title";
        title.textContent = result.title;
        const summary = item.appendChild(document.createElement("div"));
        summary.className = "cortex-result-summary";
        summary.textContent = result.summary.slice(0, 100) + "...";
        const tags = item.appendChild(document.createElement("div"));
        tags.className = "cortex-result-tags";
        tags.textContent = ((_a2 = result.tags) == null ? void 0 : _a2.join(", ")) || "";
        item.onclick = () => {
          this.openMemory(result);
        };
      });
    } catch (error) {
      console.error("Search failed:", error);
    }
  }
  async updateStats() {
    try {
      const stats = await this.api.getStats();
      this.statsEl.innerHTML = `
        <div class="cortex-stat">
          <span class="cortex-stat-value">${stats.totalRecords}</span>
          <span class="cortex-stat-label">Total Memories</span>
        </div>
        <div class="cortex-stat">
          <span class="cortex-stat-value">${stats.vectorCount}</span>
          <span class="cortex-stat-label">Vectors Indexed</span>
        </div>
      `;
    } catch (error) {
      console.error("Stats failed:", error);
    }
  }
  async updateRecent() {
    try {
      const recent = await this.api.getRecent(5);
      this.recentEl.empty();
      recent.forEach((record) => {
        const item = this.recentEl.appendChild(document.createElement("div"));
        item.className = "cortex-recent-item";
        const title = item.appendChild(document.createElement("div"));
        title.className = "cortex-recent-title";
        title.textContent = record.title || record.id.slice(0, 30);
        const date = item.appendChild(document.createElement("div"));
        date.className = "cortex-recent-date";
        date.textContent = new Date(record.createdAt).toLocaleDateString();
        item.onclick = () => this.openMemory(record);
      });
    } catch (error) {
      console.error("Recent failed:", error);
    }
  }
  async openGraphView() {
    const vaultPath = this.plugin.settings.vaultPath.replace("~", process.env.HOME || "");
    const atlasPath = path.join(vaultPath, "Cortex Atlas", "00 Home.md");
    if (fs.existsSync(atlasPath)) {
      await this.app.workspace.openLinkText(atlasPath, "");
    } else {
      new Notice("Cortex Atlas not found. Run sync first.");
    }
  }
  openMemory(record) {
    var _a;
    const content = `# ${record.title}

${record.summary}

Tags: ${((_a = record.tags) == null ? void 0 : _a.join(", ")) || "none"}

Source: ${record.source}

Confidence: ${record.extractionConfidence}

---

${record.content}`;
    const path3 = `Cortex/Memories/${record.id.slice(0, 20)}.md`;
    this.app.vault.create(path3, content).then((file) => {
      this.app.workspace.openLinkText(file.path, "");
    });
  }
};

// src/suggest.ts
var import_obsidian2 = require("obsidian");
var CortexSuggest = class extends import_obsidian2.EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onTrigger(editor) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    if (line.includes("[[cortex:")) {
      return {
        query: line.split("[[cortex:")[1] || "",
        start: { line: cursor.line, ch: line.indexOf("[[cortex:") },
        end: cursor
      };
    }
    if (line.includes("@cortex")) {
      return {
        query: line.split("@cortex")[1] || "",
        start: { line: cursor.line, ch: line.indexOf("@cortex") },
        end: cursor
      };
    }
    return null;
  }
  async getSuggestions(context) {
    const query = context.query.toLowerCase();
    try {
      const memories = await this.plugin.api.getRecent(20);
      return memories.filter((m) => {
        var _a, _b;
        return !query || ((_a = m.title) == null ? void 0 : _a.toLowerCase().includes(query)) || ((_b = m.content) == null ? void 0 : _b.toLowerCase().includes(query));
      }).map((m) => ({
        title: m.title,
        id: m.id,
        content: m.content,
        summary: m.summary
      }));
    } catch (e) {
      return [];
    }
  }
  renderSuggestion(value, el) {
    var _a;
    el.addClass("cortex-suggest-item");
    const titleEl = el.appendChild(document.createElement("div"));
    titleEl.className = "cortex-suggest-title";
    titleEl.textContent = value.title;
    const summaryEl = el.appendChild(document.createElement("div"));
    summaryEl.className = "cortex-suggest-summary";
    summaryEl.textContent = ((_a = value.summary) == null ? void 0 : _a.slice(0, 50)) || "No summary";
  }
  async onSuggest(value, editor, context) {
    const replacement = `[[Cortex/Memories/${value.id.slice(0, 20)}|${value.title}]]`;
    editor.replaceRange(replacement, context.start, context.end);
  }
};

// src/main.ts
var CORTEX_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
var DEFAULT_SETTINGS = {
  cortexPath: "~/.claude/memory",
  vaultPath: "~/.obsidian-vault",
  autoSync: true,
  syncInterval: 300,
  // 5 minutes
  showGraphView: true,
  enableSuggestions: true,
  maxResults: 20
};
var CortexPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.cortexView = null;
    this.syncInterval = null;
  }
  async onload() {
    (0, import_obsidian3.addIcon)("cortex", CORTEX_ICON);
    await this.loadSettings();
    this.api = new CortexAPI(this.settings.cortexPath);
    this.registerView(CORTEX_VIEW_TYPE, (leaf) => {
      this.cortexView = new CortexView(leaf, this);
      return this.cortexView;
    });
    this.addRibbonIcon("cortex", "Open Cortex Memory", async () => {
      await this.openCortexView();
    });
    this.addCommand({
      id: "open-cortex-view",
      name: "Open Cortex Memory View",
      callback: () => this.openCortexView()
    });
    this.addCommand({
      id: "search-cortex-memory",
      name: "Search Cortex Memory",
      callback: () => this.searchMemory()
    });
    this.addCommand({
      id: "sync-cortex-vault",
      name: "Sync Cortex Vault",
      callback: () => this.syncVault()
    });
    this.addCommand({
      id: "export-to-cortex",
      name: "Export Current Note to Cortex",
      callback: () => this.exportCurrentNote()
    });
    if (this.settings.enableSuggestions) {
      this.registerEditorSuggest(new CortexSuggest(this));
    }
    this.addSettingTab(new CortexSettingTab(this.app, this));
    if (this.settings.autoSync) {
      this.startAutoSync();
    }
    const statusEl = this.addStatusBarItem();
    statusEl.textContent = "\u{1F9E0} Cortex";
    statusEl.title = "Cortex Memory Plugin";
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        menu.addItem((item) => {
          item.setTitle("Export to Cortex").setIcon("cortex").onClick(() => this.exportFile(file));
        });
      })
    );
  }
  async openCortexView() {
    const leaves = this.app.workspace.getLeavesOfType(CORTEX_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: CORTEX_VIEW_TYPE,
      active: true
    });
    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(CORTEX_VIEW_TYPE)[0]
    );
  }
  async searchMemory() {
    const query = await this.prompt("Search Cortex Memory", "Enter search query...");
    if (!query) return;
    const results = await this.api.search(query, { limit: this.settings.maxResults });
    if (results.length === 0) {
      new import_obsidian3.Notice("No memories found for: " + query);
      return;
    }
    const content = `# Cortex Memory Search: ${query}

${results.map((r, i) => {
      var _a;
      return `## ${i + 1}. ${r.title}

${r.summary}

Tags: ${((_a = r.tags) == null ? void 0 : _a.join(", ")) || "none"}

---`;
    }).join("\n")}`;
    const file = await this.app.vault.create("Cortex/Search Results.md", content);
    await this.app.workspace.openLinkText(file.path, "");
    new import_obsidian3.Notice(`Found ${results.length} memories`);
  }
  async syncVault() {
    new import_obsidian3.Notice("Syncing Cortex vault...");
    try {
      const result = await this.api.exportVault(this.settings.vaultPath);
      new import_obsidian3.Notice(`\u2713 Vault synced: ${result.recordCount} records`);
    } catch (error) {
      new import_obsidian3.Notice("\u2717 Sync failed: " + error.message);
    }
  }
  async exportCurrentNote() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    if (!view) {
      new import_obsidian3.Notice("No active markdown file");
      return;
    }
    const content = view.data;
    const file = view.file;
    try {
      await this.api.importNote({
        id: `obsidian:${file.path}`,
        title: file.name,
        content,
        source: "obsidian",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      new import_obsidian3.Notice("\u2713 Note exported to Cortex");
    } catch (error) {
      new import_obsidian3.Notice("\u2717 Export failed: " + error.message);
    }
  }
  async exportFile(file) {
    if (file instanceof import_obsidian3.TFolder) {
      new import_obsidian3.Notice("Folder export not yet supported");
      return;
    }
    const content = await this.app.vault.read(file);
    try {
      await this.api.importNote({
        id: `obsidian:${file.path}`,
        title: file.name,
        content,
        source: "obsidian",
        tags: [],
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      new import_obsidian3.Notice(`\u2713 Exported: ${file.name}`);
    } catch (error) {
      new import_obsidian3.Notice("\u2717 Export failed: " + error.message);
    }
  }
  startAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    this.syncInterval = setInterval(async () => {
      try {
        await this.syncVault();
      } catch (error) {
        console.error("Auto-sync failed:", error);
      }
    }, this.settings.syncInterval * 1e3);
  }
  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  prompt(title, placeholder) {
    return new Promise((resolve) => {
      const modal = new Modal(this.app, title, placeholder, resolve);
      modal.open();
    });
  }
};
var Modal = class extends import_obsidian3.Modal {
  constructor(app, title, placeholder, onSubmit) {
    super(app);
    this.setTitle(title);
    const inputEl = this.contentEl.appendChild(document.createElement("input"));
    inputEl.type = "text";
    inputEl.placeholder = placeholder || "";
    inputEl.style.width = "100%";
    inputEl.style.marginBottom = "10px";
    const buttonEl = this.contentEl.appendChild(document.createElement("button"));
    buttonEl.textContent = "Submit";
    buttonEl.onclick = () => {
      onSubmit(inputEl.value || null);
      this.close();
    };
    inputEl.focus();
  }
};
var CortexSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Cortex Settings" });
    new import_obsidian3.Setting(containerEl).setName("Cortex Path").setDesc("Path to the Cortex memory directory").addText((text) => text.setPlaceholder("~/.claude/memory").setValue(this.plugin.settings.cortexPath).onChange(async (value) => {
      this.plugin.settings.cortexPath = value;
      await this.plugin.saveSettings();
    }));
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2FwaS50cyIsICJzcmMvdmlldy50cyIsICJzcmMvc3VnZ2VzdC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgUGx1Z2luLCBQbHVnaW5TZXR0aW5nVGFiLCBBcHAsIFNldHRpbmcsIE5vdGljZSwgVEZpbGUsIFRGb2xkZXIsIFdvcmtzcGFjZUxlYWYsIEVkaXRvciwgTWFya2Rvd25WaWV3LCBhZGRJY29uLCBNb2RhbCBhcyBPTW9kYWwgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgeyBDb3J0ZXhBUEkgfSBmcm9tICcuL2FwaSc7XG5pbXBvcnQgeyBDb3J0ZXhWaWV3LCBDT1JURVhfVklFV19UWVBFIH0gZnJvbSAnLi92aWV3JztcbmltcG9ydCB7IENvcnRleFN1Z2dlc3QgfSBmcm9tICcuL3N1Z2dlc3QnO1xuXG5jb25zdCBDT1JURVhfSUNPTiA9IGA8c3ZnIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIyXCI+PHBhdGggZD1cIk0xMiAyTDIgN2wxMCA1IDEwLTUtMTAtNXpNMiAxN2wxMCA1IDEwLTVNMiAxMmwxMCA1IDEwLTVcIi8+PC9zdmc+YDtcblxuaW50ZXJmYWNlIENvcnRleFBsdWdpblNldHRpbmdzIHtcbiAgY29ydGV4UGF0aDogc3RyaW5nO1xuICB2YXVsdFBhdGg6IHN0cmluZztcbiAgYXV0b1N5bmM6IGJvb2xlYW47XG4gIHN5bmNJbnRlcnZhbDogbnVtYmVyO1xuICBzaG93R3JhcGhWaWV3OiBib29sZWFuO1xuICBlbmFibGVTdWdnZXN0aW9uczogYm9vbGVhbjtcbiAgbWF4UmVzdWx0czogbnVtYmVyO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBDb3J0ZXhQbHVnaW5TZXR0aW5ncyA9IHtcbiAgY29ydGV4UGF0aDogJ34vLmNsYXVkZS9tZW1vcnknLFxuICB2YXVsdFBhdGg6ICd+Ly5vYnNpZGlhbi12YXVsdCcsXG4gIGF1dG9TeW5jOiB0cnVlLFxuICBzeW5jSW50ZXJ2YWw6IDMwMCwgLy8gNSBtaW51dGVzXG4gIHNob3dHcmFwaFZpZXc6IHRydWUsXG4gIGVuYWJsZVN1Z2dlc3Rpb25zOiB0cnVlLFxuICBtYXhSZXN1bHRzOiAyMCxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIENvcnRleFBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBDb3J0ZXhQbHVnaW5TZXR0aW5ncztcbiAgYXBpOiBDb3J0ZXhBUEk7XG4gIGNvcnRleFZpZXc6IENvcnRleFZpZXcgfCBudWxsID0gbnVsbDtcbiAgc3luY0ludGVydmFsOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICBhZGRJY29uKCdjb3J0ZXgnLCBDT1JURVhfSUNPTik7XG4gICAgXG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFwaSA9IG5ldyBDb3J0ZXhBUEkodGhpcy5zZXR0aW5ncy5jb3J0ZXhQYXRoKTtcblxuICAgIC8vIFJlZ2lzdGVyIENvcnRleCBzaWRlYmFyIHZpZXdcbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhDT1JURVhfVklFV19UWVBFLCAobGVhZikgPT4ge1xuICAgICAgdGhpcy5jb3J0ZXhWaWV3ID0gbmV3IENvcnRleFZpZXcobGVhZiwgdGhpcyk7XG4gICAgICByZXR1cm4gdGhpcy5jb3J0ZXhWaWV3O1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIHJpYmJvbiBpY29uXG4gICAgdGhpcy5hZGRSaWJib25JY29uKCdjb3J0ZXgnLCAnT3BlbiBDb3J0ZXggTWVtb3J5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vcGVuQ29ydGV4VmlldygpO1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbW1hbmRzXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAnb3Blbi1jb3J0ZXgtdmlldycsXG4gICAgICBuYW1lOiAnT3BlbiBDb3J0ZXggTWVtb3J5IFZpZXcnLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMub3BlbkNvcnRleFZpZXcoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3NlYXJjaC1jb3J0ZXgtbWVtb3J5JyxcbiAgICAgIG5hbWU6ICdTZWFyY2ggQ29ydGV4IE1lbW9yeScsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zZWFyY2hNZW1vcnkoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3N5bmMtY29ydGV4LXZhdWx0JyxcbiAgICAgIG5hbWU6ICdTeW5jIENvcnRleCBWYXVsdCcsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5zeW5jVmF1bHQoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ2V4cG9ydC10by1jb3J0ZXgnLFxuICAgICAgbmFtZTogJ0V4cG9ydCBDdXJyZW50IE5vdGUgdG8gQ29ydGV4JyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmV4cG9ydEN1cnJlbnROb3RlKCksXG4gICAgfSk7XG5cbiAgICAvLyBSZWdpc3RlciBlZGl0b3Igc3VnZ2VzdCAoYXV0b2NvbXBsZXRlIGZvciBtZW1vcnkgcmVmZXJlbmNlcylcbiAgICBpZiAodGhpcy5zZXR0aW5ncy5lbmFibGVTdWdnZXN0aW9ucykge1xuICAgICAgdGhpcy5yZWdpc3RlckVkaXRvclN1Z2dlc3QobmV3IENvcnRleFN1Z2dlc3QodGhpcykpO1xuICAgIH1cblxuICAgIC8vIEFkZCBzZXR0aW5ncyB0YWJcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IENvcnRleFNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcblxuICAgIC8vIFN0YXJ0IGF1dG8tc3luYyBpZiBlbmFibGVkXG4gICAgaWYgKHRoaXMuc2V0dGluZ3MuYXV0b1N5bmMpIHtcbiAgICAgIHRoaXMuc3RhcnRBdXRvU3luYygpO1xuICAgIH1cblxuICAgIC8vIEFkZCBzdGF0dXMgYmFyIGl0ZW1cbiAgICBjb25zdCBzdGF0dXNFbCA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gJ1x1RDgzRVx1RERFMCBDb3J0ZXgnO1xuICAgIHN0YXR1c0VsLnRpdGxlID0gJ0NvcnRleCBNZW1vcnkgUGx1Z2luJztcblxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbignZmlsZS1tZW51JywgKG1lbnUsIGZpbGUpID0+IHtcbiAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiB7XG4gICAgICAgICAgaXRlbVxuICAgICAgICAgICAgLnNldFRpdGxlKCdFeHBvcnQgdG8gQ29ydGV4JylcbiAgICAgICAgICAgIC5zZXRJY29uKCdjb3J0ZXgnKVxuICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5leHBvcnRGaWxlKGZpbGUpKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICk7XG4gIH1cblxuICBhc3luYyBvcGVuQ29ydGV4VmlldygpIHtcbiAgICBjb25zdCBsZWF2ZXMgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKENPUlRFWF9WSUVXX1RZUEUpO1xuICAgIGlmIChsZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLnJldmVhbExlYWYobGVhdmVzWzBdKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0UmlnaHRMZWFmKGZhbHNlKS5zZXRWaWV3U3RhdGUoe1xuICAgICAgdHlwZTogQ09SVEVYX1ZJRVdfVFlQRSxcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShDT1JURVhfVklFV19UWVBFKVswXVxuICAgICk7XG4gIH1cblxuICBhc3luYyBzZWFyY2hNZW1vcnkoKSB7XG4gICAgY29uc3QgcXVlcnkgPSBhd2FpdCB0aGlzLnByb21wdCgnU2VhcmNoIENvcnRleCBNZW1vcnknLCAnRW50ZXIgc2VhcmNoIHF1ZXJ5Li4uJyk7XG4gICAgaWYgKCFxdWVyeSkgcmV0dXJuO1xuXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuYXBpLnNlYXJjaChxdWVyeSwgeyBsaW1pdDogdGhpcy5zZXR0aW5ncy5tYXhSZXN1bHRzIH0pO1xuICAgIFxuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbmV3IE5vdGljZSgnTm8gbWVtb3JpZXMgZm91bmQgZm9yOiAnICsgcXVlcnkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSByZXN1bHRzIGluIHRlbXBvcmFyeSBmaWxlXG4gICAgY29uc3QgY29udGVudCA9IGAjIENvcnRleCBNZW1vcnkgU2VhcmNoOiAke3F1ZXJ5fVxcblxcbiR7cmVzdWx0cy5tYXAoKHIsIGkpID0+IGAjIyAke2kgKyAxfS4gJHtyLnRpdGxlfVxcblxcbiR7ci5zdW1tYXJ5fVxcblxcblRhZ3M6ICR7ci50YWdzPy5qb2luKCcsICcpIHx8ICdub25lJ31cXG5cXG4tLS1gKS5qb2luKCdcXG4nKX1gO1xuICAgIFxuICAgIGNvbnN0IGZpbGUgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUoJ0NvcnRleC9TZWFyY2ggUmVzdWx0cy5tZCcsIGNvbnRlbnQpO1xuICAgIGF3YWl0IHRoaXMuYXBwLndvcmtzcGFjZS5vcGVuTGlua1RleHQoZmlsZS5wYXRoLCAnJyk7XG4gICAgXG4gICAgbmV3IE5vdGljZShgRm91bmQgJHtyZXN1bHRzLmxlbmd0aH0gbWVtb3JpZXNgKTtcbiAgfVxuXG4gIGFzeW5jIHN5bmNWYXVsdCgpIHtcbiAgICBuZXcgTm90aWNlKCdTeW5jaW5nIENvcnRleCB2YXVsdC4uLicpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwaS5leHBvcnRWYXVsdCh0aGlzLnNldHRpbmdzLnZhdWx0UGF0aCk7XG4gICAgICBuZXcgTm90aWNlKGBcdTI3MTMgVmF1bHQgc3luY2VkOiAke3Jlc3VsdC5yZWNvcmRDb3VudH0gcmVjb3Jkc2ApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBuZXcgTm90aWNlKCdcdTI3MTcgU3luYyBmYWlsZWQ6ICcgKyBlcnJvci5tZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBleHBvcnRDdXJyZW50Tm90ZSgpIHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ05vIGFjdGl2ZSBtYXJrZG93biBmaWxlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY29udGVudCA9IHZpZXcuZGF0YTtcbiAgICBjb25zdCBmaWxlID0gdmlldy5maWxlO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFwaS5pbXBvcnROb3RlKHtcbiAgICAgICAgaWQ6IGBvYnNpZGlhbjoke2ZpbGUucGF0aH1gLFxuICAgICAgICB0aXRsZTogZmlsZS5uYW1lLFxuICAgICAgICBjb250ZW50OiBjb250ZW50LFxuICAgICAgICBzb3VyY2U6ICdvYnNpZGlhbicsXG4gICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIG5ldyBOb3RpY2UoJ1x1MjcxMyBOb3RlIGV4cG9ydGVkIHRvIENvcnRleCcpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBuZXcgTm90aWNlKCdcdTI3MTcgRXhwb3J0IGZhaWxlZDogJyArIGVycm9yLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGV4cG9ydEZpbGUoZmlsZTogVEZpbGUgfCBURm9sZGVyKSB7XG4gICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURm9sZGVyKSB7XG4gICAgICBuZXcgTm90aWNlKCdGb2xkZXIgZXhwb3J0IG5vdCB5ZXQgc3VwcG9ydGVkJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYXBpLmltcG9ydE5vdGUoe1xuICAgICAgICBpZDogYG9ic2lkaWFuOiR7ZmlsZS5wYXRofWAsXG4gICAgICAgIHRpdGxlOiBmaWxlLm5hbWUsXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRlbnQsXG4gICAgICAgIHNvdXJjZTogJ29ic2lkaWFuJyxcbiAgICAgICAgdGFnczogW10sXG4gICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIG5ldyBOb3RpY2UoYFx1MjcxMyBFeHBvcnRlZDogJHtmaWxlLm5hbWV9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1x1MjcxNyBFeHBvcnQgZmFpbGVkOiAnICsgZXJyb3IubWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgc3RhcnRBdXRvU3luYygpIHtcbiAgICBpZiAodGhpcy5zeW5jSW50ZXJ2YWwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5zeW5jSW50ZXJ2YWwpO1xuICAgIH1cblxuICAgIHRoaXMuc3luY0ludGVydmFsID0gc2V0SW50ZXJ2YWwoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zeW5jVmF1bHQoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0F1dG8tc3luYyBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgfVxuICAgIH0sIHRoaXMuc2V0dGluZ3Muc3luY0ludGVydmFsICogMTAwMCk7XG4gIH1cblxuICBzdG9wQXV0b1N5bmMoKSB7XG4gICAgaWYgKHRoaXMuc3luY0ludGVydmFsKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMuc3luY0ludGVydmFsKTtcbiAgICAgIHRoaXMuc3luY0ludGVydmFsID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxuXG4gIHByaXZhdGUgcHJvbXB0KHRpdGxlOiBzdHJpbmcsIHBsYWNlaG9sZGVyPzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjb25zdCBtb2RhbCA9IG5ldyBNb2RhbCh0aGlzLmFwcCwgdGl0bGUsIHBsYWNlaG9sZGVyLCByZXNvbHZlKTtcbiAgICAgIG1vZGFsLm9wZW4oKTtcbiAgICB9KTtcbiAgfVxufVxuXG4vLyBTaW1wbGUgbW9kYWwgZm9yIHByb21wdHNcbmNsYXNzIE1vZGFsIGV4dGVuZHMgT01vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHRpdGxlOiBzdHJpbmcsIHBsYWNlaG9sZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsIG9uU3VibWl0OiAodmFsdWU6IHN0cmluZyB8IG51bGwpID0+IHZvaWQpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuc2V0VGl0bGUodGl0bGUpO1xuICAgIFxuICAgIGNvbnN0IGlucHV0RWwgPSB0aGlzLmNvbnRlbnRFbC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbnB1dCcpKTtcbiAgICBpbnB1dEVsLnR5cGUgPSAndGV4dCc7XG4gICAgaW5wdXRFbC5wbGFjZWhvbGRlciA9IHBsYWNlaG9sZGVyIHx8ICcnO1xuICAgIGlucHV0RWwuc3R5bGUud2lkdGggPSAnMTAwJSc7XG4gICAgaW5wdXRFbC5zdHlsZS5tYXJnaW5Cb3R0b20gPSAnMTBweCc7XG4gICAgXG4gICAgY29uc3QgYnV0dG9uRWwgPSB0aGlzLmNvbnRlbnRFbC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKSk7XG4gICAgYnV0dG9uRWwudGV4dENvbnRlbnQgPSAnU3VibWl0JztcbiAgICBidXR0b25FbC5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgb25TdWJtaXQoaW5wdXRFbC52YWx1ZSB8fCBudWxsKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9O1xuXG4gICAgaW5wdXRFbC5mb2N1cygpO1xuICB9XG59XG5cbmNsYXNzIENvcnRleFNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBDb3J0ZXhQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogQ29ydGV4UGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ2gyJywgeyB0ZXh0OiAnQ29ydGV4IFNldHRpbmdzJyB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0NvcnRleCBQYXRoJylcbiAgICAgIC5zZXREZXNjKCdQYXRoIHRvIHRoZSBDb3J0ZXggbWVtb3J5IGRpcmVjdG9yeScpXG4gICAgICAuYWRkVGV4dCh0ZXh0ID0+IHRleHRcbiAgICAgICAgLnNldFBsYWNlaG9sZGVyKCd+Ly5jbGF1ZGUvbWVtb3J5JylcbiAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvcnRleFBhdGgpXG4gICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb3J0ZXhQYXRoID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pKTtcbiAgfVxufSIsICIvKipcbiAqIENvcnRleCBBUEkgZm9yIE9ic2lkaWFuIFBsdWdpblxuICogQ29tbXVuaWNhdGVzIHdpdGggQ29ydGV4IE1DUCBzZXJ2ZXIgYW5kIG1lbW9yeSBzdG9yZXNcbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcblxuZXhwb3J0IGludGVyZmFjZSBNZW1vcnlSZWNvcmQge1xuICBpZDogc3RyaW5nO1xuICB0aXRsZTogc3RyaW5nO1xuICBjb250ZW50OiBzdHJpbmc7XG4gIHN1bW1hcnk/OiBzdHJpbmc7XG4gIHR5cGU/OiBzdHJpbmc7XG4gIHRhZ3M/OiBzdHJpbmdbXTtcbiAgc291cmNlPzogc3RyaW5nO1xuICBjcmVhdGVkQXQ6IHN0cmluZztcbiAgZXh0cmFjdGlvbkNvbmZpZGVuY2U/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VhcmNoUmVzdWx0IHtcbiAgaWQ6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbiAgc3VtbWFyeTogc3RyaW5nO1xuICB0YWdzPzogc3RyaW5nW107XG4gIGNvbmZpZGVuY2U6IG51bWJlcjtcbiAgc291cmNlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmF1bHRFeHBvcnRSZXN1bHQge1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBleHBvcnRSb290OiBzdHJpbmc7XG4gIHJlY29yZENvdW50OiBudW1iZXI7XG4gIGVudGl0eUNvdW50OiBudW1iZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBDb3J0ZXhBUEkge1xuICBwcml2YXRlIGNvcnRleFBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBtZW1vcnlQYXRoOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoY29ydGV4UGF0aDogc3RyaW5nKSB7XG4gICAgdGhpcy5jb3J0ZXhQYXRoID0gY29ydGV4UGF0aC5yZXBsYWNlKCd+JywgcHJvY2Vzcy5lbnYuSE9NRSB8fCAnJyk7XG4gICAgdGhpcy5tZW1vcnlQYXRoID0gcGF0aC5qb2luKHRoaXMuY29ydGV4UGF0aCwgJ2RhdGEvbWVtb3JpZXMnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWFyY2ggbWVtb3JpZXMgdXNpbmcgQ29ydGV4IGh5YnJpZCBzZWFyY2hcbiAgICovXG4gIGFzeW5jIHNlYXJjaChxdWVyeTogc3RyaW5nLCBvcHRpb25zOiB7IGxpbWl0PzogbnVtYmVyOyB0eXBlPzogc3RyaW5nIH0pOiBQcm9taXNlPFNlYXJjaFJlc3VsdFtdPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IGFyZ3MgPSBbXG4gICAgICAgIHBhdGguam9pbih0aGlzLmNvcnRleFBhdGgsICdiaW4vY29ydGV4LmNqcycpLFxuICAgICAgICAnc2VhcmNoJyxcbiAgICAgICAgJy0tcXVlcnknLFxuICAgICAgICBxdWVyeSxcbiAgICAgICAgJy0tanNvbicsXG4gICAgICBdO1xuXG4gICAgICBpZiAob3B0aW9ucy5saW1pdCkge1xuICAgICAgICBhcmdzLnB1c2goJy0tbGltaXQnLCBTdHJpbmcob3B0aW9ucy5saW1pdCkpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwcm9jID0gc3Bhd24oJ25vZGUnLCBhcmdzLCB7XG4gICAgICAgIHN0ZGlvOiBbJ3BpcGUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB9KTtcblxuICAgICAgbGV0IG91dHB1dCA9ICcnO1xuICAgICAgcHJvYy5zdGRvdXQub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICBvdXRwdXQgKz0gZGF0YS50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIHByb2Mub24oJ2Nsb3NlJywgKGNvZGUpID0+IHtcbiAgICAgICAgaWYgKGNvZGUgPT09IDApIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0cyA9IEpTT04ucGFyc2Uob3V0cHV0KTtcbiAgICAgICAgICAgIHJlc29sdmUocmVzdWx0cyk7XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICByZXNvbHZlKFtdKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignU2VhcmNoIGZhaWxlZCcpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIHByb2Mub24oJ2Vycm9yJywgcmVqZWN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbXBvcnQgYSBub3RlIGludG8gQ29ydGV4IG1lbW9yeVxuICAgKi9cbiAgYXN5bmMgaW1wb3J0Tm90ZShub3RlOiBNZW1vcnlSZWNvcmQpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IHdvcmtpbmdGaWxlID0gcGF0aC5qb2luKHRoaXMubWVtb3J5UGF0aCwgJ3dvcmtpbmcuanNvbmwnKTtcbiAgICAgIGNvbnN0IGxpbmUgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIC4uLm5vdGUsXG4gICAgICAgIGltcG9ydGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgX3NvdXJjZTogJ29ic2lkaWFuLXBsdWdpbicsXG4gICAgICB9KSArICdcXG4nO1xuXG4gICAgICBmcy5hcHBlbmRGaWxlKHdvcmtpbmdGaWxlLCBsaW5lLCAoZXJyKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHBvcnQgQ29ydGV4IG1lbW9yaWVzIHRvIE9ic2lkaWFuIHZhdWx0XG4gICAqL1xuICBhc3luYyBleHBvcnRWYXVsdCh2YXVsdFBhdGg6IHN0cmluZyk6IFByb21pc2U8VmF1bHRFeHBvcnRSZXN1bHQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgYXJncyA9IFtcbiAgICAgICAgcGF0aC5qb2luKHRoaXMuY29ydGV4UGF0aCwgJ2Jpbi9jb3J0ZXguY2pzJyksXG4gICAgICAgICdleHBvcnQtdmF1bHQnLFxuICAgICAgICAnLS12YXVsdC1wYXRoJyxcbiAgICAgICAgdmF1bHRQYXRoLnJlcGxhY2UoJ34nLCBwcm9jZXNzLmVudi5IT01FIHx8ICcnKSxcbiAgICAgICAgJy0tcm9vdC1mb2xkZXInLFxuICAgICAgICAnQ29ydGV4IEF0bGFzJyxcbiAgICAgICAgJy0tanNvbicsXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBwcm9jID0gc3Bhd24oJ25vZGUnLCBhcmdzLCB7XG4gICAgICAgIHN0ZGlvOiBbJ3BpcGUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB9KTtcblxuICAgICAgbGV0IG91dHB1dCA9ICcnO1xuICAgICAgcHJvYy5zdGRvdXQub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICBvdXRwdXQgKz0gZGF0YS50b1N0cmluZygpO1xuICAgICAgfSk7XG5cbiAgICAgIHByb2Mub24oJ2Nsb3NlJywgKGNvZGUpID0+IHtcbiAgICAgICAgaWYgKGNvZGUgPT09IDApIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gSlNPTi5wYXJzZShvdXRwdXQpO1xuICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgcmVzb2x2ZSh7XG4gICAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICAgIGV4cG9ydFJvb3Q6IHBhdGguam9pbih2YXVsdFBhdGgucmVwbGFjZSgnficsIHByb2Nlc3MuZW52LkhPTUUgfHwgJycpLCAnQ29ydGV4IEF0bGFzJyksXG4gICAgICAgICAgICAgIHJlY29yZENvdW50OiAwLFxuICAgICAgICAgICAgICBlbnRpdHlDb3VudDogMCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKCdFeHBvcnQgZmFpbGVkJykpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcHJvYy5vbignZXJyb3InLCByZWplY3QpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBtZW1vcnkgc3RhdGlzdGljc1xuICAgKi9cbiAgYXN5bmMgZ2V0U3RhdHMoKTogUHJvbWlzZTx7XG4gICAgdG90YWxSZWNvcmRzOiBudW1iZXI7XG4gICAgYnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAgIGJ5U291cmNlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAgIHZlY3RvckNvdW50OiBudW1iZXI7XG4gIH0+IHtcbiAgICBjb25zdCBzdGF0cyA9IHtcbiAgICAgIHRvdGFsUmVjb3JkczogMCxcbiAgICAgIGJ5VHlwZToge30sXG4gICAgICBieVNvdXJjZToge30sXG4gICAgICB2ZWN0b3JDb3VudDogMCxcbiAgICB9O1xuXG4gICAgLy8gQ291bnQgcmVjb3JkcyBpbiBlYWNoIG1lbW9yeSBmaWxlXG4gICAgY29uc3QgbWVtb3J5RmlsZXMgPSBbJ3dvcmtpbmcuanNvbmwnLCAnc2hvcnQtdGVybS5qc29ubCcsICdsb25nLXRlcm0uanNvbmwnLCAnaW5zaWdodHMuanNvbmwnLCAnbGVhcm5pbmdzLmpzb25sJ107XG4gICAgXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIG1lbW9yeUZpbGVzKSB7XG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbih0aGlzLm1lbW9yeVBhdGgsIGZpbGUpO1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IGxpbmVzID0gY29udGVudC50cmltKCkuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgc3RhdHMudG90YWxSZWNvcmRzICs9IGxpbmVzLmxlbmd0aDtcblxuICAgICAgICAvLyBQYXJzZSBsaW5lcyBmb3IgdHlwZS9zb3VyY2Ugc3RhdHNcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlY29yZCA9IEpTT04ucGFyc2UobGluZSk7XG4gICAgICAgICAgICBpZiAocmVjb3JkLnR5cGUpIHtcbiAgICAgICAgICAgICAgc3RhdHMuYnlUeXBlW3JlY29yZC50eXBlXSA9IChzdGF0cy5ieVR5cGVbcmVjb3JkLnR5cGVdIHx8IDApICsgMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZWNvcmQuX3NvdXJjZSkge1xuICAgICAgICAgICAgICBzdGF0cy5ieVNvdXJjZVtyZWNvcmQuX3NvdXJjZV0gPSAoc3RhdHMuYnlTb3VyY2VbcmVjb3JkLl9zb3VyY2VdIHx8IDApICsgMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFNraXAgaW52YWxpZCBsaW5lc1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENvdW50IHZlY3RvcnNcbiAgICBjb25zdCB2ZWN0b3JJbmRleCA9IHBhdGguam9pbih0aGlzLmNvcnRleFBhdGgsICdkYXRhL3ZlY3Rvci9pbmRleC5iaW4nKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyh2ZWN0b3JJbmRleCkpIHtcbiAgICAgIGNvbnN0IG1hcHBpbmdGaWxlID0gcGF0aC5qb2luKHRoaXMuY29ydGV4UGF0aCwgJ2RhdGEvdmVjdG9yL21hcHBpbmcuanNvbicpO1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMobWFwcGluZ0ZpbGUpKSB7XG4gICAgICAgIGNvbnN0IG1hcHBpbmcgPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyhtYXBwaW5nRmlsZSwgJ3V0ZjgnKSk7XG4gICAgICAgIHN0YXRzLnZlY3RvckNvdW50ID0gT2JqZWN0LmtleXMobWFwcGluZykubGVuZ3RoO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzdGF0cztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcmVjZW50IG1lbW9yaWVzXG4gICAqL1xuICBhc3luYyBnZXRSZWNlbnQobGltaXQ6IG51bWJlciA9IDEwKTogUHJvbWlzZTxNZW1vcnlSZWNvcmRbXT4ge1xuICAgIGNvbnN0IHdvcmtpbmdGaWxlID0gcGF0aC5qb2luKHRoaXMubWVtb3J5UGF0aCwgJ3dvcmtpbmcuanNvbmwnKTtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMod29ya2luZ0ZpbGUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyh3b3JraW5nRmlsZSwgJ3V0ZjgnKTtcbiAgICBjb25zdCBsaW5lcyA9IGNvbnRlbnQudHJpbSgpLnNwbGl0KCdcXG4nKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgXG4gICAgcmV0dXJuIGxpbmVzXG4gICAgICAuc2xpY2UoLWxpbWl0KVxuICAgICAgLm1hcCgobGluZSkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBKU09OLnBhcnNlKGxpbmUpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbikgYXMgTWVtb3J5UmVjb3JkW107XG4gIH1cblxuICAvKipcbiAgICogR2V0IGVudGl0aWVzIGZyb20ga25vd2xlZGdlIGdyYXBoXG4gICAqL1xuICBhc3luYyBnZXRFbnRpdGllcygpOiBQcm9taXNlPHsgbmFtZTogc3RyaW5nOyB0eXBlOiBzdHJpbmc7IGNvdW50OiBudW1iZXIgfVtdPiB7XG4gICAgY29uc3Qga2dGaWxlID0gcGF0aC5qb2luKHRoaXMuY29ydGV4UGF0aCwgJ2tub3dsZWRnZS1ncmFwaC5qc29ubCcpO1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhrZ0ZpbGUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhrZ0ZpbGUsICd1dGY4Jyk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGdyYXBoID0gSlNPTi5wYXJzZShjb250ZW50KTtcbiAgICAgIHJldHVybiBncmFwaC5lbnRpdGllcyB8fCBbXTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJpZ2dlciBDb3J0ZXggcmVmbGVjdGlvbiBvbiBhIHRvcGljXG4gICAqL1xuICBhc3luYyByZWZsZWN0KHRvcGljOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBhcmdzID0gW1xuICAgICAgICBwYXRoLmpvaW4odGhpcy5jb3J0ZXhQYXRoLCAnYmluL2NvcnRleC5janMnKSxcbiAgICAgICAgJ3JlZmxlY3QnLFxuICAgICAgICAnLS10b3BpYycsXG4gICAgICAgIHRvcGljLFxuICAgICAgICAnLS1qc29uJyxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IHByb2MgPSBzcGF3bignbm9kZScsIGFyZ3MsIHtcbiAgICAgICAgc3RkaW86IFsncGlwZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgIH0pO1xuXG4gICAgICBsZXQgb3V0cHV0ID0gJyc7XG4gICAgICBwcm9jLnN0ZG91dC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgIG91dHB1dCArPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgICB9KTtcblxuICAgICAgcHJvYy5vbignY2xvc2UnLCAoY29kZSkgPT4ge1xuICAgICAgICBpZiAoY29kZSA9PT0gMCkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG91dHB1dCk7XG4gICAgICAgICAgICByZXNvbHZlKHJlc3VsdC5zdW1tYXJ5IHx8IHJlc3VsdC5jb250ZW50IHx8ICcnKTtcbiAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgIHJlc29sdmUob3V0cHV0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignUmVmbGVjdGlvbiBmYWlsZWQnKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBwcm9jLm9uKCdlcnJvcicsIHJlamVjdCk7XG4gICAgfSk7XG4gIH1cbn0iLCAiLyoqXG4gKiBDb3J0ZXggU2lkZWJhciBWaWV3IGZvciBPYnNpZGlhblxuICogRGlzcGxheXMgbWVtb3J5IHNlYXJjaCwgcmVjZW50IG1lbW9yaWVzLCBhbmQgZ3JhcGggdmlld1xuICovXG5cbmltcG9ydCB7IEl0ZW1WaWV3LCBXb3Jrc3BhY2VMZWFmLCBzZXRJY29uLCBURmlsZSwgTWFya2Rvd25WaWV3IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IENvcnRleFBsdWdpbiBmcm9tICcuL21haW4nO1xuaW1wb3J0IHsgQ29ydGV4QVBJIH0gZnJvbSAnLi9hcGknO1xuXG5leHBvcnQgY29uc3QgQ09SVEVYX1ZJRVdfVFlQRSA9ICdjb3J0ZXgtdmlldyc7XG5cbmV4cG9ydCBjbGFzcyBDb3J0ZXhWaWV3IGV4dGVuZHMgSXRlbVZpZXcge1xuICBwcml2YXRlIHBsdWdpbjogQ29ydGV4UGx1Z2luO1xuICBwcml2YXRlIGFwaTogQ29ydGV4QVBJO1xuICBwcml2YXRlIHNlYXJjaEVsOiBIVE1MSW5wdXRFbGVtZW50O1xuICBwcml2YXRlIHJlc3VsdHNFbDogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgcmVjZW50RWw6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIHN0YXRzRWw6IEhUTUxFbGVtZW50O1xuXG4gIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYsIHBsdWdpbjogQ29ydGV4UGx1Z2luKSB7XG4gICAgc3VwZXIobGVhZik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcGkgPSBwbHVnaW4uYXBpO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gQ09SVEVYX1ZJRVdfVFlQRTtcbiAgfVxuXG4gIGdldERpc3BsYXlUZXh0KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuICdcdUQ4M0VcdURERTAgQ29ydGV4IE1lbW9yeSc7XG4gIH1cblxuICBnZXRJY29uKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuICdjb3J0ZXgnO1xuICB9XG5cbiAgYXN5bmMgb25PcGVuKCkge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY2hpbGRyZW5bMV07XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG5cbiAgICAvLyBIZWFkZXJcbiAgICBjb25zdCBoZWFkZXJFbCA9IGNvbnRhaW5lci5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgaGVhZGVyRWwuY2xhc3NOYW1lID0gJ2NvcnRleC1oZWFkZXInO1xuICAgIGhlYWRlckVsLmlubmVySFRNTCA9ICc8aDI+Q29ydGV4IE1lbW9yeTwvaDI+JztcblxuICAgIC8vIFNlYXJjaFxuICAgIGNvbnN0IHNlYXJjaENvbnRhaW5lciA9IGNvbnRhaW5lci5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgc2VhcmNoQ29udGFpbmVyLmNsYXNzTmFtZSA9ICdjb3J0ZXgtc2VhcmNoJztcbiAgICBcbiAgICB0aGlzLnNlYXJjaEVsID0gc2VhcmNoQ29udGFpbmVyLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lucHV0JykpO1xuICAgIHRoaXMuc2VhcmNoRWwudHlwZSA9ICd0ZXh0JztcbiAgICB0aGlzLnNlYXJjaEVsLnBsYWNlaG9sZGVyID0gJ1NlYXJjaCBtZW1vcmllcy4uLic7XG4gICAgdGhpcy5zZWFyY2hFbC5jbGFzc05hbWUgPSAnY29ydGV4LXNlYXJjaC1pbnB1dCc7XG4gICAgXG4gICAgdGhpcy5zZWFyY2hFbC5hZGRFdmVudExpc3RlbmVyKCdpbnB1dCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0aGlzLnNlYXJjaEVsLnZhbHVlLmxlbmd0aCA+IDIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZWFyY2godGhpcy5zZWFyY2hFbC52YWx1ZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTdGF0c1xuICAgIHRoaXMuc3RhdHNFbCA9IGNvbnRhaW5lci5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgdGhpcy5zdGF0c0VsLmNsYXNzTmFtZSA9ICdjb3J0ZXgtc3RhdHMnO1xuICAgIGF3YWl0IHRoaXMudXBkYXRlU3RhdHMoKTtcblxuICAgIC8vIFJlY2VudCBtZW1vcmllc1xuICAgIGNvbnN0IHJlY2VudEhlYWRlciA9IGNvbnRhaW5lci5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgcmVjZW50SGVhZGVyLmNsYXNzTmFtZSA9ICdjb3J0ZXgtc2VjdGlvbi1oZWFkZXInO1xuICAgIHJlY2VudEhlYWRlci50ZXh0Q29udGVudCA9ICdSZWNlbnQgTWVtb3JpZXMnO1xuXG4gICAgdGhpcy5yZWNlbnRFbCA9IGNvbnRhaW5lci5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgdGhpcy5yZWNlbnRFbC5jbGFzc05hbWUgPSAnY29ydGV4LXJlY2VudCc7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVSZWNlbnQoKTtcblxuICAgIC8vIEFjdGlvbnNcbiAgICBjb25zdCBhY3Rpb25zRWwgPSBjb250YWluZXIuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JykpO1xuICAgIGFjdGlvbnNFbC5jbGFzc05hbWUgPSAnY29ydGV4LWFjdGlvbnMnO1xuXG4gICAgY29uc3Qgc3luY0J0biA9IGFjdGlvbnNFbC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKSk7XG4gICAgc3luY0J0bi50ZXh0Q29udGVudCA9ICdTeW5jIFZhdWx0JztcbiAgICBzeW5jQnRuLm9uY2xpY2sgPSAoKSA9PiB0aGlzLnBsdWdpbi5zeW5jVmF1bHQoKTtcblxuICAgIGNvbnN0IGV4cG9ydEJ0biA9IGFjdGlvbnNFbC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKSk7XG4gICAgZXhwb3J0QnRuLnRleHRDb250ZW50ID0gJ0V4cG9ydCBDdXJyZW50JztcbiAgICBleHBvcnRCdG4ub25jbGljayA9ICgpID0+IHRoaXMucGx1Z2luLmV4cG9ydEN1cnJlbnROb3RlKCk7XG5cbiAgICBjb25zdCBncmFwaEJ0biA9IGFjdGlvbnNFbC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKSk7XG4gICAgZ3JhcGhCdG4udGV4dENvbnRlbnQgPSAnT3BlbiBHcmFwaCc7XG4gICAgZ3JhcGhCdG4ub25jbGljayA9ICgpID0+IHRoaXMub3BlbkdyYXBoVmlldygpO1xuICB9XG5cbiAgYXN5bmMgb25DbG9zZSgpIHtcbiAgICAvLyBDbGVhbnVwXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlYXJjaChxdWVyeTogc3RyaW5nKSB7XG4gICAgdGhpcy5yZXN1bHRzRWw/LmVtcHR5KCk7XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmFwaS5zZWFyY2gocXVlcnksIHsgbGltaXQ6IDEwIH0pO1xuICAgICAgXG4gICAgICBpZiAoIXRoaXMucmVzdWx0c0VsKSB7XG4gICAgICAgIHRoaXMucmVzdWx0c0VsID0gdGhpcy5jb250YWluZXJFbC5jaGlsZHJlblsxXS5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgICAgIHRoaXMucmVzdWx0c0VsLmNsYXNzTmFtZSA9ICdjb3J0ZXgtcmVzdWx0cyc7XG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVzdWx0c0VsLmVtcHR5KCk7XG5cbiAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aGlzLnJlc3VsdHNFbC50ZXh0Q29udGVudCA9ICdObyByZXN1bHRzIGZvdW5kJztcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICByZXN1bHRzLmZvckVhY2goKHJlc3VsdCkgPT4ge1xuICAgICAgICBjb25zdCBpdGVtID0gdGhpcy5yZXN1bHRzRWwuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JykpO1xuICAgICAgICBpdGVtLmNsYXNzTmFtZSA9ICdjb3J0ZXgtcmVzdWx0LWl0ZW0nO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgdGl0bGUgPSBpdGVtLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpKTtcbiAgICAgICAgdGl0bGUuY2xhc3NOYW1lID0gJ2NvcnRleC1yZXN1bHQtdGl0bGUnO1xuICAgICAgICB0aXRsZS50ZXh0Q29udGVudCA9IHJlc3VsdC50aXRsZTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHN1bW1hcnkgPSBpdGVtLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpKTtcbiAgICAgICAgc3VtbWFyeS5jbGFzc05hbWUgPSAnY29ydGV4LXJlc3VsdC1zdW1tYXJ5JztcbiAgICAgICAgc3VtbWFyeS50ZXh0Q29udGVudCA9IHJlc3VsdC5zdW1tYXJ5LnNsaWNlKDAsIDEwMCkgKyAnLi4uJztcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHRhZ3MgPSBpdGVtLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpKTtcbiAgICAgICAgdGFncy5jbGFzc05hbWUgPSAnY29ydGV4LXJlc3VsdC10YWdzJztcbiAgICAgICAgdGFncy50ZXh0Q29udGVudCA9IHJlc3VsdC50YWdzPy5qb2luKCcsICcpIHx8ICcnO1xuICAgICAgICBcbiAgICAgICAgaXRlbS5vbmNsaWNrID0gKCkgPT4ge1xuICAgICAgICAgIC8vIE9wZW4gb3IgY3JlYXRlIG5vdGUgd2l0aCBtZW1vcnkgY29udGVudFxuICAgICAgICAgIHRoaXMub3Blbk1lbW9yeShyZXN1bHQpO1xuICAgICAgICB9O1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1NlYXJjaCBmYWlsZWQ6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlU3RhdHMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgdGhpcy5hcGkuZ2V0U3RhdHMoKTtcbiAgICAgIHRoaXMuc3RhdHNFbC5pbm5lckhUTUwgPSBgXG4gICAgICAgIDxkaXYgY2xhc3M9XCJjb3J0ZXgtc3RhdFwiPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwiY29ydGV4LXN0YXQtdmFsdWVcIj4ke3N0YXRzLnRvdGFsUmVjb3Jkc308L3NwYW4+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJjb3J0ZXgtc3RhdC1sYWJlbFwiPlRvdGFsIE1lbW9yaWVzPC9zcGFuPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImNvcnRleC1zdGF0XCI+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJjb3J0ZXgtc3RhdC12YWx1ZVwiPiR7c3RhdHMudmVjdG9yQ291bnR9PC9zcGFuPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwiY29ydGV4LXN0YXQtbGFiZWxcIj5WZWN0b3JzIEluZGV4ZWQ8L3NwYW4+XG4gICAgICAgIDwvZGl2PlxuICAgICAgYDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignU3RhdHMgZmFpbGVkOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHVwZGF0ZVJlY2VudCgpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVjZW50ID0gYXdhaXQgdGhpcy5hcGkuZ2V0UmVjZW50KDUpO1xuICAgICAgXG4gICAgICB0aGlzLnJlY2VudEVsLmVtcHR5KCk7XG4gICAgICBcbiAgICAgIHJlY2VudC5mb3JFYWNoKChyZWNvcmQpID0+IHtcbiAgICAgICAgY29uc3QgaXRlbSA9IHRoaXMucmVjZW50RWwuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JykpO1xuICAgICAgICBpdGVtLmNsYXNzTmFtZSA9ICdjb3J0ZXgtcmVjZW50LWl0ZW0nO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgdGl0bGUgPSBpdGVtLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpKTtcbiAgICAgICAgdGl0bGUuY2xhc3NOYW1lID0gJ2NvcnRleC1yZWNlbnQtdGl0bGUnO1xuICAgICAgICB0aXRsZS50ZXh0Q29udGVudCA9IHJlY29yZC50aXRsZSB8fCByZWNvcmQuaWQuc2xpY2UoMCwgMzApO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZGF0ZSA9IGl0ZW0uYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JykpO1xuICAgICAgICBkYXRlLmNsYXNzTmFtZSA9ICdjb3J0ZXgtcmVjZW50LWRhdGUnO1xuICAgICAgICBkYXRlLnRleHRDb250ZW50ID0gbmV3IERhdGUocmVjb3JkLmNyZWF0ZWRBdCkudG9Mb2NhbGVEYXRlU3RyaW5nKCk7XG4gICAgICAgIFxuICAgICAgICBpdGVtLm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5NZW1vcnkocmVjb3JkKTtcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdSZWNlbnQgZmFpbGVkOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG9wZW5HcmFwaFZpZXcoKSB7XG4gICAgLy8gT3BlbiBDb3J0ZXggQXRsYXMgdmF1bHQgaW4gT2JzaWRpYW5cbiAgICBjb25zdCB2YXVsdFBhdGggPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy52YXVsdFBhdGgucmVwbGFjZSgnficsIHByb2Nlc3MuZW52LkhPTUUgfHwgJycpO1xuICAgIGNvbnN0IGF0bGFzUGF0aCA9IHBhdGguam9pbih2YXVsdFBhdGgsICdDb3J0ZXggQXRsYXMnLCAnMDAgSG9tZS5tZCcpO1xuICAgIFxuICAgIGlmIChmcy5leGlzdHNTeW5jKGF0bGFzUGF0aCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLndvcmtzcGFjZS5vcGVuTGlua1RleHQoYXRsYXNQYXRoLCAnJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ldyBOb3RpY2UoJ0NvcnRleCBBdGxhcyBub3QgZm91bmQuIFJ1biBzeW5jIGZpcnN0LicpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb3Blbk1lbW9yeShyZWNvcmQ6IGFueSkge1xuICAgIC8vIENyZWF0ZSBvciBvcGVuIG5vdGUgZm9yIHRoaXMgbWVtb3J5XG4gICAgY29uc3QgY29udGVudCA9IGAjICR7cmVjb3JkLnRpdGxlfVxcblxcbiR7cmVjb3JkLnN1bW1hcnl9XFxuXFxuVGFnczogJHtyZWNvcmQudGFncz8uam9pbignLCAnKSB8fCAnbm9uZSd9XFxuXFxuU291cmNlOiAke3JlY29yZC5zb3VyY2V9XFxuXFxuQ29uZmlkZW5jZTogJHtyZWNvcmQuZXh0cmFjdGlvbkNvbmZpZGVuY2V9XFxuXFxuLS0tXFxuXFxuJHtyZWNvcmQuY29udGVudH1gO1xuICAgIFxuICAgIGNvbnN0IHBhdGggPSBgQ29ydGV4L01lbW9yaWVzLyR7cmVjb3JkLmlkLnNsaWNlKDAsIDIwKX0ubWRgO1xuICAgIHRoaXMuYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBjb250ZW50KS50aGVuKChmaWxlKSA9PiB7XG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub3BlbkxpbmtUZXh0KGZpbGUucGF0aCwgJycpO1xuICAgIH0pO1xuICB9XG59IiwgIi8qKlxuICogQ29ydGV4IEVkaXRvciBTdWdnZXN0XG4gKiBQcm92aWRlcyBhdXRvY29tcGxldGUgZm9yIG1lbW9yeSByZWZlcmVuY2VzIGluIGVkaXRvclxuICovXG5cbmltcG9ydCB7IEVkaXRvclN1Z2dlc3QsIEVkaXRvclN1Z2dlc3RUcmlnZ2VyLCBFZGl0b3JTdWdnZXN0Q29udGV4dCwgRWRpdG9yLCBURmlsZSB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCBDb3J0ZXhQbHVnaW4gZnJvbSAnLi9tYWluJztcblxuZXhwb3J0IGNsYXNzIENvcnRleFN1Z2dlc3QgZXh0ZW5kcyBFZGl0b3JTdWdnZXN0PGFueT4ge1xuICBwcml2YXRlIHBsdWdpbjogQ29ydGV4UGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKHBsdWdpbjogQ29ydGV4UGx1Z2luKSB7XG4gICAgc3VwZXIocGx1Z2luLmFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvblRyaWdnZXIoZWRpdG9yOiBFZGl0b3IpOiBFZGl0b3JTdWdnZXN0VHJpZ2dlciB8IG51bGwge1xuICAgIGNvbnN0IGN1cnNvciA9IGVkaXRvci5nZXRDdXJzb3IoKTtcbiAgICBjb25zdCBsaW5lID0gZWRpdG9yLmdldExpbmUoY3Vyc29yLmxpbmUpO1xuICAgIFxuICAgIC8vIFRyaWdnZXIgb24gW1tjb3J0ZXg6XG4gICAgaWYgKGxpbmUuaW5jbHVkZXMoJ1tbY29ydGV4OicpKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBxdWVyeTogbGluZS5zcGxpdCgnW1tjb3J0ZXg6JylbMV0gfHwgJycsXG4gICAgICAgIHN0YXJ0OiB7IGxpbmU6IGN1cnNvci5saW5lLCBjaDogbGluZS5pbmRleE9mKCdbW2NvcnRleDonKSB9LFxuICAgICAgICBlbmQ6IGN1cnNvcixcbiAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIFRyaWdnZXIgb24gQGNvcnRleFxuICAgIGlmIChsaW5lLmluY2x1ZGVzKCdAY29ydGV4JykpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHF1ZXJ5OiBsaW5lLnNwbGl0KCdAY29ydGV4JylbMV0gfHwgJycsXG4gICAgICAgIHN0YXJ0OiB7IGxpbmU6IGN1cnNvci5saW5lLCBjaDogbGluZS5pbmRleE9mKCdAY29ydGV4JykgfSxcbiAgICAgICAgZW5kOiBjdXJzb3IsXG4gICAgICB9O1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIGdldFN1Z2dlc3Rpb25zKGNvbnRleHQ6IEVkaXRvclN1Z2dlc3RDb250ZXh0KTogUHJvbWlzZTxhbnlbXT4ge1xuICAgIGNvbnN0IHF1ZXJ5ID0gY29udGV4dC5xdWVyeS50b0xvd2VyQ2FzZSgpO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICBjb25zdCBtZW1vcmllcyA9IGF3YWl0IHRoaXMucGx1Z2luLmFwaS5nZXRSZWNlbnQoMjApO1xuICAgICAgXG4gICAgICByZXR1cm4gbWVtb3JpZXNcbiAgICAgICAgLmZpbHRlcihtID0+ICFxdWVyeSB8fCBtLnRpdGxlPy50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHF1ZXJ5KSB8fCBtLmNvbnRlbnQ/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpKVxuICAgICAgICAubWFwKG0gPT4gKHtcbiAgICAgICAgICB0aXRsZTogbS50aXRsZSxcbiAgICAgICAgICBpZDogbS5pZCxcbiAgICAgICAgICBjb250ZW50OiBtLmNvbnRlbnQsXG4gICAgICAgICAgc3VtbWFyeTogbS5zdW1tYXJ5LFxuICAgICAgICB9KSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbih2YWx1ZTogYW55LCBlbDogSFRNTEVsZW1lbnQpIHtcbiAgICBlbC5hZGRDbGFzcygnY29ydGV4LXN1Z2dlc3QtaXRlbScpO1xuICAgIFxuICAgIGNvbnN0IHRpdGxlRWwgPSBlbC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgdGl0bGVFbC5jbGFzc05hbWUgPSAnY29ydGV4LXN1Z2dlc3QtdGl0bGUnO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSB2YWx1ZS50aXRsZTtcbiAgICBcbiAgICBjb25zdCBzdW1tYXJ5RWwgPSBlbC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKSk7XG4gICAgc3VtbWFyeUVsLmNsYXNzTmFtZSA9ICdjb3J0ZXgtc3VnZ2VzdC1zdW1tYXJ5JztcbiAgICBzdW1tYXJ5RWwudGV4dENvbnRlbnQgPSB2YWx1ZS5zdW1tYXJ5Py5zbGljZSgwLCA1MCkgfHwgJ05vIHN1bW1hcnknO1xuICB9XG5cbiAgYXN5bmMgb25TdWdnZXN0KHZhbHVlOiBhbnksIGVkaXRvcjogRWRpdG9yLCBjb250ZXh0OiBFZGl0b3JTdWdnZXN0Q29udGV4dCkge1xuICAgIC8vIFJlcGxhY2UgdHJpZ2dlciB3aXRoIG1lbW9yeSByZWZlcmVuY2VcbiAgICBjb25zdCByZXBsYWNlbWVudCA9IGBbW0NvcnRleC9NZW1vcmllcy8ke3ZhbHVlLmlkLnNsaWNlKDAsIDIwKX18JHt2YWx1ZS50aXRsZX1dXWA7XG4gICAgXG4gICAgZWRpdG9yLnJlcGxhY2VSYW5nZShyZXBsYWNlbWVudCwgY29udGV4dC5zdGFydCwgY29udGV4dC5lbmQpO1xuICB9XG59Il0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQUE4STs7O0FDSzlJLElBQUFDLE1BQW9CO0FBQ3BCLElBQUFDLFFBQXNCO0FBQ3RCLDJCQUFzQjtBQThCZixJQUFNLFlBQU4sTUFBZ0I7QUFBQSxFQUlyQixZQUFZLFlBQW9CO0FBQzlCLFNBQUssYUFBYSxXQUFXLFFBQVEsS0FBSyxRQUFRLElBQUksUUFBUSxFQUFFO0FBQ2hFLFNBQUssYUFBa0IsV0FBSyxLQUFLLFlBQVksZUFBZTtBQUFBLEVBQzlEO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLQSxNQUFNLE9BQU8sT0FBZSxTQUFxRTtBQUMvRixXQUFPLElBQUksUUFBUSxDQUFDLFNBQVMsV0FBVztBQUN0QyxZQUFNLE9BQU87QUFBQSxRQUNOLFdBQUssS0FBSyxZQUFZLGdCQUFnQjtBQUFBLFFBQzNDO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUVBLFVBQUksUUFBUSxPQUFPO0FBQ2pCLGFBQUssS0FBSyxXQUFXLE9BQU8sUUFBUSxLQUFLLENBQUM7QUFBQSxNQUM1QztBQUVBLFlBQU0sV0FBTyw0QkFBTSxRQUFRLE1BQU07QUFBQSxRQUMvQixPQUFPLENBQUMsUUFBUSxRQUFRLE1BQU07QUFBQSxNQUNoQyxDQUFDO0FBRUQsVUFBSSxTQUFTO0FBQ2IsV0FBSyxPQUFPLEdBQUcsUUFBUSxDQUFDLFNBQVM7QUFDL0Isa0JBQVUsS0FBSyxTQUFTO0FBQUEsTUFDMUIsQ0FBQztBQUVELFdBQUssR0FBRyxTQUFTLENBQUMsU0FBUztBQUN6QixZQUFJLFNBQVMsR0FBRztBQUNkLGNBQUk7QUFDRixrQkFBTSxVQUFVLEtBQUssTUFBTSxNQUFNO0FBQ2pDLG9CQUFRLE9BQU87QUFBQSxVQUNqQixTQUFRO0FBQ04sb0JBQVEsQ0FBQyxDQUFDO0FBQUEsVUFDWjtBQUFBLFFBQ0YsT0FBTztBQUNMLGlCQUFPLElBQUksTUFBTSxlQUFlLENBQUM7QUFBQSxRQUNuQztBQUFBLE1BQ0YsQ0FBQztBQUVELFdBQUssR0FBRyxTQUFTLE1BQU07QUFBQSxJQUN6QixDQUFDO0FBQUEsRUFDSDtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBS0EsTUFBTSxXQUFXLE1BQXNDO0FBQ3JELFdBQU8sSUFBSSxRQUFRLENBQUMsWUFBWTtBQUM5QixZQUFNLGNBQW1CLFdBQUssS0FBSyxZQUFZLGVBQWU7QUFDOUQsWUFBTSxPQUFPLEtBQUssVUFBVTtBQUFBLFFBQzFCLEdBQUc7QUFBQSxRQUNILGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxRQUNuQyxTQUFTO0FBQUEsTUFDWCxDQUFDLElBQUk7QUFFTCxNQUFHLGVBQVcsYUFBYSxNQUFNLENBQUMsUUFBUTtBQUN4QyxZQUFJLEtBQUs7QUFDUCxrQkFBUSxLQUFLO0FBQUEsUUFDZixPQUFPO0FBQ0wsa0JBQVEsSUFBSTtBQUFBLFFBQ2Q7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNIO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLQSxNQUFNLFlBQVksV0FBK0M7QUFDL0QsV0FBTyxJQUFJLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFDdEMsWUFBTSxPQUFPO0FBQUEsUUFDTixXQUFLLEtBQUssWUFBWSxnQkFBZ0I7QUFBQSxRQUMzQztBQUFBLFFBQ0E7QUFBQSxRQUNBLFVBQVUsUUFBUSxLQUFLLFFBQVEsSUFBSSxRQUFRLEVBQUU7QUFBQSxRQUM3QztBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUVBLFlBQU0sV0FBTyw0QkFBTSxRQUFRLE1BQU07QUFBQSxRQUMvQixPQUFPLENBQUMsUUFBUSxRQUFRLE1BQU07QUFBQSxNQUNoQyxDQUFDO0FBRUQsVUFBSSxTQUFTO0FBQ2IsV0FBSyxPQUFPLEdBQUcsUUFBUSxDQUFDLFNBQVM7QUFDL0Isa0JBQVUsS0FBSyxTQUFTO0FBQUEsTUFDMUIsQ0FBQztBQUVELFdBQUssR0FBRyxTQUFTLENBQUMsU0FBUztBQUN6QixZQUFJLFNBQVMsR0FBRztBQUNkLGNBQUk7QUFDRixrQkFBTSxTQUFTLEtBQUssTUFBTSxNQUFNO0FBQ2hDLG9CQUFRLE1BQU07QUFBQSxVQUNoQixTQUFRO0FBQ04sb0JBQVE7QUFBQSxjQUNOLFNBQVM7QUFBQSxjQUNULFlBQWlCLFdBQUssVUFBVSxRQUFRLEtBQUssUUFBUSxJQUFJLFFBQVEsRUFBRSxHQUFHLGNBQWM7QUFBQSxjQUNwRixhQUFhO0FBQUEsY0FDYixhQUFhO0FBQUEsWUFDZixDQUFDO0FBQUEsVUFDSDtBQUFBLFFBQ0YsT0FBTztBQUNMLGlCQUFPLElBQUksTUFBTSxlQUFlLENBQUM7QUFBQSxRQUNuQztBQUFBLE1BQ0YsQ0FBQztBQUVELFdBQUssR0FBRyxTQUFTLE1BQU07QUFBQSxJQUN6QixDQUFDO0FBQUEsRUFDSDtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBS0EsTUFBTSxXQUtIO0FBQ0QsVUFBTSxRQUFRO0FBQUEsTUFDWixjQUFjO0FBQUEsTUFDZCxRQUFRLENBQUM7QUFBQSxNQUNULFVBQVUsQ0FBQztBQUFBLE1BQ1gsYUFBYTtBQUFBLElBQ2Y7QUFHQSxVQUFNLGNBQWMsQ0FBQyxpQkFBaUIsb0JBQW9CLG1CQUFtQixrQkFBa0IsaUJBQWlCO0FBRWhILGVBQVcsUUFBUSxhQUFhO0FBQzlCLFlBQU0sV0FBZ0IsV0FBSyxLQUFLLFlBQVksSUFBSTtBQUNoRCxVQUFPLGVBQVcsUUFBUSxHQUFHO0FBQzNCLGNBQU0sVUFBYSxpQkFBYSxVQUFVLE1BQU07QUFDaEQsY0FBTSxRQUFRLFFBQVEsS0FBSyxFQUFFLE1BQU0sSUFBSSxFQUFFLE9BQU8sT0FBTztBQUN2RCxjQUFNLGdCQUFnQixNQUFNO0FBRzVCLG1CQUFXLFFBQVEsT0FBTztBQUN4QixjQUFJO0FBQ0Ysa0JBQU0sU0FBUyxLQUFLLE1BQU0sSUFBSTtBQUM5QixnQkFBSSxPQUFPLE1BQU07QUFDZixvQkFBTSxPQUFPLE9BQU8sSUFBSSxLQUFLLE1BQU0sT0FBTyxPQUFPLElBQUksS0FBSyxLQUFLO0FBQUEsWUFDakU7QUFDQSxnQkFBSSxPQUFPLFNBQVM7QUFDbEIsb0JBQU0sU0FBUyxPQUFPLE9BQU8sS0FBSyxNQUFNLFNBQVMsT0FBTyxPQUFPLEtBQUssS0FBSztBQUFBLFlBQzNFO0FBQUEsVUFDRixTQUFRO0FBQUEsVUFFUjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUdBLFVBQU0sY0FBbUIsV0FBSyxLQUFLLFlBQVksdUJBQXVCO0FBQ3RFLFFBQU8sZUFBVyxXQUFXLEdBQUc7QUFDOUIsWUFBTSxjQUFtQixXQUFLLEtBQUssWUFBWSwwQkFBMEI7QUFDekUsVUFBTyxlQUFXLFdBQVcsR0FBRztBQUM5QixjQUFNLFVBQVUsS0FBSyxNQUFTLGlCQUFhLGFBQWEsTUFBTSxDQUFDO0FBQy9ELGNBQU0sY0FBYyxPQUFPLEtBQUssT0FBTyxFQUFFO0FBQUEsTUFDM0M7QUFBQSxJQUNGO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtBLE1BQU0sVUFBVSxRQUFnQixJQUE2QjtBQUMzRCxVQUFNLGNBQW1CLFdBQUssS0FBSyxZQUFZLGVBQWU7QUFDOUQsUUFBSSxDQUFJLGVBQVcsV0FBVyxHQUFHO0FBQy9CLGFBQU8sQ0FBQztBQUFBLElBQ1Y7QUFFQSxVQUFNLFVBQWEsaUJBQWEsYUFBYSxNQUFNO0FBQ25ELFVBQU0sUUFBUSxRQUFRLEtBQUssRUFBRSxNQUFNLElBQUksRUFBRSxPQUFPLE9BQU87QUFFdkQsV0FBTyxNQUNKLE1BQU0sQ0FBQyxLQUFLLEVBQ1osSUFBSSxDQUFDLFNBQVM7QUFDYixVQUFJO0FBQ0YsZUFBTyxLQUFLLE1BQU0sSUFBSTtBQUFBLE1BQ3hCLFNBQVE7QUFDTixlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsQ0FBQyxFQUNBLE9BQU8sT0FBTztBQUFBLEVBQ25CO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLQSxNQUFNLGNBQXdFO0FBQzVFLFVBQU0sU0FBYyxXQUFLLEtBQUssWUFBWSx1QkFBdUI7QUFDakUsUUFBSSxDQUFJLGVBQVcsTUFBTSxHQUFHO0FBQzFCLGFBQU8sQ0FBQztBQUFBLElBQ1Y7QUFFQSxVQUFNLFVBQWEsaUJBQWEsUUFBUSxNQUFNO0FBQzlDLFFBQUk7QUFDRixZQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU87QUFDaEMsYUFBTyxNQUFNLFlBQVksQ0FBQztBQUFBLElBQzVCLFNBQVE7QUFDTixhQUFPLENBQUM7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBS0EsTUFBTSxRQUFRLE9BQWdDO0FBQzVDLFdBQU8sSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQ3RDLFlBQU0sT0FBTztBQUFBLFFBQ04sV0FBSyxLQUFLLFlBQVksZ0JBQWdCO0FBQUEsUUFDM0M7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBRUEsWUFBTSxXQUFPLDRCQUFNLFFBQVEsTUFBTTtBQUFBLFFBQy9CLE9BQU8sQ0FBQyxRQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ2hDLENBQUM7QUFFRCxVQUFJLFNBQVM7QUFDYixXQUFLLE9BQU8sR0FBRyxRQUFRLENBQUMsU0FBUztBQUMvQixrQkFBVSxLQUFLLFNBQVM7QUFBQSxNQUMxQixDQUFDO0FBRUQsV0FBSyxHQUFHLFNBQVMsQ0FBQyxTQUFTO0FBQ3pCLFlBQUksU0FBUyxHQUFHO0FBQ2QsY0FBSTtBQUNGLGtCQUFNLFNBQVMsS0FBSyxNQUFNLE1BQU07QUFDaEMsb0JBQVEsT0FBTyxXQUFXLE9BQU8sV0FBVyxFQUFFO0FBQUEsVUFDaEQsU0FBUTtBQUNOLG9CQUFRLE1BQU07QUFBQSxVQUNoQjtBQUFBLFFBQ0YsT0FBTztBQUNMLGlCQUFPLElBQUksTUFBTSxtQkFBbUIsQ0FBQztBQUFBLFFBQ3ZDO0FBQUEsTUFDRixDQUFDO0FBRUQsV0FBSyxHQUFHLFNBQVMsTUFBTTtBQUFBLElBQ3pCLENBQUM7QUFBQSxFQUNIO0FBQ0Y7OztBQ2hTQSxzQkFBc0U7QUFJL0QsSUFBTSxtQkFBbUI7QUFFekIsSUFBTSxhQUFOLGNBQXlCLHlCQUFTO0FBQUEsRUFRdkMsWUFBWSxNQUFxQixRQUFzQjtBQUNyRCxVQUFNLElBQUk7QUFDVixTQUFLLFNBQVM7QUFDZCxTQUFLLE1BQU0sT0FBTztBQUFBLEVBQ3BCO0FBQUEsRUFFQSxjQUFzQjtBQUNwQixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsaUJBQXlCO0FBQ3ZCLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxVQUFrQjtBQUNoQixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsTUFBTSxTQUFTO0FBQ2IsVUFBTSxZQUFZLEtBQUssWUFBWSxTQUFTLENBQUM7QUFDN0MsY0FBVSxNQUFNO0FBR2hCLFVBQU0sV0FBVyxVQUFVLFlBQVksU0FBUyxjQUFjLEtBQUssQ0FBQztBQUNwRSxhQUFTLFlBQVk7QUFDckIsYUFBUyxZQUFZO0FBR3JCLFVBQU0sa0JBQWtCLFVBQVUsWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQzNFLG9CQUFnQixZQUFZO0FBRTVCLFNBQUssV0FBVyxnQkFBZ0IsWUFBWSxTQUFTLGNBQWMsT0FBTyxDQUFDO0FBQzNFLFNBQUssU0FBUyxPQUFPO0FBQ3JCLFNBQUssU0FBUyxjQUFjO0FBQzVCLFNBQUssU0FBUyxZQUFZO0FBRTFCLFNBQUssU0FBUyxpQkFBaUIsU0FBUyxZQUFZO0FBQ2xELFVBQUksS0FBSyxTQUFTLE1BQU0sU0FBUyxHQUFHO0FBQ2xDLGNBQU0sS0FBSyxPQUFPLEtBQUssU0FBUyxLQUFLO0FBQUEsTUFDdkM7QUFBQSxJQUNGLENBQUM7QUFHRCxTQUFLLFVBQVUsVUFBVSxZQUFZLFNBQVMsY0FBYyxLQUFLLENBQUM7QUFDbEUsU0FBSyxRQUFRLFlBQVk7QUFDekIsVUFBTSxLQUFLLFlBQVk7QUFHdkIsVUFBTSxlQUFlLFVBQVUsWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQ3hFLGlCQUFhLFlBQVk7QUFDekIsaUJBQWEsY0FBYztBQUUzQixTQUFLLFdBQVcsVUFBVSxZQUFZLFNBQVMsY0FBYyxLQUFLLENBQUM7QUFDbkUsU0FBSyxTQUFTLFlBQVk7QUFDMUIsVUFBTSxLQUFLLGFBQWE7QUFHeEIsVUFBTSxZQUFZLFVBQVUsWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQ3JFLGNBQVUsWUFBWTtBQUV0QixVQUFNLFVBQVUsVUFBVSxZQUFZLFNBQVMsY0FBYyxRQUFRLENBQUM7QUFDdEUsWUFBUSxjQUFjO0FBQ3RCLFlBQVEsVUFBVSxNQUFNLEtBQUssT0FBTyxVQUFVO0FBRTlDLFVBQU0sWUFBWSxVQUFVLFlBQVksU0FBUyxjQUFjLFFBQVEsQ0FBQztBQUN4RSxjQUFVLGNBQWM7QUFDeEIsY0FBVSxVQUFVLE1BQU0sS0FBSyxPQUFPLGtCQUFrQjtBQUV4RCxVQUFNLFdBQVcsVUFBVSxZQUFZLFNBQVMsY0FBYyxRQUFRLENBQUM7QUFDdkUsYUFBUyxjQUFjO0FBQ3ZCLGFBQVMsVUFBVSxNQUFNLEtBQUssY0FBYztBQUFBLEVBQzlDO0FBQUEsRUFFQSxNQUFNLFVBQVU7QUFBQSxFQUVoQjtBQUFBLEVBRUEsTUFBYyxPQUFPLE9BQWU7QUFoR3RDO0FBaUdJLGVBQUssY0FBTCxtQkFBZ0I7QUFFaEIsUUFBSTtBQUNGLFlBQU0sVUFBVSxNQUFNLEtBQUssSUFBSSxPQUFPLE9BQU8sRUFBRSxPQUFPLEdBQUcsQ0FBQztBQUUxRCxVQUFJLENBQUMsS0FBSyxXQUFXO0FBQ25CLGFBQUssWUFBWSxLQUFLLFlBQVksU0FBUyxDQUFDLEVBQUUsWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQ3ZGLGFBQUssVUFBVSxZQUFZO0FBQUEsTUFDN0I7QUFFQSxXQUFLLFVBQVUsTUFBTTtBQUVyQixVQUFJLFFBQVEsV0FBVyxHQUFHO0FBQ3hCLGFBQUssVUFBVSxjQUFjO0FBQzdCO0FBQUEsTUFDRjtBQUVBLGNBQVEsUUFBUSxDQUFDLFdBQVc7QUFsSGxDLFlBQUFDO0FBbUhRLGNBQU0sT0FBTyxLQUFLLFVBQVUsWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQ3JFLGFBQUssWUFBWTtBQUVqQixjQUFNLFFBQVEsS0FBSyxZQUFZLFNBQVMsY0FBYyxLQUFLLENBQUM7QUFDNUQsY0FBTSxZQUFZO0FBQ2xCLGNBQU0sY0FBYyxPQUFPO0FBRTNCLGNBQU0sVUFBVSxLQUFLLFlBQVksU0FBUyxjQUFjLEtBQUssQ0FBQztBQUM5RCxnQkFBUSxZQUFZO0FBQ3BCLGdCQUFRLGNBQWMsT0FBTyxRQUFRLE1BQU0sR0FBRyxHQUFHLElBQUk7QUFFckQsY0FBTSxPQUFPLEtBQUssWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQzNELGFBQUssWUFBWTtBQUNqQixhQUFLLGdCQUFjQSxNQUFBLE9BQU8sU0FBUCxnQkFBQUEsSUFBYSxLQUFLLFVBQVM7QUFFOUMsYUFBSyxVQUFVLE1BQU07QUFFbkIsZUFBSyxXQUFXLE1BQU07QUFBQSxRQUN4QjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0gsU0FBUyxPQUFPO0FBQ2QsY0FBUSxNQUFNLGtCQUFrQixLQUFLO0FBQUEsSUFDdkM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGNBQWM7QUFDMUIsUUFBSTtBQUNGLFlBQU0sUUFBUSxNQUFNLEtBQUssSUFBSSxTQUFTO0FBQ3RDLFdBQUssUUFBUSxZQUFZO0FBQUE7QUFBQSw0Q0FFYSxNQUFNLFlBQVk7QUFBQTtBQUFBO0FBQUE7QUFBQSw0Q0FJbEIsTUFBTSxXQUFXO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFJekQsU0FBUyxPQUFPO0FBQ2QsY0FBUSxNQUFNLGlCQUFpQixLQUFLO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGVBQWU7QUFDM0IsUUFBSTtBQUNGLFlBQU0sU0FBUyxNQUFNLEtBQUssSUFBSSxVQUFVLENBQUM7QUFFekMsV0FBSyxTQUFTLE1BQU07QUFFcEIsYUFBTyxRQUFRLENBQUMsV0FBVztBQUN6QixjQUFNLE9BQU8sS0FBSyxTQUFTLFlBQVksU0FBUyxjQUFjLEtBQUssQ0FBQztBQUNwRSxhQUFLLFlBQVk7QUFFakIsY0FBTSxRQUFRLEtBQUssWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQzVELGNBQU0sWUFBWTtBQUNsQixjQUFNLGNBQWMsT0FBTyxTQUFTLE9BQU8sR0FBRyxNQUFNLEdBQUcsRUFBRTtBQUV6RCxjQUFNLE9BQU8sS0FBSyxZQUFZLFNBQVMsY0FBYyxLQUFLLENBQUM7QUFDM0QsYUFBSyxZQUFZO0FBQ2pCLGFBQUssY0FBYyxJQUFJLEtBQUssT0FBTyxTQUFTLEVBQUUsbUJBQW1CO0FBRWpFLGFBQUssVUFBVSxNQUFNLEtBQUssV0FBVyxNQUFNO0FBQUEsTUFDN0MsQ0FBQztBQUFBLElBQ0gsU0FBUyxPQUFPO0FBQ2QsY0FBUSxNQUFNLGtCQUFrQixLQUFLO0FBQUEsSUFDdkM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGdCQUFnQjtBQUU1QixVQUFNLFlBQVksS0FBSyxPQUFPLFNBQVMsVUFBVSxRQUFRLEtBQUssUUFBUSxJQUFJLFFBQVEsRUFBRTtBQUNwRixVQUFNLFlBQVksS0FBSyxLQUFLLFdBQVcsZ0JBQWdCLFlBQVk7QUFFbkUsUUFBSSxHQUFHLFdBQVcsU0FBUyxHQUFHO0FBQzVCLFlBQU0sS0FBSyxJQUFJLFVBQVUsYUFBYSxXQUFXLEVBQUU7QUFBQSxJQUNyRCxPQUFPO0FBQ0wsVUFBSSxPQUFPLHlDQUF5QztBQUFBLElBQ3REO0FBQUEsRUFDRjtBQUFBLEVBRVEsV0FBVyxRQUFhO0FBbk1sQztBQXFNSSxVQUFNLFVBQVUsS0FBSyxPQUFPLEtBQUs7QUFBQTtBQUFBLEVBQU8sT0FBTyxPQUFPO0FBQUE7QUFBQSxVQUFhLFlBQU8sU0FBUCxtQkFBYSxLQUFLLFVBQVMsTUFBTTtBQUFBO0FBQUEsVUFBZSxPQUFPLE1BQU07QUFBQTtBQUFBLGNBQW1CLE9BQU8sb0JBQW9CO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFBYyxPQUFPLE9BQU87QUFFMU0sVUFBTUMsUUFBTyxtQkFBbUIsT0FBTyxHQUFHLE1BQU0sR0FBRyxFQUFFLENBQUM7QUFDdEQsU0FBSyxJQUFJLE1BQU0sT0FBT0EsT0FBTSxPQUFPLEVBQUUsS0FBSyxDQUFDLFNBQVM7QUFDbEQsV0FBSyxJQUFJLFVBQVUsYUFBYSxLQUFLLE1BQU0sRUFBRTtBQUFBLElBQy9DLENBQUM7QUFBQSxFQUNIO0FBQ0Y7OztBQ3ZNQSxJQUFBQyxtQkFBeUY7QUFHbEYsSUFBTSxnQkFBTixjQUE0QiwrQkFBbUI7QUFBQSxFQUdwRCxZQUFZLFFBQXNCO0FBQ2hDLFVBQU0sT0FBTyxHQUFHO0FBQ2hCLFNBQUssU0FBUztBQUFBLEVBQ2hCO0FBQUEsRUFFQSxVQUFVLFFBQTZDO0FBQ3JELFVBQU0sU0FBUyxPQUFPLFVBQVU7QUFDaEMsVUFBTSxPQUFPLE9BQU8sUUFBUSxPQUFPLElBQUk7QUFHdkMsUUFBSSxLQUFLLFNBQVMsV0FBVyxHQUFHO0FBQzlCLGFBQU87QUFBQSxRQUNMLE9BQU8sS0FBSyxNQUFNLFdBQVcsRUFBRSxDQUFDLEtBQUs7QUFBQSxRQUNyQyxPQUFPLEVBQUUsTUFBTSxPQUFPLE1BQU0sSUFBSSxLQUFLLFFBQVEsV0FBVyxFQUFFO0FBQUEsUUFDMUQsS0FBSztBQUFBLE1BQ1A7QUFBQSxJQUNGO0FBR0EsUUFBSSxLQUFLLFNBQVMsU0FBUyxHQUFHO0FBQzVCLGFBQU87QUFBQSxRQUNMLE9BQU8sS0FBSyxNQUFNLFNBQVMsRUFBRSxDQUFDLEtBQUs7QUFBQSxRQUNuQyxPQUFPLEVBQUUsTUFBTSxPQUFPLE1BQU0sSUFBSSxLQUFLLFFBQVEsU0FBUyxFQUFFO0FBQUEsUUFDeEQsS0FBSztBQUFBLE1BQ1A7QUFBQSxJQUNGO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQU0sZUFBZSxTQUErQztBQUNsRSxVQUFNLFFBQVEsUUFBUSxNQUFNLFlBQVk7QUFFeEMsUUFBSTtBQUNGLFlBQU0sV0FBVyxNQUFNLEtBQUssT0FBTyxJQUFJLFVBQVUsRUFBRTtBQUVuRCxhQUFPLFNBQ0osT0FBTyxPQUFFO0FBaERsQjtBQWdEcUIsZ0JBQUMsV0FBUyxPQUFFLFVBQUYsbUJBQVMsY0FBYyxTQUFTLGFBQVUsT0FBRSxZQUFGLG1CQUFXLGNBQWMsU0FBUztBQUFBLE9BQU0sRUFDeEcsSUFBSSxRQUFNO0FBQUEsUUFDVCxPQUFPLEVBQUU7QUFBQSxRQUNULElBQUksRUFBRTtBQUFBLFFBQ04sU0FBUyxFQUFFO0FBQUEsUUFDWCxTQUFTLEVBQUU7QUFBQSxNQUNiLEVBQUU7QUFBQSxJQUNOLFNBQVE7QUFDTixhQUFPLENBQUM7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBLEVBRUEsaUJBQWlCLE9BQVksSUFBaUI7QUE1RGhEO0FBNkRJLE9BQUcsU0FBUyxxQkFBcUI7QUFFakMsVUFBTSxVQUFVLEdBQUcsWUFBWSxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQzVELFlBQVEsWUFBWTtBQUNwQixZQUFRLGNBQWMsTUFBTTtBQUU1QixVQUFNLFlBQVksR0FBRyxZQUFZLFNBQVMsY0FBYyxLQUFLLENBQUM7QUFDOUQsY0FBVSxZQUFZO0FBQ3RCLGNBQVUsZ0JBQWMsV0FBTSxZQUFOLG1CQUFlLE1BQU0sR0FBRyxRQUFPO0FBQUEsRUFDekQ7QUFBQSxFQUVBLE1BQU0sVUFBVSxPQUFZLFFBQWdCLFNBQStCO0FBRXpFLFVBQU0sY0FBYyxxQkFBcUIsTUFBTSxHQUFHLE1BQU0sR0FBRyxFQUFFLENBQUMsSUFBSSxNQUFNLEtBQUs7QUFFN0UsV0FBTyxhQUFhLGFBQWEsUUFBUSxPQUFPLFFBQVEsR0FBRztBQUFBLEVBQzdEO0FBQ0Y7OztBSHpFQSxJQUFNLGNBQWM7QUFZcEIsSUFBTSxtQkFBeUM7QUFBQSxFQUM3QyxZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxVQUFVO0FBQUEsRUFDVixjQUFjO0FBQUE7QUFBQSxFQUNkLGVBQWU7QUFBQSxFQUNmLG1CQUFtQjtBQUFBLEVBQ25CLFlBQVk7QUFDZDtBQUVBLElBQXFCLGVBQXJCLGNBQTBDLHdCQUFPO0FBQUEsRUFBakQ7QUFBQTtBQUdFLHNCQUFnQztBQUNoQyx3QkFBc0M7QUFBQTtBQUFBLEVBRXRDLE1BQU0sU0FBUztBQUNiLGtDQUFRLFVBQVUsV0FBVztBQUU3QixVQUFNLEtBQUssYUFBYTtBQUN4QixTQUFLLE1BQU0sSUFBSSxVQUFVLEtBQUssU0FBUyxVQUFVO0FBR2pELFNBQUssYUFBYSxrQkFBa0IsQ0FBQyxTQUFTO0FBQzVDLFdBQUssYUFBYSxJQUFJLFdBQVcsTUFBTSxJQUFJO0FBQzNDLGFBQU8sS0FBSztBQUFBLElBQ2QsQ0FBQztBQUdELFNBQUssY0FBYyxVQUFVLHNCQUFzQixZQUFZO0FBQzdELFlBQU0sS0FBSyxlQUFlO0FBQUEsSUFDNUIsQ0FBQztBQUdELFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sVUFBVSxNQUFNLEtBQUssZUFBZTtBQUFBLElBQ3RDLENBQUM7QUFFRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLFVBQVUsTUFBTSxLQUFLLGFBQWE7QUFBQSxJQUNwQyxDQUFDO0FBRUQsU0FBSyxXQUFXO0FBQUEsTUFDZCxJQUFJO0FBQUEsTUFDSixNQUFNO0FBQUEsTUFDTixVQUFVLE1BQU0sS0FBSyxVQUFVO0FBQUEsSUFDakMsQ0FBQztBQUVELFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sVUFBVSxNQUFNLEtBQUssa0JBQWtCO0FBQUEsSUFDekMsQ0FBQztBQUdELFFBQUksS0FBSyxTQUFTLG1CQUFtQjtBQUNuQyxXQUFLLHNCQUFzQixJQUFJLGNBQWMsSUFBSSxDQUFDO0FBQUEsSUFDcEQ7QUFHQSxTQUFLLGNBQWMsSUFBSSxpQkFBaUIsS0FBSyxLQUFLLElBQUksQ0FBQztBQUd2RCxRQUFJLEtBQUssU0FBUyxVQUFVO0FBQzFCLFdBQUssY0FBYztBQUFBLElBQ3JCO0FBR0EsVUFBTSxXQUFXLEtBQUssaUJBQWlCO0FBQ3ZDLGFBQVMsY0FBYztBQUN2QixhQUFTLFFBQVE7QUFFakIsU0FBSztBQUFBLE1BQ0gsS0FBSyxJQUFJLFVBQVUsR0FBRyxhQUFhLENBQUMsTUFBTSxTQUFTO0FBQ2pELGFBQUssUUFBUSxDQUFDLFNBQVM7QUFDckIsZUFDRyxTQUFTLGtCQUFrQixFQUMzQixRQUFRLFFBQVEsRUFDaEIsUUFBUSxNQUFNLEtBQUssV0FBVyxJQUFJLENBQUM7QUFBQSxRQUN4QyxDQUFDO0FBQUEsTUFDSCxDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0saUJBQWlCO0FBQ3JCLFVBQU0sU0FBUyxLQUFLLElBQUksVUFBVSxnQkFBZ0IsZ0JBQWdCO0FBQ2xFLFFBQUksT0FBTyxTQUFTLEdBQUc7QUFDckIsV0FBSyxJQUFJLFVBQVUsV0FBVyxPQUFPLENBQUMsQ0FBQztBQUN2QztBQUFBLElBQ0Y7QUFFQSxVQUFNLEtBQUssSUFBSSxVQUFVLGFBQWEsS0FBSyxFQUFFLGFBQWE7QUFBQSxNQUN4RCxNQUFNO0FBQUEsTUFDTixRQUFRO0FBQUEsSUFDVixDQUFDO0FBRUQsU0FBSyxJQUFJLFVBQVU7QUFBQSxNQUNqQixLQUFLLElBQUksVUFBVSxnQkFBZ0IsZ0JBQWdCLEVBQUUsQ0FBQztBQUFBLElBQ3hEO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFVBQU0sUUFBUSxNQUFNLEtBQUssT0FBTyx3QkFBd0IsdUJBQXVCO0FBQy9FLFFBQUksQ0FBQyxNQUFPO0FBRVosVUFBTSxVQUFVLE1BQU0sS0FBSyxJQUFJLE9BQU8sT0FBTyxFQUFFLE9BQU8sS0FBSyxTQUFTLFdBQVcsQ0FBQztBQUVoRixRQUFJLFFBQVEsV0FBVyxHQUFHO0FBQ3hCLFVBQUksd0JBQU8sNEJBQTRCLEtBQUs7QUFDNUM7QUFBQSxJQUNGO0FBR0EsVUFBTSxVQUFVLDJCQUEyQixLQUFLO0FBQUE7QUFBQSxFQUFPLFFBQVEsSUFBSSxDQUFDLEdBQUcsTUFBRztBQXRJOUU7QUFzSWlGLG1CQUFNLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSztBQUFBO0FBQUEsRUFBTyxFQUFFLE9BQU87QUFBQTtBQUFBLFVBQWEsT0FBRSxTQUFGLG1CQUFRLEtBQUssVUFBUyxNQUFNO0FBQUE7QUFBQTtBQUFBLEtBQVMsRUFBRSxLQUFLLElBQUksQ0FBQztBQUVsTCxVQUFNLE9BQU8sTUFBTSxLQUFLLElBQUksTUFBTSxPQUFPLDRCQUE0QixPQUFPO0FBQzVFLFVBQU0sS0FBSyxJQUFJLFVBQVUsYUFBYSxLQUFLLE1BQU0sRUFBRTtBQUVuRCxRQUFJLHdCQUFPLFNBQVMsUUFBUSxNQUFNLFdBQVc7QUFBQSxFQUMvQztBQUFBLEVBRUEsTUFBTSxZQUFZO0FBQ2hCLFFBQUksd0JBQU8seUJBQXlCO0FBQ3BDLFFBQUk7QUFDRixZQUFNLFNBQVMsTUFBTSxLQUFLLElBQUksWUFBWSxLQUFLLFNBQVMsU0FBUztBQUNqRSxVQUFJLHdCQUFPLHdCQUFtQixPQUFPLFdBQVcsVUFBVTtBQUFBLElBQzVELFNBQVMsT0FBTztBQUNkLFVBQUksd0JBQU8seUJBQW9CLE1BQU0sT0FBTztBQUFBLElBQzlDO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxvQkFBb0I7QUFDeEIsVUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLG9CQUFvQiw2QkFBWTtBQUNoRSxRQUFJLENBQUMsTUFBTTtBQUNULFVBQUksd0JBQU8seUJBQXlCO0FBQ3BDO0FBQUEsSUFDRjtBQUVBLFVBQU0sVUFBVSxLQUFLO0FBQ3JCLFVBQU0sT0FBTyxLQUFLO0FBRWxCLFFBQUk7QUFDRixZQUFNLEtBQUssSUFBSSxXQUFXO0FBQUEsUUFDeEIsSUFBSSxZQUFZLEtBQUssSUFBSTtBQUFBLFFBQ3pCLE9BQU8sS0FBSztBQUFBLFFBQ1o7QUFBQSxRQUNBLFFBQVE7QUFBQSxRQUNSLFlBQVcsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxNQUNwQyxDQUFDO0FBRUQsVUFBSSx3QkFBTyxnQ0FBMkI7QUFBQSxJQUN4QyxTQUFTLE9BQU87QUFDZCxVQUFJLHdCQUFPLDJCQUFzQixNQUFNLE9BQU87QUFBQSxJQUNoRDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sV0FBVyxNQUF1QjtBQUN0QyxRQUFJLGdCQUFnQiwwQkFBUztBQUMzQixVQUFJLHdCQUFPLGlDQUFpQztBQUM1QztBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQVUsTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLElBQUk7QUFFOUMsUUFBSTtBQUNGLFlBQU0sS0FBSyxJQUFJLFdBQVc7QUFBQSxRQUN4QixJQUFJLFlBQVksS0FBSyxJQUFJO0FBQUEsUUFDekIsT0FBTyxLQUFLO0FBQUEsUUFDWjtBQUFBLFFBQ0EsUUFBUTtBQUFBLFFBQ1IsTUFBTSxDQUFDO0FBQUEsUUFDUCxZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDcEMsQ0FBQztBQUVELFVBQUksd0JBQU8sb0JBQWUsS0FBSyxJQUFJLEVBQUU7QUFBQSxJQUN2QyxTQUFTLE9BQU87QUFDZCxVQUFJLHdCQUFPLDJCQUFzQixNQUFNLE9BQU87QUFBQSxJQUNoRDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLGdCQUFnQjtBQUNkLFFBQUksS0FBSyxjQUFjO0FBQ3JCLG9CQUFjLEtBQUssWUFBWTtBQUFBLElBQ2pDO0FBRUEsU0FBSyxlQUFlLFlBQVksWUFBWTtBQUMxQyxVQUFJO0FBQ0YsY0FBTSxLQUFLLFVBQVU7QUFBQSxNQUN2QixTQUFTLE9BQU87QUFDZCxnQkFBUSxNQUFNLHFCQUFxQixLQUFLO0FBQUEsTUFDMUM7QUFBQSxJQUNGLEdBQUcsS0FBSyxTQUFTLGVBQWUsR0FBSTtBQUFBLEVBQ3RDO0FBQUEsRUFFQSxlQUFlO0FBQ2IsUUFBSSxLQUFLLGNBQWM7QUFDckIsb0JBQWMsS0FBSyxZQUFZO0FBQy9CLFdBQUssZUFBZTtBQUFBLElBQ3RCO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFNBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixNQUFNLEtBQUssU0FBUyxDQUFDO0FBQUEsRUFDM0U7QUFBQSxFQUVBLE1BQU0sZUFBZTtBQUNuQixVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUFBLEVBRVEsT0FBTyxPQUFlLGFBQThDO0FBQzFFLFdBQU8sSUFBSSxRQUFRLENBQUMsWUFBWTtBQUM5QixZQUFNLFFBQVEsSUFBSSxNQUFNLEtBQUssS0FBSyxPQUFPLGFBQWEsT0FBTztBQUM3RCxZQUFNLEtBQUs7QUFBQSxJQUNiLENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFHQSxJQUFNLFFBQU4sY0FBb0IsaUJBQUFDLE1BQU87QUFBQSxFQUN6QixZQUFZLEtBQVUsT0FBZSxhQUFpQyxVQUEwQztBQUM5RyxVQUFNLEdBQUc7QUFDVCxTQUFLLFNBQVMsS0FBSztBQUVuQixVQUFNLFVBQVUsS0FBSyxVQUFVLFlBQVksU0FBUyxjQUFjLE9BQU8sQ0FBQztBQUMxRSxZQUFRLE9BQU87QUFDZixZQUFRLGNBQWMsZUFBZTtBQUNyQyxZQUFRLE1BQU0sUUFBUTtBQUN0QixZQUFRLE1BQU0sZUFBZTtBQUU3QixVQUFNLFdBQVcsS0FBSyxVQUFVLFlBQVksU0FBUyxjQUFjLFFBQVEsQ0FBQztBQUM1RSxhQUFTLGNBQWM7QUFDdkIsYUFBUyxVQUFVLE1BQU07QUFDdkIsZUFBUyxRQUFRLFNBQVMsSUFBSTtBQUM5QixXQUFLLE1BQU07QUFBQSxJQUNiO0FBRUEsWUFBUSxNQUFNO0FBQUEsRUFDaEI7QUFDRjtBQUVBLElBQU0sbUJBQU4sY0FBK0Isa0NBQWlCO0FBQUEsRUFHOUMsWUFBWSxLQUFVLFFBQXNCO0FBQzFDLFVBQU0sS0FBSyxNQUFNO0FBQ2pCLFNBQUssU0FBUztBQUFBLEVBQ2hCO0FBQUEsRUFFQSxVQUFnQjtBQUNkLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsZ0JBQVksTUFBTTtBQUNsQixnQkFBWSxTQUFTLE1BQU0sRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBRXRELFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGFBQWEsRUFDckIsUUFBUSxxQ0FBcUMsRUFDN0MsUUFBUSxVQUFRLEtBQ2QsZUFBZSxrQkFBa0IsRUFDakMsU0FBUyxLQUFLLE9BQU8sU0FBUyxVQUFVLEVBQ3hDLFNBQVMsT0FBTyxVQUFVO0FBQ3pCLFdBQUssT0FBTyxTQUFTLGFBQWE7QUFDbEMsWUFBTSxLQUFLLE9BQU8sYUFBYTtBQUFBLElBQ2pDLENBQUMsQ0FBQztBQUFBLEVBQ1I7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImZzIiwgInBhdGgiLCAiX2EiLCAicGF0aCIsICJpbXBvcnRfb2JzaWRpYW4iLCAiT01vZGFsIl0KfQo=
