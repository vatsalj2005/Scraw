FROM node:20-alpine
WORKDIR /app/apps/frontend

COPY apps/frontend/package.json ./package.json
RUN npm install

COPY apps/frontend .

CMD ["npm", "run", "dev", "--", "--host"]
