FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY apps/replica/package.json ./apps/replica/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY packages/shared ./packages/shared
COPY apps/replica ./apps/replica

WORKDIR /app/apps/replica
CMD ["npx", "nodemon", "--watch", "src", "--ext", "ts", "--exec", "npx ts-node src/server.ts"]
