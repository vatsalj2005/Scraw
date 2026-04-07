FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/shared ./packages/shared
COPY apps/frontend ./apps/frontend

WORKDIR /app/apps/frontend
CMD ["npm", "run", "dev", "--", "--host"]
