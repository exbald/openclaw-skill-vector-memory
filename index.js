#!/usr/bin/env node
// Indexer - crawls workspace and creates vector embeddings
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const lib = require('./lib');

async function findFiles() {
  const patterns = [
    '*.md',
    'memory/**/*.md',
    'tasks/**/*.md',
    'crm/**/*.md',
    'skills/*/SKILL.md',
    'config/**/*.md',
    'projects/**/*.md',
  ];
  const files = new Set();
  for (const pat of patterns) {
    const matches = await glob(pat, { cwd: lib.WORKSPACE, absolute: true });
    matches.forEach(f => files.add(f));
  }
  return [...files].sort();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node index.js [--full]\n\nIndex workspace files for semantic search.\n\nOptions:\n  --full    Full rebuild (ignore cache)\n  --help    Show this help');
    process.exit(0);
  }
  const full = args.includes('--full');
  
  const files = await findFiles();
  const fileMeta = full ? {} : lib.loadFileMeta();
  const existingDocs = full ? [] : lib.loadIndex();
  
  // Determine which files need reindexing
  const toIndex = [];
  const currentFiles = new Set();
  
  for (const file of files) {
    const stat = fs.statSync(file);
    const mtime = stat.mtimeMs;
    const relPath = path.relative(lib.WORKSPACE, file);
    currentFiles.add(relPath);
    
    if (!full && fileMeta[relPath] && fileMeta[relPath].mtime >= mtime) {
      continue; // unchanged
    }
    toIndex.push({ absPath: file, relPath, mtime });
  }
  
  if (toIndex.length === 0) {
    console.log(JSON.stringify({ status: 'ok', message: 'No files changed', totalChunks: existingDocs.length }));
    return;
  }
  
  // Remove old chunks for files being reindexed
  const reindexPaths = new Set(toIndex.map(f => f.relPath));
  const keptDocs = existingDocs.filter(d => !reindexPaths.has(d.file) && currentFiles.has(d.file));
  
  // Chunk all files to index
  const allChunks = [];
  for (const { absPath, relPath } of toIndex) {
    const content = fs.readFileSync(absPath, 'utf8');
    const chunks = lib.chunkMarkdown(content, relPath);
    allChunks.push(...chunks);
  }
  
  if (allChunks.length === 0) {
    console.log(JSON.stringify({ status: 'ok', message: 'No content to index', totalChunks: keptDocs.length }));
    lib.saveIndex(keptDocs);
    return;
  }
  
  // Get embeddings in batches
  const texts = allChunks.map(c => c.text.slice(0, 8000));
  const embeddings = await lib.getEmbeddings(texts);
  
  // Build new docs
  const newDocs = allChunks.map((chunk, i) => ({
    id: `${chunk.file}:${chunk.startLine}`,
    file: chunk.file,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    heading: chunk.heading,
    text: chunk.text,
    vector: embeddings[i],
    indexedAt: Date.now(),
  }));
  
  const finalDocs = [...keptDocs, ...newDocs];
  lib.saveIndex(finalDocs);
  
  // Update file meta
  const newMeta = { ...fileMeta };
  // Remove files that no longer exist
  for (const key of Object.keys(newMeta)) {
    if (!currentFiles.has(key)) delete newMeta[key];
  }
  for (const { relPath, mtime } of toIndex) {
    newMeta[relPath] = { mtime };
  }
  lib.saveFileMeta(newMeta);
  
  console.log(JSON.stringify({
    status: 'ok',
    filesIndexed: toIndex.length,
    chunksAdded: newDocs.length,
    totalChunks: finalDocs.length,
    files: toIndex.map(f => f.relPath),
  }));
}

main().catch(e => {
  console.error(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
