# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/contracts/package.json packages/contracts/
COPY packages/policy/package.json packages/policy/
COPY packages/keys/package.json packages/keys/
COPY packages/sessions/package.json packages/sessions/
COPY packages/seals/package.json packages/seals/
COPY packages/core/package.json packages/core/
COPY packages/ws/package.json packages/ws/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
COPY packages/sdk/package.json packages/sdk/
COPY packages/verifier/package.json packages/verifier/
RUN bun install --frozen-lockfile

# Stage 2: Build
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Stage 3: Runtime
FROM oven/bun:1-slim AS runtime
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/*/dist ./packages/
COPY --from=build /app/packages/*/package.json ./packages/
COPY --from=build /app/package.json ./

ENV XMTP_SIGNET_DATA_DIR=/data
ENV XMTP_SIGNET_ENV=dev

EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun run packages/cli/dist/bin.js status --json || exit 1

ENTRYPOINT ["bun", "run", "packages/cli/dist/bin.js"]
CMD ["start"]
