FROM node:22-bookworm-slim

# This image installs **nothing** beyond the Node.js base. Every other tool the
# worker needs (OpenJDK 17, python3, pip, curl, unzip, zip, git, the Android
# SDK, the Gradle wrapper, pyzipper) is installed by build.sh itself on the
# worker's first cold start, then cached on the container's writable
# filesystem for every subsequent job.
#
# Why: keeps the image build seconds long, mirrors what build.sh does on a
# bare VPS, and means there's only one place (build.sh) that decides which
# versions of Java / SDK / Gradle the worker needs.

WORKDIR /app
COPY . .

# Default control port for the worker's HTTP surface (server.js).
# The worker reaches the backend via BUILD_URL and authenticates with
# BUILD_API_KEY, both supplied at runtime by the host (Zeabur/Render/Fly/etc).
ENV PORT=7000
# One job at a time — fits a 1 CPU / 1 GB RAM / 1 GB disk container.
ENV BUILD_MAX_PARALLEL=1
EXPOSE 7000

CMD ["node", "/app/server.js"]
