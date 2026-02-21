#!/usr/bin/env node
// Ingest ad-hoc content into the vector index
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

async function main() {
  const args = process.argv.slice(2);
  let source = 'adhoc', text = '', filePath = '';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) { source = args[++i]; }
    else if (args[i] === '--text' && args[i + 1]) { text = args[++i]; }
    else if (args[i] === '--file' && args[i + 1]) { filePath = args[++i]; }
  }
  
  if (args.includes('--help') || args.includes('-h') || (!text && !filePath)) {
    console.error('Usage: node ingest.js --file /path/to/file.md\n       node ingest.js --source "name" --text "content"\n\nIngest ad-hoc content into the vector index.\n\nOptions:\n  --file PATH     File to ingest\n  --source NAME   Source label (default: filename or "adhoc")\n  --text TEXT     Raw text to ingest\n  --help, -h      Show this help');
    process.exit(text || filePath ? 0 : 1);
  }
  
  if (filePath) {
    text = fs.readFileSync(filePath, 'utf8');
    source = source === 'adhoc' ? path.basename(filePath) : source;
  }
  
  const chunks = lib.chunkMarkdown(text, `ingest:${source}`);
  if (chunks.length === 0) {
    console.log(JSON.stringify({ status: 'ok', message: 'No content to ingest' }));
    return;
  }
  
  const embeddings = await lib.getEmbeddings(chunks.map(c => c.text.slice(0, 8000)));
  
  const docs = lib.loadIndex();
  // Remove old chunks from same source
  const filtered = docs.filter(d => d.file !== `ingest:${source}`);
  
  const newDocs = chunks.map((chunk, i) => ({
    id: `ingest:${source}:${i}`,
    file: `ingest:${source}`,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    heading: chunk.heading,
    text: chunk.text,
    vector: embeddings[i],
    indexedAt: Date.now(),
  }));
  
  lib.saveIndex([...filtered, ...newDocs]);
  console.log(JSON.stringify({ status: 'ok', chunksIngested: newDocs.length, totalChunks: filtered.length + newDocs.length }));
}

main().catch(e => {
  console.error(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
