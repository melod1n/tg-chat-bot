# Telegram Chat Bot

Bot for Telegram with a lot of commands and AI (Ollama/Mistral/OpenAI) written in TypeScript + NodeJS/Bun runtime + SQLite/PostgreSQL/in-memory storage

## Quick Start

```bash
cp .env.example .env
# Edit .env: add BOT_TOKEN, CREATOR_ID and configure optional AI models (MISTRAL_API_KEY, OPENAI_API_KEY, OLLAMA_ADDRESS)
# Optional: set DATABASE_URL to postgres://... for PostgreSQL or :memory: for ephemeral SQLite.
# Optional: set DATA_PATH if you want to override the default local storage directory.
```

**With Bun (Recommended):**
```bash
bun install
bun run build && bun start
```

**With Node.js:**
```bash
npm install
npm run build && npm start
```

The bot initializes and migrates its database schema automatically on startup.
`/exportdb` sends the SQLite file when available, plus a `.sql` dump and a JSON backup.
`/importdb` restores the database from the JSON backup format.

MCP tool servers can be configured through `MCP_SERVERS` in `.env`. Use a JSON array with `stdio` or `http` transports. Example:

```bash
MCP_SERVERS=[{"name":"local-tools","transport":"stdio","command":"node","args":["./mcp-server.js"]}]
```

If you want to disable all built-in local tools and use only MCP tools, set:

```bash
DISABLE_LOCAL_TOOLS=true
```

If you want a partial filter instead, use tool names:

```bash
LOCAL_TOOL_ALLOWLIST=get_datetime,web_search
LOCAL_TOOL_DENYLIST=shell_execute,python_interpreter
```

For local Ollama document RAG, install an embedding model locally and set it in `.env`:

```bash
ollama pull nomic-embed-text
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Tool ranker fallback is configurable via `TOOL_RANKER_FALLBACK_POLICY`:

- `MAIN_MODEL` - use the provider's main chat model to rank tools if a dedicated ranker target is missing or fails
- `ALL_TOOLS` - skip tool ranking fallback and allow all tools
- `NO_TOOLS` - skip tool ranking fallback and allow no tools

The default is `ALL_TOOLS`.

**With Docker Compose:**
```bash
docker compose up -d
```
Set `IMAGE_TAG` in `.env` if you want to override the pinned release tag used by `docker-compose.yml`.

**With Docker:**
```bash
docker build -f Dockerfile -t tg-bot .
docker run -d --env-file .env -v $(pwd)/data:/config/data tg-bot
```

**With Docker (Bun):**
```bash
docker build -f Dockerfile-bun -t tg-bot-bun .
docker run -d --env-file .env -v $(pwd)/data:/config/data tg-bot-bun
```

## Requirements

- Node.js >= 20.19 OR Bun >= 1.0
- Docker (optional)


## Features

- AI chat (Mistral, Ollama, OpenAI)
- Local document RAG for Ollama without third-party providers
- Custom answers and commands
- Admin management
- User blocking (mute/unmute)
- QR code generation
- System info
- And more...
