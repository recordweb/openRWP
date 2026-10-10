FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY . .
# Blob directory owned by the unprivileged user; a new named volume inherits this.
RUN mkdir -p /data/blobs && chown node:node /data/blobs
USER node
EXPOSE 3000
CMD ["node", "server.js"]