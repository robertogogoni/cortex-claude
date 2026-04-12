/**
 * Cortex - Universal Ingestion Pipeline
 * 
 * Transforms unstructured data from external sources (Beeper, WhatsApp, SimpleNote, etc.)
 * into structured cognitive memories and injects them directly into the neural network.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateId, expandPath } = require('./types.cjs');
const { NeuralNetwork } = require('./neural-network.cjs');
const { ExtractionEngine } = require('../hooks/extraction-engine.cjs');
const { JSONLStore } = require('./storage.cjs');

class IngestionPipeline {
  constructor(options = {}) {
    this.basePath = expandPath(options.basePath || '~/.claude/memory');
    this.neuralNetwork = new NeuralNetwork({ basePath: path.join(this.basePath, 'neural') });
    this.extractionEngine = new ExtractionEngine({
      basePath: this.basePath,
      confidenceThreshold: 0.4, // Lower threshold for unstructured external data
      minSessionLength: 1,
    });
  }

  async initialize() {
    await this.neuralNetwork.initialize();
  }

  /**
   * Process a file based on its extension and structure
   */
  async ingestFile(filePath, sourceType = 'auto') {
    const fullPath = expandPath(filePath);
    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);

    const ext = path.extname(fullPath).toLowerCase();
    let content = '';
    let messages = [];

    // Auto-detect format
    if (sourceType === 'auto') {
      if (ext === '.json') sourceType = 'beeper';
      else if (ext === '.md') sourceType = 'markdown';
      else if (ext === '.vtt' || ext === '.srt') sourceType = 'transcript';
      else if (['.mp3', '.wav', '.m4a', '.ogg'].includes(ext)) {
        sourceType = 'audio';
      } else {
        content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes(' - ') && content.includes(':')) sourceType = 'whatsapp';
        else sourceType = 'generic-text';
      }
    }

    if (sourceType !== 'audio' && !content) {
      content = fs.readFileSync(fullPath, 'utf8');
    }

    // Parse into pseudo-conversational chunks for the Extraction Engine
    switch (sourceType) {
      case 'audio':
        messages = await this._processAudio(fullPath);
        break;
      case 'transcript':
        messages = this._parseTranscript(content);
        break;
      case 'whatsapp':
        messages = this._parseWhatsApp(content);
        break;
      case 'beeper':
        messages = this._parseBeeper(content);
        break;
      case 'markdown':
      case 'simplenote':
        messages = this._parseMarkdown(content);
        break;
      case 'generic-text':
      default:
        messages = this._parseGenericText(content);
        break;
    }

    if (messages.length === 0) throw new Error('No valid content could be parsed from the file.');

    // Run extraction
    const sessionId = `ingest_${Date.now()}`;
    const extractionResult = await this.extractionEngine.extract({
      messages,
      sessionId,
      context: { intent: 'archival', source: sourceType, projectHash: 'external' }
    });

    // Add directly to Neural Network
    const neurons = [];
    for (const memory of extractionResult.extracted) {
      // Force source attribute
      memory._source = `ingest:${sourceType}`;
      memory._sourceFile = fullPath;
      
      const neuron = this.neuralNetwork.addNeuron(memory);
      neurons.push(neuron);
    }

    // Save neural state
    await this.neuralNetwork.save();

    // Optionally save to standard JSONL store (long-term memory)
    if (extractionResult.extracted.length > 0) {
      const store = new JSONLStore(path.join(this.basePath, 'data', 'memories', 'long-term.jsonl'));
      for (const memory of extractionResult.extracted) {
        store.upsert(memory.id, memory);
      }
    }

    return {
      success: true,
      sourceType,
      messagesParsed: messages.length,
      memoriesExtracted: extractionResult.extracted.length,
      neuronsCreated: neurons.length,
      extractions: extractionResult.extracted
    };
  }

  /**
   * Triggers a dream cycle specifically to wire up the newly ingested memories
   */
  async consolidateIngestion() {
    return await this.neuralNetwork.dreamConsolidate();
  }

  // --- Parsers ---

  _parseWhatsApp(content) {
    // Format: [Date Time] Sender: Message or Date, Time - Sender: Message
    const lines = content.split('\n');
    const messages = [];
    let currentMessage = null;

    const regex = /^\[?(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})[, ]\s*(\d{1,2}:\d{2}(?::\d{2})?(?: [AP]M)?)\]?\s*[\-]?\s*([^:]+):\s*(.+)/;

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        if (currentMessage) messages.push(currentMessage);
        currentMessage = {
          role: 'user', // Treat all participants as users offering context
          content: match[4],
          sender: match[3],
        };
      } else if (currentMessage) {
        currentMessage.content += '\n' + line;
      }
    }
    if (currentMessage) messages.push(currentMessage);
    return messages;
  }

  _parseBeeper(content) {
    try {
      const data = JSON.parse(content);
      const messages = [];
      const events = Array.isArray(data) ? data : (data.messages || data.events || []);
      
      for (const event of events) {
        if (event.text || (event.content && event.content.body)) {
          messages.push({
            role: 'user',
            content: event.text || event.content.body,
            sender: event.sender || 'unknown'
          });
        }
      }
      return messages;
    } catch {
      return this._parseGenericText(content);
    }
  }

  _parseMarkdown(content) {
    // Split by headings to create topical chunks
    const chunks = content.split(/(?=^#+ )/m);
    return chunks.map(chunk => ({
      role: 'user',
      content: chunk.trim()
    })).filter(m => m.content.length > 0);
  }

  _parseGenericText(content) {
    // Split by double newline to create paragraphs
    const chunks = content.split(/\n\n+/);
    return chunks.map(chunk => ({
      role: 'user',
      content: chunk.trim()
    })).filter(m => m.content.length > 0);
  }

  // --- Voice and Audio Parsers ---

  async _processAudio(filePath) {
    console.log(`[Ingestion] Native Audio ingestion started: ${filePath}`);
    const { execSync } = require('child_process');

    let audioData;
    try {
      console.log(`[Ingestion] Extracting audio footprint via ffmpeg...`);
      // Convert to 16kHz mono 16-bit PCM (standard for Whisper)
      const rawPcm = execSync(`ffmpeg -i "${filePath}" -ar 16000 -ac 1 -f s16le - 2>/dev/null`);
      audioData = new Float32Array(rawPcm.length / 2);
      for (let i = 0; i < audioData.length; i++) {
        audioData[i] = rawPcm.readInt16LE(i * 2) / 32768.0;
      }
    } catch (e) {
      throw new Error(`[Ingestion] Failed to decode audio. Is ffmpeg installed? Error: ${e.message}`);
    }

    console.log(`[Ingestion] Booting local Whisper inference engine...`);
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = true;
    
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      quantized: true,
    });

    console.log(`[Ingestion] Transcribing ${Math.round(audioData.length / 16000)} seconds of audio...`);
    const output = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    console.log(`[Ingestion] Transcription complete.`);
    
    // Convert output chunks into the standard pseudo-vtt string format our parser expects
    const transcriptLines = output.chunks.map(chunk => {
      const formatTime = (secs) => {
        const d = new Date(secs * 1000);
        return d.toISOString().substr(11, 12);
      };
      const start = formatTime(chunk.timestamp[0]);
      const end = formatTime(chunk.timestamp[1] || chunk.timestamp[0] + 5);
      return `[${start} --> ${end}] ${chunk.text.trim()}`;
    }).join('\n');

    return this._parseTranscript(transcriptLines);
  }

  _parseTranscript(content) {
    // Basic parser for VTT or SRT style transcripts
    const lines = content.split('\n');
    const messages = [];
    let currentText = [];

    const timePattern = /^\s*\[?\d{2}:\d{2}:\d{2}/;

    for (const line of lines) {
      if (timePattern.test(line)) {
        // Line has a timestamp, the text usually follows or is on the next line
        const textPart = line.replace(/^.*?]\s*/, '').trim();
        if (textPart) {
          currentText.push(textPart);
        }
      } else if (line.trim().length > 0 && !line.includes('WEBVTT') && !/^\d+$/.test(line.trim())) {
        currentText.push(line.trim());
      }
    }
    
    if (currentText.length > 0) {
      // Chunk transcript every 5 sentences or so to create logical extraction blocks
      const fullText = currentText.join(' ');
      const chunks = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
      
      let block = [];
      for (let i = 0; i < chunks.length; i++) {
        block.push(chunks[i]);
        if (block.length >= 3 || i === chunks.length - 1) {
          messages.push({
            role: 'user',
            content: block.join(' ').trim(),
            sender: 'voice-note'
          });
          block = [];
        }
      }
    }
    
    return messages;
  }
}

module.exports = { IngestionPipeline };