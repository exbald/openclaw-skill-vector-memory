# openclaw-skill-vector-memory

Semantic vector memory skill for [OpenClaw](https://github.com/nichochar/openclaw) — indexes workspace files and chat sessions for intelligent recall using OpenAI embeddings.

## What it does

- **Indexes** all markdown files in your OpenClaw workspace (memory, tasks, CRM, skills, projects)
- **Ingests** chat session transcripts from OpenClaw session logs
- **Searches** semantically — find relevant content by meaning, not just keywords
- Uses OpenAI `text-embedding-3-small` (1536 dimensions) with cosine similarity

## Installation

Clone into your OpenClaw `skills/` directory:

```bash
cd your-workspace/skills
git clone https://github.com/exbald/openclaw-skill-vector-memory.git vector-memory
cd vector-memory
npm install
```

## Configuration

| Env Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | **Required.** OpenAI API key | Reads from `~/.clawdbot/.env` or `~/.openclaw/.env` |
| `VECTOR_MEMORY_WORKSPACE` | Workspace root to index | Auto-detected (looks for `AGENTS.md`, `SOUL.md`, `memory/`) |
| `VECTOR_MEMORY_DATA_DIR` | Where to store the vector index | `./data` in skill directory |

## Usage

### Build the index
```bash
# Incremental (only changed files)
node index.js

# Full rebuild
node index.js --full
```

### Search
```bash
node search.js "what did we discuss about the API redesign" --limit 5
```

Returns JSON:
```json
{
  "query": "...",
  "results": [
    {
      "file": "memory/2025-01-15.md",
      "startLine": 10,
      "endLine": 25,
      "heading": "API Discussion",
      "score": 0.87,
      "preview": "..."
    }
  ],
  "totalIndexed": 905
}
```

### Ingest ad-hoc content
```bash
node ingest.js --file /path/to/document.md
node ingest.js --source "meeting-notes" --text "Today we decided to..."
```

### Ingest chat sessions
```bash
node ingest-sessions.js
```

Reads OpenClaw session JSONL files from `~/.openclaw/agents/main/sessions/`.

## How it works

1. **Chunking** — Markdown files are split by headings into ~500-800 token chunks
2. **Embedding** — Each chunk is embedded via OpenAI's `text-embedding-3-small` model
3. **Storage** — Vectors stored as JSON in `data/vectors.json` (brute-force, fast for <10k chunks)
4. **Search** — Query is embedded and compared via cosine similarity against all chunks
5. **Incremental** — File modification times are tracked; only changed files are re-embedded

## Architecture

```
lib.js              — Shared: embedding, chunking, cosine similarity, storage
index.js            — Workspace file indexer (crawls markdown files)
search.js           — Semantic search CLI
ingest.js           — Ad-hoc content ingestion
ingest-sessions.js  — OpenClaw chat session ingestion
data/               — Runtime data (gitignored, per-user)
```

## Requirements

- Node.js 18+
- OpenAI API key (for embeddings)
- OpenClaw workspace (optional — core search works standalone)

## Standalone use

The core (`lib.js` + `search.js`) works outside OpenClaw. Set `VECTOR_MEMORY_WORKSPACE` to any directory with markdown files, run `index.js`, then `search.js`.

## License

MIT
