FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit
COPY . .
RUN node --check server.js && node --check public/app.js && node --check public/admin.js && npm test

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app app
COPY --from=build /app/node_modules ./node_modules
COPY --chown=app:app package.json server.js ./
COPY --chown=app:app public ./public
COPY --chown=app:app data ./data
RUN mkdir -p /app/private_uploads && chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node","server.js"]