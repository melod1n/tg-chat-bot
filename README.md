# Telegram Chat Bot


## Quick Start

```bash
cp .env.example .env
# Edit .env: add BOT_TOKEN and CREATOR_ID or
```

**With Bun (Recommended):**
```bash
bun install
bunx drizzle-kit generate && bunx drizzle-kit migrate
bun run build && bun start
```

**With Node.js:**
```bash
npm install
npx drizzle-kit generate && npx drizzle-kit migrate
npm run build && npm start
```

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

- Node.js >= 18 OR Bun >= 1.0
- Docker (optional)


## Features

- AI chat (Gemini, Mistral, Ollama)
- Custom answers and commands
- Admin management
- User blocking (mute/unmute)
- QR code generation
- System info
- And more...
