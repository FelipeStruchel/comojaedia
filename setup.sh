#!/bin/bash

# Atualizar sistema
echo "Atualizando sistema..."
sudo apt update && sudo apt upgrade -y

# Instalar Docker
echo "Instalando Docker..."
sudo apt install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker

# Instalar Docker Compose
echo "Instalando Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Criar diretório do projeto
echo "Criando diretório do projeto..."
mkdir -p ~/whatsapp-bot
cd ~/whatsapp-bot

# Criar arquivo docker-compose.yml
echo "Criando docker-compose.yml..."
cat > docker-compose.yml << EOL
version: '3'
services:
  whatsapp-bot:
    build: .
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./whatsapp-session:/app/whatsapp-session
    environment:
      - NODE_ENV=production
EOL

# Criar diretório para sessão do WhatsApp
mkdir -p whatsapp-session

echo "Setup concluído! Agora você pode:"
echo "1. Fazer upload dos arquivos do projeto para ~/whatsapp-bot"
echo "2. Executar: docker-compose up -d" 