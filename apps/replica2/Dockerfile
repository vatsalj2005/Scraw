FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY apps/replica/package.json ./apps/replica/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/shared ./packages/shared
COPY apps/replica ./apps/replica

# Copy this replica's own source folder on top — overrides apps/replica/src
COPY apps/replica2/src ./apps/replica/src

WORKDIR /app/apps/replica
CMD ["npm", "run", "dev"]
