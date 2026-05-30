# syntax=docker/dockerfile:1.7

############################
# Stage 1 — clone repo + build the React dashboard
############################
FROM node:22-alpine AS builder

RUN apk add --no-cache git

WORKDIR /src
RUN git clone https://github.com/lastie357-droid/Testing .

RUN cd backend && npm ci --no-audit --no-fund --ignore-scripts
RUN cd backend && npm run build

############################
# Stage 2 — minimal runtime
############################
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    BUILD_URL=http://localhost:5000

RUN apk add --no-cache tini ca-certificates curl bash

COPY --from=builder /src/backend/package.json /src/backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund --ignore-scripts

COPY --from=builder /src/backend/ ./backend/
COPY --from=builder /src/frps/   ./frps/
COPY --from=builder /src/frpc/   ./frpc/

EXPOSE 5000 7000 6009

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "backend/server.js"]
