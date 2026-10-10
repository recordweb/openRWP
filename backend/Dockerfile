FROM node:24-alpine
ENV NODE_ENV=production

# Shared core library; the tests run during the build and gate every deployment.
WORKDIR /app/core
COPY core/ ./
RUN node --test test/*.test.js

WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --omit=dev
COPY backend/ ./

# Blob directory owned by the unprivileged user; a new named volume inherits this.
RUN mkdir -p /data/blobs && chown node:node /data/blobs
USER node
EXPOSE 3000
CMD ["node", "server.js"]