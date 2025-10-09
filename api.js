const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Limite de caracteres do WhatsApp
const MAX_MESSAGE_LENGTH = 4096;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Caminho para o arquivo de frases
const frasesPath = path.join(__dirname, "frases.json");

// Função para ler as frases
async function lerFrases() {
  try {
    const data = await fs.readFile(frasesPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Erro ao ler frases:", error);
    return { frases: [] };
  }
}

// Função para salvar as frases
async function salvarFrases(frases) {
  try {
    await fs.writeFile(frasesPath, JSON.stringify(frases, null, 2));
    return true;
  } catch (error) {
    console.error("Erro ao salvar frases:", error);
    return false;
  }
}

// Rota para obter todas as frases
app.get("/frases", async (req, res) => {
  try {
    const data = await lerFrases();
    res.json(data.frases);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar frases" });
  }
});

// Rota para adicionar uma nova frase
app.post("/frases", async (req, res) => {
  try {
    const { frase } = req.body;
    if (!frase) {
      return res.status(400).json({ error: "Frase é obrigatória" });
    }

    if (frase.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `A frase deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres`,
        maxLength: MAX_MESSAGE_LENGTH,
      });
    }

    const data = await lerFrases();
    data.frases.push(frase);
    await salvarFrases(data);

    res.status(201).json({ message: "Frase adicionada com sucesso" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao adicionar frase" });
  }
});

// Rota para remover uma frase
app.delete("/frases/:index", async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const data = await lerFrases();

    if (index < 0 || index >= data.frases.length) {
      return res.status(404).json({ error: "Frase não encontrada" });
    }

    data.frases.splice(index, 1);
    await salvarFrases(data);

    res.json({ message: "Frase removida com sucesso" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao remover frase" });
  }
});

// Rota para servir o frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
