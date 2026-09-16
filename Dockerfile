FROM node:24-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright AGENT_DATA_DIR=/app/data AGENT_HEADLESS=true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && npm cache clean --force
COPY --chown=node:node *.cjs agent-config.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node tests ./tests
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "service.cjs"]
