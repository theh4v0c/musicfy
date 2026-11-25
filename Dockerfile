# MUSICFY: one Node service plus ffmpeg and the two Python tools. The Node code has no
# npm dependencies; the images below exist for downloads and analysis.
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="MUSICFY" \
      org.opencontainers.image.description="Self-hosted music library, browser player and DJ prep bench" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/theh4v0c/musicfy"

ENV DEBIAN_FRONTEND=noninteractive \
    MUSICFY_HOME=/data \
    MUSICFY_OWNED=/music \
    MUSICFY_BIND=0.0.0.0 \
    MUSICFY_PORT=8710 \
    MUSICFY_YTDLP=/opt/venv/bin/yt-dlp \
    MUSICFY_PYTHON=/opt/venv/bin/python

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -U pip yt-dlp librosa numpy scipy

WORKDIR /app
COPY package.json README.md INSTALL.md OPERATIONS.md DOCS.md DESIGN.md MILESTONES.md CHANGELOG.md SECURITY.md CONTRIBUTING.md THIRD_PARTY.md LICENSE ./
COPY core ./core
COPY web ./web
COPY design ./design
COPY bin ./bin

RUN mkdir -p /data /music && chown -R node:node /data /music /app
USER node

EXPOSE 8710
VOLUME ["/data", "/music"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8710/health').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "core/core.js"]
