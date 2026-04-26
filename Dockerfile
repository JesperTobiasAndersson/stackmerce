FROM node:20-alpine AS deps
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS build

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/build ./build
COPY --from=build /app/public ./public

CMD ["npm", "run", "start"]
