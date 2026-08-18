FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY . .

WORKDIR /app/server

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
