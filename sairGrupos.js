const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const moment = require('moment');

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Função para verificar se um grupo está inativo
async function verificarGrupoInativo(chat) {
    try {
        // Pegar as últimas mensagens do grupo
        const messages = await chat.fetchMessages({ limit: 1 });
        
        if (messages.length === 0) {
            return true; // Grupo sem mensagens
        }

        const ultimaMensagem = messages[0];
        const dataUltimaMensagem = moment(ultimaMensagem.timestamp * 1000);
        const umAnoAtras = moment().subtract(1, 'year');

        return dataUltimaMensagem.isBefore(umAnoAtras);
    } catch (error) {
        console.error(`Erro ao verificar grupo ${chat.name}:`, error);
        return false;
    }
}

// Função para sair dos grupos inativos
async function sairGruposInativos() {
    try {
        console.log('Buscando grupos...');
        const chats = await client.getChats();
        const grupos = chats.filter(chat => chat.isGroup);

        console.log(`Encontrados ${grupos.length} grupos`);

        for (const grupo of grupos) {
            console.log(`\nVerificando grupo: ${grupo.name}`);
            
            const isInativo = await verificarGrupoInativo(grupo);
            
            if (isInativo) {
                console.log(`Grupo ${grupo.name} está inativo há mais de 1 ano. Saindo...`);
                try {
                    await grupo.leave();
                    console.log(`✅ Saiu do grupo ${grupo.name} com sucesso!`);
                } catch (error) {
                    console.error(`❌ Erro ao sair do grupo ${grupo.name}:`, error);
                }
            } else {
                console.log(`Grupo ${grupo.name} está ativo. Mantendo...`);
            }
        }

        console.log('\nProcesso finalizado!');
    } catch (error) {
        console.error('Erro ao processar grupos:', error);
    }
}

// Configurar evento de QR Code do WhatsApp
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR Code gerado! Escaneie com seu WhatsApp.');
});

// Quando o cliente estiver pronto
client.on('ready', () => {
    console.log('Cliente WhatsApp conectado!');
    sairGruposInativos();
});

// Iniciar o cliente WhatsApp
client.initialize(); 