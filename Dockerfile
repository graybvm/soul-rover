# Build stage
FROM node:20.11.1-slim AS builder

# Set working directory
WORKDIR /app

# Copy package.json only
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Production stage
FROM node:20.11.1-slim

# Set working directory
WORKDIR /app

# Copy package.json only
COPY package.json ./

# Install production dependencies only
RUN npm install --production

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Create non-root user with home directory
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nodeuser nodeuser

# Set ownership
RUN chown -R nodeuser:nodejs /app

# Switch to non-root user
USER nodeuser

# Expose port
EXPOSE 80

# Start the application
CMD ["node", "--experimental-specifier-resolution=node", "dist/server.js"] 