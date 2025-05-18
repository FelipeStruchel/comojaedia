const fs = require('fs').promises;
const path = require('path');
const { saveMedia } = require('./mediaManager');

async function migratePhrases() {
    try {
        // Lê o arquivo de frases
        const phrasesContent = await fs.readFile('frases.txt', 'utf8');
        
        // Divide o conteúdo em frases individuais
        const phrases = phrasesContent.split('\n').filter(phrase => phrase.trim());
        
        console.log(`Encontradas ${phrases.length} frases para migrar`);
        
        // Para cada frase, cria um arquivo temporário e salva usando o mediaManager
        for (const phrase of phrases) {
            // Cria um arquivo temporário com a frase
            const tempFilePath = path.join(__dirname, 'temp_phrase.txt');
            await fs.writeFile(tempFilePath, phrase);
            
            // Prepara o objeto de arquivo no formato esperado pelo mediaManager
            const fileObj = {
                originalname: `frase_${Date.now()}.txt`,
                path: tempFilePath
            };
            
            // Salva usando o mediaManager
            await saveMedia(fileObj, 'text');
            
            console.log(`Frase migrada: ${phrase.substring(0, 50)}...`);
        }
        
        console.log('Migração concluída com sucesso!');
    } catch (error) {
        console.error('Erro durante a migração:', error);
    }
}

// Executa a migração
migratePhrases(); 