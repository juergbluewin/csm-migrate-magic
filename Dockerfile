# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build-time Vite vars
ARG VITE_PROXY_URL
ENV VITE_PROXY_URL=${VITE_PROXY_URL}

# Build the application
RUN npm run build

# Install serve to run the built application
RUN npm install -g serve

# Expose port 3000
EXPOSE 3000

# Start the application (custom local proxy + static hosting)
CMD ["node", "server/local-proxy.js"]