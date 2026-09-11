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
COPY Apk-builder/packageids.json ./Apk-builder/packageids.json

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

COPY --from=builder /src/backend/package.json /src/backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund --ignore-scripts

COPY --from=builder /src/backend/ ./backend/
# The dashboard serves package suggestions from this static pool. The runtime
# image only copies backend/ (not the full source tree), so include the pool
# explicitly for /api/build/packageids.
COPY --from=builder /src/Apk-builder/packageids.json ./backend/packageids.json
COPY frps/ ./frps/
COPY frpc/ ./frpc/

EXPOSE 5000 7000 6009 8070

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/server.js"]
