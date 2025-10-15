import "dotenv/config";
import { OpenAI } from "openai";

import WhatsappWebPkg from "whatsapp-web.js";
import QrCodeTerminal from "qrcode-terminal";
import moment from "moment-timezone";

const { Client, LocalAuth, MessageMedia } = WhatsappWebPkg;
const { generate } = QrCodeTerminal;
import cron from "node-cron";
const { locale, tz } = moment;
import "moment/locale/pt-br.js";
locale("pt-br");
import { existsSync, mkdirSync, readdirSync, createReadStream } from "fs";
import { promises as fsPromises } from "fs";
import { fileURLToPath } from "url";
import { join, extname, basename, dirname } from "path";
import express from "express";
import cors from "cors";
import { exec } from "child_process";
import { promisify } from "util";
const execPromise = promisify(exec);
import multer from "multer";
const { diskStorage } = multer;
import {
    MEDIA_TYPES,
    saveMedia,
    getRandomMedia,
    removeMedia,
    prepareMediaForWhatsApp,
    listAllMedia,
} from "./mediaManager.js";

// ESM-compatible __dirname/__filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
const tempDir = join(__dirname, "temp");
if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
    console.log("Diretório temp criado:", tempDir);
}

// Configuração do Express
const app = express();
const PORT = process.env.PORT || 3000;

// Limites de tamanho de texto
// Limite duro do WhatsApp
const MAX_MESSAGE_LENGTH = 4096;
// Limite recomendado para mensagens de texto geradas/enviadas (humano-legíveis)
const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TEXT_LENGTH || "1000", 10);

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Load mongoose (env already loaded by dotenv/config)
import mongoose from "mongoose";
const { connect, Schema, models, model: _model } = mongoose;

const mongoConnStr = process.env.MONGO_CONNECTION_STRING;
let dbConnected = false;

async function connectWithRetry(uri, maxAttempts = 6) {
    if (!uri) {
        log("MONGO_CONNECTION_STRING não definido no .env", "warning");
        return;
    }

    const baseDelay = 2000; // 2s
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            log(
                `Tentativa de conexão ao MongoDB (${attempt}/${maxAttempts})...`,
                "info"
            );
            await connect(uri, {
                // Mongoose 7+ options: these are no-ops in some versions but safe to include
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                connectTimeoutMS: 10000,
                family: 4,
                // useNewUrlParser/useUnifiedTopology are defaults in newer mongoose
            });
            dbConnected = true;
            log("Conectado ao MongoDB com sucesso", "success");
            return;
        } catch (err) {
            dbConnected = false;
            log(
                `Erro ao conectar no MongoDB (attempt ${attempt}): ${err.message}`,
                "error"
            );
            if (attempt < maxAttempts) {
                const delay = baseDelay * Math.pow(2, attempt - 1);
                log(
                    `Aguardando ${Math.round(
                        delay / 1000
                    )}s antes da próxima tentativa...`,
                    "info"
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
                log(
                    "Máximo de tentativas de conexão ao MongoDB atingido. Prosseguindo sem DB.",
                    "warning"
                );
            }
        }
    }
}

// Start initial connection attempt (non-blocking)
connectWithRetry(mongoConnStr).catch((e) => {
    log(`connectWithRetry encerrou com erro inesperado: ${e.message}`, "error");
});

// OpenAI helper: generate a short caption using the provided persona and context
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
// Admin confirmation number (JID). Can be overridden by CONFIRMATION_NUMBER env var.
const CONFIRMATION_NUMBER_RAW =
    process.env.CONFIRMATION_NUMBER || "5514997061981";
const confirmationNumber = CONFIRMATION_NUMBER_RAW.includes("@")
    ? CONFIRMATION_NUMBER_RAW
    : `${CONFIRMATION_NUMBER_RAW}@c.us`;

// utilzinhos
function _preview(str, n = 160) {
    return String(str || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, n);
}

function _normalizeMessages(raw) {
    return (raw || [])
        .map((m) => ({
            role: m?.role || "user",
            content:
                typeof m?.content === "string"
                    ? m.content
                    : String(m?.content ?? ""),
        }))
        .filter((m) => m.content.trim());
}

function _extractResponseText(resp) {
    // 1) conveniência moderna do SDK
    if (resp?.output_text && resp.output_text.trim())
        return resp.output_text.trim();

    // 2) árvore comum: output[].content[].text | refusal
    if (Array.isArray(resp?.output)) {
        for (const item of resp.output) {
            if (Array.isArray(item?.content)) {
                for (const c of item.content) {
                    if (typeof c?.text === "string" && c.text.trim())
                        return c.text.trim();
                    if (
                        c?.type === "output_text" &&
                        typeof c?.text === "string" &&
                        c.text.trim()
                    )
                        return c.text.trim();
                    if (
                        c?.type === "refusal" &&
                        typeof c?.text === "string" &&
                        c.text.trim()
                    )
                        return c.text.trim();
                }
            }
        }
    }

    // 3) variação antiga: data[0].content[0].text
    if (Array.isArray(resp?.data)) {
        for (const d of resp.data) {
            if (Array.isArray(d?.content)) {
                for (const c of d.content) {
                    if (typeof c?.text === "string" && c.text.trim())
                        return c.text.trim();
                }
            }
        }
    }
    return null;
}

// Simplificada: só GPT-5 via Responses API, sem fallback/retry e ignorando temperatura.
// Requer SDK oficial: `npm i openai` e um `openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` já instanciado.

async function callOpenAIChat(
    messages,
    _timeoutMs = 60000,
    maxCompletionTokensOverride = null,
    modelOverride = null,
    temperatureOverride = null
) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
    if (!OPENAI_API_KEY) {
        log(
            "OPENAI_API_KEY não configurada, pulando chamada à OpenAI",
            "warning"
        );
        return null;
    }

    const modelInUse = modelOverride || OPENAI_MODEL;
    if (!/^gpt-5/i.test(modelInUse)) {
        log(
            `Aviso: "${modelInUse}" não parece gpt-5; esta função usa Responses API focada em gpt-5.`,
            "info"
        );
    }

    const maxOutputTokens =
        maxCompletionTokensOverride ??
        (process.env.OPENAI_MAX_COMPLETION_TOKENS
            ? parseInt(process.env.OPENAI_MAX_COMPLETION_TOKENS, 10)
            : 512);

    if (
        (temperatureOverride !== null && temperatureOverride !== undefined) ||
        (process.env.OPENAI_TEMPERATURE !== undefined &&
            process.env.OPENAI_TEMPERATURE !== "")
    ) {
        log(
            "Temperatura ignorada: gpt-5 usa valor padrão do servidor.",
            "info"
        );
    }

    const msgs = _normalizeMessages(messages);
    const systemInstructions = msgs
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n")
        .trim();
    const convo = msgs
        .filter((m) => m.role !== "system")
        .map((m) => ({
            role: m.role,
            content: [{ type: "input_text", text: m.content }],
        }));

    try {
        const sum = msgs
            .slice(0, 5)
            .map((m) => _preview(m.content, 100))
            .join(" | ");
        log(
            `OpenAI request -> model=${modelInUse} max_output_tokens=${maxOutputTokens} messagesSummary=[${sum}]`,
            "debug"
        );
    } catch {}

    try {
        const resp = await openai.responses.create({
            model: modelInUse,
            ...(systemInstructions ? { instructions: systemInstructions } : {}),
            input: convo, // [{ role, content: [{ type: "input_text", text }] }]
            text: { format: { type: "text" } }, // <- AQUI (era string)
            max_output_tokens: maxOutputTokens,
        });

        const text = _extractResponseText(resp);
        if (text && text.trim()) {
            log(
                `OpenAI returned content (truncated): ${_preview(text, 240)}`,
                "debug"
            );
            return text.trim();
        }

        // diagnóstico quando vier vazio
        try {
            const outputTypes = Array.isArray(resp?.output)
                ? resp.output.map((o) => o?.type || "unknown")
                : null;
            const contentTypes = Array.isArray(resp?.output)
                ? resp.output.flatMap((o) =>
                      (o?.content || []).map((c) => c?.type || typeof c)
                  )
                : null;

            log(
                `OpenAI vazio. status=${resp?.status} reason=${
                    resp?.incomplete_details?.reason || "n/a"
                } ` +
                    `outputTypes=${JSON.stringify(
                        outputTypes
                    )} contentTypes=${JSON.stringify(contentTypes)} ` +
                    `usage=${JSON.stringify(resp?.usage || {})}`,
                "warning"
            );
        } catch {}

        return null;
    } catch (err) {
        log(`Erro ao chamar OpenAI: ${err.message}`, "error");
        return null;
    }
}

const AI_PERSONA = `
Você é um bot de WhatsApp criado por Grego.
Fala como aquele amigo sarcástico que sempre tem uma resposta pronta.
Humor ácido, direto e às vezes cruel, mas nunca forçado.
Prefere zoar a situação do que explicar qualquer coisa.
Nada de frase montada, piada pronta, metáfora “engraçadinha” ou texto com cabeçalho.
PROIBIDO usar labels como "Resumo:", "Observação:", "Nota:", "Outra:" ou similares.
Não pareça roteiro: nada de enumerações, bullets, tópicos ou títulos.
Fala curto, em PT-BR, com gírias leves. Máximo 2 frases. Máximo 2 emojis (só se deixarem mais engraçado).
Não peça desculpas. Não diga que é bot/IA. Não eduque. Não explique o óbvio.
Evite soar “fofo” ou “bonzinho”; sarcasmo seco é a base.
Quando “filosofar”, é no tom de saco cheio, não de coach.
Não ataque grupos protegidos; zoe a situação ou a própria pessoa que fala, de leve.
Responda APENAS com a mensagem final, sem preâmbulo e sem formatação de relatório.
`;

// helper: redact phone-like numbers and long digit sequences to avoid exposing PII to the AI
function redactNumbers(text) {
    if (!text) return text;
    try {
        let s = String(text);
        // Replace phone-like sequences: +55 14 99999-9999, (14) 9999-9999, 5514997061981, etc.
        s = s.replace(/\+?\d[\d\s().\-]{4,}\d/g, "[NÚMERO_REMOVIDO]");
        // Fallback: any remaining runs of 4 or more digits
        s = s.replace(/\d{4,}/g, "[NÚMERO_REMOVIDO]");
        return s;
    } catch (e) {
        return text;
    }
}

// Note: we rely on the prompt asking OpenAI to "RETORNE SOMENTE" the final message.
// The raw response from callOpenAIChat is already trimmed, so we return it directly
// to avoid aggressive sanitization that could remove intended words.

async function generateAICaption({
    purpose = "greeting",
    names = [],
    timeStr = null,
    noEvents = false,
    dayOfWeek = null,
    countdown = null,
    eventsTodayDetails = null,
    nearestDateStr = null,
    todayDateStr = null,
}) {
    if (!OPENAI_API_KEY) return null;
    const eventList = names.length ? names.join(", ") : "nenhum evento";
    const userMsgParts = [];
    if (purpose === "greeting") {
        if (noEvents) {
            userMsgParts.push(
                `Gere uma legenda curta (1-2 frases) em português brasileiro para um grupo de WhatsApp dizendo que não há eventos hoje. Convide a galera a cadastrar no link: https://vmi2849405.contaboserver.net. Seja ácido, engraçado e levemente ofensivo conforme a persona. Use no máximo 2 emojis. RETORNE SOMENTE a legenda final, sem explicações, sem introduções como 'claro' ou 'vou gerar', sem passos.`
            );
            if (dayOfWeek) userMsgParts.push(`Contexto: hoje é ${dayOfWeek}.`);
            // Ensure AI attempts to be funny within the persona
            userMsgParts.push(
                "Tente ser engraçado e sarcástico conforme a persona acima."
            );
        } else {
            userMsgParts.push(
                `Gere uma legenda curta (1-2 frases) em português brasileiro mencionando os eventos do dia: ${eventList}${
                    timeStr ? " (" + timeStr + ")" : ""
                }. Seja ácido, engraçado, sarcástico e leve. Evite metáforas inspiracionais. Máximo 2 emojis. RETORNE SOMENTE a legenda final, sem explicações, sem introduções como 'claro' ou 'vou gerar', sem passos.`
            );
            if (dayOfWeek) userMsgParts.push(`Contexto: hoje é ${dayOfWeek}.`);
            userMsgParts.push(
                "Tente ser engraçado e sarcástico conforme a persona acima."
            );
        }
    } else if (purpose === "event") {
        // Require the AI to include a short comment/observation in addition to the announcement
        userMsgParts.push(
            `Gere uma mensagem de anúncio para o grupo dizendo que é hora do evento ${eventList}${
                timeStr ? " (" + timeStr + ")" : ""
            }. A mensagem deve conter: 1) uma frase clara anunciando que o evento começou; 2) uma observação curta e sarcástica (1 frase) comentando a situação — tipo uma zoeira rápida sobre o evento ou os participantes. Curta, sarcástica, com humor ácido, em português brasileiro. Até 2 emojis. RETORNE SOMENTE a mensagem final (duas frases no máximo), sem explicações.`
        );
        userMsgParts.push(
            "Tente ser engraçado e sarcástico conforme a persona acima."
        );
    }

    if (purpose === "greeting") {
        userMsgParts.push(
            "Se possivel, com um toque de crueldade divertida (sem exagero)."
        );
        userMsgParts.push(
            "Contexto importante: se o evento ainda nao for hoje, nao diga parabens nem que ja comecou; deixe claro que ainda falta e inclua a contagem."
        );
        if (eventsTodayDetails) {
            userMsgParts.push(
                `Hoje tem: ${eventsTodayDetails}. Mencione todos com seus horarios.`
            );
        } else if (nearestDateStr) {
            userMsgParts.push(
                `Proximo evento em: ${nearestDateStr}. Não diga que ja comecou; deixe claro que ainda falta.`
            );
        }
        if (
            countdown &&
            typeof countdown.days === "number" &&
            typeof countdown.hours === "number" &&
            typeof countdown.minutes === "number"
        ) {
            userMsgParts.push(
                `Obrigatorio: inclua no final a contagem de tempo restante neste formato exato: "Faltam ${countdown.days} dias, ${countdown.hours} horas e ${countdown.minutes} minutos".`
            );
        }
    }
    // Contexto adicional universal
    if (todayDateStr)
        userMsgParts.push(`Data de hoje (America/Sao_Paulo): ${todayDateStr}.`);
    if (purpose === "event" && dayOfWeek)
        userMsgParts.push(`Contexto: hoje é ${dayOfWeek}.`);
    userMsgParts.push(
        "Inclua pelo menos uma observacao sarcastica ou piada curta; evite resposta generica/obvia; mantenha tom acido da persona."
    );
    const messages = [
        { role: "system", content: AI_PERSONA },
        { role: "user", content: userMsgParts.join("\n") },
    ];

    // Use higher-quality model for greeting/short captions by default
    const modelForCaption = process.env.OPENAI_MODEL_GREET || "gpt-5-mini";
    const tempForCaption = process.env.OPENAI_TEMPERATURE_GREET || "0.9";
    const raw = await callOpenAIChat(
        messages,
        60000,
        null,
        modelForCaption,
        tempForCaption
    );
    return raw;
}

// Event model
const eventSchema = new Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    announced: { type: Boolean, default: false },
    announcedAt: { type: Date, default: null },
    claimedBy: { type: String, default: null },
    claimedAt: { type: Date, default: null },
});
const Event = models.Event || _model("Event", eventSchema);

// Analysis log schema - stores !analise attempts and responses for auditing
const analysisLogSchema = new Schema({
    user: { type: String, required: true }, // sender id (ex: 5514xxxx@c.us)
    chatId: { type: String, required: false },
    requestedN: { type: Number, default: 0 },
    analyzedCount: { type: Number, default: 0 },
    messages: { type: Array, default: [] }, // short snippets of messages
    result: { type: String, default: null },
    error: { type: String, default: null },
    durationMs: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
});
const AnalysisLog =
    models.AnalysisLog || _model("AnalysisLog", analysisLogSchema);

// In-memory fallback for rate-limiting when DB is unavailable
const lastAnalyses = new Map(); // key: user id, value: timestamp millis
const ANALYSE_COOLDOWN_SECONDS = parseInt(
    process.env.ANALYSE_COOLDOWN_SECONDS || "300",
    10
);

// Events API
app.get("/events", async (req, res) => {
    if (!dbConnected) return res.status(503).json({ error: "DB unavailable" });
    try {
        // Only return events that are upcoming, not yet announced and not claimed by any worker
        const now = new Date();
        const events = await Event.find({
            announced: false,
            claimedBy: null,
            date: { $gt: now },
        })
            .sort({ date: 1 })
            .lean();
        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// simple db-status endpoint
app.get("/db-status", (req, res) => {
    res.json({ connected: dbConnected });
});

app.post("/events", async (req, res) => {
    if (!dbConnected) return res.status(503).json({ error: "DB unavailable" });
    try {
        const { name, date } = req.body; // date expected as ISO string
        if (!name || !date)
            return res
                .status(400)
                .json({ error: "name and date are required" });

        // Interpret incoming date string in America/Sao_Paulo timezone.
        // If client sends an ISO with timezone, moment.tz will respect it; otherwise we assume it's local date/time in Sao Paulo.
        let m = tz(date, "America/Sao_Paulo");

        if (!m.isValid()) {
            // Try parsing as plain ISO fallback
            m = moment(date);
            if (!m.isValid())
                return res.status(400).json({ error: "Invalid date format" });
        }

        // Check if the event time is in the past relative to Sao_Paulo now
        const nowSP = tz("America/Sao_Paulo");
        if (m.isBefore(nowSP)) {
            return res
                .status(400)
                .json({ error: "Cannot create event in the past" });
        }

        // Store the UTC instant corresponding to the Sao_Paulo local time
        const ev = new Event({ name, date: m.toDate() });
        await ev.save();
        res.status(201).json(ev);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/events/:id", async (req, res) => {
    if (!dbConnected) return res.status(503).json({ error: "DB unavailable" });
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
        const textsDir = join(__dirname, "media", "texts");
        const files = await fsPromises.readdir(textsDir);

        const frases = await Promise.all(
            files.map(async (file) => {
                const filePath = join(textsDir, file);
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
        const textsDir = join(__dirname, "media", "texts");
        const files = await fsPromises.readdir(textsDir);

        await Promise.all(
            data.frases.map(async (frase, index) => {
                const fileName = `frase_${Date.now()}_${index + 1}.txt`;
                const filePath = join(textsDir, fileName);
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
        const filePath = join(__dirname, "media", "texts", fileName);
        await fsPromises.writeFile(filePath, frase);

        console.log("Frase adicionada com sucesso:", frase);
        res.status(201).json({
            message: "Frase adicionada com sucesso",
            frase,
        });
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

        const textsDir = join(__dirname, "media", "texts");
        const files = await fsPromises.readdir(textsDir);
        const fileToDelete = files[index];

        if (fileToDelete) {
            await fsPromises.unlink(join(textsDir, fileToDelete));
        }

        res.json({ message: "Frase removida com sucesso" });
    } catch (error) {
        res.status(500).json({ error: "Erro ao remover frase" });
    }
});

// Rota para servir o frontend
app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "public", "index.html"));
});

// Rota de healthcheck
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

console.log("Iniciando configuração do WhatsApp...");

// Detectar caminho do Chrome/Chromium de forma condicional por plataforma
let chromePath;
if (process.platform === "win32") {
    const candidates = [
        join(
            process.env.PROGRAMFILES || "C:\\Program Files",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe"
        ),
        join(
            process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe"
        ),
        join(
            process.env.LOCALAPPDATA || "",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe"
        ),
    ];
    chromePath = candidates.find((p) => p && existsSync(p));
} else {
    const linuxPath = join(__dirname, "chrome-linux64", "chrome");
    chromePath = existsSync(linuxPath) ? linuxPath : undefined;
}
const userDataDir = join(__dirname, "chrome-data");

// Garantir que o diretório de dados existe
if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
}

// Configuração do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot",
        dataPath: join(__dirname, ".wwebjs_auth"),
    }),
    puppeteer: Object.assign(
        {
            headless: true,
            args: [
                `--user-data-dir=${userDataDir}`,
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--window-size=1280,720",
            ],
        },
        chromePath ? { executablePath: chromePath } : {},
        {
            timeout: 300000, // 5 minutos
            defaultViewport: {
                width: 1280,
                height: 720,
            },
            pipe: true,
            dumpio: false,
            ignoreHTTPSErrors: true,
            protocolTimeout: 300000,
        }
    ),
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
        const chromeDataPath = join(__dirname, ".wwebjs_auth", "Default");
        if (existsSync(chromeDataPath)) {
            const dirsToClean = [
                "IndexedDB",
                "Local Storage",
                "Session Storage",
                "Cache",
                "Code Cache",
            ];
            for (const dir of dirsToClean) {
                const dirPath = join(chromeDataPath, dir);
                if (existsSync(dirPath)) {
                    await fsPromises.rm(dirPath, {
                        recursive: true,
                        force: true,
                    });
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
                if (process.platform === "win32") {
                    // For Windows, use taskkill to terminate chrome processes
                    await execPromise("taskkill /IM chrome.exe /F");
                } else {
                    await execPromise("pkill -f chrome");
                }
                await new Promise((resolve) => setTimeout(resolve, 2000));
            } catch (e) {
                log(
                    "Nenhum processo Chrome para matar ou erro ao matar processos",
                    "info"
                );
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

                log(
                    "Cliente inicializado, aguardando página carregar...",
                    "info"
                );
                // Aguardar a página estar completamente carregada
                await new Promise((resolve) => setTimeout(resolve, 30000)); // 30 segundos

                // Verificar se o cliente está realmente pronto
                if (!client.pupPage) {
                    throw new Error(
                        "Página do Puppeteer não inicializada corretamente"
                    );
                }

                log("Cliente inicializado com sucesso!", "success");
                return;
            } catch (initError) {
                log(
                    `Erro durante inicialização: ${initError.message}`,
                    "error"
                );
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
        const dailyDir = join(__dirname, "daily_vid");
        const videos = {
            manha: "bomdia.mp4",
            noite: "bomnoite.mp4",
        };

        // Escolha manhã se entre 6h e 11:59, caso contrário escolha noite
        if (currentHour >= 6 && currentHour < 18) {
            const p = join(dailyDir, videos.manha);
            log(`Selecionando vídeo da manhã: ${videos.manha}`, "info");
            if (existsSync(p)) return p;
        }

        const p2 = join(dailyDir, videos.noite);
        log(`Selecionando vídeo da noite: ${videos.noite}`, "info");
        if (existsSync(p2)) return p2;

        // fallback: primeiro mp4 disponível
        if (existsSync(dailyDir)) {
            const files = readdirSync(dailyDir).filter((f) =>
                f.toLowerCase().endsWith(".mp4")
            );
            if (files.length > 0) return join(dailyDir, files[0]);
        }

        return null;
    } catch (error) {
        log(`Erro ao obter vídeo local: ${error.message}`, "error");
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
            setTimeout(
                () =>
                    reject(
                        new Error(
                            "Timeout: Verificação demorou mais de 10 minutos"
                        )
                    ),
                10 * 60 * 1000
            );
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
                await new Promise((resolve) =>
                    setTimeout(resolve, 60 * 60 * 1000)
                ); // 1 hora
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
                    `Aguardando ${
                        delay / 1000
                    } segundos antes da próxima tentativa...`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// Configuração do Multer para upload de mídia
const storage = diskStorage({
    destination: function (req, file, cb) {
        const isVideo = file.mimetype.startsWith("video/");
        const uploadDir = join(
            __dirname,
            "media",
            isVideo ? "videos" : "images"
        );
        // Garantir que o diretório existe
        mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = extname(file.originalname);
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
    const filePath = join(__dirname, "media", pluralType, filename);

    console.log("Tentando servir arquivo:", filePath);

    // Verificar se o arquivo existe
    if (!existsSync(filePath)) {
        console.error(`Arquivo não encontrado: ${filePath}`);
        return res.status(404).json({ error: "Arquivo não encontrado" });
    }

    // Configurar headers antes de enviar o arquivo
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    // Criar stream de leitura
    const fileStream = createReadStream(filePath);

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
            url: `/media/${item.type}/${basename(item.path)}`,
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
        const filePath = join(__dirname, "media", pluralType, filename);

        console.log("Tentando deletar arquivo:", filePath);

        // Verificar se o arquivo existe
        if (!existsSync(filePath)) {
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
        // Define groupId from env or default
        const groupId = process.env.GROUP_ID || "120363339314665620@g.us";
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

        // Buscar evento(s) mais próximo(s) no banco e compor legenda com contagem dinâmica
        let defaultMessage;
        // declare these in function scope so they can be used later
        let futureEvents = null;
        let nearestDate = null;
        let nearestIso = null;
        try {
            futureEvents = await Event.find({ date: { $gt: new Date() } })
                .sort({ date: 1 })
                .lean();
            if (futureEvents && futureEvents.length > 0) {
                // selecionar todos os eventos que compartilham a mesma data/hora mais próxima
                nearestDate = new Date(futureEvents[0].date);
                nearestIso = nearestDate.toISOString();
                const nearestEvents = futureEvents.filter(
                    (e) => new Date(e.date).toISOString() === nearestIso
                );
                const names = nearestEvents.map((e) => e.name).join(" ou ");

                // Calcular diferença em São Paulo
                const target = tz(nearestDate, "America/Sao_Paulo");
                const nowSP = tz("America/Sao_Paulo");
                let diffMs = target.diff(nowSP);

                if (diffMs <= 0) {
                    defaultMessage = `Eventos do dia: ${names}`;
                } else {
                    const totalMinutes = Math.floor(diffMs / (1000 * 60));
                    const days = Math.floor(totalMinutes / (60 * 24));
                    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
                    const minutes = totalMinutes % 60;

                    const parts = [];
                    if (days > 0)
                        parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
                    if (hours > 0)
                        parts.push(
                            `${hours} ${hours === 1 ? "hora" : "horas"}`
                        );
                    if (minutes > 0)
                        parts.push(
                            `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`
                        );
                    let human;
                    if (parts.length === 0) {
                        human = "menos de 1 minuto";
                    } else if (parts.length === 1) {
                        human = parts[0];
                    } else if (parts.length === 2) {
                        human = parts.join(" e ");
                    } else {
                        human =
                            parts.slice(0, -1).join(", ") +
                            " e " +
                            parts.slice(-1);
                    }

                    defaultMessage = `Faltam ${human} para ${names} e eu ainda não consigo acreditar que hoje já é dia ${moment().format(
                        "DD"
                    )}! 🎉`;
                }
            } else {
                // Nenhum evento cadastrado — mensagem convidando a cadastrar com link
                defaultMessage = `Nenhum evento cadastrado ainda. Cadastre um aqui: https://vmi2849405.contaboserver.net`;
            }
        } catch (err) {
            log(`Erro ao buscar eventos para legenda: ${err.message}`, "error");
            const daysRemaining = getDaysRemaining();
            defaultMessage = `Faltam ${daysRemaining} dias para a chacrinha e eu ainda não consigo acreditar que hoje já é dia ${moment().format(
                "DD"
            )}! 🎉`;
        }

        // Try to generate with AI (greeting caption). If AI is available, prefer it but keep fallback.
        try {
            let ai = null;
            if (futureEvents && futureEvents.length > 0) {
                const names = futureEvents
                    .filter(
                        (e) => new Date(e.date).toISOString() === nearestIso
                    )
                    .map((e) => e.name);
                const weekday = tz("America/Sao_Paulo").format("dddd");
                const todayStr = tz("America/Sao_Paulo").format("DD/MM/YYYY");
                // Compute countdown components (>=0)
                const targetSP2 = tz(nearestDate, "America/Sao_Paulo");
                const nowSP2 = tz("America/Sao_Paulo");
                const diffMs2 = targetSP2.diff(nowSP2);
                const totalMin2 = Math.max(
                    0,
                    Math.floor(diffMs2 / (1000 * 60))
                );
                const cd = {
                    days: Math.floor(totalMin2 / (60 * 24)),
                    hours: Math.floor((totalMin2 % (60 * 24)) / 60),
                    minutes: totalMin2 % 60,
                };
                // Provide full next-event date/time as context to the AI to avoid premature congratulations
                const nearestDateStr = tz(
                    nearestDate,
                    "America/Sao_Paulo"
                ).format("DD/MM/YYYY [às] HH:mm");
                ai = await generateAICaption({
                    purpose: "greeting",
                    names,
                    timeStr: tz(nearestDate, "America/Sao_Paulo").format(
                        "HH:mm"
                    ),
                    noEvents: false,
                    dayOfWeek: weekday,
                    countdown: cd,
                    nearestDateStr,
                    todayDateStr: todayStr,
                });
            } else {
                const weekday = tz("America/Sao_Paulo").format("dddd");
                const todayStr = tz("America/Sao_Paulo").format("DD/MM/YYYY");
                ai = await generateAICaption({
                    purpose: "greeting",
                    names: [],
                    noEvents: true,
                    dayOfWeek: weekday,
                    todayDateStr: todayStr,
                });
            }
            if (ai) defaultMessage = ai;
        } catch (allErr) {
            log(`Erro ao processar legenda com AI: ${allErr.message}`, "error");
            // fallback: keep defaultMessage as previously set
        }
        if (!defaultMessage) {
            log(
                "AI did not produce a default message; using static fallback.",
                "warning"
            );
        }

        // 1. Enviar vídeo com a mensagem de contagem regressiva (baseada em eventos cadastrados)
        try {
            const media = MessageMedia.fromFilePath(videoPath);
            await retryOperation(async () => {
                await client.sendMessage(groupId, media, {
                    caption: (defaultMessage || "").slice(
                        0,
                        MAX_MESSAGE_LENGTH
                    ),
                });
            });
            log("Vídeo enviado com sucesso", "success");
        } catch (videoError) {
            log(`Erro ao enviar vídeo: ${videoError.message}`, "error");
            // Notify admin/confirmation number (best-effort)
            try {
                await retryOperation(
                    async () => {
                        await client.sendMessage(
                            confirmationNumber,
                            `❌ Erro ao enviar vídeo: ${videoError.message}`
                        );
                    },
                    2,
                    3000
                );
                log(
                    `Notificação enviada para admin ${confirmationNumber}`,
                    "info"
                );
            } catch (notifyErr) {
                log(
                    `Falha ao notificar admin (${confirmationNumber}): ${notifyErr.message}`,
                    "error"
                );
            }
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
                    await client.sendMessage(
                        groupId,
                        (mediaMessage.content || "").slice(
                            0,
                            MAX_MESSAGE_LENGTH
                        )
                    );
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

// Process expired events: announce on WhatsApp and remove from DB
async function processExpiredEvents() {
    if (!dbConnected) {
        log("DB not connected, skipping expired events processing", "info");
        return;
    }

    // Ensure client is ready to send messages
    if (!client || !client.pupPage) {
        log(
            "WhatsApp client not ready, skipping expired events processing",
            "info"
        );
        return;
    }

    try {
        const now = new Date();
        const workerId = `worker-${process.pid}-${Date.now()}`;

        // Atomically claim one timestamp group: find one event not yet announced and not claimed (or claimed long ago)
        // We choose the earliest event.date <= now
        const claimThreshold = new Date(Date.now() - 5 * 60 * 1000); // consider claims older than 5min stale

        const claimQuery = {
            date: { $lte: now },
            announced: false,
            $or: [{ claimedBy: null }, { claimedAt: { $lte: claimThreshold } }],
        };

        const toClaim = await Event.findOneAndUpdate(
            claimQuery,
            { $set: { claimedBy: workerId, claimedAt: new Date() } },
            { sort: { date: 1 }, returnDocument: "after" }
        ).lean();

        if (!toClaim) return; // nothing to claim now

        const claimIso = new Date(toClaim.date).toISOString();
        // Now fetch all events that share this exact instant and are not yet announced
        const groupEvents = await Event.find({
            date: new Date(claimIso),
            announced: false,
        }).lean();
        if (!groupEvents || groupEvents.length === 0) {
            // Nothing to do
            // release claim
            await Event.updateMany(
                { _id: toClaim._id, claimedBy: workerId },
                { $set: { claimedBy: null, claimedAt: null } }
            );
            return;
        }

        const names = groupEvents.map((e) => e.name).join(" e ");
        const timeStr = tz(
            new Date(groupEvents[0].date),
            "America/Sao_Paulo"
        ).format("DD/MM/YYYY [às] HH:mm");
        // Prefer AI-generated announcement when available
        let message = `É hora do evento ${names}! (${timeStr}) 🎉`;
        try {
            const weekday2 = tz("America/Sao_Paulo").format("dddd");
            const todayStr2 = tz("America/Sao_Paulo").format("DD/MM/YYYY");
            const aiMsg = await generateAICaption({
                purpose: "event",
                names: groupEvents.map((e) => e.name),
                timeStr,
                dayOfWeek: weekday2,
                todayDateStr: todayStr2,
            });
            if (aiMsg) message = aiMsg;
            else
                log(
                    `generateAICaption returned null for events: ${names}`,
                    "warning"
                );
        } catch (aiErr) {
            log(
                `OpenAI announcement failed: ${
                    aiErr && aiErr.message ? aiErr.message : aiErr
                }`,
                "info"
            );
        }
        const groupId = "120363339314665620@g.us";

        try {
            const finalMsg = (message || "").slice(0, MAX_MESSAGE_LENGTH);
            await retryOperation(async () => {
                await client.sendMessage(groupId, finalMsg);
            });
            log(`Anúncio enviado para evento(s): ${names}`, "success");

            // Mark announced atomically for all group events
            const ids = groupEvents.map((e) => e._id);
            await Event.updateMany(
                { _id: { $in: ids } },
                {
                    $set: { announced: true, announcedAt: new Date() },
                    $unset: { claimedBy: "", claimedAt: "" },
                }
            );
            // Optionally delete events after announcing or keep for audit; here we delete
            await Event.deleteMany({ _id: { $in: ids } });
            log(`Evento(s) removido(s) do banco: ${names}`, "info");
        } catch (sendErr) {
            log(
                `Falha ao enviar anúncio de evento(s) ${names}: ${sendErr.message}`,
                "error"
            );
            // rollback claim so others can pick it later
            try {
                await Event.updateMany(
                    {
                        _id: { $in: groupEvents.map((e) => e._id) },
                        claimedBy: workerId,
                    },
                    { $set: { claimedBy: null, claimedAt: null } }
                );
            } catch (rollbackErr) {
                log(
                    `Erro ao liberar claim após falha: ${rollbackErr.message}`,
                    "error"
                );
            }
        }
    } catch (err) {
        log(
            `Erro no processamento de eventos expirados: ${err.message}`,
            "error"
        );
    }
}

// Configurar evento de QR Code do WhatsApp
client.on("qr", (qr) => {
    log("QR Code gerado! Escaneie com seu WhatsApp:", "info");
    log("----------------------------------------", "info");
    generate(qr, { small: true });
    log("----------------------------------------", "info");
    log("Se o QR Code acima não estiver legível, você pode:", "info");
    log("1. Aumentar o zoom do terminal", "info");
    log("2. Copiar o QR Code e usar um leitor online", "info");
    log("3. Tentar novamente em alguns segundos", "info");
});

// Quando o cliente estiver pronto
client.on("ready", async () => {
    log("Cliente WhatsApp conectado!", "success");
    log(`Diretório da sessão: ${join(__dirname, ".wwebjs_auth")}`, "info");

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

    // Process expired events immediately and then every minute
    try {
        await processExpiredEvents();
    } catch (e) {
        log(
            `Erro ao processar eventos expirados na inicialização: ${e.message}`,
            "error"
        );
    }

    // agendar verificação de eventos expirados a cada minuto
    cron.schedule("* * * * *", () => {
        processExpiredEvents().catch((err) =>
            log(
                `Erro na tarefa agendada de eventos expirados: ${err.message}`,
                "error"
            )
        );
    });

    log("Cron agendado com sucesso!", "success");
});

// Helper to generate analysis with AI for a list of messages
async function generateAIAnalysis(messagesArray) {
    if (!OPENAI_API_KEY) return null;
    // helper: redact phone-like numbers and long digit sequences to avoid exposing PII to the AI
    function redactNumbers(text) {
        if (!text) return text;
        try {
            // Replace phone-like sequences: +55 14 99999-9999, (14) 9999-9999, 5514997061981, etc.
            // First replace long runs containing digits, spaces, +, parentheses and common separators
            let s = String(text);
            s = s.replace(/\+?\d[\d\s().\-]{4,}\d/g, "[NÚMERO_REMOVIDO]");
            // Fallback: any remaining runs of 4 or more digits
            s = s.replace(/\d{4,}/g, "[NÚMERO_REMOVIDO]");
            return s;
        } catch (e) {
            return text;
        }
    }
    // Prepare a compact context with up to 30 messages
    const safeMessages = messagesArray
        .map((m, i) => {
            const sender = m.senderName || m.author || m.from || "desconhecido";
            // Prefer sanitized body if present, otherwise redact here
            const raw = m.bodySanitized || m.body || "";
            const redacted = redactNumbers(raw);
            const txt = redacted
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\s+/g, " ")
                .trim();
            // limit length per message to avoid huge payloads
            return `${i + 1}. [${sender}] ${txt.slice(0, 1000)}`;
        })
        .join("\n");

    const userPrompt = `Você vai analisar as mensagens abaixo e responder com uma análise curta e afiada no estilo da persona (ácido, sarcástico, leve ofensa). Procure algo para zoar nas mensagens, resuma os principais pontos e dê 2-3 observações engraçadas. Não seja muito longo (3-4 frases). IMPORTANTE: NÚMEROS TELEFÔNICOS E DADOS NUMÉRICOS FORAM REMOVIDOS DO TEXTO (substituídos por [NÚMERO_REMOVIDO]). NÃO MENCIONE, NÃO TENTE RECONSTRUIR OU COMENTAR NENHUM NÚMERO. \nMensagens:\n${safeMessages} \n FIM DAS MENSAGENS. \n`;

    const userPromptFinal =
        userPrompt +
        " Inclua pelo menos UMA piada/observacao sarcastica; evite resposta generica/obvia; mantenha tom acido; RETORNE SOMENTE o texto final, sem explicacoes, sem preambulo." +
        "Formato: escreva 1–2 frases, sem labels (ex.: “Resumo:”, “Observação:”) e sem tópicos. Só o texto final.";
    const messages = [
        { role: "system", content: AI_PERSONA },
        { role: "user", content: userPromptFinal },
    ];

    // Allow larger token budget for analysis (default fallback to env or 1024)
    const analyseTokens = parseInt(
        process.env.OPENAI_MAX_COMPLETION_TOKENS_ANALYSE ||
            process.env.OPENAI_MAX_COMPLETION_TOKENS ||
            "1024",
        10
    );
    // Use cheaper model for analysis by default
    const modelForAnalysis = process.env.OPENAI_MODEL_ANALYSE || "gpt-5-mini";
    const tempForAnalysis = process.env.OPENAI_TEMPERATURE_ANALYSE || "0.9";
    const raw = await callOpenAIChat(
        messages,
        60000,
        analyseTokens,
        modelForAnalysis,
        tempForAnalysis
    );
    return raw;
}

// Message routing helpers and command handlers
function getAllowedGroupId() {
    return process.env.ALLOWED_PING_GROUP || "120363339314665620@g.us";
}

function isFromAllowedGroup(msg) {
    const allowed = getAllowedGroupId();
    return msg && msg.from === allowed;
}

function parseCommand(text) {
    const lowered = (text || "").trim().toLowerCase();
    if (lowered === "!all" || lowered === "!everyone") return { name: "all" };
    if (lowered.startsWith("!analise")) {
        const parts = lowered.split(/\s+/);
        let n = 10;
        if (parts.length >= 2) {
            const parsed = parseInt(parts[1], 10);
            if (!isNaN(parsed)) n = parsed;
        }
        return { name: "analise", n };
    }
    if (lowered.includes("john")) return { name: "john" };
    return null;
}

async function handleAllCommand(msg) {
    const chat = await msg.getChat();
    const allowedGroup = getAllowedGroupId();
    if (!chat.isGroup) {
        await msg.reply("Isso só funciona em grupos, parceiro.");
        return true;
    }
    if (!(chat.id && chat.id._serialized === allowedGroup)) {
        await msg.reply(
            "Comando !all e !everyone restrito a administradores deste grupo."
        );
        return true;
    }
    const ALL_COOLDOWN = parseInt(
        process.env.ANALYSE_ALL_COOLDOWN_SECONDS || "600",
        10
    );
    if (!global.lastAllTimestamp) global.lastAllTimestamp = 0;
    const nowTs = Date.now();
    if ((nowTs - global.lastAllTimestamp) / 1000 < ALL_COOLDOWN) {
        const wait = Math.ceil(
            ALL_COOLDOWN - (nowTs - global.lastAllTimestamp) / 1000
        );
        await msg.reply(
            `Já teve um ping recentemente. Aguenta mais ${wait} segundos.`
        );
        return true;
    }
    const participants = chat.participants || [];
    const maxMentions = 256;
    if (participants.length === 0) {
        await msg.reply("Não consegui obter a lista de participantes.");
        return true;
    }
    if (participants.length > maxMentions) {
        await msg.reply(
            `Esse grupo é gigante (${participants.length} membros). Não vou pingar todo mundo.`
        );
        return true;
    }
    const mentionContacts = [];
    for (const p of participants) {
        if (!p || !p.id || !p.id._serialized) continue;
        try {
            const c = await client.getContactById(p.id._serialized);
            if (c) mentionContacts.push(c);
        } catch (_) {}
    }
    await chat.sendMessage("@everyone", { mentions: mentionContacts });
    global.lastAllTimestamp = nowTs;
    return true;
}

function getUserIdForCooldown(msg) {
    if (msg.fromMe) {
        if (client && client.info && client.info.me) {
            return `bot:${
                client.info.me._serialized || client.info.me.user || "self"
            }`;
        }
        return "bot-self";
    }
    return msg.author || msg.from;
}

function withinAnalyseCooldown(userId) {
    const now = Date.now();
    const last = lastAnalyses.get(userId) || 0;
    const diffSec = Math.floor((now - last) / 1000);
    if (diffSec < ANALYSE_COOLDOWN_SECONDS) {
        return { blocked: true, wait: ANALYSE_COOLDOWN_SECONDS - diffSec };
    }
    lastAnalyses.set(userId, now);
    return { blocked: false };
}

/**
 * Retorna as N mensagens mais recentes (válidas) em ORDEM CRONOLÓGICA,
 * excluindo a mensagem que disparou o comando, mensagens vazias e o comando em si.
 *
 * Garante tentar buscar mais mensagens se, após o filtro, ainda não houver N válidas.
 *
 * @param {object} chat - Instância do chat (ex: de whatsapp-web.js).
 * @param {object} msg  - Mensagem que disparou o comando (será excluída do resultado).
 * @param {number} n    - Quantidade de mensagens válidas desejadas.
 * @param {object} [options]
 * @param {number} [options.extraHeadroom=20] - “Folga” inicial além de N para compensar filtros.
 * @param {number} [options.maxFetch=300]     - Limite duro de mensagens totais a buscar.
 * @returns {Promise<Array>} Array com até N mensagens, onde o índice 0 é a mais antiga entre as N.
 */
async function fetchMessagesForAnalysis(chat, msg, n, options = {}) {
    const extraHeadroom = Number.isFinite(options.extraHeadroom)
        ? options.extraHeadroom
        : 20;
    const maxFetch = Number.isFinite(options.maxFetch) ? options.maxFetch : 300;

    // Helpers
    const isCmdOnly = (m) => {
        if (!m || !m.body) return false;
        const t = m.body.trim();
        return /^!analise(\s+\d+)?$/i.test(t);
    };

    const isEmpty = (m) => {
        // Considera "chat" como mensagens de texto; outras (sticker, img sem legenda etc.) são ignoradas
        if (!m) return true;
        if (m.type && m.type !== "chat") return true;
        if (!m.body || m.body.trim() === "") return true;
        return false;
    };

    const excludeTriggerId = msg?.id?.id;

    // Estratégia: buscar (n + “folga”), reverter p/ cronológica, filtrar,
    // e se ainda não tiver N válidas, aumentar o limit progressivamente até maxFetch.
    let fetchLimit = Math.min(60, n + extraHeadroom);
    let filtered = [];

    while (true) {
        let messages = await chat.fetchMessages({ limit: fetchLimit });

        messages = Array.isArray(messages) ? messages.slice() : [];

        filtered = messages.filter(
            (m) =>
                (excludeTriggerId ? m?.id?.id !== excludeTriggerId : true) &&
                !isCmdOnly(m) &&
                !isEmpty(m)
        );

        if (filtered.length >= n) break;

        // Se já chegamos no máximo configurado, encerramos com o que temos.
        if (fetchLimit >= maxFetch) break;

        // Aumenta o limite e tenta novamente (rebusca tudo de uma vez com um limit maior).
        const increment = Math.max(10, Math.ceil(n * 0.5)); // incremento razoável
        fetchLimit = Math.min(maxFetch, fetchLimit + increment);
    }

    // Retorna as N últimas mensagens válidas em ordem cronológica.
    if (filtered.length === 0) return [];
    return filtered.slice(-n);
}

async function resolveSendersAndSanitize(messages) {
    return Promise.all(
        messages.map(async (m) => {
            const out = { ...m };
            try {
                const id = m.author || m.from;
                if (id && client && client.getContactById) {
                    try {
                        const contact = await client.getContactById(id);
                        if (contact)
                            out.senderName =
                                contact.name ||
                                contact.pushname ||
                                contact.shortName ||
                                id;
                        else out.senderName = id;
                    } catch (_) {
                        out.senderName = id;
                    }
                } else {
                    out.senderName = "desconhecido";
                }
            } catch (_) {
                out.senderName = "desconhecido";
            }
            try {
                out.bodySanitized = redactNumbers(out.body || "");
            } catch (_) {
                out.bodySanitized = out.body || "";
            }
            return out;
        })
    );
}

async function handleAnaliseCommand(msg, n) {
    if (n > 30) {
        await msg.reply(
            "Tu acha que essa porcaria de IA é de graça? Limite máximo: 30 mensagens."
        );
        return true;
    }
    if (n <= 0) {
        await msg.reply(
            "Número inválido. Use !analise ou !analise <n> onde n entre 1 e 30."
        );
        return true;
    }
    const userId = getUserIdForCooldown(msg);
    const cd = withinAnalyseCooldown(userId);
    if (cd.blocked) {
        await msg.reply(
            `Aguenta aí, parceiro. Espera mais ${cd.wait} segundos antes de pedir outra análise.`
        );
        return true;
    }
    const chat = await msg.getChat();
    let toAnalyze;
    try {
        toAnalyze = await fetchMessagesForAnalysis(chat, msg, n);
    } catch (fetchErr) {
        log(`Erro ao buscar mensagens do chat: ${fetchErr.message}`, "error");
        await msg.reply("Erro ao buscar mensagens para análise.");
        return true;
    }
    if (!toAnalyze || toAnalyze.length === 0) {
        await msg.reply("Não há mensagens suficientes para analisar.");
        return true;
    }
    const resolved = await resolveSendersAndSanitize(toAnalyze);
    let analysis = null;
    const start = Date.now();
    try {
        // Preview logs com remetente + texto (evita [object Object])
        for (const m of resolved) {
            const sender =
                m?.senderName || m?.author || m?.from || "desconhecido";
            const txt = String(m?.bodySanitized || m?.body || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 160);
            log(
                `Mensagem para análise: [${sender}] ${txt || "<vazia>"}`,
                "info"
            );
        }
        analysis = await generateAIAnalysis(resolved);
        const snippets = resolved.map((m, i) => ({
            idx: i + 1,
            sender: m.senderName || "desconhecido",
            text: (m.bodySanitized || m.body || "").slice(0, 1000),
        }));
        if (dbConnected) {
            try {
                await AnalysisLog.create({
                    user: userId,
                    chatId: (await msg.getChat()).id._serialized,
                    requestedN: n,
                    analyzedCount: resolved.length,
                    messages: snippets,
                    result: analysis,
                    durationMs: Date.now() - start,
                });
            } catch (createErr) {
                log(
                    `Erro ao salvar AnalysisLog: ${createErr.message}`,
                    "error"
                );
            }
        }
    } catch (aiErr) {
        log(
            `AI analysis error: ${
                aiErr && aiErr.message ? aiErr.message : aiErr
            }`,
            "error"
        );
        if (dbConnected) {
            try {
                await AnalysisLog.create({
                    user: userId,
                    chatId: (await msg.getChat()).id._serialized,
                    requestedN: n,
                    analyzedCount: resolved.length,
                    messages: resolved.map((m, i) => ({
                        idx: i + 1,
                        sender: m.senderName || "desconhecido",
                        text: (m.body || "").slice(0, 1000),
                    })),
                    error:
                        aiErr && aiErr.message ? aiErr.message : String(aiErr),
                    durationMs: Date.now() - start,
                });
            } catch (createErr) {
                log(
                    `Erro ao salvar AnalysisLog (failure): ${createErr.message}`,
                    "error"
                );
            }
        }
    }
    if (!analysis) {
        await msg.reply("Hmmm... a IA não colaborou dessa vez.");
        return true;
    }
    await msg.reply((analysis || "").slice(0, MAX_MESSAGE_LENGTH));
    return true;
}

// Command handler: !analise [n]
client.on("message", async (msg) => {
    try {
        if (!msg || !msg.body) return;
        if (!isFromAllowedGroup(msg)) {
            log(
                `Mensagem recebida de grupo não autorizado (${msg.from}). Ignorando.`,
                "info"
            );
            return;
        }
        if (msg.fromMe) {
            // Helpful debug: show truncated body when the bot processes its own message
            log(
                `Processando mensagem própria (fromMe). Conteúdo: "${(
                    msg.body || ""
                )
                    .replace(/\s+/g, " ")
                    .slice(0, 120)}"`,
                "debug"
            );
        }
        const text = msg.body.trim();
        const cmd = parseCommand(text);
        if (!cmd) return;

        // Handle !all & !everyone
        if (cmd && cmd.name === "all") {
            try {
                await handleAllCommand(msg);
                return;
            } catch (allErr) {
                log(`Erro ao processar !all: ${allErr.message}`, "error");
                await msg.reply("Falha ao tentar mencionar todos.");
                return;
            }
        }

        if (cmd && cmd.name === "analise") {
            await handleAnaliseCommand(msg, cmd.n);
            return;
        }

        if (cmd && cmd.name === "john") {
            await handleJohnMention(msg);
            return;
        }
    } catch (err) {
        log(`Erro no handler de comando !analise: ${err.message}`, "error");
    }
});

async function handleJohnMention(msg) {
    try {
        const msgBody = msg.body || "";
        const newMsg = msgBody.replace(/john/gi, "Jão");
        if (newMsg !== msgBody) {
            await msg.reply(newMsg);
            log("Respondido menção a John com Jão", "info");
        }
    } catch (err) {
        log(`Erro ao responder menção a John: ${err.message}`, "error");
    }
}

// Função para inicializar diretórios de mídia
async function initializeDirectories() {
    try {
        const directories = [
            join(__dirname, "media"),
            join(__dirname, "media", "images"),
            join(__dirname, "media", "videos"),
            join(__dirname, "media", "texts"),
            join(__dirname, "temp"),
        ];

        for (const dir of directories) {
            if (!existsSync(dir)) {
                await fsPromises.mkdir(dir, { recursive: true });
                log(`Diretório criado: ${dir}`, "success");
            }
        }

        log(
            "Todos os diretórios de mídia inicializados com sucesso",
            "success"
        );
    } catch (error) {
        log(
            `Erro ao inicializar diretórios de mídia: ${error.message}`,
            "error"
        );
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
        log(
            `Erro ao inicializar diretórios de mídia: ${error.message}`,
            "error"
        );
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
