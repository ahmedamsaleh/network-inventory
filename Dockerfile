# Network Inventory - production image
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# install production dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY . .

# writable runtime directories (logs, CSV import/export) owned by the unprivileged user
RUN mkdir -p log import export && chown -R node:node /app
USER node

EXPOSE 8080
CMD ["node", "application.js"]
