# Imagen de la API: Node 22 sobre Debian slim (bcrypt usa binarios precompilados para glibc).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Dependencias primero para aprovechar la cache de capas (package-lock.json es opcional).
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
