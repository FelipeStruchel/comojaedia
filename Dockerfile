FROM ghcr.io/puppeteer/puppeteer:21.5.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "start"] 