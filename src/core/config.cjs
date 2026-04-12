/**
 * Cortex - Claude's Cognitive Layer - Configuration Manager
 *
 * Configuration with:
 * - Version tracking and history
 * - Safe updates with validation
 * - Path resolution (~/paths)
 * - Default merging
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG, generateId, getTimestamp, expandPath } = require('./types.cjs');

// =============================================================================
// CONFIG VALIDATOR
// =============================================================================

class ConfigValidator {
  /**
   * Validate configuration object
   * @param {Object} config
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate(config) {
    const errors = [];

    // Required version
    if (!config.version) {
      errors.push('Missing required field: version');
    }

    // Validate sessionStart
    if (config.sessionStart) {
      if (typeof config.sessionStart.enabled !== 'boolean') {
        errors.push('sessionStart.enabled must be a boolean');
      }
      if (config.sessionStart.timeoutMs && typeof config.sessionStart.timeoutMs !== 'number') {
        errors.push('sessionStart.timeoutMs must be a number');
      }
      if (config.sessionStart.slots) {
        const slots = config.sessionStart.slots;
        if (slots.maxTotal && (slots.maxTotal < 1 || slots.maxTotal > 20)) {
          errors.push('sessionStart.slots.maxTotal must be between 1 and 20');
        }
        if (slots.maxTokens && (slots.maxTokens < 100 || slots.maxTokens > 10000)) {
          errors.push('sessionStart.slots.maxTokens must be between 100 and 10000');
        }
      }
    }

    // Validate sessionEnd
    if (config.sessionEnd) {
      if (typeof config.sessionEnd.enabled !== 'boolean') {
        errors.push('sessionEnd.enabled must be a boolean');
      }
      if (config.sessionEnd.extractionThreshold !== undefined) {
        const threshold = config.sessionEnd.extractionThreshold;
        if (threshold < 0 || threshold > 1) {
          errors.push('sessionEnd.extractionThreshold must be between 0 and 1');
        }
      }
    }

    // Validate queryOrchestrator
    if (config.queryOrchestrator) {
      if (config.queryOrchestrator.defaultTimeout !== undefined) {
        const timeout = config.queryOrchestrator.defaultTimeout;
        if (timeout < 50 || timeout > 10000) {
          errors.push('queryOrchestrator.defaultTimeout must be between 50 and 10000');
        }
      }
      if (config.queryOrchestrator.sources) {
        for (const source of config.queryOrchestrator.sources) {
          if (!source.name) {
            errors.push('queryOrchestrator.sources: each source must have a name');
          }
          if (source.priority !== undefined && (source.priority < 0 || source.priority > 1)) {
            errors.push(`queryOrchestrator.sources.${source.name}: priority must be between 0 and 1`);
          }
        }
      }
    }

    // Validate ladsCore
    if (config.ladsCore?.evolution) {
      const evolution = config.ladsCore.evolution;
      if (evolution.maxChangePercent !== undefined) {
        if (evolution.maxChangePercent < 0.01 || evolution.maxChangePercent > 0.5) {
          errors.push('ladsCore.evolution.maxChangePercent must be between 0.01 and 0.5');
        }
      }
    }

    // Validate storage
    if (config.storage) {
      if (config.storage.maxSizeMB !== undefined) {
        if (config.storage.maxSizeMB < 10 || config.storage.maxSizeMB > 1000) {
          errors.push('storage.maxSizeMB must be between 10 and 1000');
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// =============================================================================
// CONFIG MANAGER
// =============================================================================

class ConfigManager {
  /**
   * @param {Object} options
   * @param {string} options.configPath - Path to config file
   * @param {string} options.historyDir - Path to config history directory
   * @param {number} options.maxHistory - Max history entries to keep
   */
  constructor(options = {}) {
    this.configPath = expandPath(options.configPath || '~/.claude/memory/data/configs/current.json');
    this.historyDir = expandPath(options.historyDir || '~/.claude/memory/data/configs/history');
    this.maxHistory = options.maxHistory || 50;

    this.validator = new ConfigValidator();

    // Current config
    this.config = null;
    this.loaded = false;

    // Change callbacks
    this.changeCallbacks = [];
  }

  /**
   * Ensure directories exist
   */
  _ensureDirectories() {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Deep merge two objects
   * @param {Object} target
   * @param {Object} source
   * @returns {Object}
   */
  _deepMerge(target, source) {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Load configuration from disk
   * @returns {{success: boolean, config?: Object, error?: string}}
   */
  load() {
    this._ensureDirectories();

    if (!fs.existsSync(this.configPath)) {
      // Create default config
      this.config = { ...DEFAULT_CONFIG };
      this.save('Initial configuration');
      this.loaded = true;
      return { success: true, config: this.config };
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf8');
      const fileConfig = JSON.parse(content);

      // Merge with defaults (ensures new fields are added)
      this.config = this._deepMerge(DEFAULT_CONFIG, fileConfig);
      this.loaded = true;

      return { success: true, config: this.config };
    } catch (error) {
      // Try to recover from history
      const recovered = this._recoverFromHistory();
      if (recovered) {
        this.config = recovered;
        this.loaded = true;
        return { success: true, config: this.config, recovered: true };
      }

      // Use defaults
      this.config = { ...DEFAULT_CONFIG };
      this.loaded = true;
      return { success: true, config: this.config, usedDefaults: true };
    }
  }

  /**
   * Save current configuration
   * @param {string} reason - Reason for the change
   * @returns {{success: boolean, error?: string}}
   */
  save(reason = 'Manual save') {
    if (!this.config) {
      return { success: false, error: 'No config loaded' };
    }

    // Validate
    const validation = this.validator.validate(this.config);
    if (!validation.valid) {
      return { success: false, error: `Invalid config: ${validation.errors.join(', ')}` };
    }

    this._ensureDirectories();

    // Save to history first
    this._saveToHistory(reason);

    // Save current config
    try {
      const content = JSON.stringify(this.config, null, 2);
      const tempPath = `${this.configPath}.tmp.${process.pid}`;
      fs.writeFileSync(tempPath, content, { mode: 0o600 });
      fs.renameSync(tempPath, this.configPath);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Save current config to history
   * @param {string} reason
   */
  _saveToHistory(reason) {
    const historyEntry = {
      id: generateId(),
      timestamp: getTimestamp(),
      reason,
      config: { ...this.config },
    };

    const filename = `${historyEntry.timestamp.replace(/[:.]/g, '-')}_${historyEntry.id}.json`;
    const filepath = path.join(this.historyDir, filename);

    try {
      fs.writeFileSync(filepath, JSON.stringify(historyEntry, null, 2), { mode: 0o600 });

      // Prune old history
      this._pruneHistory();
    } catch (error) {
      console.error('[ConfigManager] Failed to save history:', error.message);
    }
  }

  /**
   * Prune old history files
   */
  _pruneHistory() {
    try {
      const files = fs.readdirSync(this.historyDir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.historyDir, f),
          time: fs.statSync(path.join(this.historyDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      // Keep only maxHistory files
      for (const file of files.slice(this.maxHistory)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      // Ignore pruning errors
    }
  }

  /**
   * Recover config from history
   * @returns {Object|null}
   */
  _recoverFromHistory() {
    try {
      const files = fs.readdirSync(this.historyDir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.historyDir, f),
          time: fs.statSync(path.join(this.historyDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      if (files.length === 0) return null;

      // Try each history file until one works
      for (const file of files) {
        try {
          const content = fs.readFileSync(file.path, 'utf8');
          const entry = JSON.parse(content);
          if (entry.config) {
            console.log(`[ConfigManager] Recovered config from ${file.name}`);
            return entry.config;
          }
        } catch {
          continue;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get a config value by path
   * @param {string} keyPath - Dot-separated path (e.g., 'sessionStart.slots.maxTotal')
   * @param {*} defaultValue
   * @returns {*}
   */
  get(keyPath, defaultValue = undefined) {
    if (!this.loaded) {
      this.load();
    }

    const parts = keyPath.split('.');
    let value = this.config;

    for (const part of parts) {
      if (value === undefined || value === null) {
        return defaultValue;
      }
      value = value[part];
    }

    return value !== undefined ? value : defaultValue;
  }

  /**
   * Set a config value by path
   * @param {string} keyPath
   * @param {*} value
   * @param {string} reason
   * @returns {{success: boolean, error?: string}}
   */
  set(keyPath, value, reason = 'Manual update') {
    if (!this.loaded) {
      this.load();
    }

    const parts = keyPath.split('.');
    const lastKey = parts.pop();
    let target = this.config;

    for (const part of parts) {
      if (target[part] === undefined) {
        target[part] = {};
      }
      target = target[part];
    }

    const oldValue = target[lastKey];
    target[lastKey] = value;

    // Validate
    const validation = this.validator.validate(this.config);
    if (!validation.valid) {
      // Revert
      target[lastKey] = oldValue;
      return { success: false, error: `Invalid config: ${validation.errors.join(', ')}` };
    }

    // Save and notify
    const saveResult = this.save(reason);
    if (saveResult.success) {
      this._notifyChange(keyPath, oldValue, value);
    }

    return saveResult;
  }

  /**
   * Update multiple config values
   * @param {Object} updates
   * @param {string} reason
   * @returns {{success: boolean, error?: string}}
   */
  update(updates, reason = 'Bulk update') {
    if (!this.loaded) {
      this.load();
    }

    const oldConfig = JSON.parse(JSON.stringify(this.config));

    // Apply updates
    this.config = this._deepMerge(this.config, updates);

    // Validate
    const validation = this.validator.validate(this.config);
    if (!validation.valid) {
      // Revert
      this.config = oldConfig;
      return { success: false, error: `Invalid config: ${validation.errors.join(', ')}` };
    }

    return this.save(reason);
  }

  /**
   * Rollback to a previous config version
   * @param {string} historyId - ID or timestamp of history entry
   * @returns {{success: boolean, error?: string}}
   */
  rollback(historyId) {
    try {
      const files = fs.readdirSync(this.historyDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        if (file.includes(historyId)) {
          const filepath = path.join(this.historyDir, file);
          const content = fs.readFileSync(filepath, 'utf8');
          const entry = JSON.parse(content);

          if (entry.config) {
            const oldConfig = this.config;
            this.config = entry.config;
            this.save(`Rollback to ${historyId}`);

            return { success: true, rolledBackFrom: oldConfig, rolledBackTo: entry };
          }
        }
      }

      return { success: false, error: 'History entry not found' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get config history
   * @param {number} limit
   * @returns {Object[]}
   */
  getHistory(limit = 10) {
    try {
      const files = fs.readdirSync(this.historyDir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.historyDir, f),
          time: fs.statSync(path.join(this.historyDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time)
        .slice(0, limit);

      return files.map(f => {
        try {
          const content = fs.readFileSync(f.path, 'utf8');
          const entry = JSON.parse(content);
          return {
            id: entry.id,
            timestamp: entry.timestamp,
            reason: entry.reason,
            filename: f.name,
          };
        } catch {
          return { filename: f.name, error: 'Failed to parse' };
        }
      });
    } catch {
      return [];
    }
  }

  /**
   * Register callback for config changes
   * @param {Function} callback
   */
  onChange(callback) {
    this.changeCallbacks.push(callback);
  }

  /**
   * Notify callbacks of config change
   * @param {string} keyPath
   * @param {*} oldValue
   * @param {*} newValue
   */
  _notifyChange(keyPath, oldValue, newValue) {
    for (const callback of this.changeCallbacks) {
      try {
        callback({ keyPath, oldValue, newValue, timestamp: getTimestamp() });
      } catch (error) {
        console.error('[ConfigManager] Callback error:', error.message);
      }
    }
  }

  /**
   * Get full configuration
   * @returns {Object}
   */
  getAll() {
    if (!this.loaded) {
      this.load();
    }
    return { ...this.config };
  }

  /**
   * Reset to default configuration
   * @returns {{success: boolean}}
   */
  reset() {
    this.config = { ...DEFAULT_CONFIG };
    return this.save('Reset to defaults');
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let instance = null;

function getConfigManager(options) {
  if (!instance) {
    instance = new ConfigManager(options);
  }
  return instance;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ConfigValidator,
  ConfigManager,
  getConfigManager,
  DEFAULT_CONFIG,
};
