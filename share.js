import { db } from './db.js';

// DOM Elements
const sharedVideo = document.getElementById('shared-video');
const videoLoading = document.getElementById('video-loading');
const videoError = document.getElementById('video-error');
const videoTitle = document.getElementById('video-title');
const videoDate = document.getElementById('video-date');
const videoSize = document.getElementById('video-size');
const videoViews = document.getElementById('video-views');
const copyLinkBtn = document.getElementById('copy-link-btn');
const downloadBtn = document.getElementById('download-btn');
const commentInput = document.getElementById('comment-input');
const sendCommentBtn = document.getElementById('send-comment-btn');
const commentsContainer = document.getElementById('comments-container');
const commentCountDisplay = document.getElementById('comment-count');
const myVideosContainer = document.getElementById('my-videos-container');
const speedBadges = document.querySelectorAll('.speed-badge');

// Page State
let currentVideoId = null;
let currentVideoBlob = null;

// Initialize Share Page
async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  currentVideoId = urlParams.get('id');

  try {
    await db.init();
    
    if (currentVideoId) {
      await loadVideo(currentVideoId);
    } else {
      // If no ID is provided, try to load the latest recording
      const allVideos = await db.getAllVideos();
      if (allVideos.length > 0) {
        window.location.href = `share.html?id=${allVideos[0].id}`;
        return;
      } else {
        showErrorState();
      }
    }

    // Load other recordings sidebar
    await loadOtherVideos();

    // Event listeners
    setupEventListeners();
  } catch (err) {
    console.error("Falha ao inicializar página de compartilhamento:", err);
    showErrorState();
  }
}

// Load Video from IndexedDB
async function loadVideo(id) {
  videoLoading.classList.remove('hidden');
  videoError.classList.add('hidden');

  try {
    const record = await db.getVideo(id);

    if (!record) {
      showErrorState();
      return;
    }

    currentVideoBlob = record.blob;
    
    // Set video source
    const videoUrl = URL.createObjectURL(currentVideoBlob);
    sharedVideo.src = videoUrl;

    // Load metadata
    videoTitle.textContent = record.title;
    
    // Format Date
    const formattedDate = new Date(record.date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    videoDate.innerHTML = `<i data-lucide="calendar"></i> Gravação em ${formattedDate}`;

    // Format Size
    const sizeInMB = (record.size / (1024 * 1024)).toFixed(1);
    videoSize.innerHTML = `<i data-lucide="hard-drive"></i> ${sizeInMB} MB`;

    // Increment and show views
    await db.incrementViews(id);
    const updatedRecord = await db.getVideo(id);
    const viewsCount = updatedRecord.views || 1;
    videoViews.innerHTML = `<i data-lucide="eye"></i> ${viewsCount} ${viewsCount === 1 ? 'visualização' : 'visualizações'}`;

    // Hide loader
    videoLoading.classList.add('hidden');

    // Render comments
    renderComments(updatedRecord.comments || []);

    // Add some default system comments if new video with no comments
    if (updatedRecord.comments.length === 0) {
      await addInitialMockComments(id);
    }

    // Refresh Lucide Icons
    if (window.lucide) window.lucide.createIcons();

  } catch (err) {
    console.error("Erro ao ler gravação do IndexedDB:", err);
    showErrorState();
  }
}

// Show error state when video is missing
function showErrorState() {
  videoLoading.classList.add('hidden');
  videoError.classList.remove('hidden');
  videoTitle.textContent = "Gravação Não Encontrada";
  videoDate.textContent = "";
  videoSize.textContent = "";
  videoViews.textContent = "";
  document.querySelector('.video-player-controls').classList.add('hidden');
}

// Setup all page action event listeners
function setupEventListeners() {
  // Title editing (Loom style)
  videoTitle.addEventListener('blur', saveNewTitle);
  videoTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      videoTitle.blur();
    }
  });

  // Copy share link
  copyLinkBtn.addEventListener('click', copyShareLink);

  // Download video file
  downloadBtn.addEventListener('click', downloadVideo);

  // Playback speeds
  speedBadges.forEach(badge => {
    badge.addEventListener('click', () => {
      // Remove active class from all
      speedBadges.forEach(b => b.classList.remove('active'));
      // Add active to current
      badge.classList.add('active');
      
      const speed = parseFloat(badge.dataset.speed);
      sharedVideo.playbackRate = speed;
    });
  });

  // Comments submit
  sendCommentBtn.addEventListener('click', submitComment);
  commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComment();
    }
  });
}

// Rename Video
async function saveNewTitle() {
  if (!currentVideoId) return;
  const newTitle = videoTitle.textContent.trim();
  if (newTitle === "") {
    videoTitle.textContent = "Gravação sem título";
    return;
  }

  try {
    await db.updateVideoTitle(currentVideoId, newTitle);
    // Reload sidebar to show updated title
    await loadOtherVideos();
  } catch (err) {
    console.error("Erro ao salvar novo título:", err);
  }
}

// Copy sharing url
function copyShareLink() {
  const shareUrl = window.location.href;
  
  navigator.clipboard.writeText(shareUrl).then(() => {
    const originalText = copyLinkBtn.innerHTML;
    copyLinkBtn.innerHTML = `<i data-lucide="check"></i> Copiado!`;
    copyLinkBtn.style.background = 'rgba(16, 185, 129, 0.15)';
    copyLinkBtn.style.color = 'var(--color-success)';
    
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      copyLinkBtn.innerHTML = originalText;
      copyLinkBtn.style.background = '';
      copyLinkBtn.style.color = '';
      if (window.lucide) window.lucide.createIcons();
    }, 2000);
  }).catch(err => {
    console.error("Erro ao copiar link:", err);
  });
}

// Download local video file
function downloadVideo() {
  if (!currentVideoBlob) return;
  
  const title = videoTitle.textContent.trim().replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const url = URL.createObjectURL(currentVideoBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || 'gravacao'}.webm`;
  document.body.appendChild(a);
  a.click();
  
  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// Load Other Videos Sidebar
async function loadOtherVideos() {
  try {
    const allVideos = await db.getAllVideos();
    
    myVideosContainer.innerHTML = '';
    
    if (allVideos.length === 0) {
      myVideosContainer.innerHTML = '<p class="no-videos-message">Nenhuma gravação recente.</p>';
      return;
    }

    allVideos.forEach(vid => {
      const isCurrent = vid.id === currentVideoId;
      
      const a = document.createElement('a');
      a.className = `video-thumb-item ${isCurrent ? 'active' : ''}`;
      a.href = `share.html?id=${vid.id}`;
      
      // Highlight style
      if (isCurrent) {
        a.style.background = 'rgba(139, 92, 246, 0.1)';
        a.style.borderColor = 'var(--color-violet)';
      }

      const dateStr = new Date(vid.date).toLocaleDateString('pt-BR');
      
      a.innerHTML = `
        <div class="thumb-preview-placeholder">
          <i data-lucide="video"></i>
        </div>
        <div class="thumb-info">
          <span class="thumb-title" title="${vid.title}">${vid.title}</span>
          <span class="thumb-date">${dateStr}</span>
        </div>
      `;
      myVideosContainer.appendChild(a);
    });

    if (window.lucide) window.lucide.createIcons();

  } catch (err) {
    console.error("Erro ao carregar lista de gravações na barra lateral:", err);
  }
}

// Add Mock Comments to simulate interaction
async function addInitialMockComments(id) {
  try {
    // Add two mock comments
    await db.addComment(id, 'Carla Souza (Designer)', 'Ficou sensacional! Essa funcionalidade de arrastar a bolha do rosto para qualquer lugar é perfeita pra mim, me ajuda muito ao gravar feedbacks de design.');
    await db.addComment(id, 'Felipe Tech (Developer)', 'Massa demais! Gravação super fluida e limpa. Conseguiu capturar tanto o áudio do mic quanto os cliques. Sensacional.');
    
    // Reload video record comments
    const record = await db.getVideo(id);
    renderComments(record.comments);
  } catch (err) {
    console.warn("Could not load initial mock comments", err);
  }
}

// Render Comment items
function renderComments(comments) {
  commentsContainer.innerHTML = '';
  commentCountDisplay.textContent = comments.length;

  if (comments.length === 0) {
    commentsContainer.innerHTML = '<p class="no-videos-message" id="no-comments-msg">Nenhum comentário ainda. Seja o primeiro a comentar!</p>';
    return;
  }

  // Sort comments by date ascending (oldest first for conversational chat flow)
  const sorted = [...comments].sort((a, b) => new Date(a.date) - new Date(b.date));

  sorted.forEach(comment => {
    const item = document.createElement('div');
    item.className = 'comment-item';

    const formattedTime = new Date(comment.date).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    item.innerHTML = `
      <div class="comment-header">
        <span class="comment-author">${comment.author}</span>
        <span class="comment-time">${formattedTime}</span>
      </div>
      <p class="comment-content">${comment.content}</p>
    `;
    commentsContainer.appendChild(item);
  });

  // Scroll to bottom of comments list
  commentsContainer.scrollTop = commentsContainer.scrollHeight;
}

// Submit a new comment
async function submitComment() {
  if (!currentVideoId) return;
  const content = commentInput.value.trim();
  if (content === "") return;

  try {
    // Author as "Você" for user additions
    const comment = await db.addComment(currentVideoId, 'Você (Criador)', content);
    commentInput.value = '';

    // Reload and render comments
    const record = await db.getVideo(currentVideoId);
    renderComments(record.comments);
  } catch (err) {
    console.error("Erro ao enviar comentário:", err);
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);
