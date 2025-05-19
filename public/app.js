// Configuração da data alvo
const targetDate = new Date('2025-07-25');

// Função para atualizar o contador
function updateCountdown() {
    const now = new Date();
    const diff = targetDate - now;

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    document.getElementById('countdown').innerHTML = `
        ${days} dias, ${hours} horas, ${minutes} minutos e ${seconds} segundos
    `;
}

// Atualizar contador a cada segundo
setInterval(updateCountdown, 1000);
updateCountdown();

// Função para mostrar mensagens de feedback
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} animate-slide-up`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Gerenciamento de Tabs
const textTab = document.getElementById('textTab');
const mediaTab = document.getElementById('mediaTab');
const textForm = document.getElementById('textForm');
const mediaForm = document.getElementById('mediaForm');

// Função para alternar entre os formulários
function switchForm(showText) {
    if (showText) {
        textTab.classList.add('bg-indigo-600', 'text-white');
        textTab.classList.remove('bg-gray-200', 'text-gray-700');
        mediaTab.classList.add('bg-gray-200', 'text-gray-700');
        mediaTab.classList.remove('bg-indigo-600', 'text-white');
        textForm.classList.remove('hidden');
        mediaForm.classList.add('hidden');
    } else {
        mediaTab.classList.add('bg-indigo-600', 'text-white');
        mediaTab.classList.remove('bg-gray-200', 'text-gray-700');
        textTab.classList.add('bg-gray-200', 'text-gray-700');
        textTab.classList.remove('bg-indigo-600', 'text-white');
        mediaForm.classList.remove('hidden');
        textForm.classList.add('hidden');
    }
}

textTab.addEventListener('click', () => switchForm(true));
mediaTab.addEventListener('click', () => switchForm(false));

// Gerenciamento de Frases
const fraseText = document.getElementById('fraseText');
const charCount = document.getElementById('charCount');
const contentItems = document.getElementById('contentItems');

// Atualizar contador de caracteres
fraseText.addEventListener('input', () => {
    const count = fraseText.value.length;
    charCount.textContent = count;
    if (count > 4000) {
        charCount.classList.add('text-red-500');
    } else {
        charCount.classList.remove('text-red-500');
    }
});

// Carregar conteúdo
async function loadContent() {
    try {
        console.log('Carregando conteúdo...');
        
        // Carregar mídias
        const mediaResponse = await fetch('/media');
        const media = await mediaResponse.json();
        console.log('Mídias carregadas:', media);
        
        // Para cada item de mídia do tipo texto, buscar o conteúdo
        const mediaWithContent = await Promise.all(media.map(async item => {
            if (item.type === 'text') {
                try {
                    const response = await fetch(item.url);
                    const content = await response.text();
                    return { ...item, content };
                } catch (error) {
                    console.error('Erro ao ler conteúdo do arquivo:', error);
                    return item;
                }
            }
            return item;
        }));

        // Ordenar conteúdo
        const content = mediaWithContent.map(item => ({
            type: item.type,
            content: item.type === 'text' ? item.content : item.url,
            fileName: item.fileName
        })).sort((a, b) => {
            // Ordenar por data (mais recente primeiro)
            const dateA = a.fileName.split('_')[0];
            const dateB = b.fileName.split('_')[0];
            return dateB - dateA;
        });

        console.log('Conteúdo carregado:', content);
        const contentItems = document.getElementById('contentItems');
        if (!contentItems) {
            console.error('Elemento contentItems não encontrado');
            return;
        }

        contentItems.innerHTML = content.map(item => {
            if (item.type === 'text') {
                return `
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-gray-800 mb-2">${item.content}</p>
                        <button 
                            onclick="deleteContent('text', '${item.fileName}')"
                            class="text-red-500 hover:text-red-700 transition-colors"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                `;
            } else {
                const isImage = item.type === 'image';
                const type = isImage ? 'image' : 'video';
                return `
                    <div class="bg-gray-50 p-4 rounded-lg">
                        ${isImage ? 
                            `<img src="${item.content}" alt="${item.fileName}" class="max-w-full h-auto rounded-lg mb-2">` :
                            `<video src="${item.content}" controls class="max-w-full h-auto rounded-lg mb-2"></video>`
                        }
                        <button 
                            onclick="deleteContent('${type}', '${item.fileName}')"
                            class="text-red-500 hover:text-red-700 transition-colors"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                `;
            }
        }).join('');
    } catch (error) {
        console.error('Erro ao carregar conteúdo:', error);
        showToast('Erro ao carregar conteúdo', 'error');
    }
}

// Adicionar frase
async function addFrase(frase) {
    try {
        const response = await fetch('/frases', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ frase })
        });

        if (response.ok) {
            showToast('Frase adicionada com sucesso');
            fraseText.value = '';
            charCount.textContent = '0';
            loadContent();
        } else {
            const error = await response.json();
            throw new Error(error.error);
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Deletar conteúdo
async function deleteContent(type, identifier) {
    try {
        let endpoint;
        if (type === 'text') {
            endpoint = `/frases/${identifier}`;
        } else {
            endpoint = `/media/${type}/${identifier}`;
        }
        console.log('Deletando conteúdo:', endpoint);
        
        const response = await fetch(endpoint, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Erro ao deletar conteúdo');
        }
        
        showToast('Conteúdo deletado com sucesso!');
        await loadContent(); // Recarrega a lista
    } catch (error) {
        console.error('Erro ao deletar conteúdo:', error);
        showToast('Erro ao deletar conteúdo');
    }
}

// Inicializar com o formulário de texto visível
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página carregada, inicializando...');
    switchForm(true);
    
    // Verificar se os elementos existem
    const textForm = document.getElementById('textForm');
    const mediaForm = document.getElementById('mediaForm');
    
    console.log('Elementos encontrados:', {
        textForm: !!textForm,
        mediaForm: !!mediaForm
    });

    if (textForm) {
        console.log('Registrando evento do formulário de texto');
        const submitButton = textForm.querySelector('button[type="submit"]');
        
        textForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Formulário de texto submetido');
            const frase = document.getElementById('fraseText').value.trim();
            
            if (!frase) {
                showToast('Por favor, digite uma frase', 'error');
                return;
            }

            try {
                // Desabilitar botão e mostrar indicador de carregamento
                submitButton.disabled = true;
                submitButton.innerHTML = `
                    <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Enviando...
                `;

                console.log('Enviando frase:', frase);
                const response = await fetch('/frases', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ frase })
                });

                const data = await response.json();
                console.log('Resposta do servidor:', data);

                if (response.ok) {
                    showToast('Frase adicionada com sucesso');
                    document.getElementById('fraseText').value = '';
                    document.getElementById('charCount').textContent = '0';
                    await loadContent();
                } else {
                    throw new Error(data.error || 'Erro ao adicionar frase');
                }
            } catch (error) {
                console.error('Erro ao adicionar frase:', error);
                showToast(error.message, 'error');
            } finally {
                // Restaurar botão ao estado original
                submitButton.disabled = false;
                submitButton.innerHTML = 'Adicionar Frase';
            }
        });
    }

    if (mediaForm) {
        console.log('Registrando evento do formulário de mídia');
        const mediaFormElement = mediaForm.querySelector('form');
        const submitButton = mediaFormElement.querySelector('button[type="submit"]');
        
        mediaFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Formulário de mídia submetido');
            
            const fileInput = document.getElementById('mediaFile');
            const file = fileInput.files[0];

            if (!file) {
                showToast('Por favor, selecione um arquivo', 'error');
                return;
            }

            const validation = validateFile(file);
            if (!validation.valid) {
                showToast(validation.error, 'error');
                return;
            }

            try {
                // Desabilitar botão e mostrar indicador de carregamento
                submitButton.disabled = true;
                submitButton.innerHTML = `
                    <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Enviando...
                `;

                console.log('Enviando arquivo:', file.name, 'Tipo:', file.type);
                const formData = new FormData();
                const type = ALLOWED_IMAGE_TYPES.includes(file.type) ? 'image' : 'video';
                formData.append('type', type);
                formData.append('file', file);

                console.log('Dados do formulário:', {
                    type: type,
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type
                });

                const response = await fetch('/media', {
                    method: 'POST',
                    body: formData
                });

                console.log('Status da resposta:', response.status);
                console.log('Headers da resposta:', Object.fromEntries(response.headers.entries()));
                
                const responseText = await response.text();
                console.log('Resposta bruta do servidor:', responseText);
                
                let data;
                try {
                    data = JSON.parse(responseText);
                    console.log('Resposta parseada:', data);
                } catch (parseError) {
                    console.error('Erro ao fazer parse da resposta:', parseError);
                    throw new Error('Erro ao processar resposta do servidor');
                }

                if (response.ok) {
                    showToast('Mídia enviada com sucesso');
                    fileInput.value = '';
                    fileError.classList.add('hidden');
                    await loadContent();
                } else {
                    throw new Error(data.error || 'Erro ao enviar mídia');
                }
            } catch (error) {
                console.error('Erro ao enviar mídia:', error);
                showToast(error.message, 'error');
            } finally {
                // Restaurar botão ao estado original
                submitButton.disabled = false;
                submitButton.innerHTML = 'Enviar Mídia';
            }
        });
    }

    // Carregar conteúdo inicial
    loadContent();
});

// Elementos do formulário de mídia
const mediaFile = document.getElementById('mediaFile');
const fileError = document.getElementById('fileError');
const dropZone = document.querySelector('#mediaForm .border-dashed');

// Configurações de validação
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// Função para formatar tamanho do arquivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Função para validar arquivo
function validateFile(file) {
    // Verificar extensão
    const extension = file.name.split('.').pop().toLowerCase();
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'avi', 'mkv'];
    
    if (!allowedExtensions.includes(extension)) {
        return {
            valid: false,
            error: `Tipo de arquivo não permitido (${extension}). Use apenas JPG, PNG, GIF ou vídeos (MP4, MOV, AVI, MKV).`
        };
    }

    // Verificar tipo MIME
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
    
    if (!isImage && !isVideo) {
        return {
            valid: false,
            error: `Tipo de arquivo não permitido (${file.type}). Use apenas imagens ou vídeos.`
        };
    }

    // Verificar tamanho
    if (file.size > MAX_FILE_SIZE) {
        return {
            valid: false,
            error: `Arquivo muito grande. Tamanho atual: ${formatFileSize(file.size)}. Tamanho máximo permitido: ${formatFileSize(MAX_FILE_SIZE)}`
        };
    }

    return { valid: true };
}

// Evento de mudança do input de arquivo
mediaFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
        fileError.classList.add('hidden');
        fileError.textContent = '';
        return;
    }

    const validation = validateFile(file);
    if (!validation.valid) {
        fileError.textContent = validation.error;
        fileError.classList.remove('hidden');
        return;
    }

    fileError.classList.add('hidden');
});

// Eventos de drag and drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
});

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('border-indigo-500', 'bg-indigo-50');
    });
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');
    });
});

dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const validation = validateFile(file);
    if (!validation.valid) {
        fileError.textContent = validation.error;
        fileError.classList.remove('hidden');
        return;
    }

    mediaFile.files = e.dataTransfer.files;
    fileError.classList.add('hidden');
}); 