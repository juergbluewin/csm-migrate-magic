# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies needed for Vite build)
RUN npm ci --prefer-offline --no-audit

# Copy source code and config files
COPY src/ ./src/
COPY public/ ./public/
COPY index.html ./
COPY tsconfig*.json ./
COPY vite.config.ts tailwind.config.ts postcss.config.js ./

# Build-time Vite vars
ARG VITE_PROXY_URL
ENV VITE_PROXY_URL=${VITE_PROXY_URL}

# Build the application
RUN npm run build

# Expose port 8080
EXPOSE 8080

# Start static server using npx (no global install needed)
CMD ["npx", "serve", "-s", "dist", "-l", "8080"]