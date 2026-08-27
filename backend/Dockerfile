# Two stages so the C toolchain needed to compile better-sqlite3 doesn't ship
# in the final image. Alpine uses musl, which has no better-sqlite3 prebuild,
# so it always compiles from source — but only the resulting binary is kept.
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
# The compiled .node binary is linked against this exact base, so the modules
# tree copies across as-is.
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

EXPOSE 3004
CMD ["node", "src/index.js"]
