const { IgApiClient } = require('instagram-private-api');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const moment = require('moment');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const express = require('express');
const cors = require('cors');

// Configuração do Express
const app = express();
const PORT = process.env.PORT || 3000;

// Limite de caracteres do WhatsApp
const MAX_MESSAGE_LENGTH = 4096;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Caminho para o arquivo de frases
const frasesPath = path.join(__dirname, 'frases.json');

// Função para ler as frases
async function lerFrases() {
    try {
        const data = await fs.readFile(frasesPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erro ao ler frases:', error);
        return { frases: [] };
    }
}

// Função para salvar as frases
async function salvarFrases(data) {
    await fs.writeFile(frasesPath, JSON.stringify(data, null, 2));
}

// Rota para obter todas as frases
app.get('/frases', async (req, res) => {
    try {
        const data = await lerFrases();
        res.json(data.frases);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar frases' });
    }
});

// Rota para adicionar uma nova frase
app.post('/frases', async (req, res) => {
    try {
        const { frase } = req.body;
        if (!frase) {
            return res.status(400).json({ error: 'Frase é obrigatória' });
        }

        if (frase.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({ 
                error: `A frase deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres`,
                maxLength: MAX_MESSAGE_LENGTH
            });
        }

        const data = await lerFrases();
        data.frases.push(frase);
        await salvarFrases(data);

        res.status(201).json({ message: 'Frase adicionada com sucesso' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao adicionar frase' });
    }
});

// Rota para remover uma frase
app.delete('/frases/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const data = await lerFrases();

        if (index < 0 || index >= data.frases.length) {
            return res.status(404).json({ error: 'Frase não encontrada' });
        }

        data.frases.splice(index, 1);
        await salvarFrases(data);

        res.json({ message: 'Frase removida com sucesso' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao remover frase' });
    }
});

// Rota para servir o frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar o servidor Express
app.listen(PORT, () => {
    console.log(`API rodando na porta ${PORT}`);
});

// Configuração do Instagram
const ig = new IgApiClient();
const username = 'feleaokdt';
const password = 'eusouumbot1234';

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        headless: true
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

// Função para verificar se o vídeo é do dia atual
async function isVideoFromToday(post) {
    try {
        const postDate = moment.unix(post.taken_at);
        const today = moment().startOf('day');
        return postDate.isSame(today, 'day');
    } catch (error) {
        console.error('Erro ao verificar data do vídeo:', error);
        return false;
    }
}

// Função para login no Instagram
async function loginToInstagram() {
    try {
        console.log('Iniciando login no Instagram...');
        ig.state.generateDevice(username);
        
        await randomDelay(2000, 4000);
        
        const loggedInUser = await ig.account.login(username, password);
        console.log('Login realizado com sucesso!');
        
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
        await loginToInstagram();
        
        const targetUsername = 'comojaediaa';
        console.log(`Buscando posts de ${targetUsername}...`);
        
        const user = await ig.user.searchExact(targetUsername);
        if (!user) {
            throw new Error('Usuário não encontrado');
        }
        
        console.log('Usuário encontrado, buscando posts...');
        await randomDelay(2000, 4000);
        
        const feed = ig.feed.user(user.pk);
        const posts = await feed.items();
        
        if (!posts || posts.length === 0) {
            console.log('Nenhum post encontrado');
            return null;
        }
        
        console.log(`${posts.length} posts encontrados`);
        
        for (let i = 0; i < posts.length; i++) {
            const post = posts[i];
            console.log(`Verificando post ${i + 1} de ${posts.length}...`);
            
            if (post.video_versions && post.video_versions.length > 0) {
                const isFromToday = await isVideoFromToday(post);
                if (!isFromToday) {
                    console.log('Vídeo encontrado, mas não é do dia atual');
                    continue;
                }

                const videoUrl = post.video_versions[0].url;
                console.log('Vídeo do dia encontrado, baixando...');
                
                await randomDelay(2000, 4000);
                
                const videoResponse = await axios.get(videoUrl, {
                    responseType: 'arraybuffer',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                const videoPath = path.join(__dirname, 'video.mp4');
                await fs.writeFile(videoPath, videoResponse.data);
                console.log('Vídeo baixado com sucesso!');
                return videoPath;
            }
        }
        
        console.log('Nenhum vídeo do dia encontrado nos posts recentes');
        return null;
    } catch (error) {
        console.error('Erro ao baixar vídeo:', error.message);
        return null;
    }
}

// Função para obter uma frase aleatória e removê-la
async function getRandomPhrase() {
    try {
        const data = await fs.readFile(path.join(__dirname, 'frases.json'), 'utf8');
        const { frases } = JSON.parse(data);
        if (frases.length === 0) return '';

        const randomIndex = Math.floor(Math.random() * frases.length);
        const frase = frases[randomIndex];

        frases.splice(randomIndex, 1);
        await fs.writeFile(path.join(__dirname, 'frases.json'), JSON.stringify({ frases }, null, 2));

        return frase;
    } catch (error) {
        console.error('Erro ao ler frases:', error);
        return '';
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
        const randomPhrase = await getRandomPhrase();
        
        // Mensagem padrão que sempre será enviada com o vídeo
        const defaultMessage = `Faltam ${daysRemaining} dias para a chacrinha e eu ainda não consigo acreditar que hoje já é dia ${moment().format('DD')}! 🎉`;

        const groupId = '120363339314665620@g.us';
        
        const chats = await client.getChats();
        const group = chats.find(chat => chat.id._serialized === groupId);
        
        if (!group) {
            throw new Error('Bot não é membro do grupo ou grupo não encontrado');
        }

        console.log(`Enviando mensagem para o grupo: ${group.name}`);
        
        const stats = await fs.stat(videoPath);
        console.log(`Tamanho do vídeo: ${stats.size} bytes`);

        console.log('Enviando cópia do vídeo para o PV...');
        const confirmationNumber = '5514982276185@c.us';
        
        await client.sendMessage(confirmationNumber, '📱 Enviando cópia do vídeo...');
        
        try {
            if (!await fs.access(videoPath, fs.constants.F_OK)) {
                throw new Error('Arquivo de vídeo não encontrado');
            }

            console.log('Criando MessageMedia do vídeo...');
            const media = MessageMedia.fromFilePath(videoPath);
            
            console.log('Enviando vídeo...');
            await client.sendMessage(confirmationNumber, media);
            console.log('Cópia enviada com sucesso!');

            await client.sendMessage(confirmationNumber, '✅ Vídeo enviado com sucesso!');

            console.log('Iniciando envio do vídeo para o grupo...');
            
            // Enviar vídeo com a mensagem padrão
            await client.sendMessage(groupId, media, {
                caption: defaultMessage
            });
            console.log('Vídeo enviado para o grupo com sucesso!');

            // Se tiver uma frase aleatória, enviar em uma mensagem separada
            if (randomPhrase && randomPhrase.trim() !== '') {
                console.log('Enviando frase aleatória em mensagem separada...');
                await client.sendMessage(groupId, `Mensagem do dia: ${randomPhrase}`);
                console.log('Frase aleatória enviada com sucesso!');
            }

        } catch (videoError) {
            console.error('Erro ao enviar vídeo:', videoError);
            await client.sendMessage(confirmationNumber, '❌ Erro ao enviar vídeo: ' + videoError.message);
        }

        await fs.unlink(videoPath);
        
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        
        try {
            const confirmationNumber = '5514982276185@c.us';
            await client.sendMessage(confirmationNumber, '❌ Erro ao enviar vídeo: ' + error.message);
        } catch (confirmationError) {
            console.error('Erro ao enviar confirmação:', confirmationError);
        }
    }
}

// Função para verificar vídeo e enviar mensagem
async function checkAndSendVideo() {
    try {
        const videoPath = await downloadInstagramVideo();
        if (videoPath) {
            console.log('Vídeo novo encontrado! Enviando mensagem...');
            await sendWhatsAppMessage();
            return true;
        }
        console.log('Nenhum vídeo novo encontrado. Tentando novamente em 30 minutos...');
        return false;
    } catch (error) {
        console.error('Erro ao verificar/enviar vídeo:', error);
        return false;
    }
}

// Função para iniciar o processo de verificação
async function startVideoCheck() {
    console.log('Iniciando verificação de vídeos...');
    let videoFound = false;
    
    while (!videoFound) {
        videoFound = await checkAndSendVideo();
        if (!videoFound) {
            console.log('Aguardando 30 minutos para próxima verificação...');
            await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000)); // 30 minutos
        }
    }
    
    console.log('Vídeo enviado com sucesso! Próxima verificação às 7:00 do próximo dia.');
}

// Configurar evento de QR Code do WhatsApp
client.on('qr', (qr) => {
    console.log('QR Code gerado! Escaneie com seu WhatsApp:');
    console.log('----------------------------------------');
    qrcode.generate(qr, { small: false });
    console.log('----------------------------------------');
    console.log('Se o QR Code acima não estiver legível, você pode:');
    console.log('1. Aumentar o zoom do terminal');
    console.log('2. Copiar o QR Code e usar um leitor online');
    console.log('3. Tentar novamente em alguns segundos');
});

// Quando o cliente estiver pronto
client.on('ready', () => {
    console.log('Cliente WhatsApp conectado!');
    
    // Agendar tarefa para rodar todos os dias às 7:00
    cron.schedule('0 7 * * *', () => {
        console.log('Iniciando verificação diária de vídeos...');
        startVideoCheck();
    }, {
        runOnInit: true
    });
});

// Iniciar o cliente WhatsApp
client.initialize(); 