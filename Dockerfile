# ─── Global Arguments ────────────────────────────────────────────────────────
ARG NODE_VERSION=20.18.3-alpine3.21

# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps

WORKDIR /app

# Copy package files for deterministic dependency installation
COPY package.json package-lock.json ./

# Install dependencies (clean npm cache to minimize layer size)
RUN npm ci && \
    npm cache clean --force

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

# Reuse node_modules from deps stage to speed up build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# Build the Next.js standalone application
RUN npm run build

# ─── Stage 3: Runner (Hardened Runtime) ─────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner

# OCI Image Security & Metadata Labels
LABEL org.opencontainers.image.title="Lumigift Application" \
      org.opencontainers.image.description="Hardened production container for Lumigift" \
      org.opencontainers.image.vendor="Lumigift" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/joekeyz8/Lumigift-lumigift"

WORKDIR /app

# Set runtime environment
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME="0.0.0.0" \
    PORT=3000

# Install dumb-init for proper signal handling (SIGTERM/SIGINT) and zombie process reaping
# Clean apk cache and remove temporary files to minimize attack surface
RUN apk add --no-cache dumb-init=~1.2 && \
    rm -rf /var/cache/apk/* /tmp/*

# Create dedicated unprivileged system group and user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -G nodejs nextjs

# Pre-create app directory structure with correct ownership
RUN mkdir -p /app/.next /app/public /app/migrations && \
    chown -R nextjs:nodejs /app

# Copy only minimal standalone artifacts with non-root ownership (prevents extra chown layer)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations

# Switch to unprivileged non-root user
USER nextjs:nodejs

# Expose application port
EXPOSE 3000

# Container Health Check (uses Node.js built-in HTTP client - no curl/wget needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init as init system for signal forwarding and PID 1 management
ENTRYPOINT ["dumb-init", "--"]

# Start Next.js standalone server
CMD ["node", "server.js"]

