# --- deps ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- run ---
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# Persistent data lives on a mounted volume (docker-compose mounts ./data -> /app/.data)
VOLUME ["/app/.data"]
EXPOSE 3000
CMD ["npm", "start"]
