FROM node:24-alpine

RUN addgroup -g 1001 -S nodejs && \
    adduser -S node -u 1001

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install && \
    npm cache clean --force

COPY . .

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

USER node

CMD ["npm", "run", "server"]
