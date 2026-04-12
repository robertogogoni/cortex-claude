/**
 * Cortex API for Obsidian Plugin
 * Communicates with Cortex MCP server and memory stores
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  summary?: string;
  type?: string;
  tags?: string[];
  source?: string;
  createdAt: string;
  extractionConfidence?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  summary: string;
  tags?: string[];
  confidence: number;
  source: string;
}

export interface VaultExportResult {
  success: boolean;
  exportRoot: string;
  recordCount: number;
  entityCount: number;
}

export class CortexAPI {
  private cortexPath: string;
  private memoryPath: string;

  constructor(cortexPath: string) {
    this.cortexPath = cortexPath.replace('~', process.env.HOME || '');
    this.memoryPath = path.join(this.cortexPath, 'data/memories');
  }

  /**
   * Search memories using Cortex hybrid search
   */
  async search(query: string, options: { limit?: number; type?: string }): Promise<SearchResult[]> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(this.cortexPath, 'bin/cortex.cjs'),
        'search',
        '--query',
        query,
        '--json',
      ];

      if (options.limit) {
        args.push('--limit', String(options.limit));
      }

      const proc = spawn('node', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const results = JSON.parse(output);
            resolve(results);
          } catch {
            resolve([]);
          }
        } else {
          reject(new Error('Search failed'));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Import a note into Cortex memory
   */
  async importNote(note: MemoryRecord): Promise<boolean> {
    return new Promise((resolve) => {
      const workingFile = path.join(this.memoryPath, 'working.jsonl');
      const line = JSON.stringify({
        ...note,
        importedAt: new Date().toISOString(),
        _source: 'obsidian-plugin',
      }) + '\n';

      fs.appendFile(workingFile, line, (err) => {
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
  async exportVault(vaultPath: string): Promise<VaultExportResult> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(this.cortexPath, 'bin/cortex.cjs'),
        'export-vault',
        '--vault-path',
        vaultPath.replace('~', process.env.HOME || ''),
        '--root-folder',
        'Cortex Atlas',
        '--json',
      ];

      const proc = spawn('node', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output);
            resolve(result);
          } catch {
            resolve({
              success: true,
              exportRoot: path.join(vaultPath.replace('~', process.env.HOME || ''), 'Cortex Atlas'),
              recordCount: 0,
              entityCount: 0,
            });
          }
        } else {
          reject(new Error('Export failed'));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<{
    totalRecords: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    vectorCount: number;
  }> {
    const stats = {
      totalRecords: 0,
      byType: {},
      bySource: {},
      vectorCount: 0,
    };

    // Count records in each memory file
    const memoryFiles = ['working.jsonl', 'short-term.jsonl', 'long-term.jsonl', 'insights.jsonl', 'learnings.jsonl'];
    
    for (const file of memoryFiles) {
      const filePath = path.join(this.memoryPath, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        stats.totalRecords += lines.length;

        // Parse lines for type/source stats
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record.type) {
              stats.byType[record.type] = (stats.byType[record.type] || 0) + 1;
            }
            if (record._source) {
              stats.bySource[record._source] = (stats.bySource[record._source] || 0) + 1;
            }
          } catch {
            // Skip invalid lines
          }
        }
      }
    }

    // Count vectors
    const vectorIndex = path.join(this.cortexPath, 'data/vector/index.bin');
    if (fs.existsSync(vectorIndex)) {
      const mappingFile = path.join(this.cortexPath, 'data/vector/mapping.json');
      if (fs.existsSync(mappingFile)) {
        const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
        stats.vectorCount = Object.keys(mapping).length;
      }
    }

    return stats;
  }

  /**
   * Get recent memories
   */
  async getRecent(limit: number = 10): Promise<MemoryRecord[]> {
    const workingFile = path.join(this.memoryPath, 'working.jsonl');
    if (!fs.existsSync(workingFile)) {
      return [];
    }

    const content = fs.readFileSync(workingFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as MemoryRecord[];
  }

  /**
   * Get entities from knowledge graph
   */
  async getEntities(): Promise<{ name: string; type: string; count: number }[]> {
    const kgFile = path.join(this.cortexPath, 'knowledge-graph.jsonl');
    if (!fs.existsSync(kgFile)) {
      return [];
    }

    const content = fs.readFileSync(kgFile, 'utf8');
    try {
      const graph = JSON.parse(content);
      return graph.entities || [];
    } catch {
      return [];
    }
  }

  /**
   * Trigger Cortex reflection on a topic
   */
  async reflect(topic: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(this.cortexPath, 'bin/cortex.cjs'),
        'reflect',
        '--topic',
        topic,
        '--json',
      ];

      const proc = spawn('node', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output);
            resolve(result.summary || result.content || '');
          } catch {
            resolve(output);
          }
        } else {
          reject(new Error('Reflection failed'));
        }
      });

      proc.on('error', reject);
    });
  }
}