FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY services/api/package.json services/api/tsconfig.json ./services/api/
RUN npm ci
COPY packages/shared/src ./packages/shared/src
COPY services/api/src ./services/api/src
COPY infra/migrations ./infra/migrations
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3100
EXPOSE 3100
CMD ["node", "services/api/dist/index.js"]
