# ---------- Stage 1: Build ----------
FROM node:20-alpine AS build

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy package.json + package-lock.json
COPY package*.json ./

# Cài devDependencies vì cần build TypeScript
RUN npm install

# Copy toàn bộ source code
COPY . .

# Build TypeScript
RUN npm run build

# ---------- Stage 2: Production ----------
FROM node:20-alpine AS production

WORKDIR /app

# Chỉ copy package.json + package-lock.json
COPY package*.json ./

# Chỉ cài production dependencies
RUN npm install --only=production

# Copy file đã build từ stage trước
COPY --from=build /app/dist ./dist

# Copy các file cần thiết khác (ví dụ .env)
COPY --from=build /app/.env ./

# Expose cổng app
EXPOSE 5000

# Chạy app
CMD ["node", "dist/server.js"]
