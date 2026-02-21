// Shared utilities for vector memory system
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

// --- Configuration via env vars with smart defaults ---

function detectWorkspace() {
  // Explicit env var first
  if (process.env.VECTOR_MEMORY_WORKSPACE) return process.env.VECTOR_MEMORY_WORKSPACE;
  // Auto-detect: walk up from cwd looking for OpenClaw markers
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (['AGENTS.md', 'SOUL.md'].some(f => fs.existsSync(path.join(dir, f))) ||
        fs.existsSync(path.join(dir, 'memory'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function getDataDir() {
  return process.env.VECTOR_MEMORY_DATA_DIR || path.join(__dirname, 'data');
}

const WORKSPACE = detectWorkspace();
const DATA_DIR = getDataDir();
const INDEX_FILE = path.join(DATA_DIR, 'vectors.json');
const META_FILE = path.join(DATA_DIR, 'file-meta.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadIndex() {
  ensureDataDir();
  if (!fs.existsSync(INDEX_FILE)) return [];
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
}

function saveIndex(docs) {
  ensureDataDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(docs));
}

function loadFileMeta() {
  ensureDataDir();
  if (!fs.existsSync(META_FILE)) return {};
  return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
}

function saveFileMeta(meta) {
  ensureDataDir();
  fs.writeFileSync(META_FILE, JSON.stringify(meta));
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function getOpenAI() {
  // Direct env var takes priority; then try common .env locations
  if (!process.env.OPENAI_API_KEY) {
    const home = process.env.HOME || '/root';
    const envPaths = [
      path.join(home, '.clawdbot/.env'),
      path.join(home, '.openclaw/.env'),
      path.join(WORKSPACE, '.env'),
    ];
    for (const p of envPaths) loadEnvFile(p);
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function getEmbeddings(texts) {
  const openai = getOpenAI();
  const batches = [];
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const resp = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    batches.push(...resp.data.map(d => d.embedding));
  }
  return batches;
}

async function getEmbedding(text) {
  const [emb] = await getEmbeddings([text]);
  return emb;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Chunk a markdown document by headings, ~500-800 tokens per chunk
function chunkMarkdown(text, filePath) {
  const lines = text.split('\n');
  const chunks = [];
  let current = { lines: [], startLine: 1, heading: '' };

  function flush() {
    const content = current.lines.join('\n').trim();
    if (content.length < 20) return;
    
    const maxChars = 3000; // ~750 tokens
    if (content.length > maxChars) {
      const paragraphs = content.split(/\n\n+/);
      let buf = '', bufStart = current.startLine;
      let lineOffset = 0;
      
      for (const para of paragraphs) {
        if (buf.length + para.length > maxChars && buf.length > 100) {
          chunks.push({
            text: buf.trim(),
            file: filePath,
            startLine: bufStart,
            endLine: bufStart + buf.split('\n').length - 1,
            heading: current.heading,
          });
          buf = '';
          bufStart = current.startLine + lineOffset;
        }
        buf += (buf ? '\n\n' : '') + para;
        lineOffset += para.split('\n').length + 1;
      }
      if (buf.trim().length > 20) {
        chunks.push({
          text: buf.trim(),
          file: filePath,
          startLine: bufStart,
          endLine: current.startLine + current.lines.length - 1,
          heading: current.heading,
        });
      }
    } else {
      chunks.push({
        text: content,
        file: filePath,
        startLine: current.startLine,
        endLine: current.startLine + current.lines.length - 1,
        heading: current.heading,
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,3}\s/.test(line) && current.lines.length > 0) {
      flush();
      current = { lines: [line], startLine: i + 1, heading: line.replace(/^#+\s*/, '') };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return chunks;
}

module.exports = {
  DATA_DIR, INDEX_FILE, META_FILE, WORKSPACE,
  ensureDataDir, loadIndex, saveIndex, loadFileMeta, saveFileMeta,
  getOpenAI, getEmbeddings, getEmbedding, cosineSimilarity, chunkMarkdown,
};
