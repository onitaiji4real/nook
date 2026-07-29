FROM node:24.17.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.7.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nook/api... build
RUN pnpm --filter @nook/api deploy --prod /prod/api
RUN cd /prod/api && node /app/packages/database/node_modules/prisma/build/index.js generate --schema node_modules/@nook/database/prisma/schema.prisma

FROM gcr.io/distroless/nodejs24-debian13@sha256:70a2c12a0d76018b54d7bd01c5e3677632eeed9f890ba318d6db55fc54cf3baa AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=65532:65532 /prod/api ./
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["dist/main.js"]
