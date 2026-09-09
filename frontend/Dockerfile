# syntax=docker/dockerfile:1
#
# Demo runtime image for the Warehouse Console (Next.js 16 + BFF).
#
# - Multi-stage: deps -> build -> minimal runtime.
# - Uses Next's `output: "standalone"` bundle (see next.config.ts) so the
#   runtime layer ships only the traced dependencies.
# - Runs as a non-root user.
# - API_BASE_URL / SESSION_COOKIE_NAME / COOKIE_SECURE are RUNTIME env only.
#   They are read server-side (route handlers are `force-dynamic`) and never
#   enter the browser bundle. Do NOT pass them as build args.
#
# Build:   docker build -t inventory-frontend:sha-<sha> frontend/
# Run:     provided by compose.demo.yml (frontend service, expose 3000 only)

# ---- deps: install exact locked dependencies -------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the production Next output ----------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: standalone server only -------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# BusyBox `wget` (bundled in node:alpine) is used by the healthcheck.
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# .next/standalone contains server.js + the minimal node_modules subset.
# static assets and /public are not included by the tracer and are copied
# explicitly.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Verifies the real production server renders a route (not just that the
# process is alive): /login is a Route + Server Component render.
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1

CMD ["node", "server.js"]
