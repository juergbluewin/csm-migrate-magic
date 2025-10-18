FROM node:18-alpine

WORKDIR /app

# Copy proxy source (includes node_modules if present)
COPY proxy/ ./

RUN npm config set fetch-timeout 300000 && \
  npm config set fetch-retries 5 && \
  npm config set strict-ssl false && \
  (npm ci || npm install --registry=https://registry.npmmirror.com --fetch-timeout=300000) && \
  (npx tsc -p . || ./node_modules/.bin/tsc -p . || tsc -p .) && \
  npm prune --omit=dev

# Expose proxy port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Start proxy
CMD ["node", "dist/server.js"]
