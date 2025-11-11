# syntax=docker/dockerfile:1

# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# Install deps using lockfile for reproducible builds
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the sources and build
COPY . .

# Optional build-time variables (only used if you prefer not to proxy /api)
# Example: docker build --build-arg VITE_API_BASE=https://api.example.com
ARG VITE_API_BASE=/api
ARG VITE_API_KEY=devkey
ARG VITE_MODEL
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_API_KEY=${VITE_API_KEY}
ENV VITE_MODEL=${VITE_MODEL}

# Build static assets to dist/
RUN npm run build

# --- Runtime stage ---
FROM nginx:1.27-alpine AS runtime

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Provide an nginx template that supports SPA routing and optional /api proxy
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Safe default so envsubst always has a value
ENV API_TARGET=http://localhost:8000

EXPOSE 80
# Use default nginx entrypoint which renders templates from /etc/nginx/templates
CMD ["/docker-entrypoint.sh", "nginx", "-g", "daemon off;"]
