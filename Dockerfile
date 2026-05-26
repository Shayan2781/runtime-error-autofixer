FROM node:20-alpine

WORKDIR /app

# Native deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY client-sdk ./client-sdk
COPY docs ./docs

RUN mkdir -p /app/storage/sourcemaps

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:./storage/data.sqlite
ENV STORAGE_DIR=./storage

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server/src/index.js"]
