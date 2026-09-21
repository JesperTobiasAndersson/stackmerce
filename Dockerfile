# Build stage: install everything and produce the React Router build.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY extensions/discount-function-js/package.json ./extensions/discount-function-js/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Runtime stage: production dependencies only.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
COPY extensions/discount-function-js/package.json ./extensions/discount-function-js/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm", "run", "start"]
