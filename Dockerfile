FROM node:18-slim

# Set timezone for the image (Brasília)
ENV TZ=America/Sao_Paulo

# Instalar dependências necessárias (inclui tzdata para timezone)
RUN DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y \
    tzdata \
    wget \
    gnupg \
    ca-certificates \
    procps \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone

# Instalar Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Criar diretório da aplicação
WORKDIR /app

# Copiar arquivos do projeto
COPY package*.json ./

# Instalar dependências (usa cache da camada quando package.json não muda)
RUN npm ci --production --no-optional || npm install --production --no-optional

# Copiar todo o código da aplicação (após instalar deps para melhor cache)
COPY . .

# Expor porta
EXPOSE 3000

# Configurar variáveis de ambiente
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# Iniciar aplicação
CMD ["node", "index.js"] 