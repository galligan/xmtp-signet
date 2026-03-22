# Dockerfile for xmtp-signet
# Bun runs TypeScript natively — no compile step needed.
FROM oven/bun:1.3.10-slim

WORKDIR /app

# Non-root user for production safety
RUN groupadd --gid 1001 signet && \
    useradd --uid 1001 --gid signet --shell /bin/sh --home-dir /home/signet signet && \
    mkdir -p /data /home/signet && chown signet:signet /data /home/signet

# Copy entire workspace (.dockerignore filters out unwanted files)
COPY . .

# Install all deps (workspace packages need full structure for linking)
RUN bun install && \
    chown -R signet:signet /app

VOLUME /data

# Defaults — override via env vars or mount a config.toml
ENV XMTP_SIGNET_DATA_DIR=/data
ENV XMTP_SIGNET_ENV=dev
ENV XMTP_SIGNET_WS_PORT=8393
ENV XMTP_SIGNET_WS_HOST=0.0.0.0
ENV XMTP_SIGNET_HTTP_ENABLED=true
ENV XMTP_SIGNET_HTTP_PORT=8081
ENV XMTP_SIGNET_HTTP_HOST=0.0.0.0

USER signet

# WS default 8393, HTTP default 8081
EXPOSE 8393 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun run packages/cli/src/bin.ts status --json || exit 1

ENTRYPOINT ["bun", "run", "packages/cli/src/bin.ts"]
CMD ["start"]
