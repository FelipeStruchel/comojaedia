FROM node:18-slim

# Instalar dependências do Chrome
RUN apt-get update && apt-get install -y \
    wget \
    gnupg2 \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        google-chrome-stable \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && npm cache clean --force

# Criar diretório da aplicação
WORKDIR /app

# Copiar apenas package.json primeiro
COPY package*.json ./

# Instalar dependências
RUN npm install --production --no-optional

# Copiar o resto dos arquivos
COPY . .

# Expor porta
EXPOSE 3000

# Configurar variáveis de ambiente
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Comando para iniciar
CMD ["npm", "start"] 