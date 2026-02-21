---
name: vector-memory
description: Semantic vector search over workspace files, notes, and chat sessions using OpenAI embeddings. Use for recalling past conversations, finding relevant context, and searching across all workspace content.
---

# Vector Memory - Semantic Search

Semantic search over all workspace content using OpenAI embeddings.

## Usage

### Search (most common)
```bash
node skills/vector-memory/search.js "your query here" --limit 10 --min-score 0.3
```
Returns JSON with ranked results including file path, line numbers, score, and text preview.

### Index (rebuild)
```bash
# Incremental (only changed files)
node skills/vector-memory/index.js

# Full rebuild
node skills/vector-memory/index.js --full
```

### Ingest ad-hoc content
```bash
node skills/vector-memory/ingest.js --file /path/to/file.md
node skills/vector-memory/ingest.js --source "session-notes" --text "content here"
```

### Ingest chat sessions
```bash
node skills/vector-memory/ingest-sessions.js
```

## Configuration

Set via environment variables:
- `VECTOR_MEMORY_WORKSPACE` — workspace root (auto-detected if not set)
- `VECTOR_MEMORY_DATA_DIR` — index storage location (default: `./data` in skill dir)
- `OPENAI_API_KEY` — required, reads from env or `~/.clawdbot/.env` / `~/.openclaw/.env`

## Output Format
All commands output JSON. Search returns:
```json
{"query": "...", "results": [{"file": "...", "startLine": 1, "endLine": 10, "heading": "...", "score": 0.85, "preview": "..."}], "totalIndexed": 905}
```
