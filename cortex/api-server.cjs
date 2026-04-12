#!/usr/bin/env node
/**
 * Cortex HTTP API Bridge
 *
 * Lightweight REST API server to expose Cortex memory to external
 * dashboards, Web UIs, or other AI agents without requiring MCP.
 */

'use strict';

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');

const { expandPath } = require('../core/types.cjs');
const { getVectorSearchProvider } = require('../core/vector-search-provider.cjs');

const CORTEX_HOME = expandPath('~/.claude/memory');
const PORT = process.env.CORTEX_API_PORT || 4000;

async function startServer() {
  console.log('🧠 Starting Cortex API Bridge...');

  // Initialize Search Provider
  const vsp = getVectorSearchProvider({ basePath: CORTEX_HOME });
  await vsp.initialize();
  console.log('✓ Vector Search Provider loaded');

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    try {
      // ----------------------------------------------------
      // GET /api/stats
      // ----------------------------------------------------
      if (req.method === 'GET' && parsedUrl.pathname === '/api/stats') {
        const stats = vsp.stats;
        const memoryCount = vsp._memoryStore.getCount();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          status: 'healthy',
          vectorIndexSize: stats.vectorIndexSize || memoryCount,
          totalMemories: memoryCount,
          uptime: process.uptime()
        }));
      }

      // ----------------------------------------------------
      // GET /api/search?q=keyword&limit=10
      // ----------------------------------------------------
      if (req.method === 'GET' && parsedUrl.pathname === '/api/search') {
        const query = parsedUrl.query.q || '';
        const limit = parseInt(parsedUrl.query.limit) || 10;
        
        const results = await vsp.search(query, { limit });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(results));
      }

      // ----------------------------------------------------
      // GET /api/memories?limit=50
      // ----------------------------------------------------
      if (req.method === 'GET' && parsedUrl.pathname === '/api/memories') {
        const limit = parseInt(parsedUrl.query.limit) || 50;
        const results = await vsp.search('', { limit });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(results));
      }

      // ----------------------------------------------------
      // POST /api/query
      // ----------------------------------------------------
      if (req.method === 'POST' && parsedUrl.pathname === '/api/query') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            const query = data.query || '';
            const limit = data.limit || 10;
            const results = await vsp.search(query, { limit });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          }
        });
        return;
      }

      // ----------------------------------------------------
      // Not Found
      // ----------------------------------------------------
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));

    } catch (error) {
      console.error('API Error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Cortex API Bridge running at: http://localhost:${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  GET  /api/stats`);
    console.log(`  GET  /api/search?q=keyword&limit=10\n`);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}