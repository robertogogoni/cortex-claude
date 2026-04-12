/**
 * Cortex Sidebar View for Obsidian
 * Displays memory search, recent memories, and graph view
 */

import { ItemView, WorkspaceLeaf, setIcon, TFile, MarkdownView } from 'obsidian';
import CortexPlugin from './main';
import { CortexAPI } from './api';

export const CORTEX_VIEW_TYPE = 'cortex-view';

export class CortexView extends ItemView {
  private plugin: CortexPlugin;
  private api: CortexAPI;
  private searchEl: HTMLInputElement;
  private resultsEl: HTMLElement;
  private recentEl: HTMLElement;
  private statsEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: CortexPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.api = plugin.api;
  }

  getViewType(): string {
    return CORTEX_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '🧠 Cortex Memory';
  }

  getIcon(): string {
    return 'cortex';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();

    // Header
    const headerEl = container.appendChild(document.createElement('div'));
    headerEl.className = 'cortex-header';
    headerEl.innerHTML = '<h2>Cortex Memory</h2>';

    // Search
    const searchContainer = container.appendChild(document.createElement('div'));
    searchContainer.className = 'cortex-search';
    
    this.searchEl = searchContainer.appendChild(document.createElement('input'));
    this.searchEl.type = 'text';
    this.searchEl.placeholder = 'Search memories...';
    this.searchEl.className = 'cortex-search-input';
    
    this.searchEl.addEventListener('input', async () => {
      if (this.searchEl.value.length > 2) {
        await this.search(this.searchEl.value);
      }
    });

    // Stats
    this.statsEl = container.appendChild(document.createElement('div'));
    this.statsEl.className = 'cortex-stats';
    await this.updateStats();

    // Recent memories
    const recentHeader = container.appendChild(document.createElement('div'));
    recentHeader.className = 'cortex-section-header';
    recentHeader.textContent = 'Recent Memories';

    this.recentEl = container.appendChild(document.createElement('div'));
    this.recentEl.className = 'cortex-recent';
    await this.updateRecent();

    // Actions
    const actionsEl = container.appendChild(document.createElement('div'));
    actionsEl.className = 'cortex-actions';

    const syncBtn = actionsEl.appendChild(document.createElement('button'));
    syncBtn.textContent = 'Sync Vault';
    syncBtn.onclick = () => this.plugin.syncVault();

    const exportBtn = actionsEl.appendChild(document.createElement('button'));
    exportBtn.textContent = 'Export Current';
    exportBtn.onclick = () => this.plugin.exportCurrentNote();

    const graphBtn = actionsEl.appendChild(document.createElement('button'));
    graphBtn.textContent = 'Open Graph';
    graphBtn.onclick = () => this.openGraphView();
  }

  async onClose() {
    // Cleanup
  }

  private async search(query: string) {
    this.resultsEl?.empty();
    
    try {
      const results = await this.api.search(query, { limit: 10 });
      
      if (!this.resultsEl) {
        this.resultsEl = this.containerEl.children[1].appendChild(document.createElement('div'));
        this.resultsEl.className = 'cortex-results';
      }

      this.resultsEl.empty();

      if (results.length === 0) {
        this.resultsEl.textContent = 'No results found';
        return;
      }

      results.forEach((result) => {
        const item = this.resultsEl.appendChild(document.createElement('div'));
        item.className = 'cortex-result-item';
        
        const title = item.appendChild(document.createElement('div'));
        title.className = 'cortex-result-title';
        title.textContent = result.title;
        
        const summary = item.appendChild(document.createElement('div'));
        summary.className = 'cortex-result-summary';
        summary.textContent = result.summary.slice(0, 100) + '...';
        
        const tags = item.appendChild(document.createElement('div'));
        tags.className = 'cortex-result-tags';
        tags.textContent = result.tags?.join(', ') || '';
        
        item.onclick = () => {
          // Open or create note with memory content
          this.openMemory(result);
        };
      });
    } catch (error) {
      console.error('Search failed:', error);
    }
  }

  private async updateStats() {
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
      console.error('Stats failed:', error);
    }
  }

  private async updateRecent() {
    try {
      const recent = await this.api.getRecent(5);
      
      this.recentEl.empty();
      
      recent.forEach((record) => {
        const item = this.recentEl.appendChild(document.createElement('div'));
        item.className = 'cortex-recent-item';
        
        const title = item.appendChild(document.createElement('div'));
        title.className = 'cortex-recent-title';
        title.textContent = record.title || record.id.slice(0, 30);
        
        const date = item.appendChild(document.createElement('div'));
        date.className = 'cortex-recent-date';
        date.textContent = new Date(record.createdAt).toLocaleDateString();
        
        item.onclick = () => this.openMemory(record);
      });
    } catch (error) {
      console.error('Recent failed:', error);
    }
  }

  private async openGraphView() {
    // Open Cortex Atlas vault in Obsidian
    const vaultPath = this.plugin.settings.vaultPath.replace('~', process.env.HOME || '');
    const atlasPath = path.join(vaultPath, 'Cortex Atlas', '00 Home.md');
    
    if (fs.existsSync(atlasPath)) {
      await this.app.workspace.openLinkText(atlasPath, '');
    } else {
      new Notice('Cortex Atlas not found. Run sync first.');
    }
  }

  private openMemory(record: any) {
    // Create or open note for this memory
    const content = `# ${record.title}\n\n${record.summary}\n\nTags: ${record.tags?.join(', ') || 'none'}\n\nSource: ${record.source}\n\nConfidence: ${record.extractionConfidence}\n\n---\n\n${record.content}`;
    
    const path = `Cortex/Memories/${record.id.slice(0, 20)}.md`;
    this.app.vault.create(path, content).then((file) => {
      this.app.workspace.openLinkText(file.path, '');
    });
  }
}