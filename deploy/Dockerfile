# syntax=docker/dockerfile:1.7
ARG RUNTIME_IMAGE=ghcr.io/cheftaco/hive-node-runtime:26.13.0-1@sha256:48948514bce59a27f8ee2a3eabaea0a04cbfa87e087297a52f8501c0d465c84f
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS build
# This stage runs on TARGETPLATFORM, including native Prisma engine generation.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY prisma/schema.prisma prisma/schema.prisma
RUN npx prisma generate --schema prisma/schema.prisma
COPY src/ src/
COPY scripts/container.ts scripts/probe-tls.ts scripts/image-notices.ts scripts/
COPY scripts/schema-policy.mjs scripts/schema-policy.mjs
COPY prisma/migrations/ prisma/migrations/
COPY deploy/schema-policy.json deploy/schema-policy.json
COPY tsconfig.json ./
RUN npx tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --outDir dist src/server/index.ts scripts/container.ts scripts/image-notices.ts
RUN node scripts/schema-policy.mjs inspect /app > schema.json

FROM build AS production-deps
# Prisma client declares tooling as optional peers; npm retains them even with omit.
RUN npm prune --omit=dev --omit=peer --ignore-scripts && npm cache clean --force
RUN node dist/scripts/image-notices.js prune

FROM build AS migration-deps
RUN npm pkg set dependencies.prisma="$(node -p "require('prisma/package.json').version")" && npm pkg delete devDependencies.prisma && npm prune --omit=dev --omit=peer --ignore-scripts && npm cache clean --force
RUN node dist/scripts/image-notices.js prune

FROM ${RUNTIME_IMAGE} AS runtime
USER root
WORKDIR /app
ARG VERSION=development
ARG REVISION=local
ARG CREATED=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="ChatterMost" \
      org.opencontainers.image.description="Mattermost-compatible supervised chat" \
      org.opencontainers.image.source="https://github.com/ChefTaco/ChatterMost" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.created=$CREATED
ENV NODE_ENV=production BUILD_NUMBER=$VERSION BUILD_HASH=$REVISION BUILD_DATE=$CREATED RELEASE_ID=$VERSION
COPY --from=production-deps /app/node_modules/ node_modules/
COPY --from=build /app/dist/ dist/
COPY --from=build /app/schema.json schema.json
COPY --from=production-deps /app/THIRD_PARTY_NOTICES.json ./
COPY package.json LICENSE NOTICE ./
RUN mkdir -p /var/lib/chattermost/files /var/lib/chattermost/profile-images && chown -R node:node /var/lib/chattermost
USER 1000:1000
EXPOSE 8065
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=5s --timeout=4s --start-period=30s --retries=12 CMD ["node", "dist/scripts/container.js", "health"]
ENTRYPOINT ["node", "dist/scripts/container.js"]
CMD ["serve"]

# Explicit migration image; build tools never enter the application image.
FROM runtime AS migrator
COPY --from=migration-deps /app/node_modules/ node_modules/
COPY --from=migration-deps /app/THIRD_PARTY_NOTICES.json ./
COPY --from=build /app/prisma/ prisma/
COPY --from=build /app/scripts/schema-policy.mjs scripts/schema-policy.mjs
COPY --from=build /app/deploy/schema-policy.json deploy/schema-policy.json
HEALTHCHECK NONE
CMD ["migrate"]

# A plain docker build produces the application, never the migration tooling.
FROM runtime AS application
