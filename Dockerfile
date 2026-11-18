# The Home Assistant app (see config.yaml and DOCS.md); Home Assistant builds this image on your device.

# Build the app.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build

# Serve it: plain Node, no packages needed.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server/dataApi.ts server/serve.ts ./server/
COPY --from=build /app/dist ./dist
# Port 8099 for everyone who can reach it (no login; set ALLOWED_IPS to limit the clients), and the travel log in
# /config: Home Assistant maps the app's config folder there (see config.yaml); with plain Docker, mount a folder.
ENV NODE_ENV=production PORT=8099 HOST=0.0.0.0 DATA_DIR=/config
CMD ["node", "--disable-warning=ExperimentalWarning", "server/serve.ts"]
