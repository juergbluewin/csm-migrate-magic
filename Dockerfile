# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code (exclude proxy folder)
COPY src/ ./src/
COPY public/ ./public/
COPY index.html tsconfig*.json vite.config.ts tailwind.config.ts postcss.config.js ./

# Build-time Vite vars
ARG VITE_PROXY_URL
ENV VITE_PROXY_URL=${VITE_PROXY_URL}

# Build the application
RUN npm run build

# Install serve to run the built application
RUN npm install -g serve

# Expose port 8080
EXPOSE 8080

# Start static server
CMD ["serve", "-s", "dist", "-l", "8080"]