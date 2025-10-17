FROM node:18-alpine

WORKDIR /app

# Copy proxy source (includes node_modules if present)
COPY proxy/ ./

# Use preinstalled node_modules if available; otherwise install production deps with fallbacks
RUN if [ -d "node_modules" ]; then \
  echo "Using preinstalled node_modules"; \
else \
  npm config set fetch-timeout 300000 && \
  npm config set fetch-retries 5 && \
  npm config set strict-ssl false && \
  (npm ci --omit=dev || npm install --omit=dev --registry=https://registry.npmmirror.com --fetch-timeout=300000); \
fi && \
  if [ -f "tsconfig.json" ] && [ -x "./node_modules/.bin/tsc" ]; then \
    ./node_modules/.bin/tsc; \
  else \
    echo "Skipping TS compile (typescript missing)"; \
  fi

# Expose proxy port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Start proxy: prefer compiled JS; fallback to ts-node if needed
CMD ["/bin/sh", "-c", "if [ -f dist/server.js ]; then node dist/server.js; else npx ts-node server.ts; fi"]
