# syntax=docker/dockerfile:1.7

############################
# Stage 1 — build the dashboard from this checkout
############################
FROM node:22-alpine AS builder

WORKDIR /src

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --no-audit --no-fund --ignore-scripts

COPY backend/ ./backend/
COPY react-dashboard/ ./react-dashboard/

RUN cd backend && npm run build

############################
# Stage 2 — minimal runtime
############################
FROM node:22-alpine AS runtime
WORKDIR /app

ARG SOURCE_REVISION=unknown

ENV NODE_ENV=production \
    PORT=5000 \
    BUILD_URL=http://localhost:5000

LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"

RUN apk add --no-cache tini ca-certificates curl bash

COPY package.json ./
COPY --from=builder /src/backend/package.json /src/backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund --ignore-scripts

COPY --from=builder /src/backend/ ./backend/
COPY --chmod=0555 frps/ ./frps/
COPY --chmod=0555 frpc/ ./frpc/

EXPOSE 5000 7000 6009 8070

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:5000/api/health >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/server.js"]
