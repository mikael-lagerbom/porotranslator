# Build stage: better-sqlite3 needs a toolchain to compile its native addon.
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

# Runtime stage: no toolchain, non-root.
FROM node:24-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p data && chown node:node data
USER node
CMD ["node", "src/index.ts"]
