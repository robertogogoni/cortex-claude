/**
 * Cortex Editor Suggest
 * Provides autocomplete for memory references in editor
 */

import { EditorSuggest, EditorSuggestTrigger, EditorSuggestContext, Editor, TFile } from 'obsidian';
import CortexPlugin from './main';

export class CortexSuggest extends EditorSuggest<any> {
  private plugin: CortexPlugin;

  constructor(plugin: CortexPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onTrigger(editor: Editor): EditorSuggestTrigger | null {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    
    // Trigger on [[cortex:
    if (line.includes('[[cortex:')) {
      return {
        query: line.split('[[cortex:')[1] || '',
        start: { line: cursor.line, ch: line.indexOf('[[cortex:') },
        end: cursor,
      };
    }
    
    // Trigger on @cortex
    if (line.includes('@cortex')) {
      return {
        query: line.split('@cortex')[1] || '',
        start: { line: cursor.line, ch: line.indexOf('@cortex') },
        end: cursor,
      };
    }
    
    return null;
  }

  async getSuggestions(context: EditorSuggestContext): Promise<any[]> {
    const query = context.query.toLowerCase();
    
    try {
      const memories = await this.plugin.api.getRecent(20);
      
      return memories
        .filter(m => !query || m.title?.toLowerCase().includes(query) || m.content?.toLowerCase().includes(query))
        .map(m => ({
          title: m.title,
          id: m.id,
          content: m.content,
          summary: m.summary,
        }));
    } catch {
      return [];
    }
  }

  renderSuggestion(value: any, el: HTMLElement) {
    el.addClass('cortex-suggest-item');
    
    const titleEl = el.appendChild(document.createElement('div'));
    titleEl.className = 'cortex-suggest-title';
    titleEl.textContent = value.title;
    
    const summaryEl = el.appendChild(document.createElement('div'));
    summaryEl.className = 'cortex-suggest-summary';
    summaryEl.textContent = value.summary?.slice(0, 50) || 'No summary';
  }

  async onSuggest(value: any, editor: Editor, context: EditorSuggestContext) {
    // Replace trigger with memory reference
    const replacement = `[[Cortex/Memories/${value.id.slice(0, 20)}|${value.title}]]`;
    
    editor.replaceRange(replacement, context.start, context.end);
  }
}