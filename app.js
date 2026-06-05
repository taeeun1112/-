// 디버깅용 화면 로그 함수
function logDebug(message, type = 'info') {
  console.log(`[DEBUG] ${message}`);
  const debugConsole = document.getElementById('debug-console');
  if (debugConsole) {
    const logEl = document.createElement('div');
    logEl.style.color = type === 'error' ? '#f87171' : type === 'success' ? '#34d399' : '#a1a1aa';
    logEl.style.marginBottom = '4px';
    logEl.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    debugConsole.appendChild(logEl);
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }
}

// 디버깅을 위한 전역 에러 핸들러 (화면에 직접 에러를 경고창으로 표시해 줍니다)
window.onerror = function(message, source, lineno, colno, error) {
  logDebug(`자바스크립트 오류: ${message} (파일: ${source}, 라인: ${lineno})`, 'error');
  alert("자바스크립트 오류 발생:\n" + message + "\n파일: " + source + "\n라인: " + lineno);
  return false;
};

window.onunhandledrejection = function(event) {
  logDebug(`비동기 프로미스 오류: ${event.reason}`, 'error');
  alert("비동기 처리(Promise) 오류 발생:\n" + event.reason);
};

// --- Supabase Connection ---
// .env의 값을 코드 내에 직접 하드코딩하여 빌드 도구 없이도 작동하게 만듭니다.
const supabaseUrl = 'https://pubeqsfxacavsoguohmc.supabase.co';
const supabaseAnonKey = 'sb_publishable_UEreoEeLvm7W5CrVqeB9wQ_KzAjGxZT';

let supabase = null;

function startApp() {
  logDebug('애플리케이션 시작 (DOM 준비 완료)');

  // 브라우저 환경에서 Supabase CDN이 올바르게 로드되었는지 확인합니다.
  if (!window.supabase) {
    logDebug('Supabase 라이브러리(CDN) 로드 실패!', 'error');
    console.error('Supabase CDN이 로드되지 않았습니다. 인터넷 연결을 확인하거나 CDN 주소를 확인해주세요.');
    alert('Supabase 라이브러리를 가져오지 못했습니다. 인터넷 연결 상태를 확인하고 페이지를 새로고침해 주세요.');
    return;
  }

  // Supabase 클라이언트 초기화
  logDebug('Supabase 클라이언트 초기화 시작...');
  supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  logDebug('Supabase 클라이언트 초기화 완료', 'success');

  // --- State ---
  let comments = [];
  let likedIds = JSON.parse(localStorage.getItem('liked_comment_ids') || '[]');

  // --- DOM Elements ---
  const themeToggle = document.getElementById('theme-toggle');
  const debugToggle = document.getElementById('debug-toggle');
  const debugPanel = document.getElementById('debug-panel');
  const commentCountEl = document.getElementById('comment-count');
  const commentForm = document.getElementById('comment-form');
  const authorInput = document.getElementById('comment-author');
  const contentInput = document.getElementById('comment-content');
  const charCountEl = document.getElementById('char-count');
  const commentList = document.getElementById('comment-list');
  const emptyState = document.getElementById('empty-state');

  // --- Initializer ---
  function init() {
    loadTheme();
    setupEventListeners();
    loadCommentsAndReplies();
    subscribeRealtime();
  }

  // --- Database CRUD Logics ---
  async function loadCommentsAndReplies() {
    logDebug('DB에서 댓글 목록을 조회하는 중...');
    try {
      // Fetch comments and replies in a single nested join query
      const { data, error } = await supabase
        .from('comments')
        .select('*, replies(*)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      logDebug(`댓글 목록 로드 성공 (${data?.length || 0}개의 댓글 발견)`, 'success');

      comments = data.map(item => ({
        id: item.id,
        author: item.author,
        content: item.content,
        timestamp: Date.parse(item.created_at),
        likes: item.likes || 0,
        replies: (item.replies || []).map(r => ({
          id: r.id,
          author: r.author,
          content: r.content,
          timestamp: Date.parse(r.created_at)
        })).sort((a, b) => a.timestamp - b.timestamp) // Sort replies older to newer
      }));

      renderComments();
    } catch (err) {
      console.error('Error loading comments/replies:', err);
      logDebug(`댓글 목록 로드 실패: ${err.message || err}`, 'error');
      alert('댓글 목록 로드 실패:\n' + (err.message || err));
      commentCountEl.textContent = 'Error';
    }
  }

  // --- Realtime Sync ---
  let currentSubscription = null;
  function subscribeRealtime() {
    logDebug('실시간 동기화(Realtime) 연결 등록 중...');
    if (currentSubscription) {
      supabase.removeChannel(currentSubscription);
    }

    currentSubscription = supabase
      .channel('comments-feed-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        logDebug(`실시간 이벤트 감지 (comments 테이블 - ${eventType})`);
        
        if (eventType === 'INSERT') {
          // If already rendered locally, ignore to avoid duplicating
          if (!comments.some(c => c.id === newRow.id)) {
            const newComment = {
              id: newRow.id,
              author: newRow.author,
              content: newRow.content,
              timestamp: Date.parse(newRow.created_at),
              likes: newRow.likes || 0,
              replies: []
            };
            comments.unshift(newComment);
            renderComments();
            highlightCard(newRow.id);
          }
        } else if (eventType === 'UPDATE') {
          const comment = comments.find(c => c.id === newRow.id);
          if (comment) {
            let needsRender = false;
            if (comment.likes !== newRow.likes) {
              comment.likes = newRow.likes;
              needsRender = true;
            }
            if (comment.author !== newRow.author || comment.content !== newRow.content) {
              comment.author = newRow.author;
              comment.content = newRow.content;
              needsRender = true;
            }
            if (needsRender) {
              renderComments();
            }
          }
        } else if (eventType === 'DELETE') {
          comments = comments.filter(c => c.id !== oldRow.id);
          renderComments();
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'replies' }, (payload) => {
        const newReplyRow = payload.new;
        logDebug(`실시간 이벤트 감지 (replies 테이블 - INSERT)`);
        const parentComment = comments.find(c => c.id === newReplyRow.comment_id);
        
        if (parentComment) {
          if (!parentComment.replies) parentComment.replies = [];
          // Avoid duplicate renders
          if (!parentComment.replies.some(r => r.id === newReplyRow.id)) {
            const newReply = {
              id: newReplyRow.id,
              author: newReplyRow.author,
              content: newReplyRow.content,
              timestamp: Date.parse(newReplyRow.created_at)
            };
            parentComment.replies.push(newReply);
            parentComment.replies.sort((a, b) => a.timestamp - b.timestamp);
            renderComments();
            highlightCard(newReplyRow.id, true);
          }
        }
      })
      .subscribe((status) => {
        logDebug(`실시간 구독 상태 변경: ${status}`, status === 'SUBSCRIBED' ? 'success' : 'info');
      });
  }

  // --- Theme Management ---
  function loadTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }

  // Toggle theme
  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
  }

  // --- Helper Functions ---
  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // First letter avatar
  function getAvatarLetter(name) {
    if (!name) return '익';
    return name.trim().charAt(0);
  }

  function timeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (diff < 10000) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 30) return `${days}일 전`;
    
    const date = new Date(timestamp);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  }

  function highlightCard(id, isReply = false) {
    setTimeout(() => {
      const card = commentList.querySelector(`[data-id="${id}"]`);
      if (card) {
        card.classList.add('newly-added');
        setTimeout(() => {
          card.classList.remove('newly-added');
        }, 2000);
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  }

  // --- Render logic ---
  function updateCount() {
    let totalCount = comments.length;
    comments.forEach(comment => {
      if (comment.replies) {
        totalCount += comment.replies.length;
      }
    });
    commentCountEl.textContent = totalCount;
  }

  function renderComments() {
    const existingCards = commentList.querySelectorAll('.comment-card');
    existingCards.forEach(card => card.remove());

    updateCount();

    if (comments.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    comments.forEach(comment => {
      const card = createCommentCardElement(comment);
      commentList.appendChild(card);
    });
  }

  function createCommentCardElement(comment) {
    const card = document.createElement('div');
    card.className = 'comment-card';
    card.dataset.id = comment.id;

    const isLiked = likedIds.includes(comment.id);
    const likedClass = isLiked ? 'liked' : '';
    const avatarLetter = escapeHTML(getAvatarLetter(comment.author));

    card.innerHTML = `
      <div class="comment-header">
        <div class="comment-meta">
          <div class="comment-avatar">${avatarLetter}</div>
          <div class="comment-info">
            <span class="comment-author-name">${escapeHTML(comment.author)}</span>
            <span class="comment-time" data-timestamp="${comment.timestamp}">${timeAgo(comment.timestamp)}</span>
          </div>
        </div>
      </div>
      <div class="comment-body">${escapeHTML(comment.content)}</div>
      <div class="comment-footer">
        <div class="footer-left">
          <button class="like-btn ${likedClass}" data-action="like" data-id="${comment.id}">
            <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
            <span class="like-count">${comment.likes || 0}</span>
          </button>
          <button class="reply-toggle-btn" data-action="toggle-reply-box" data-id="${comment.id}">
            <i class="fa-regular fa-comment"></i> 답글
          </button>
        </div>
      </div>
      <!-- Replies Section Container -->
      <div class="replies-container" id="replies-container-${comment.id}"></div>
    `;

    // Render existing replies
    const repliesContainer = card.querySelector(`#replies-container-${comment.id}`);
    if (comment.replies && comment.replies.length > 0) {
      comment.replies.forEach(reply => {
        const replyEl = createReplyCardElement(reply, comment.id);
        repliesContainer.appendChild(replyEl);
      });
    }

    return card;
  }

  function createReplyCardElement(reply, parentId) {
    const replyCard = document.createElement('div');
    replyCard.className = 'reply-card';
    replyCard.dataset.id = reply.id;
    replyCard.dataset.parentId = parentId;

    const avatarLetter = escapeHTML(getAvatarLetter(reply.author));

    replyCard.innerHTML = `
      <div class="comment-header">
        <div class="comment-meta">
          <div class="comment-avatar" style="width: 28px; height: 28px; font-size: 0.8rem; background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%)">${avatarLetter}</div>
          <div class="comment-info">
            <span class="comment-author-name" style="font-size: 0.85rem;">${escapeHTML(reply.author)}</span>
            <span class="comment-time" data-timestamp="${reply.timestamp}">${timeAgo(reply.timestamp)}</span>
          </div>
        </div>
      </div>
      <div class="comment-body" style="font-size: 0.88rem; color: var(--text-main);">${escapeHTML(reply.content)}</div>
    `;

    return replyCard;
  }

  // --- Action Handlers ---
  async function handleCommentSubmit(e) {
    e.preventDefault();
    const author = authorInput.value.trim();
    const content = contentInput.value.trim();

    if (!author || !content) return;

    logDebug(`댓글 등록 요청 중... (작성자: ${author})`);
    try {
      const { data, error } = await supabase
        .from('comments')
        .insert([{ author, content }])
        .select();

      if (error) throw error;

      logDebug(`댓글 등록 완료: ${JSON.stringify(data)}`, 'success');

      // Reset inputs
      authorInput.value = '';
      contentInput.value = '';
      charCountEl.textContent = '0';

      if (data && data[0]) {
        const newComment = {
          id: data[0].id,
          author: data[0].author,
          content: data[0].content,
          timestamp: Date.parse(data[0].created_at),
          likes: data[0].likes || 0,
          replies: []
        };
        
        // Optimistically insert locally if not already done by Realtime
        if (!comments.some(c => c.id === newComment.id)) {
          comments.unshift(newComment);
          renderComments();
          highlightCard(newComment.id);
        }
      }
    } catch (err) {
      console.error('Error inserting comment:', err);
      logDebug(`댓글 등록 실패: ${err.message || err}`, 'error');
      alert('댓글 등록 중 오류가 발생했습니다. DB 연동 정보를 확인해주세요.\n오류 내용: ' + (err.message || err));
    }
  }

  async function handleLike(btn, id) {
    const isLiked = likedIds.includes(id);
    const likeCountSpan = btn.querySelector('.like-count');
    const heartIcon = btn.querySelector('i');

    try {
      if (!isLiked) {
        // Optimistic UI updates
        likedIds.push(id);
        localStorage.setItem('liked_comment_ids', JSON.stringify(likedIds));
        
        btn.classList.add('liked');
        if (heartIcon) heartIcon.className = 'fa-solid fa-heart';
        
        const comment = comments.find(c => c.id === id);
        if (comment) {
          comment.likes += 1;
          if (likeCountSpan) likeCountSpan.textContent = comment.likes;
        }

        // Call remote DB RPC
        const { error } = await supabase.rpc('increment_comment_likes', { comment_id: id });
        if (error) throw error;
      } else {
        // Optimistic UI updates
        const index = likedIds.indexOf(id);
        if (index !== -1) likedIds.splice(index, 1);
        localStorage.setItem('liked_comment_ids', JSON.stringify(likedIds));

        btn.classList.remove('liked');
        if (heartIcon) heartIcon.className = 'fa-regular fa-heart';

        const comment = comments.find(c => c.id === id);
        if (comment) {
          comment.likes = Math.max(0, comment.likes - 1);
          if (likeCountSpan) likeCountSpan.textContent = comment.likes;
        }

        // Call remote DB RPC
        const { error } = await supabase.rpc('decrement_comment_likes', { comment_id: id });
        if (error) throw error;
      }
    } catch (err) {
      console.error('Error handling like:', err);
      alert('좋아요 처리 중 오류가 발생했습니다.\n오류 내용: ' + (err.message || err));
      // Revert optimistic changes on error
      likedIds = JSON.parse(localStorage.getItem('liked_comment_ids') || '[]');
      await loadCommentsAndReplies();
    }
  }

  function handleToggleReplyBox(btn, commentId) {
    const container = document.getElementById(`replies-container-${commentId}`);
    if (!container) return;

    // Check if reply form is already open
    const existingForm = container.querySelector('.reply-write-box');
    if (existingForm) {
      existingForm.remove();
      return;
    }

    // Create Reply Form
    const replyForm = document.createElement('div');
    replyForm.className = 'reply-write-box';
    replyForm.innerHTML = `
      <div style="margin-bottom: 0.5rem;">
        <input type="text" class="reply-author-input" placeholder="답글 닉네임" required style="width: 100%;" maxlength="15">
      </div>
      <textarea class="reply-content-input" placeholder="답글 내용을 적어주세요..." required maxlength="300"></textarea>
      <div class="reply-write-actions">
        <button class="btn btn-secondary cancel-reply-btn">취소</button>
        <button class="btn btn-primary submit-reply-btn">답글 등록</button>
      </div>
    `;

    // Event handlers inside form
    const cancelBtn = replyForm.querySelector('.cancel-reply-btn');
    const submitBtn = replyForm.querySelector('.submit-reply-btn');
    const rAuthor = replyForm.querySelector('.reply-author-input');
    const rContent = replyForm.querySelector('.reply-content-input');

    cancelBtn.addEventListener('click', () => replyForm.remove());
    submitBtn.addEventListener('click', () => {
      const author = rAuthor.value.trim();
      const content = rContent.value.trim();

      if (!author || !content) {
        alert('모든 항목을 입력해주세요.');
        return;
      }

      submitReply(commentId, author, content);
      replyForm.remove();
    });

    container.insertBefore(replyForm, container.firstChild);
    rAuthor.focus();
  }

  async function submitReply(parentId, author, content) {
    try {
      const { data, error } = await supabase
        .from('replies')
        .insert([{ comment_id: parentId, author, content }])
        .select();

      if (error) throw error;

      if (data && data[0]) {
        const parentComment = comments.find(c => c.id === parentId);
        if (parentComment) {
          if (!parentComment.replies) parentComment.replies = [];
          
          const newReply = {
            id: data[0].id,
            author: data[0].author,
            content: data[0].content,
            timestamp: Date.parse(data[0].created_at)
          };
          
          // Optimistically add to local state if not added by Realtime
          if (!parentComment.replies.some(r => r.id === newReply.id)) {
            parentComment.replies.push(newReply);
            parentComment.replies.sort((a, b) => a.timestamp - b.timestamp);
            renderComments();
            highlightCard(data[0].id, true);
          }
        }
      }
    } catch (err) {
      console.error('Error submitting reply:', err);
      alert('답글 등록 중 오류가 발생했습니다. DB 구성을 확인해주세요.\n오류 내용: ' + (err.message || err));
    }
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Theme toggle
    themeToggle.addEventListener('click', toggleTheme);

    // Debug Panel toggle
    if (debugToggle && debugPanel) {
      debugToggle.addEventListener('click', () => {
        const isHidden = debugPanel.style.display === 'none' || debugPanel.style.display === '';
        debugPanel.style.display = isHidden ? 'flex' : 'none';
        
        // Give the toggle button a highlighted look when open
        if (isHidden) {
          debugToggle.classList.add('active');
          debugToggle.style.color = 'var(--color-danger)';
          debugToggle.style.borderColor = 'rgba(239, 68, 68, 0.2)';
          debugToggle.style.background = 'rgba(239, 68, 68, 0.08)';
        } else {
          debugToggle.classList.remove('active');
          debugToggle.style.color = '';
          debugToggle.style.borderColor = '';
          debugToggle.style.background = '';
        }
      });
    }

    // Comment submission
    commentForm.addEventListener('submit', handleCommentSubmit);

    // Character counter
    contentInput.addEventListener('input', () => {
      charCountEl.textContent = contentInput.value.length;
    });

    // Event delegation on comment list
    commentList.addEventListener('click', (e) => {
      const target = e.target;

      // Liking a comment
      const likeBtn = target.closest('.like-btn');
      if (likeBtn && likeBtn.dataset.action === 'like') {
        const id = likeBtn.dataset.id;
        handleLike(likeBtn, id);
        return;
      }

      // Replying trigger
      const replyToggleBtn = target.closest('.reply-toggle-btn');
      if (replyToggleBtn && replyToggleBtn.dataset.action === 'toggle-reply-box') {
        const id = replyToggleBtn.dataset.id;
        handleToggleReplyBox(replyToggleBtn, id);
        return;
      }
    });

    // Update times every minute dynamically
    setInterval(() => {
      const timeElements = document.querySelectorAll('.comment-time');
      timeElements.forEach(el => {
        const timestamp = parseInt(el.getAttribute('data-timestamp'));
        if (timestamp) {
          el.textContent = timeAgo(timestamp);
        }
      });
    }, 60000);
  }

  // Run initial loading
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
