import { Plugin, PluginSettingTab, App, Setting, Notice, TFile, TFolder, WorkspaceLeaf, Editor, MarkdownView, addIcon, Modal as OModal } from 'obsidian';
import { CortexAPI } from './api';
import { CortexView, CORTEX_VIEW_TYPE } from './view';
import { CortexSuggest } from './suggest';

const CORTEX_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

interface CortexPluginSettings {
  cortexPath: string;
  vaultPath: string;
  autoSync: boolean;
  syncInterval: number;
  showGraphView: boolean;
  enableSuggestions: boolean;
  maxResults: number;
}

const DEFAULT_SETTINGS: CortexPluginSettings = {
  cortexPath: '~/.claude/memory',
  vaultPath: '~/.obsidian-vault',
  autoSync: true,
  syncInterval: 300, // 5 minutes
  showGraphView: true,
  enableSuggestions: true,
  maxResults: 20,
};

export default class CortexPlugin extends Plugin {
  settings: CortexPluginSettings;
  api: CortexAPI;
  cortexView: CortexView | null = null;
  syncInterval: NodeJS.Timeout | null = null;

  async onload() {
    addIcon('cortex', CORTEX_ICON);
    
    await this.loadSettings();
    this.api = new CortexAPI(this.settings.cortexPath);

    // Register Cortex sidebar view
    this.registerView(CORTEX_VIEW_TYPE, (leaf) => {
      this.cortexView = new CortexView(leaf, this);
      return this.cortexView;
    });

    // Add ribbon icon
    this.addRibbonIcon('cortex', 'Open Cortex Memory', async () => {
      await this.openCortexView();
    });

    // Add commands
    this.addCommand({
      id: 'open-cortex-view',
      name: 'Open Cortex Memory View',
      callback: () => this.openCortexView(),
    });

    this.addCommand({
      id: 'search-cortex-memory',
      name: 'Search Cortex Memory',
      callback: () => this.searchMemory(),
    });

    this.addCommand({
      id: 'sync-cortex-vault',
      name: 'Sync Cortex Vault',
      callback: () => this.syncVault(),
    });

    this.addCommand({
      id: 'export-to-cortex',
      name: 'Export Current Note to Cortex',
      callback: () => this.exportCurrentNote(),
    });

    // Register editor suggest (autocomplete for memory references)
    if (this.settings.enableSuggestions) {
      this.registerEditorSuggest(new CortexSuggest(this));
    }

    // Add settings tab
    this.addSettingTab(new CortexSettingTab(this.app, this));

    // Start auto-sync if enabled
    if (this.settings.autoSync) {
      this.startAutoSync();
    }

    // Add status bar item
    const statusEl = this.addStatusBarItem();
    statusEl.textContent = '🧠 Cortex';
    statusEl.title = 'Cortex Memory Plugin';

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        menu.addItem((item) => {
          item
            .setTitle('Export to Cortex')
            .setIcon('cortex')
            .onClick(() => this.exportFile(file));
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
      active: true,
    });

    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(CORTEX_VIEW_TYPE)[0]
    );
  }

  async searchMemory() {
    const query = await this.prompt('Search Cortex Memory', 'Enter search query...');
    if (!query) return;

    const results = await this.api.search(query, { limit: this.settings.maxResults });
    
    if (results.length === 0) {
      new Notice('No memories found for: ' + query);
      return;
    }

    // Create results in temporary file
    const content = `# Cortex Memory Search: ${query}\n\n${results.map((r, i) => `## ${i + 1}. ${r.title}\n\n${r.summary}\n\nTags: ${r.tags?.join(', ') || 'none'}\n\n---`).join('\n')}`;
    
    const file = await this.app.vault.create('Cortex/Search Results.md', content);
    await this.app.workspace.openLinkText(file.path, '');
    
    new Notice(`Found ${results.length} memories`);
  }

  async syncVault() {
    new Notice('Syncing Cortex vault...');
    try {
      const result = await this.api.exportVault(this.settings.vaultPath);
      new Notice(`✓ Vault synced: ${result.recordCount} records`);
    } catch (error) {
      new Notice('✗ Sync failed: ' + error.message);
    }
  }

  async exportCurrentNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('No active markdown file');
      return;
    }

    const content = view.data;
    const file = view.file;
    
    try {
      await this.api.importNote({
        id: `obsidian:${file.path}`,
        title: file.name,
        content: content,
        source: 'obsidian',
        createdAt: new Date().toISOString(),
      });
      
      new Notice('✓ Note exported to Cortex');
    } catch (error) {
      new Notice('✗ Export failed: ' + error.message);
    }
  }

  async exportFile(file: TFile | TFolder) {
    if (file instanceof TFolder) {
      new Notice('Folder export not yet supported');
      return;
    }

    const content = await this.app.vault.read(file);
    
    try {
      await this.api.importNote({
        id: `obsidian:${file.path}`,
        title: file.name,
        content: content,
        source: 'obsidian',
        tags: [],
        createdAt: new Date().toISOString(),
      });
      
      new Notice(`✓ Exported: ${file.name}`);
    } catch (error) {
      new Notice('✗ Export failed: ' + error.message);
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
        console.error('Auto-sync failed:', error);
      }
    }, this.settings.syncInterval * 1000);
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

  private prompt(title: string, placeholder?: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app, title, placeholder, resolve);
      modal.open();
    });
  }
}

// Simple modal for prompts
class Modal extends OModal {
  constructor(app: App, title: string, placeholder: string | undefined, onSubmit: (value: string | null) => void) {
    super(app);
    this.setTitle(title);
    
    const inputEl = this.contentEl.appendChild(document.createElement('input'));
    inputEl.type = 'text';
    inputEl.placeholder = placeholder || '';
    inputEl.style.width = '100%';
    inputEl.style.marginBottom = '10px';
    
    const buttonEl = this.contentEl.appendChild(document.createElement('button'));
    buttonEl.textContent = 'Submit';
    buttonEl.onclick = () => {
      onSubmit(inputEl.value || null);
      this.close();
    };

    inputEl.focus();
  }
}

class CortexSettingTab extends PluginSettingTab {
  plugin: CortexPlugin;

  constructor(app: App, plugin: CortexPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Cortex Settings' });

    new Setting(containerEl)
      .setName('Cortex Path')
      .setDesc('Path to the Cortex memory directory')
      .addText(text => text
        .setPlaceholder('~/.claude/memory')
        .setValue(this.plugin.settings.cortexPath)
        .onChange(async (value) => {
          this.plugin.settings.cortexPath = value;
          await this.plugin.saveSettings();
        }));
  }
}