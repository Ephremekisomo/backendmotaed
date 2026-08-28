FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install && \
    npm cache clean --force

COPY . .

EXPOSE 10000

ENV NODE_ENV=production
ENV PORT=3001

USER node

CMD ["npm", "run", "server"]
