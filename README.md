# Bot Instagram-WhatsApp

Este bot automatiza o processo de baixar vídeos do Instagram e enviá-los para um grupo do WhatsApp, junto com uma contagem regressiva para uma data específica.

## Requisitos

- Node.js instalado
- Conta no Instagram
- WhatsApp Web
- ID do grupo do WhatsApp
- ID do usuário do Instagram que você quer monitorar

## Configuração

1. Instale as dependências:
```bash
npm install
```

2. Edite o arquivo `index.js` e substitua as seguintes variáveis:
- `username`: Seu nome de usuário do Instagram
- `password`: Sua senha do Instagram
- `userId`: ID do usuário do Instagram que você quer monitorar
- `groupId`: ID do grupo do WhatsApp onde as mensagens serão enviadas

3. Para obter o ID do grupo do WhatsApp:
   - Adicione o bot ao grupo
   - Envie uma mensagem no grupo
   - Acesse: https://web.whatsapp.com
   - Clique no grupo
   - O ID estará na URL: https://web.whatsapp.com/c/[ID_DO_GRUPO]

## Executando o Bot

1. Inicie o bot:
```bash
npm start
```

2. Escaneie o QR Code que aparecerá no terminal com seu WhatsApp

3. O bot irá:
   - Conectar ao Instagram e WhatsApp
   - Verificar novos vídeos todos os dias às 8:00
   - Baixar o vídeo mais recente
   - Enviar o vídeo para o grupo do WhatsApp com a mensagem de contagem regressiva

## Observações

- O bot precisa estar rodando para funcionar
- Recomenda-se usar um servidor ou computador que fique ligado 24/7
- Mantenha suas credenciais seguras e não compartilhe o arquivo de configuração 