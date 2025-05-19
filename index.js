const { IgApiClient } = require('instagram-private-api');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const moment = require('moment');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const multer = require('multer');
const { MEDIA_TYPES, saveMedia, getRandomMedia, removeMedia, prepareMediaForWhatsApp, listAllMedia } = require('./mediaManager');

// Função de log melhorada
function log(message, type = 'info') {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const prefix = {
        info: 'ℹ️',
        error: '❌',
        success: '✅',
        warning: '⚠️',
        debug: '🔍'
    }[type] || 'ℹ️';

    console.log(`[${timestamp}] ${prefix} ${message}`);
}

log('Iniciando aplicação...', 'info');
log(`Node version: ${process.version}`, 'info');
log(`Diretório atual: ${__dirname}`, 'info');

// Criar diretório para arquivos temporários
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log('Diretório temp criado:', tempDir);
}

// Configuração do Express
const app = express();
const PORT = process.env.PORT || 3000;

// Limite de caracteres do WhatsApp
const MAX_MESSAGE_LENGTH = 4096;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Função para ler as frases
async function lerFrases() {
    try {
        const textsDir = path.join(__dirname, 'media', 'texts');
        const files = await fsPromises.readdir(textsDir);
        
        const frases = await Promise.all(files.map(async (file) => {
            const filePath = path.join(textsDir, file);
            const content = await fsPromises.readFile(filePath, 'utf8');
            return content;
        }));

        return { frases };
    } catch (error) {
        console.error('Erro ao ler frases:', error);
        return { frases: [] };
    }
}

// Função para salvar as frases
async function salvarFrases(data) {
    try {
        const textsDir = path.join(__dirname, 'media', 'texts');
        const files = await fsPromises.readdir(textsDir);
        
        await Promise.all(data.frases.map(async (frase, index) => {
            const fileName = `frase_${Date.now()}_${index + 1}.txt`;
            const filePath = path.join(textsDir, fileName);
            await fsPromises.writeFile(filePath, frase);
        }));
    } catch (error) {
        console.error('Erro ao salvar frases:', error);
    }
}

// Rota para obter todas as frases
app.get('/frases', async (req, res) => {
    try {
        console.log('Buscando frases...');
        const data = await lerFrases();
        console.log('Frases encontradas:', data.frases);
        res.json(data.frases);
    } catch (error) {
        console.error('Erro ao buscar frases:', error);
        res.status(500).json({ error: 'Erro ao buscar frases' });
    }
});

// Rota para adicionar uma nova frase
app.post('/frases', async (req, res) => {
    try {
        console.log('Recebendo nova frase:', req.body);
        const { frase } = req.body;
        if (!frase) {
            console.log('Frase não fornecida');
            return res.status(400).json({ error: 'Frase é obrigatória' });
        }

        if (frase.length > MAX_MESSAGE_LENGTH) {
            console.log('Frase excede o tamanho máximo');
            return res.status(400).json({ 
                error: `A frase deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres`,
                maxLength: MAX_MESSAGE_LENGTH
            });
        }

        // Criar arquivo de texto para a nova frase
        const fileName = `frase_${Date.now()}.txt`;
        const filePath = path.join(__dirname, 'media', 'texts', fileName);
        await fsPromises.writeFile(filePath, frase);
        
        console.log('Frase adicionada com sucesso:', frase);
        res.status(201).json({ message: 'Frase adicionada com sucesso', frase });
    } catch (error) {
        console.error('Erro ao adicionar frase:', error);
        res.status(500).json({ error: 'Erro ao adicionar frase' });
    }
});

// Rota para remover uma frase
app.delete('/frases/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const { frases } = await lerFrases();

        if (index < 0 || index >= frases.length) {
            return res.status(404).json({ error: 'Frase não encontrada' });
        }

        const textsDir = path.join(__dirname, 'media', 'texts');
        const files = await fsPromises.readdir(textsDir);
        const fileToDelete = files[index];
        
        if (fileToDelete) {
            await fsPromises.unlink(path.join(textsDir, fileToDelete));
        }

        res.json({ message: 'Frase removida com sucesso' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao remover frase' });
    }
});

// Rota para servir o frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de healthcheck
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Configuração do Instagram
const ig = new IgApiClient();
const username = 'feleaokdtsecond';
const password = '123Mudar@';

console.log('Iniciando configuração do WhatsApp...');

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot",
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--disable-features=site-per-process',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-first-run',
            '--no-zygote',
            '--disable-accelerated-2d-canvas',
            '--disable-background-networking',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--safebrowsing-disable-auto-update',
            '--disable-default-apps',
            '--disable-translate'
        ],
        executablePath: '/usr/bin/google-chrome',
        timeout: 0,
        defaultViewport: null,
        pipe: true,
        dumpio: true
    },
    restartOnAuthFail: true,
    qrMaxRetries: 5,
    authTimeout: 0,
    qrQualityOptions: {
        quality: 0.8,
        margin: 4
    }
});

// Função para inicializar com retry
async function initializeWithRetry(retries = 3, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            log(`Tentativa ${i + 1} de ${retries} de inicialização...`, 'info');
            
            // Limpar processos do Chrome antes de cada tentativa
            try {
                await execPromise('pkill -f chrome');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
                log('Nenhum processo Chrome para matar', 'info');
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Inicializar com timeout
            const initPromise = client.initialize();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout na inicialização')), 30000)
            );
            
            await Promise.race([initPromise, timeoutPromise]);
            log('Cliente inicializado com sucesso!', 'success');
            return;
        } catch (error) {
            log(`Erro na tentativa ${i + 1}: ${error.message}`, 'error');
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay * 2));
        }
    }
}

// Adicionar mais logs para debug
client.on('disconnected', (reason) => {
    log(`Cliente desconectado: ${reason}`, 'warning');
    log('Tentando reconectar em 60 segundos...', 'info');
    setTimeout(() => {
        log('Iniciando reconexão...', 'info');
        initializeWithRetry().catch(err => {
            log(`Erro na reconexão: ${err.message}`, 'error');
            setTimeout(() => {
                log('Tentando reconexão novamente após erro...', 'info');
                initializeWithRetry();
            }, 60000);
        });
    }, 60000);
});

client.on('auth_failure', (error) => {
    log(`Falha na autenticação: ${error}`, 'error');
    log(`Detalhes do erro: ${JSON.stringify(error, null, 2)}`, 'error');
    log('Tentando reiniciar em 60 segundos...', 'info');
    setTimeout(() => {
        log('Reiniciando após falha de autenticação...', 'info');
        initializeWithRetry();
    }, 60000);
});

// Adicionar handler para erros não capturados
process.on('uncaughtException', (error) => {
    log(`Erro não capturado: ${error.message}`, 'error');
    log(`Stack: ${error.stack}`, 'error');
    if (error.message.includes('Protocol error') || error.message.includes('Session closed') || error.message.includes('Target closed')) {
        log('Erro de protocolo detectado, reiniciando em 60 segundos...', 'warning');
        setTimeout(() => {
            log('Reiniciando após erro de protocolo...', 'info');
            initializeWithRetry();
        }, 60000);
    }
});

// Adicionar handler para erros de rejeição não tratados
process.on('unhandledRejection', (reason, promise) => {
    log(`Promessa rejeitada não tratada: ${reason}`, 'error');
    if (reason.message && (reason.message.includes('Protocol error') || reason.message.includes('Session closed') || reason.message.includes('Target closed'))) {
        log('Erro de protocolo detectado em promessa, reiniciando em 60 segundos...', 'warning');
        setTimeout(() => {
            log('Reiniciando após erro de protocolo em promessa...', 'info');
            initializeWithRetry();
        }, 60000);
    }
});

client.on('loading_screen', (percent, message) => {
    log(`Carregando: ${percent}% ${message}`, 'info');
});

client.on('authenticated', () => {
    log('Autenticado com sucesso!', 'success');
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
        log('Iniciando login no Instagram...', 'info');
        ig.state.generateDevice(username);
        
        await randomDelay(2000, 4000);
        
        const loggedInUser = await ig.account.login(username, password);
        log('Login realizado com sucesso!', 'success');
        
        await randomDelay(3000, 5000);
        
        return loggedInUser;
    } catch (error) {
        log(`Erro no login: ${error.message}`, 'error');
        if (error.name === 'IgCheckpointError') {
            log('Verificação de segurança necessária. Por favor:', 'warning');
            log('1. Acesse o Instagram pelo navegador', 'info');
            log('2. Complete a verificação de segurança', 'info');
            log('3. Tente novamente em alguns minutos', 'info');
        }
        throw error;
    }
}

// Função para baixar o vídeo do Instagram
async function downloadInstagramVideo() {
    try {
        await loginToInstagram();
        
        const targetUsername = 'comojaediaa';
        log(`Buscando posts de ${targetUsername}...`, 'info');
        
        const user = await ig.user.searchExact(targetUsername);
        if (!user) {
            throw new Error('Usuário não encontrado');
        }
        
        log('Usuário encontrado, buscando posts...', 'info');
        await randomDelay(2000, 4000);
        
        const feed = ig.feed.user(user.pk);
        const posts = await feed.items();
        
        if (!posts || posts.length === 0) {
            log('Nenhum post encontrado', 'warning');
            return null;
        }
        
        log(`${posts.length} posts encontrados`, 'info');
        
        for (let i = 0; i < posts.length; i++) {
            const post = posts[i];
            log(`Verificando post ${i + 1} de ${posts.length}...`, 'info');
            
            if (post.video_versions && post.video_versions.length > 0) {
                const isFromToday = await isVideoFromToday(post);
                if (!isFromToday) {
                    log('Vídeo encontrado, mas não é do dia atual', 'info');
                    continue;
                }

                const videoUrl = post.video_versions[0].url;
                log('Vídeo do dia encontrado, baixando...', 'info');
                
                await randomDelay(2000, 4000);
                
                const videoResponse = await axios.get(videoUrl, {
                    responseType: 'arraybuffer',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                const videoPath = path.join(tempDir, `video_${Date.now()}.mp4`);
                log(`Salvando vídeo em: ${videoPath}`, 'info');
                await fsPromises.writeFile(videoPath, videoResponse.data);
                log('Vídeo baixado com sucesso!', 'success');
                return videoPath;
            }
        }
        
        log('Nenhum vídeo do dia encontrado nos posts recentes', 'warning');
        return null;
    } catch (error) {
        log(`Erro ao baixar vídeo: ${error.message}`, 'error');
        return null;
    }
}

// Função para obter uma frase aleatória e removê-la
async function getRandomPhrase() {
    try {
        const { frases } = await lerFrases();
        if (!frases || frases.length === 0) {
            console.log('Nenhuma frase disponível');
            return '';
        }

        const randomIndex = Math.floor(Math.random() * frases.length);
        const frase = frases[randomIndex];

        await salvarFrases({ frases: frases.filter((_, index) => index !== randomIndex) });

        return frase;
    } catch (error) {
        console.error('Erro ao obter frase aleatória:', error);
        return '';
    }
}

// Variável para controlar se já está em execução
let isRunning = false;

// Função para verificar vídeo e enviar mensagem
async function checkAndSendVideo() {
    if (isRunning) {
        console.log('Já existe uma verificação em andamento...');
        return false;
    }

    try {
        isRunning = true;
        console.log('Iniciando nova verificação de vídeo...');
        
        // Adiciona timeout de 5 minutos para a verificação
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: Verificação demorou mais de 5 minutos')), 5 * 60 * 1000);
        });

        const videoCheckPromise = (async () => {
            const videoPath = await downloadInstagramVideo();
            if (videoPath) {
                console.log('Vídeo novo encontrado! Iniciando envio...');
                await sendWhatsAppMessage();
                return true;
            }
            console.log('Nenhum vídeo novo encontrado.');
            return false;
        })();

        const result = await Promise.race([videoCheckPromise, timeoutPromise]);
        return result;
    } catch (error) {
        console.error('Erro durante verificação/envio:', error.message);
        return false;
    } finally {
        isRunning = false;
        console.log('Verificação finalizada.');
    }
}

// Função para iniciar o processo de verificação
async function startVideoCheck() {
    console.log('Iniciando processo de verificação de vídeos...');
    let videoFound = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (!videoFound && attempts < maxAttempts) {
        attempts++;
        console.log(`Tentativa ${attempts} de ${maxAttempts}...`);
        
        videoFound = await checkAndSendVideo();
        
        if (!videoFound) {
            console.log(`Aguardando 30 minutos para próxima verificação... (Tentativa ${attempts}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000));
        }
    }
    
    if (videoFound) {
        console.log('Vídeo enviado com sucesso! Próxima verificação às 7:00 do próximo dia.');
    } else {
        console.log(`Máximo de tentativas (${maxAttempts}) atingido. Próxima verificação às 7:00 do próximo dia.`);
    }
}

// Função para retry de operações
async function retryOperation(operation, maxRetries = 3, delay = 5000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.log(`Tentativa ${i + 1} falhou:`, error.message);
            if (i < maxRetries - 1) {
                console.log(`Aguardando ${delay/1000} segundos antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// Configuração do Multer para upload de arquivos
const upload = multer({
    dest: path.join(__dirname, 'temp'),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

// Rota para upload de mídia
app.post('/media', upload.single('file'), async (req, res) => {
    try {
        console.log('Recebendo upload de mídia:', {
            file: req.file,
            body: req.body
        });

        if (!req.file) {
            console.log('Nenhum arquivo enviado');
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const type = req.body.type || MEDIA_TYPES.TEXT;
        if (!Object.values(MEDIA_TYPES).includes(type)) {
            console.log('Tipo de mídia inválido:', type);
            return res.status(400).json({ error: 'Tipo de mídia inválido' });
        }

        console.log('Salvando mídia do tipo:', type);
        const media = await saveMedia(req.file, type);
        console.log('Mídia salva com sucesso:', media);

        res.status(201).json({ message: 'Mídia salva com sucesso', media });
    } catch (error) {
        console.error('Erro ao salvar mídia:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rota para servir arquivos de mídia
app.get('/media/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    // Garantir que o tipo seja plural (images, videos, texts)
    const pluralType = type.endsWith('s') ? type : `${type}s`;
    const filePath = path.join(__dirname, 'media', pluralType, filename);
    
    console.log('Tentando servir arquivo:', filePath);
    
    // Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
        console.error(`Arquivo não encontrado: ${filePath}`);
        return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error(`Erro ao enviar arquivo ${filePath}:`, err);
            res.status(500).json({ error: 'Erro ao enviar arquivo' });
        }
    });
});

// Rota para listar mídia
app.get('/media', async (req, res) => {
    try {
        console.log('Buscando mídias...');
        const type = req.query.type;
        if (type && !Object.values(MEDIA_TYPES).includes(type)) {
            return res.status(400).json({ error: 'Tipo de mídia inválido' });
        }

        const media = await listAllMedia();
        console.log('Mídias encontradas:', media);
        // Modificar os caminhos para URLs relativas
        const mediaWithUrls = media.map(item => ({
            ...item,
            url: `/media/${item.type}/${path.basename(item.path)}`
        }));
        console.log('Mídias com URLs:', mediaWithUrls);
        res.json(mediaWithUrls);
    } catch (error) {
        console.error('Erro ao listar mídias:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rota para deletar mídia
app.delete('/media/:type/:filename', async (req, res) => {
    try {
        const { type, filename } = req.params;
        // Garantir que o tipo seja plural (images, videos, texts)
        const pluralType = type.endsWith('s') ? type : `${type}s`;
        const filePath = path.join(__dirname, 'media', pluralType, filename);
        
        console.log('Tentando deletar arquivo:', filePath);
        
        // Verificar se o arquivo existe
        if (!fs.existsSync(filePath)) {
            console.error(`Arquivo não encontrado: ${filePath}`);
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        // Remover o arquivo
        await fsPromises.unlink(filePath);
        console.log(`Arquivo removido: ${filePath}`);
        
        res.json({ message: 'Mídia removida com sucesso' });
    } catch (error) {
        console.error('Erro ao remover mídia:', error);
        res.status(500).json({ error: error.message });
    }
});

// Função para enviar mensagem do WhatsApp
async function sendWhatsAppMessage() {
    try {
        const videoPath = await downloadInstagramVideo();
        if (!videoPath) {
            log('Nenhum vídeo encontrado para enviar', 'warning');
            return;
        }

        log('Verificando conexão com WhatsApp...', 'info');
        if (!client.pupPage) {
            throw new Error('WhatsApp Web não está inicializado corretamente');
        }

        const daysRemaining = getDaysRemaining();
        const defaultMessage = `Faltam ${daysRemaining} dias para a chacrinha e eu ainda não consigo acreditar que hoje já é dia ${moment().format('DD')}! 🎉`;

        const groupId = '120363339314665620@g.us';
        const confirmationNumber = '5514982276185@c.us';

        // 1. Enviar vídeo do Instagram com a mensagem de contagem regressiva como legenda
        try {
            const media = MessageMedia.fromFilePath(videoPath);
            await retryOperation(async () => {
                await client.sendMessage(groupId, media, {
                    caption: defaultMessage
                });
            });
            log('Vídeo do Instagram enviado com sucesso', 'success');
        } catch (videoError) {
            log(`Erro ao enviar vídeo: ${videoError.message}`, 'error');
            await retryOperation(async () => {
                await client.sendMessage(confirmationNumber, '❌ Erro ao enviar vídeo: ' + videoError.message);
            });
            throw videoError;
        }

        // 2. Obter mídia aleatória
        const randomMedia = await getRandomMedia();
        if (randomMedia) {
            const mediaType = randomMedia.type === MEDIA_TYPES.TEXT ? 'mensagem' :
                            randomMedia.type === MEDIA_TYPES.IMAGE ? 'foto' : 'vídeo';
            
            // 3. Enviar mensagem de texto sobre a mídia sorteada
            const mediaTypeMessage = `${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} do dia:`;
            await retryOperation(async () => {
                await client.sendMessage(groupId, mediaTypeMessage);
            });
            log(`Mensagem sobre ${mediaType} enviada`, 'success');

            // 4. Enviar a mídia sem legenda
            log(`Enviando ${mediaType} do dia...`, 'info');
            const mediaMessage = await prepareMediaForWhatsApp(randomMedia);
            
            if (mediaType === 'mensagem') {
                await retryOperation(async () => {
                    await client.sendMessage(groupId, mediaMessage.content);
                });
            } else {
                await retryOperation(async () => {
                    await client.sendMessage(groupId, mediaMessage);
                });
            }
            log(`${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} do dia enviada com sucesso`, 'success');

            // Remover mídia após envio
            await removeMedia(randomMedia.path);
            log('Mídia removida após envio', 'info');
        }

        // Limpar arquivo temporário
        try {
            await fsPromises.unlink(videoPath);
            log('Arquivo de vídeo temporário removido com sucesso', 'success');
        } catch (cleanupError) {
            log(`Erro ao remover arquivo temporário: ${cleanupError.message}`, 'error');
        }

        log('Processo de envio finalizado com sucesso!', 'success');
        
    } catch (error) {
        log(`Erro ao enviar mensagem: ${error.message}`, 'error');
        throw error;
    }
}

// Configurar evento de QR Code do WhatsApp
client.on('qr', (qr) => {
    log('QR Code gerado! Escaneie com seu WhatsApp:', 'info');
    log('----------------------------------------', 'info');
    qrcode.generate(qr, { small: true });
    log('----------------------------------------', 'info');
    log('Se o QR Code acima não estiver legível, você pode:', 'info');
    log('1. Aumentar o zoom do terminal', 'info');
    log('2. Copiar o QR Code e usar um leitor online', 'info');
    log('3. Tentar novamente em alguns segundos', 'info');
});

// Quando o cliente estiver pronto
client.on('ready', async () => {
    log('Cliente WhatsApp conectado!', 'success');
    log(`Diretório da sessão: ${path.join(__dirname, '.wwebjs_auth')}`, 'info');
    
    // Aguarda 5 segundos para garantir que o WhatsApp Web está completamente inicializado
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Agendar tarefa para rodar todos os dias às 7:00
    cron.schedule('0 7 * * *', () => {
        log('Iniciando verificação diária de vídeos...', 'info');
        startVideoCheck();
    });

    log('Cron agendado com sucesso!', 'success');
});

// Iniciar o servidor Express
app.listen(PORT, async () => {
    log(`API rodando na porta ${PORT}`, 'success');
    await inicializarFrases(); // Inicializa o arquivo de frases ao iniciar o servidor
    log('Iniciando cliente WhatsApp...', 'info');
    // Iniciar o cliente WhatsApp
    initializeWithRetry().catch(error => {
        log(`Falha ao inicializar após todas as tentativas: ${error.message}`, 'error');
    });
}); 