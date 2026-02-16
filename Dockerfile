# ---- build ----
FROM node:lts-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig*.json ./
RUN npm ci

COPY src ./src
COPY assets ./assets

RUN npx tsc -p tsconfig.build.json

# ---- runtime ----
FROM node:lts-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV IS_DOCKER=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

USER node

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/assets ./assets

CMD ["node", "dist/index.js"]