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

# Create a non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Set environment variables
ENV NODE_ENV=production
ENV OPENAI_BASE_URL=http://localmodel:65534/v1

# Change ownership of the app directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 80

# Start the application
CMD ["node", "--experimental-specifier-resolution=node", "dist/server.js"] 