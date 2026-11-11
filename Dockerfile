# Shady Grove 2 game server, serving the online client from the same port.
# Build stage: install every workspace, build the online client and bundle the server.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY server server
COPY client client
RUN npm run build:online -w client && npm run build -w server

# Runtime stage: the server bundle, its migrations, the built client and production dependencies only.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    SG2_PORT=2570 \
    SG2_CLIENT_DIR=/app/client/dist-online
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && rm -rf /root/.npm
COPY server/migrations server/migrations
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist-online client/dist-online
USER node
EXPOSE 2570
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.SG2_PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/dist/index.js"]
