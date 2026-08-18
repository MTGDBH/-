FROM node:20-bookworm

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev --build-from-source

COPY . .

WORKDIR /app/server

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]