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
        // Carregar frases
        const frasesResponse = await fetch('/frases');
        const frases = await frasesResponse.json();
        console.log('Frases carregadas:', frases);
        
        // Carregar mídias
        const mediaResponse = await fetch('/media');
        const media = await mediaResponse.json();
        console.log('Mídias carregadas:', media);
        
        // Combinar e ordenar conteúdo
        const content = [
            ...frases.map((frase, index) => ({
                type: 'text',
                content: frase,
                index
            })),
            ...media.map(item => ({
                type: item.type,
                content: item.url,
                fileName: item.fileName
            }))
        ].sort((a, b) => b.index - a.index);

        console.log('Conteúdo combinado:', content);
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
                            onclick="deleteContent('text', ${item.index})"
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
        textForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Formulário de texto submetido');
            const frase = document.getElementById('fraseText').value.trim();
            
            if (!frase) {
                showToast('Por favor, digite uma frase', 'error');
                return;
            }

            try {
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
            }
        });
    }

    if (mediaForm) {
        console.log('Registrando evento do formulário de mídia');
        mediaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Formulário de mídia submetido');
            
            const fileInput = document.getElementById('mediaFile');
            const file = fileInput.files[0];

            if (!file) {
                showToast('Por favor, selecione um arquivo', 'error');
                return;
            }

            try {
                console.log('Enviando arquivo:', file.name, 'Tipo:', file.type);
                const formData = new FormData();
                const type = file.type.startsWith('image/') ? 'image' : 'video';
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

                const data = await response.json();
                console.log('Resposta do servidor:', data);

                if (response.ok) {
                    showToast('Mídia enviada com sucesso');
                    fileInput.value = ''; // Limpa o input de arquivo
                    await loadContent();
                } else {
                    throw new Error(data.error || 'Erro ao enviar mídia');
                }
            } catch (error) {
                console.error('Erro ao enviar mídia:', error);
                showToast(error.message, 'error');
            }
        });
    }

    // Carregar conteúdo inicial
    loadContent();
});

// Elementos do formulário de mídia
const mediaFile = document.getElementById('mediaFile');
const fileError = document.getElementById('fileError');
const submitButton = document.querySelector('#mediaForm button[type="submit"]');
const dropZone = document.querySelector('#mediaForm .border-dashed');

// Configurar área de drag and drop
const uploadArea = document.createElement('div');
uploadArea.className = 'upload-area';
uploadArea.innerHTML = `
    <svg class="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
    <p class="mt-2 text-sm text-gray-600">Arraste um arquivo ou clique para selecionar</p>
`;

if (mediaFile && mediaFile.parentNode) {
    mediaFile.parentNode.insertBefore(uploadArea, mediaFile);
    mediaFile.style.display = 'none';

    uploadArea.addEventListener('click', () => mediaFile.click());
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        mediaFile.files = e.dataTransfer.files;
    });
}

// Configurações de validação
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Função para validar arquivo
function validateFile(file) {
    // Verificar extensão
    const extension = file.name.split('.').pop().toLowerCase();
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'mp4'];
    
    if (!allowedExtensions.includes(extension)) {
        return {
            valid: false,
            error: 'Tipo de arquivo não permitido. Use apenas JPG, PNG, GIF ou MP4.'
        };
    }

    // Verificar tipo MIME
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
    
    if (!isImage && !isVideo) {
        return {
            valid: false,
            error: 'Tipo de arquivo não permitido. Use apenas imagens ou vídeos MP4.'
        };
    }

    // Verificar tamanho
    if (file.size > MAX_FILE_SIZE) {
        return {
            valid: false,
            error: 'Arquivo muito grande. Tamanho máximo: 20MB'
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

// Manipulador do formulário de mídia
document.getElementById('mediaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Formulário de mídia submetido');
    
    const file = mediaFile.files[0];
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

        const data = await response.json();
        console.log('Resposta do servidor:', data);

        if (response.ok) {
            showToast('Mídia enviada com sucesso');
            mediaFile.value = '';
            fileError.classList.add('hidden');
            await loadContent();
        } else {
            throw new Error(data.error || 'Erro ao enviar mídia');
        }
    } catch (error) {
        console.error('Erro ao enviar mídia:', error);
        showToast(error.message, 'error');
    }
}); 