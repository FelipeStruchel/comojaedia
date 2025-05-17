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

// Gerenciamento de mídia
const uploadForm = document.getElementById('uploadForm');
const mediaItems = document.getElementById('mediaItems');

// Função para carregar mídias
async function loadMedia() {
    try {
        const response = await fetch('/media');
        const media = await response.json();
        
        mediaItems.innerHTML = media.map(item => `
            <div class="media-item bg-white rounded-lg shadow-md overflow-hidden">
                ${item.type === 'image' ? `
                    <img src="${item.path}" alt="${item.fileName}" class="media-preview">
                ` : item.type === 'video' ? `
                    <video src="${item.path}" class="media-preview" controls></video>
                ` : `
                    <div class="p-4">
                        <p class="text-gray-800">${item.content}</p>
                    </div>
                `}
                <button class="action-button" onclick="deleteMedia('${item.path}')">
                    <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        `).join('');
    } catch (error) {
        showToast('Erro ao carregar mídias', 'error');
    }
}

// Função para deletar mídia
async function deleteMedia(path) {
    try {
        const response = await fetch(`/media/${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('Mídia removida com sucesso');
            loadMedia();
        } else {
            throw new Error('Erro ao remover mídia');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Manipulador do formulário de upload
uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const mediaType = document.getElementById('mediaType').value;
    const fileInput = document.getElementById('mediaFile');
    const file = fileInput.files[0];

    if (!file && mediaType !== 'text') {
        showToast('Por favor, selecione um arquivo', 'error');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('type', mediaType);
        
        if (mediaType === 'text') {
            formData.append('content', fileInput.value);
        } else {
            formData.append('file', file);
        }

        const response = await fetch('/media', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            showToast('Mídia enviada com sucesso');
            uploadForm.reset();
            loadMedia();
        } else {
            const error = await response.json();
            throw new Error(error.error);
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
});

// Configurar área de drag and drop
const mediaFile = document.getElementById('mediaFile');
const uploadArea = document.createElement('div');
uploadArea.className = 'upload-area';
uploadArea.innerHTML = `
    <svg class="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
    <p class="mt-2 text-sm text-gray-600">Arraste um arquivo ou clique para selecionar</p>
`;

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

// Carregar mídias ao iniciar
document.addEventListener('DOMContentLoaded', () => {
    loadMedia();
}); 