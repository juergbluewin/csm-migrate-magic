FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY proxy/package*.json ./

# Install dependencies
RUN npm install --production

# Copy proxy source
COPY proxy/ ./

# Install ts-node for TypeScript execution
RUN npm install -g ts-node typescript

# Expose proxy port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Start proxy
CMD ["ts-node", "server.ts"]
