FROM node:24-slim

# better-sqlite3 needs a toolchain to build its native addon.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

COPY src ./src

RUN mkdir -p /app/data
ENV DB_PATH=/app/data/config.db

CMD ["node", "src/index.ts"]
