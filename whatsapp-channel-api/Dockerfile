FROM node:20-slim

# Install Chromium, dependencies and dumb-init for clean process supervision
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    dumb-init \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium instead of downloading one
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Ensure sessions directory exists
RUN mkdir -p sessions && chmod -R 777 sessions

# Default port (Render/Railway override this via PORT env var)
EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
