#!/usr/bin/env node
// Ingest recent session messages into the vector index
// Reads JSONL transcript files directly from disk
// Runs as a cron job every minute

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const STATE_FILE = path.join(lib.DATA_DIR, 'session-ingest-state.json');
const SESSIONS_DIR = path.join(process.env.HOME || '/root', '.openclaw/agents/main/sessions');
const SESSIONS_INDEX = path.join(SESSIONS_DIR, 'sessions.json');

function loadState() {
  lib.ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) return { files: {}, lastRun: 0 };
  try { 
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); 
    if (!s.files) s.files = {};
    return s;
  }
  catch { return { files: {}, lastRun: 0 }; }
}

function saveState(state) {
  lib.ensureDataDir();
  state.lastRun = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getActiveSessionFiles() {
  // Read sessions index to find recently active sessions
  if (!fs.existsSync(SESSIONS_INDEX)) return [];
  
  const index = JSON.parse(fs.readFileSync(SESSIONS_INDEX, 'utf8'));
  const cutoff = Date.now() - (24 * 60 * 60 * 1000); // last 24h
  const files = [];
  
  for (const [key, entry] of Object.entries(index)) {
    if (!entry.sessionId) continue;
    const jsonlPath = path.join(SESSIONS_DIR, `${entry.sessionId}.jsonl`);
    if (!fs.existsSync(jsonlPath)) continue;
    
    const stat = fs.statSync(jsonlPath);
    // Only process files modified recently
    if (stat.mtimeMs < cutoff) continue;
    
    files.push({
      key,
      sessionId: entry.sessionId,
      path: jsonlPath,
      mtime: stat.mtimeMs,
      label: key.replace('agent:main:', ''),
    });
  }
  return files;
}

function parseJSONL(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const messages = [];
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      // OpenClaw JSONL format: { type: "message", message: { role, content }, timestamp }
      if (entry.type === 'message' && entry.message) {
        const msg = entry.message;
        msg._timestamp = entry.timestamp;
        msg._id = entry.id;
        messages.push(msg);
      }
      // Also handle flat format just in case
      else if (entry.role && entry.content) {
        messages.push(entry);
      }
    } catch {}
  }
  return messages;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('\n');
  }
  return '';
}

function shouldSkipMessage(msg) {
  if (msg.role === 'toolResult' || msg.role === 'tool' || msg.role === 'system') return true;
  const content = extractText(msg.content);
  if (!content || content.length < 10) return true;
  if (content.includes('HEARTBEAT_OK')) return true;
  if (content.includes('Read HEARTBEAT.md if it exists')) return true;
  if (content.trim() === 'NO_REPLY') return true;
  return false;
}

function formatMsg(msg, label) {
  const role = msg.role === 'user' ? 'Human' : 'Assistant';
  const content = extractText(msg.content);
  const truncated = content.length > 2000 ? content.slice(0, 2000) + '...' : content;
  return `[${label}] ${role}: ${truncated}`;
}

async function main() {
  const state = loadState();
  
  // Rate limit: don't run more often than every 50s
  if (Date.now() - state.lastRun < 50000) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'too_soon' }));
    return;
  }

  const sessionFiles = getActiveSessionFiles();
  if (sessionFiles.length === 0) {
    saveState(state);
    console.log(JSON.stringify({ status: 'ok', message: 'No active sessions' }));
    return;
  }

  let totalIngested = 0;
  let allNewTexts = [];
  let allNewMeta = [];

  for (const sf of sessionFiles) {
    const fileState = (state.files || {})[sf.sessionId] || {};
    const lastMtime = fileState.mtime || 0;
    const lastOffset = fileState.offset || 0;
    
    // Skip if file hasn't changed
    if (sf.mtime <= lastMtime) continue;
    
    // Read all messages, but only process ones after our last offset
    const messages = parseJSONL(sf.path);
    const newMessages = [];
    
    for (let i = lastOffset; i < messages.length; i++) {
      const msg = messages[i];
      if (shouldSkipMessage(msg)) continue;
      newMessages.push(msg);
    }
    
    if (newMessages.length === 0) {
      state.files[sf.sessionId] = { mtime: sf.mtime, offset: messages.length };
      continue;
    }
    
    // Group into chunks of ~5 messages for context
    const MSGS_PER_CHUNK = 5;
    for (let i = 0; i < newMessages.length; i += MSGS_PER_CHUNK) {
      const batch = newMessages.slice(i, i + MSGS_PER_CHUNK);
      const chunkText = batch.map(m => formatMsg(m, sf.label)).join('\n\n');
      if (chunkText.length < 30) continue;
      
      allNewTexts.push(chunkText);
      allNewMeta.push({
        source: `session:${sf.sessionId}`,
        label: sf.label,
        sessionId: sf.sessionId,
        timestamp: Date.now(),
      });
    }
    
    // Update state for this file
    state.files[sf.sessionId] = { mtime: sf.mtime, offset: messages.length };
  }
  
  if (allNewTexts.length === 0) {
    saveState(state);
    console.log(JSON.stringify({ status: 'ok', message: 'No new messages', sessions: sessionFiles.length }));
    return;
  }
  
  // Embed
  const truncated = allNewTexts.map(t => t.slice(0, 8000));
  const embeddings = await lib.getEmbeddings(truncated);
  
  // Add to index
  const docs = lib.loadIndex();
  const newDocs = allNewTexts.map((text, i) => ({
    id: `session:${allNewMeta[i].sessionId}:${allNewMeta[i].timestamp}:${i}`,
    file: allNewMeta[i].source,
    startLine: 0,
    endLine: 0,
    heading: `Chat: ${allNewMeta[i].label} (${new Date(allNewMeta[i].timestamp).toISOString().slice(0, 16)})`,
    text,
    vector: embeddings[i],
    indexedAt: Date.now(),
    meta: allNewMeta[i],
  }));
  
  lib.saveIndex([...docs, ...newDocs]);
  totalIngested = newDocs.length;
  
  saveState(state);
  console.log(JSON.stringify({
    status: 'ok',
    chunksIngested: totalIngested,
    totalIndex: docs.length + newDocs.length,
    sessionsChecked: sessionFiles.length,
  }));
}

main().catch(e => {
  console.error(JSON.stringify({ status: 'error', message: e.message, stack: e.stack }));
  process.exit(1);
});
