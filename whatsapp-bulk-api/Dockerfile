FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3002
EXPOSE 3002

CMD ["npm", "start"]
