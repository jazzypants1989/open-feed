# The Open Feed interop bridge, for a real origin behind a reverse proxy.
# Build context is the repository root -- the image needs both src/ and bridge/:
#   docker compose -f deploy/docker-compose.yml up -d --build
FROM node:22-alpine

WORKDIR /app

# No dependencies to install: the implementation is stdlib-only, so there is no npm install here.
COPY package.json ./
COPY src/ src/
COPY bridge/ bridge/

RUN mkdir -p /app/data && \
    addgroup -g 1001 -S bridge && \
    adduser -u 1001 -S bridge -G bridge && \
    chown -R bridge:bridge /app

USER bridge
EXPOSE 4568

# The Actor is the endpoint that has to work; it exercises the reader over the whole hub.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4568/users/alice || exit 1

CMD ["node", "bridge/mastodon-test.js"]
