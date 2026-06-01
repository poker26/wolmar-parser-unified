FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source (public/ and logs/ are bind-mounted at runtime via compose)
COPY . .

ENV NODE_ENV=production
ENV ANALYTICS_PORT=3002

EXPOSE 3002

CMD ["node", "analytics-service.js"]
