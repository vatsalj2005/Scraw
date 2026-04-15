FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY apps/gateway/package.json ./apps/gateway/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/shared ./packages/shared
COPY apps/gateway ./apps/gateway

WORKDIR /app/apps/gateway
CMD ["npm", "run", "dev"]
