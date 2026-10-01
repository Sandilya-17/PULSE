FROM node:20-alpine AS web
WORKDIR /w/client
COPY client/package.json .
RUN npm install
COPY client .
RUN npm run build
FROM node:20-alpine
WORKDIR /app/server
COPY server/package.json .
RUN npm install --omit=dev
COPY server .
COPY --from=web /w/client/dist /app/client/dist
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node","index.js"]
