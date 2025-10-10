// Events and countdown state
let events = [];

function pickNearestEvents() {
    const now = new Date();
    const future = events.filter(e => new Date(e.date) > now).sort((a,b)=> new Date(a.date)-new Date(b.date));
    if (future.length === 0) return [];
    const nearestDate = new Date(future[0].date).toISOString();
    // Return all events that share the same nearest date
    return future.filter(e => new Date(e.date).toISOString() === nearestDate);
}

function updateCountdown() {
    const nearest = pickNearestEvents();
    if (nearest.length === 0) {
        document.getElementById('countdown').textContent = 'Nenhum evento cadastrado';
        document.getElementById('nextEvents').textContent = '';
        return;
    }

    const targetDate = new Date(nearest[0].date);
    const now = new Date();
    const diff = targetDate - now;
    if (diff <= 0) {
        document.getElementById('countdown').textContent = 'O evento já ocorreu';
        document.getElementById('nextEvents').textContent = nearest.map(e=>e.name).join(', ');
        return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    document.getElementById('countdown').textContent = `${days} dias, ${hours} horas, ${minutes} minutos e ${seconds} segundos`;
    document.getElementById('nextEvents').textContent = nearest.map(e=>e.name).join(' ou ');
}

setInterval(updateCountdown, 1000);


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

// Gerenciamento de Tabs (compatível com IDs antigos e novos)
const textTab = document.getElementById('textTab2') || document.getElementById('textTab');
const mediaTab = document.getElementById('mediaTab2') || document.getElementById('mediaTab');
const textForm = document.getElementById('textForm');
const mediaForm = document.getElementById('mediaForm');

// Função para alternar entre os formulários
function switchForm(showText) {
    if (showText) {
        if (textTab) {
            textTab.classList.add('bg-indigo-600', 'text-white');
            textTab.classList.remove('bg-gray-200', 'text-gray-700');
        }
        if (mediaTab) {
            mediaTab.classList.add('bg-gray-200', 'text-gray-700');
            mediaTab.classList.remove('bg-indigo-600', 'text-white');
        }
        textForm.classList.remove('hidden');
        mediaForm.classList.add('hidden');
    } else {
        if (mediaTab) {
            mediaTab.classList.add('bg-indigo-600', 'text-white');
            mediaTab.classList.remove('bg-gray-200', 'text-gray-700');
        }
        if (textTab) {
            textTab.classList.add('bg-gray-200', 'text-gray-700');
            textTab.classList.remove('bg-indigo-600', 'text-white');
        }
        mediaForm.classList.remove('hidden');
        textForm.classList.add('hidden');
    }
}

if (textTab) textTab.addEventListener('click', () => switchForm(true));
if (mediaTab) mediaTab.addEventListener('click', () => switchForm(false));

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
                const previewId = `preview-${sanitizeId(item.fileName)}`;
                const btnId = `btn-${sanitizeId(item.fileName)}`;
                // escape content for safe insertion; basic replacement of < and >
                const safeContent = (item.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `
                    <div class="bg-gray-50 p-4 rounded-lg content-item">
                        <div id="${previewId}" class="text-content text-gray-800 mb-2 text-truncated">${safeContent}</div>
                        <button id="${btnId}" class="read-more-btn" onclick="toggleReadMore('${previewId}','${btnId}')">Ver mais</button>
                        <div class="mt-2">
                          <button 
                            onclick="deleteContent('text', '${item.fileName}')"
                            class="text-red-500 hover:text-red-700 transition-colors"
                          >
                            <svg class="w-5 h-5 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
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

        // after inserting, ensure buttons show/hide appropriately
        setTimeout(() => {
            document.querySelectorAll('.text-truncated').forEach(el => {
                const btn = document.querySelector(`#btn-${sanitizeId(el.id.replace('preview-',''))}`);
                if (!btn) return;
                // If content height is small, hide the button
                if (el.scrollHeight <= el.clientHeight + 8) {
                    btn.style.display = 'none';
                } else {
                    btn.style.display = 'inline-block';
                }
            });
        }, 50);
    } catch (error) {
        console.error('Erro ao carregar conteúdo:', error);
        showToast('Erro ao carregar conteúdo', 'error');
    }
}

// Helper to create safe element id from filename
function sanitizeId(str) {
    return (str || '').replace(/[^a-zA-Z0-9-_]/g, '_');
}

// Toggle read-more for text preview
function toggleReadMore(previewId, btnId) {
    const el = document.getElementById(previewId);
    const btn = document.getElementById(btnId);
    if (!el || !btn) return;
    if (el.classList.contains('text-expanded')) {
        el.classList.remove('text-expanded');
        el.classList.add('text-truncated');
        btn.textContent = 'Ver mais';
    } else {
        el.classList.remove('text-truncated');
        el.classList.add('text-expanded');
        btn.textContent = 'Ver menos';
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
    loadEvents();
});

// Events: load and create
async function loadEvents() {
    try {
        const resp = await fetch('/events');
        events = await resp.json();
        renderEventsList();
    } catch (err) {
        console.error('Erro ao carregar eventos:', err);
    }
}

function renderEventsList() {
    const container = document.getElementById('eventsListContainer');
    // render events list into its container
    const eventsHtml = events.map(ev => `
        <div class="bg-gray-50 p-4 rounded-lg">
            <div class="flex justify-between items-center">
                <div>
                    <div class="font-semibold">${ev.name}</div>
                    <div class="text-sm text-gray-500">${new Date(ev.date).toLocaleString()}</div>
                </div>
                <div>
                    <button onclick="deleteEvent('${ev._id}')" class="text-red-500">Excluir</button>
                </div>
            </div>
        </div>
    `).join('');
    if (container) container.innerHTML = eventsHtml;
}

async function createEvent() {
    const name = document.getElementById('eventName').value.trim();
    const date = document.getElementById('eventDate').value;
    const time = document.getElementById('eventTime') ? document.getElementById('eventTime').value : '';
    if (!name || !date) {
        showToast('Preencha nome e data do evento', 'error');
        return;
    }
    try {
        // combine date and time; if time is empty, default to 00:00
        let isoDate;
        if (time && time.trim() !== '') {
            // date is yyyy-mm-dd, time is HH:MM
            isoDate = new Date(`${date}T${time}:00`);
        } else {
            isoDate = new Date(`${date}T00:00:00`);
        }

        const resp = await fetch('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, date: isoDate.toISOString() }) });
        if (!resp.ok) throw new Error('Erro ao criar evento');
        const newEv = await resp.json();
        events.push(newEv);
        document.getElementById('eventName').value = '';
        document.getElementById('eventDate').value = '';
        if (document.getElementById('eventTime')) document.getElementById('eventTime').value = '00:00';
        showToast('Evento criado com sucesso');
        loadContent();
        loadEvents();
    } catch (err) {
        console.error(err);
        showToast('Erro ao criar evento', 'error');
    }
}

async function deleteEvent(id) {
    try {
        const resp = await fetch(`/events/${id}`, { method: 'DELETE' });
        // Backend doesn't yet have DELETE route; fallback: reload events
        await loadEvents();
        loadContent();
        showToast('Evento removido');
    } catch (err) {
        console.error('Erro ao remover evento:', err);
        showToast('Erro ao remover evento', 'error');
    }
}

// Wire events tab switching (robust to presence of old/new tab IDs)
const eventsTab = document.getElementById('eventsTab');
const textTabMain = document.getElementById('textTab2') || document.getElementById('textTab');
const mediaTabMain = document.getElementById('mediaTab2') || document.getElementById('mediaTab');
const eventsForm = document.getElementById('eventsForm');
const textFormMain = document.getElementById('textForm');
const mediaFormMain = document.getElementById('mediaForm');

function activateEventsTab() {
    if (eventsTab) eventsTab.classList.add('bg-indigo-600','text-white');
    if (textTabMain) textTabMain.classList.remove('bg-indigo-600','text-white');
    if (mediaTabMain) mediaTabMain.classList.remove('bg-indigo-600','text-white');
    if (eventsForm) eventsForm.classList.remove('hidden');
    if (textFormMain) textFormMain.classList.add('hidden');
    if (mediaFormMain) mediaFormMain.classList.add('hidden');
}

function activateTextTab() {
    if (textTabMain) textTabMain.classList.add('bg-indigo-600','text-white');
    if (eventsTab) eventsTab.classList.remove('bg-indigo-600','text-white');
    if (mediaTabMain) mediaTabMain.classList.remove('bg-indigo-600','text-white');
    if (eventsForm) eventsForm.classList.add('hidden');
    if (textFormMain) textFormMain.classList.remove('hidden');
    if (mediaFormMain) mediaFormMain.classList.add('hidden');
}

function activateMediaTab() {
    if (mediaTabMain) mediaTabMain.classList.add('bg-indigo-600','text-white');
    if (eventsTab) eventsTab.classList.remove('bg-indigo-600','text-white');
    if (textTabMain) textTabMain.classList.remove('bg-indigo-600','text-white');
    if (eventsForm) eventsForm.classList.add('hidden');
    if (textFormMain) textFormMain.classList.add('hidden');
    if (mediaFormMain) mediaFormMain.classList.remove('hidden');
}

if (eventsTab) eventsTab.addEventListener('click', activateEventsTab);
if (textTabMain) textTabMain.addEventListener('click', activateTextTab);
if (mediaTabMain) mediaTabMain.addEventListener('click', activateMediaTab);

const createEventBtn = document.getElementById('createEventBtn');
if (createEventBtn) createEventBtn.addEventListener('click', (e) => {
    e.preventDefault();
    createEvent();
});

// Start/End of day buttons
const btnStartOfDay = document.getElementById('btnStartOfDay');
const btnEndOfDay = document.getElementById('btnEndOfDay');
if (btnStartOfDay) btnStartOfDay.addEventListener('click', () => {
    const t = document.getElementById('eventTime');
    if (t) t.value = '00:00';
});
if (btnEndOfDay) btnEndOfDay.addEventListener('click', () => {
    const t = document.getElementById('eventTime');
    if (t) t.value = '23:59';
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