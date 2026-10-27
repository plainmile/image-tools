FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run test:unit && npm run build

FROM nginx:1.30.6-alpine
LABEL org.opencontainers.image.title="PlainMile Image Tools" \
      org.opencontainers.image.description="Free, browser-local image resize, size-targeted compression, signature resize, bulk resize and photo print" \
      org.opencontainers.image.url="https://image.plainmile.com/" \
      org.opencontainers.image.source="https://github.com/plainmile/image-tools" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="PlainMile"
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/ /usr/share/nginx/html/
COPY public/healthz /usr/share/nginx/html/healthz
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz | grep -qx 'ok' || exit 1
