FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3001

# Install dependencies if package.json changed (useful for volume mounts)
CMD ["sh", "-c", "npm install && npm start"]

