const { IgApiClient } = require('instagram-private-api');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuração do Instagram
const ig = new IgApiClient();
const username = 'feleaokdt';
const password = 'eusouumbot1234';

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

// Data alvo
const targetDate = moment('2025-07-25');

// Função para calcular dias restantes
function getDaysRemaining() {
    return targetDate.diff(moment(), 'days');
}

// Função para delay aleatório
function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// Função para login no Instagram
async function loginToInstagram() {
    try {
        console.log('Iniciando login no Instagram...');
        ig.state.generateDevice(username);
        
        // Simular comportamento humano
        await randomDelay(2000, 4000);
        
        // Login
        const loggedInUser = await ig.account.login(username, password);
        console.log('Login realizado com sucesso!');
        
        // Delay após login
        await randomDelay(3000, 5000);
        
        return loggedInUser;
    } catch (error) {
        console.error('Erro no login:', error.message);
        if (error.name === 'IgCheckpointError') {
            console.log('Verificação de segurança necessária. Por favor:');
            console.log('1. Acesse o Instagram pelo navegador');
            console.log('2. Complete a verificação de segurança');
            console.log('3. Tente novamente em alguns minutos');
        }
        throw error;
    }
}

// Função para baixar o vídeo do Instagram
async function downloadInstagramVideo() {
    try {
        // Login no Instagram
        await loginToInstagram();
        
        // Nome de usuário do Instagram que você quer monitorar
        const targetUsername = 'comojaediaa';
        console.log(`Buscando posts de ${targetUsername}...`);
        
        // Buscar informações do usuário
        const user = await ig.user.searchExact(targetUsername);
        if (!user) {
            throw new Error('Usuário não encontrado');
        }
        
        console.log('Usuário encontrado, buscando posts...');
        await randomDelay(2000, 4000);
        
        // Buscar posts recentes (pegando mais posts para ter mais chances de encontrar um vídeo)
        const feed = ig.feed.user(user.pk);
        const posts = await feed.items();
        
        if (!posts || posts.length === 0) {
            console.log('Nenhum post encontrado');
            return null;
        }
        
        console.log(`${posts.length} posts encontrados`);
        
        // Procurar o vídeo mais recente
        for (let i = 0; i < posts.length; i++) {
            const post = posts[i];
            console.log(`Verificando post ${i + 1} de ${posts.length}...`);
            
            if (post.video_versions && post.video_versions.length > 0) {
                const videoUrl = post.video_versions[0].url;
                console.log('Vídeo encontrado, baixando...');
                
                // Delay antes de baixar
                await randomDelay(2000, 4000);
                
                // Baixar o vídeo usando axios
                const videoResponse = await axios.get(videoUrl, {
                    responseType: 'arraybuffer',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                // Salvar o vídeo
                const videoPath = path.join(__dirname, 'video.mp4');
                fs.writeFileSync(videoPath, videoResponse.data);
                console.log('Vídeo baixado com sucesso!');
                return videoPath;
            }
        }
        
        console.log('Nenhum vídeo encontrado nos posts recentes');
        return null;
    } catch (error) {
        console.error('Erro ao baixar vídeo:', error.message);
        return null;
    }
}

// Função para enviar mensagem no WhatsApp
async function sendWhatsAppMessage() {
    try {
        const videoPath = await downloadInstagramVideo();
        if (!videoPath) {
            console.log('Nenhum vídeo encontrado para enviar');
            return;
        }

        const daysRemaining = getDaysRemaining();
        const message = `Faltam ${daysRemaining} dias para a chacrinha e eu ainda não consigo acreditar que hoje já é dia ${moment().format('DD')}! 🎉`;

        // ID do grupo do WhatsApp
        const groupId = '120363339314665620@g.us';
        
        // Verificar se o bot é membro do grupo
        const chats = await client.getChats();
        const group = chats.find(chat => chat.id._serialized === groupId);
        
        if (!group) {
            throw new Error('Bot não é membro do grupo ou grupo não encontrado');
        }

        console.log(`Enviando mensagem para o grupo: ${group.name}`);
        
        // Verificar tamanho do arquivo
        const stats = fs.statSync(videoPath);
        console.log(`Tamanho do vídeo: ${stats.size} bytes`);

        // Primeiro, enviar uma cópia para o PV
        console.log('Enviando cópia do vídeo para o PV...');
        const confirmationNumber = '5514982276185@c.us';
        
        // Enviar mensagem de texto primeiro
        await client.sendMessage(confirmationNumber, '📱 Enviando cópia do vídeo...');
        
        // Tentar enviar o vídeo
        try {
            // Verificar se o arquivo existe
            if (!fs.existsSync(videoPath)) {
                throw new Error('Arquivo de vídeo não encontrado');
            }

            console.log('Criando MessageMedia do vídeo...');
            const media = MessageMedia.fromFilePath(videoPath);
            
            console.log('Enviando vídeo...');
            await client.sendMessage(confirmationNumber, media);
            console.log('Cópia enviada com sucesso!');

            // Enviar confirmação
            await client.sendMessage(confirmationNumber, '✅ Vídeo enviado com sucesso!');

            // Depois enviar para o grupo
            console.log('Iniciando envio do vídeo para o grupo...');
            
            // Enviar vídeo com caption para o grupo
            await client.sendMessage(groupId, media, {
                caption: message
            });
            console.log('Vídeo enviado para o grupo com sucesso!');

        } catch (videoError) {
            console.error('Erro ao enviar vídeo:', videoError);
            await client.sendMessage(confirmationNumber, '❌ Erro ao enviar vídeo: ' + videoError.message);
        }

        // Limpar o arquivo de vídeo
        fs.unlinkSync(videoPath);
        
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        
        // Enviar mensagem de erro para seu número
        try {
            const confirmationNumber = '5514982276185@c.us';
            await client.sendMessage(confirmationNumber, '❌ Erro ao enviar vídeo: ' + error.message);
        } catch (confirmationError) {
            console.error('Erro ao enviar confirmação:', confirmationError);
        }
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
    
    // // Listar todos os grupos e seus IDs
    // client.getChats().then(chats => {
    //     const groups = chats.filter(chat => chat.isGroup);
    //     console.log('\nGrupos disponíveis:');
    //     groups.forEach(group => {
    //         console.log(`Nome do grupo: ${group.name}`);
    //         console.log(`ID do grupo: ${group.id._serialized}`);
    //         console.log('------------------------');
    //     });
    // });
    
    // Agendar tarefa para rodar todos os dias às 8:00
    cron.schedule('0 8 * * *', () => {
        console.log('Executando tarefa agendada...');
        sendWhatsAppMessage();
    }, {
        runOnInit: true
    });
});

// Iniciar o cliente WhatsApp
client.initialize(); 