FROM node:22-bookworm-slim

# build.sh needs: bash, python3 (+pip for pyzipper), curl, OpenJDK 17 for gradle,
# unzip/zip for the Android cmdline-tools and APK rebuild, plus standard GNU
# coreutils. We must use a glibc-based image (NOT Alpine/musl) because the
# Android SDK binaries (aapt2, apksigner, d8, ...) are dynamically linked
# against glibc and crash with "not found" errors on musl.
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        findutils \
        coreutils \
        git \
        openjdk-17-jdk-headless \
        python3 \
        python3-pip \
        unzip \
        zip \
    && rm -rf /var/lib/apt/lists/*

# Pre-install pyzipper so build.sh doesn't have to fetch it on every cold build.
RUN pip3 install --no-cache-dir --break-system-packages pyzipper

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

COPY . .

RUN chmod +x /app/build.sh /app/gradlew

# Default control port for the worker's HTTP surface (server.js).
# The worker reaches the backend via BUILD_URL and authenticates with BUILD_API_KEY,
# both of which must be supplied at runtime by the host (Zeabur/Render/Fly/etc).
ENV PORT=7000
EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "/app/server.js"]
