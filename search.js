#!/usr/bin/env node
// Semantic search over indexed workspace content
const lib = require('./lib');

async function main() {
  const args = process.argv.slice(2);
  let query = '', limit = 10, minScore = 0.3;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) { limit = parseInt(args[++i]); }
    else if (args[i] === '--min-score' && args[i + 1]) { minScore = parseFloat(args[++i]); }
    else if (!args[i].startsWith('--')) { query = args[i]; }
  }
  
  if (!query || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node search.js "query" [--limit N] [--min-score 0.5]\n\nSemantic search over indexed workspace content.\n\nOptions:\n  --limit N        Max results (default: 10)\n  --min-score N    Minimum similarity score (default: 0.3)\n  --help, -h       Show this help');
    process.exit(query ? 0 : 1);
  }
  
  const docs = lib.loadIndex();
  if (docs.length === 0) {
    console.log(JSON.stringify({ results: [], message: 'Index empty. Run index.js first.' }));
    return;
  }
  
  const queryVec = await lib.getEmbedding(query);
  
  const scored = docs.map(doc => ({
    file: doc.file,
    startLine: doc.startLine,
    endLine: doc.endLine,
    heading: doc.heading,
    score: lib.cosineSimilarity(queryVec, doc.vector),
    preview: doc.text.slice(0, 300),
  }));
  
  scored.sort((a, b) => b.score - a.score);
  const results = scored.filter(r => r.score >= minScore).slice(0, limit);
  
  console.log(JSON.stringify({ query, results, totalIndexed: docs.length }));
}

main().catch(e => {
  console.error(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
