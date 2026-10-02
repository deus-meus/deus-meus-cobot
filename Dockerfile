FROM oven/bun:1-alpine

WORKDIR /app

# Install git and bash for repository operations in sandbox
RUN apk add --no-cache git bash

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source code
COPY tsconfig.json drizzle.config.ts biome.json ./
COPY src ./src

CMD ["bun", "run", "src/queue/worker.ts"]
