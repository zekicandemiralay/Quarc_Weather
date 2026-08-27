FROM node:20-alpine
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for most targets, but falls back to
# compiling from source — keep the toolchain available for that case.
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3004
CMD ["node", "src/index.js"]
