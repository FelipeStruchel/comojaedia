const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");
const moment = require("moment");
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const multer = require("multer");
const {
  MEDIA_TYPES,
  saveMedia,
  getRandomMedia,
  removeMedia,
  prepareMediaForWhatsApp,
  listAllMedia,
} = require("./mediaManager");

// Função de log melhorada
function log(message, type = "info") {
  const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");
  const prefix =
    {
      info: "ℹ️",
      error: "❌",
      success: "✅",
      warning: "⚠️",
      debug: "🔍",
    }[type] || "ℹ️";

  console.log(`[${timestamp}] ${prefix} ${message}`);
}

log("Iniciando aplicação...", "info");
log(`Node version: ${process.version}`, "info");
log(`Diretório atual: ${__dirname}`, "info");

// Criar diretório para arquivos temporários
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log("Diretório temp criado:", tempDir);
}

// Configuração do Express
const app = express();
const PORT = process.env.PORT || 3000;

// Limite de caracteres do WhatsApp
const MAX_MESSAGE_LENGTH = 4096;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Load env and mongoose
require('dotenv').config();
const mongoose = require('mongoose');

const mongoConnStr = process.env.MONGO_CONNECTION_STRING;
let dbConnected = false;

async function connectWithRetry(uri, maxAttempts = 6) {
  if (!uri) {
    log('MONGO_CONNECTION_STRING não definido no .env', 'warning');
    return;
  }

  const baseDelay = 2000; // 2s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log(`Tentativa de conexão ao MongoDB (${attempt}/${maxAttempts})...`, 'info');
      await mongoose.connect(uri, {
        // Mongoose 7+ options: these are no-ops in some versions but safe to include
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        family: 4,
        // useNewUrlParser/useUnifiedTopology are defaults in newer mongoose
      });
      dbConnected = true;
      log('Conectado ao MongoDB com sucesso', 'success');
      return;
    } catch (err) {
      dbConnected = false;
      log(`Erro ao conectar no MongoDB (attempt ${attempt}): ${err.message}`, 'error');
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        log(`Aguardando ${Math.round(delay / 1000)}s antes da próxima tentativa...`, 'info');
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        log('Máximo de tentativas de conexão ao MongoDB atingido. Prosseguindo sem DB.', 'warning');
      }
    }
  }
}

// Start initial connection attempt (non-blocking)
connectWithRetry(mongoConnStr).catch((e) => {
  log(`connectWithRetry encerrou com erro inesperado: ${e.message}`, 'error');
});

// Event model
const eventSchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);

// Events API
app.get('/events', async (req, res) => {
  if (!dbConnected) return res.status(503).json({ error: 'DB unavailable' });
  try {
    const events = await Event.find().sort({ date: 1 }).lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/events', async (req, res) => {
  if (!dbConnected) return res.status(503).json({ error: 'DB unavailable' });
  try {
    const { name, date } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'name and date are required' });
    const ev = new Event({ name, date: new Date(date) });
    await ev.save();
    res.status(201).json(ev);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/events/:id', async (req, res) => {
  if (!dbConnected) return res.status(503).json({ error: 'DB unavailable' });
  try {
    const id = req.params.id;
    await Event.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Função para ler as frases
async function lerFrases() {
  try {
    const textsDir = path.join(__dirname, "media", "texts");
    const files = await fsPromises.readdir(textsDir);

    const frases = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(textsDir, file);
        const content = await fsPromises.readFile(filePath, "utf8");
        return content;
      })
    );

    return { frases };
  } catch (error) {
    console.error("Erro ao ler frases:", error);
    return { frases: [] };
  }
}

// Função para salvar as frases
async function salvarFrases(data) {
  try {
    const textsDir = path.join(__dirname, "media", "texts");
    const files = await fsPromises.readdir(textsDir);

    await Promise.all(
      data.frases.map(async (frase, index) => {
        const fileName = `frase_${Date.now()}_${index + 1}.txt`;
        const filePath = path.join(textsDir, fileName);
        await fsPromises.writeFile(filePath, frase);
      })
    );
  } catch (error) {
    console.error("Erro ao salvar frases:", error);
  }
}

// Rota para obter todas as frases
app.get("/frases", async (req, res) => {
  try {
    console.log("Buscando frases...");
    const data = await lerFrases();
    console.log("Frases encontradas:", data.frases);
    res.json(data.frases);
  } catch (error) {
    console.error("Erro ao buscar frases:", error);
    res.status(500).json({ error: "Erro ao buscar frases" });
  }
});

// Rota para adicionar uma nova frase
app.post("/frases", async (req, res) => {
  try {
    console.log("Recebendo nova frase:", req.body);
    const { frase } = req.body;
    if (!frase) {
      console.log("Frase não fornecida");
      return res.status(400).json({ error: "Frase é obrigatória" });
    }

    if (frase.length > MAX_MESSAGE_LENGTH) {
      console.log("Frase excede o tamanho máximo");
      return res.status(400).json({
        error: `A frase deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres`,
        maxLength: MAX_MESSAGE_LENGTH,
      });
    }

    // Criar arquivo de texto para a nova frase
    const fileName = `frase_${Date.now()}.txt`;
    const filePath = path.join(__dirname, "media", "texts", fileName);
    await fsPromises.writeFile(filePath, frase);

    console.log("Frase adicionada com sucesso:", frase);
    res.status(201).json({ message: "Frase adicionada com sucesso", frase });
  } catch (error) {
    console.error("Erro ao adicionar frase:", error);
    res.status(500).json({ error: "Erro ao adicionar frase" });
  }
});

// Rota para remover uma frase
app.delete("/frases/:index", async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const { frases } = await lerFrases();

    if (index < 0 || index >= frases.length) {
      return res.status(404).json({ error: "Frase não encontrada" });
    }

    const textsDir = path.join(__dirname, "media", "texts");
    const files = await fsPromises.readdir(textsDir);
    const fileToDelete = files[index];

    if (fileToDelete) {
      await fsPromises.unlink(path.join(textsDir, fileToDelete));
    }

    res.json({ message: "Frase removida com sucesso" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao remover frase" });
  }
});

// Rota para servir o frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Rota de healthcheck
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

console.log("Iniciando configuração do WhatsApp...");

// Detectar caminho do Chrome/Chromium de forma condicional por plataforma
let chromePath;
if (process.platform === 'win32') {
  const candidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  chromePath = candidates.find(p => p && fs.existsSync(p));
} else {
  const linuxPath = path.join(__dirname, 'chrome-linux64', 'chrome');
  chromePath = fs.existsSync(linuxPath) ? linuxPath : undefined;
}
const userDataDir = path.join(__dirname, "chrome-data");

// Garantir que o diretório de dados existe
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

// Configuração do WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-bot",
    dataPath: path.join(__dirname, ".wwebjs_auth"),
  }),
    puppeteer: Object.assign({
  headless: (process.env.PUPPETEER_HEADLESS ? process.env.PUPPETEER_HEADLESS === 'true' : false),
    args: [
      `--user-data-dir=${userDataDir}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,720",
    ],
    },
    (chromePath ? { executablePath: chromePath } : {}), {
    timeout: 300000, // 5 minutos
    defaultViewport: {
      width: 1280,
      height: 720,
    },
    pipe: true,
    dumpio: false,
    ignoreHTTPSErrors: true,
    protocolTimeout: 300000,
    }),
  restartOnAuthFail: true,
  qrMaxRetries: 5,
  authTimeout: 300000, // 5 minutos
  qrQualityOptions: {
    quality: 0.8,
    margin: 4,
  },
});

// Função para limpar dados do Chrome
async function limparDadosChrome() {
  try {
    log("Limpando dados do Chrome...", "info");
    const chromeDataPath = path.join(__dirname, ".wwebjs_auth", "Default");
    if (fs.existsSync(chromeDataPath)) {
      const dirsToClean = [
        "IndexedDB",
        "Local Storage",
        "Session Storage",
        "Cache",
        "Code Cache",
      ];
      for (const dir of dirsToClean) {
        const dirPath = path.join(chromeDataPath, dir);
        if (fs.existsSync(dirPath)) {
          await fsPromises.rm(dirPath, { recursive: true, force: true });
          log(`Diretório ${dir} limpo com sucesso`, "success");
        }
      }
    }
    log("Limpeza dos dados do Chrome concluída", "success");
  } catch (error) {
    log(`Erro ao limpar dados do Chrome: ${error.message}`, "error");
  }
}

// Função para inicializar com retry
async function initializeWithRetry(retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      log(`Tentativa ${i + 1} de ${retries} de inicialização...`, "info");

      // Limpar dados do Chrome antes de cada tentativa
      await limparDadosChrome();

      // Limpar processos do Chrome antes de cada tentativa
      try {
        if (process.platform === 'win32') {
          // For Windows, use taskkill to terminate chrome processes
          await execPromise('taskkill /IM chrome.exe /F');
        } else {
          await execPromise('pkill -f chrome');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        log("Nenhum processo Chrome para matar ou erro ao matar processos", 'info');
      }

      log("Aguardando delay inicial...", "info");
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Inicializar com timeout e tratamento de erro
      try {
        log("Iniciando cliente WhatsApp...", "info");
        const initPromise = client.initialize();
        const timeoutPromise = new Promise(
          (_, reject) =>
            setTimeout(
              () => reject(new Error("Timeout na inicialização")),
              600000
            ) // 10 minutos
        );

        log("Aguardando inicialização...", "info");
        await Promise.race([initPromise, timeoutPromise]);

        log("Cliente inicializado, aguardando página carregar...", "info");
        // Aguardar a página estar completamente carregada
        await new Promise((resolve) => setTimeout(resolve, 30000)); // 30 segundos

        // Verificar se o cliente está realmente pronto
        if (!client.pupPage) {
          throw new Error("Página do Puppeteer não inicializada corretamente");
        }

        log("Cliente inicializado com sucesso!", "success");
        return;
      } catch (initError) {
        log(`Erro durante inicialização: ${initError.message}`, "error");
        throw initError;
      }
    } catch (error) {
      log(`Erro na tentativa ${i + 1}: ${error.message}`, "error");
      if (i === retries - 1) throw error;
      log(
        `Aguardando ${
          (delay * 2) / 1000
        } segundos antes da próxima tentativa...`,
        "info"
      );
      await new Promise((resolve) => setTimeout(resolve, delay * 2));
    }
  }
}

// Adicionar handler para erros de navegação
client.on("disconnected", async (reason) => {
  log(`Cliente desconectado: ${reason}`, "warning");
  log("Tentando reconectar em 60 segundos...", "info");
  setTimeout(async () => {
    log("Iniciando reconexão...", "info");
    try {
      await initializeWithRetry();
    } catch (err) {
      log(`Erro na reconexão: ${err.message}`, "error");
      setTimeout(() => {
        log("Tentando reconexão novamente após erro...", "info");
        initializeWithRetry();
      }, 60000);
    }
  }, 60000);
});

// Adicionar handler para erros de autenticação
client.on("auth_failure", async (error) => {
  log(`Falha na autenticação: ${error}`, "error");
  log(`Detalhes do erro: ${JSON.stringify(error, null, 2)}`, "error");
  log("Tentando reiniciar em 60 segundos...", "info");
  setTimeout(async () => {
    log("Reiniciando após falha de autenticação...", "info");
    try {
      await initializeWithRetry();
    } catch (err) {
      log(`Erro na reinicialização: ${err.message}`, "error");
      setTimeout(() => {
        log("Tentando reinicialização novamente...", "info");
        initializeWithRetry();
      }, 60000);
    }
  }, 60000);
});

// Adicionar handler para erros não capturados
process.on("uncaughtException", async (error) => {
  log(`Erro não capturado: ${error.message}`, "error");
  log(`Stack: ${error.stack}`, "error");
  if (
    error.message.includes("Protocol error") ||
    error.message.includes("Session closed") ||
    error.message.includes("Target closed") ||
    error.message.includes("Execution context was destroyed")
  ) {
    log(
      "Erro de protocolo detectado, reiniciando em 60 segundos...",
      "warning"
    );
    setTimeout(async () => {
      log("Reiniciando após erro de protocolo...", "info");
      try {
        await initializeWithRetry();
      } catch (err) {
        log(`Erro na reinicialização: ${err.message}`, "error");
        setTimeout(() => {
          log("Tentando reinicialização novamente...", "info");
          initializeWithRetry();
        }, 60000);
      }
    }, 60000);
  }
});

client.on("loading_screen", (percent, message) => {
  log(`Carregando: ${percent}% ${message}`, "info");
});

client.on("authenticated", () => {
  log("Autenticado com sucesso!", "success");
});

// Data alvo
const targetDate = moment("2025-07-25");

// Função para calcular dias restantes
function getDaysRemaining() {
  return targetDate.diff(moment(), "days");
}

// Função para delay aleatório
function randomDelay(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// Função para obter um vídeo fixo da pasta daily_vid
function getLocalDailyVideo() {
  try {
    const now = moment();
    const currentHour = now.hour();
    const dailyDir = path.join(__dirname, 'daily_vid');
    const videos = {
      manha: 'bomdia.mp4',
      noite: 'bomnoite.mp4'
    };

    // Escolha manhã se entre 6h e 11:59, caso contrário escolha noite
    if (currentHour >= 6 && currentHour < 18) {
      const p = path.join(dailyDir, videos.manha);
      log(`Selecionando vídeo da manhã: ${videos.manha}`, 'info');
      if (fs.existsSync(p)) return p;
    }

    const p2 = path.join(dailyDir, videos.noite);
    log(`Selecionando vídeo da noite: ${videos.noite}`, 'info');
    if (fs.existsSync(p2)) return p2;

    // fallback: primeiro mp4 disponível
    if (fs.existsSync(dailyDir)) {
      const files = fs.readdirSync(dailyDir).filter(f => f.toLowerCase().endsWith('.mp4'));
      if (files.length > 0) return path.join(dailyDir, files[0]);
    }

    return null;
  } catch (error) {
    log(`Erro ao obter vídeo local: ${error.message}`, 'error');
    return null;
  }
}

// Função para obter uma frase aleatória e removê-la
async function getRandomPhrase() {
  try {
    const { frases } = await lerFrases();
    if (!frases || frases.length === 0) {
      console.log("Nenhuma frase disponível");
      return "";
    }

    const randomIndex = Math.floor(Math.random() * frases.length);
    const frase = frases[randomIndex];

    await salvarFrases({
      frases: frases.filter((_, index) => index !== randomIndex),
    });

    return frase;
  } catch (error) {
    console.error("Erro ao obter frase aleatória:", error);
    return "";
  }
}

// Variável para controlar se já está em execução
let isRunning = false;

// Função para verificar vídeo e enviar mensagem
async function checkAndSendVideo() {
  if (isRunning) {
    console.log("Já existe uma verificação em andamento...");
    return false;
  }

  try {
    isRunning = true;
    console.log("Iniciando nova verificação de vídeo...");

    // Adiciona timeout de 10 minutos para a verificação
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout: Verificação demorou mais de 10 minutos')), 10 * 60 * 1000);
    });

    const videoCheckPromise = (async () => {
      const videoPath = getLocalDailyVideo();
      if (videoPath) {
        console.log("Vídeo local encontrado! Iniciando envio...");
        await sendWhatsAppMessage(videoPath);
        return true;
      }
      console.log("Nenhum vídeo local encontrado.");
      return false;
    })();

    const result = await Promise.race([videoCheckPromise, timeoutPromise]);
    return result;
  } catch (error) {
    console.error("Erro durante verificação/envio:", error.message);
    return false;
  } finally {
    isRunning = false;
    console.log("Verificação finalizada.");
  }
}

// Função para iniciar o processo de verificação
async function startVideoCheck() {
  console.log("Iniciando processo de verificação de vídeos...");
  let videoFound = false;
  let attempts = 0;
  const maxAttempts = 8; // Máximo de 8 tentativas (das 7h às 14h)

  while (!videoFound && attempts < maxAttempts) {
    attempts++;
    const currentHour = moment().hour();
    console.log(
      `Tentativa ${attempts} de ${maxAttempts}... (Hora atual: ${currentHour}h)`
    );

    videoFound = await checkAndSendVideo();

    if (!videoFound) {
      if (attempts < maxAttempts) {
        console.log(
          `Aguardando 1 hora para próxima verificação... (Tentativa ${attempts}/${maxAttempts})`
        );
        await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000)); // 1 hora
      }
    }
  }

  if (videoFound) {
    console.log(
      "Vídeo enviado com sucesso! Próxima verificação às 7:30 do próximo dia."
    );
  } else {
    console.log(
      `Máximo de tentativas (${maxAttempts}) atingido. Próxima verificação às 7:30 do próximo dia.`
    );
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
        console.log(
          `Aguardando ${delay / 1000} segundos antes da próxima tentativa...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Configuração do Multer para upload de mídia
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const isVideo = file.mimetype.startsWith("video/");
    const uploadDir = path.join(
      __dirname,
      "media",
      isVideo ? "videos" : "images"
    );
    // Garantir que o diretório existe
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ["image/jpeg", "image/png", "image/gif"];
  const allowedVideoTypes = [
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
  ];

  if (
    file.mimetype.startsWith("image/") &&
    allowedImageTypes.includes(file.mimetype)
  ) {
    cb(null, true);
  } else if (
    file.mimetype.startsWith("video/") &&
    allowedVideoTypes.includes(file.mimetype)
  ) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Tipo de arquivo não permitido. Use apenas imagens (JPG, PNG, GIF) ou vídeos (MP4, MOV, AVI, MKV)."
      ),
      false
    );
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

// Rota para upload de mídia
app.post("/media", upload.single("file"), async (req, res) => {
  try {
    console.log("Recebendo upload de mídia:", {
      file: req.file,
      body: req.body,
      headers: req.headers,
    });

    if (!req.file) {
      console.log("Nenhum arquivo enviado");
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const type = req.body.type || MEDIA_TYPES.TEXT;
    if (!Object.values(MEDIA_TYPES).includes(type)) {
      console.log("Tipo de mídia inválido:", type);
      return res.status(400).json({ error: "Tipo de mídia inválido" });
    }

    console.log("Salvando mídia do tipo:", type);
    const media = await saveMedia(req.file, type);
    console.log("Mídia salva com sucesso:", media);

    res.setHeader("Content-Type", "application/json");
    res.status(201).json({ message: "Mídia salva com sucesso", media });
  } catch (error) {
    console.error("Erro ao salvar mídia:", error);
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ error: error.message });
  }
});

// Rota para servir arquivos de mídia
app.get("/media/:type/:filename", (req, res) => {
  const { type, filename } = req.params;
  // Garantir que o tipo seja plural (images, videos, texts)
  const pluralType = type.endsWith("s") ? type : `${type}s`;
  const filePath = path.join(__dirname, "media", pluralType, filename);

  console.log("Tentando servir arquivo:", filePath);

  // Verificar se o arquivo existe
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    return res.status(404).json({ error: "Arquivo não encontrado" });
  }

  // Configurar headers antes de enviar o arquivo
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

  // Criar stream de leitura
  const fileStream = fs.createReadStream(filePath);

  // Lidar com erros do stream
  fileStream.on("error", (error) => {
    console.error(`Erro ao ler arquivo ${filePath}:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro ao ler arquivo" });
    }
  });

  // Lidar com abandono da requisição
  req.on("aborted", () => {
    fileStream.destroy();
  });

  // Enviar arquivo
  fileStream.pipe(res);
});

// Rota para listar mídia
app.get("/media", async (req, res) => {
  try {
    console.log("Buscando mídias...");
    const type = req.query.type;
    if (type && !Object.values(MEDIA_TYPES).includes(type)) {
      return res.status(400).json({ error: "Tipo de mídia inválido" });
    }

    const media = await listAllMedia();
    console.log("Mídias encontradas:", media);
    // Modificar os caminhos para URLs relativas
    const mediaWithUrls = media.map((item) => ({
      ...item,
      url: `/media/${item.type}/${path.basename(item.path)}`,
    }));
    console.log("Mídias com URLs:", mediaWithUrls);
    res.json(mediaWithUrls);
  } catch (error) {
    console.error("Erro ao listar mídias:", error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para deletar mídia
app.delete("/media/:type/:filename", async (req, res) => {
  try {
    const { type, filename } = req.params;
    // Garantir que o tipo seja plural (images, videos, texts)
    const pluralType = type.endsWith("s") ? type : `${type}s`;
    const filePath = path.join(__dirname, "media", pluralType, filename);

    console.log("Tentando deletar arquivo:", filePath);

    // Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
      console.error(`Arquivo não encontrado: ${filePath}`);
      return res.status(404).json({ error: "Arquivo não encontrado" });
    }

    // Remover o arquivo
    await fsPromises.unlink(filePath);
    console.log(`Arquivo removido: ${filePath}`);

    res.json({ message: "Mídia removida com sucesso" });
  } catch (error) {
    console.error("Erro ao remover mídia:", error);
    res.status(500).json({ error: error.message });
  }
});

// Função para enviar mensagem do WhatsApp
async function sendWhatsAppMessage(videoPath = null) {
  try {
    // Se não foi passado o videoPath, usa o vídeo local
    if (!videoPath) {
      videoPath = getLocalDailyVideo();
    }
    if (!videoPath) {
      log("Nenhum vídeo encontrado para enviar", "warning");
      return;
    }

    log("Verificando conexão com WhatsApp...", "info");
    if (!client.pupPage) {
      throw new Error("WhatsApp Web não está inicializado corretamente");
    }

    // Buscar evento(s) mais próximo(s) no banco
    let defaultMessage;
    try {
      const futureEvents = await Event.find({ date: { $gt: new Date() } }).sort({ date: 1 }).lean();
      if (futureEvents && futureEvents.length > 0) {
        // selecionar todos os eventos que compartilham a mesma data/hora mais próxima
        const nearestIso = new Date(futureEvents[0].date).toISOString();
        const nearestEvents = futureEvents.filter(e => new Date(e.date).toISOString() === nearestIso);
        const names = nearestEvents.map(e => e.name).join(' ou ');
  const daysRemaining = moment(nearestIso).startOf('day').diff(moment().startOf('day'), 'days');
        defaultMessage = `Faltam ${daysRemaining} dias para ${names} e eu ainda não consigo acreditar que hoje já é dia ${moment().format('DD')}! 🎉`;
      } else {
        const daysRemaining = getDaysRemaining();
        defaultMessage = `Faltam ${daysRemaining} dias para a chacrinha e eu ainda não consigo acreditar que hoje já é dia ${moment().format('DD')}! 🎉`;
      }
    } catch (err) {
      log(`Erro ao buscar eventos para legenda: ${err.message}`, 'error');
      const daysRemaining = getDaysRemaining();
      defaultMessage = `Faltam ${daysRemaining} dias para a chacrinha e eu ainda não consigo acreditar que hoje já é dia ${moment().format('DD')}! 🎉`;
    }

    const groupId = "120363339314665620@g.us";
    const confirmationNumber = "5514982276185@c.us";

    // 1. Enviar vídeo com a mensagem de contagem regressiva (baseada em eventos cadastrados)
    try {
      const media = MessageMedia.fromFilePath(videoPath);
      await retryOperation(async () => {
        await client.sendMessage(groupId, media, {
          caption: defaultMessage,
        });
      });
      log("Vídeo enviado com sucesso", "success");
    } catch (videoError) {
      log(`Erro ao enviar vídeo: ${videoError.message}`, "error");
      await retryOperation(async () => {
        await client.sendMessage(
          confirmationNumber,
          "❌ Erro ao enviar vídeo: " + videoError.message
        );
      });
      throw videoError;
    }

    // 2. Obter mídia aleatória
    const randomMedia = await getRandomMedia();
    if (randomMedia) {
      const mediaType =
        randomMedia.type === MEDIA_TYPES.TEXT
          ? "mensagem"
          : randomMedia.type === MEDIA_TYPES.IMAGE
          ? "foto"
          : "vídeo";

      // 3. Enviar mensagem de texto sobre a mídia sorteada
      const mediaTypeMessage = `${
        mediaType.charAt(0).toUpperCase() + mediaType.slice(1)
      } do dia:`;
      await retryOperation(async () => {
        await client.sendMessage(groupId, mediaTypeMessage);
      });
      log(`Mensagem sobre ${mediaType} enviada`, "success");

      // 4. Enviar a mídia sem legenda
      log(`Enviando ${mediaType} do dia...`, "info");
      const mediaMessage = await prepareMediaForWhatsApp(randomMedia);

      if (mediaType === "mensagem") {
        await retryOperation(async () => {
          await client.sendMessage(groupId, mediaMessage.content);
        });
      } else {
        await retryOperation(async () => {
          await client.sendMessage(groupId, mediaMessage);
        });
      }
      log(
        `${
          mediaType.charAt(0).toUpperCase() + mediaType.slice(1)
        } do dia enviada com sucesso`,
        "success"
      );

      // Remover mídia após envio
      await removeMedia(randomMedia.path);
      log("Mídia removida após envio", "info");
    }

    // Não removemos os arquivos da pasta daily_vid pois são vídeos fixos do projeto.
    log("Processo de envio finalizado com sucesso!", "success");

    log("Processo de envio finalizado com sucesso!", "success");
  } catch (error) {
    log(`Erro ao enviar mensagem: ${error.message}`, "error");
    throw error;
  }
}

// Configurar evento de QR Code do WhatsApp
client.on("qr", (qr) => {
  log("QR Code gerado! Escaneie com seu WhatsApp:", "info");
  log("----------------------------------------", "info");
  qrcode.generate(qr, { small: true });
  log("----------------------------------------", "info");
  log("Se o QR Code acima não estiver legível, você pode:", "info");
  log("1. Aumentar o zoom do terminal", "info");
  log("2. Copiar o QR Code e usar um leitor online", "info");
  log("3. Tentar novamente em alguns segundos", "info");
});

// Quando o cliente estiver pronto
client.on("ready", async () => {
  log("Cliente WhatsApp conectado!", "success");
  log(`Diretório da sessão: ${path.join(__dirname, ".wwebjs_auth")}`, "info");

  // Aguarda 5 segundos para garantir que o WhatsApp Web está completamente inicializado
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Agendar tarefa para rodar todos os dias às 7:30
  cron.schedule("30 7 * * *", () => {
    log("Iniciando verificação diária de vídeos...", "info");
    startVideoCheck();
  });

    // Agendar verificação diária às 23:59
    cron.schedule("59 23 * * *", () => {
      log("Iniciando verificação diária de vídeos às 23:59...", "info");
      startVideoCheck();
    });

  // Iniciar a verificação imediatamente ao iniciar o servidor

  startVideoCheck();

  log("Cron agendado com sucesso!", "success");
});

// Função para inicializar diretórios de mídia
async function initializeDirectories() {
  try {
    const directories = [
      path.join(__dirname, "media"),
      path.join(__dirname, "media", "images"),
      path.join(__dirname, "media", "videos"),
      path.join(__dirname, "media", "texts"),
      path.join(__dirname, "temp"),
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        await fsPromises.mkdir(dir, { recursive: true });
        log(`Diretório criado: ${dir}`, "success");
      }
    }

    log("Todos os diretórios de mídia inicializados com sucesso", "success");
  } catch (error) {
    log(`Erro ao inicializar diretórios de mídia: ${error.message}`, "error");
    throw error;
  }
}

// Iniciar o servidor Express
app.listen(PORT, async () => {
  log(`API rodando na porta ${PORT}`, "success");

  // Inicializar diretórios de mídia
  try {
    await initializeDirectories();
    log("Diretórios de mídia inicializados com sucesso", "success");
  } catch (error) {
    log(`Erro ao inicializar diretórios de mídia: ${error.message}`, "error");
  }

  log("Iniciando cliente WhatsApp...", "info");
  // Iniciar o cliente WhatsApp
  initializeWithRetry().catch((error) => {
    log(
      `Falha ao inicializar após todas as tentativas: ${error.message}`,
      "error"
    );
  });
});
