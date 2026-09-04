const params = new URLSearchParams(location.search);
const makeRoom = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const room = /^[a-zA-Z0-9_-]{8,64}$/.test(params.get('room') || '') ? params.get('room') : makeRoom();
if (!params.get('room')) history.replaceState(null, '', `?room=${room}`);
let clientId = '';
try { clientId = localStorage.getItem('relay-board-client-id') || ''; } catch {}
if (!clientId) {
  clientId = crypto.randomUUID();
  try { localStorage.setItem('relay-board-client-id', clientId); } catch {}
}

function detectDeviceType() {
  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return '平板';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return '手机';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return '电脑';
  return '其他设备';
}
const deviceType = detectDeviceType();

function detectDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) {
    const model = ua.match(/Android [^;]+;\s*(?:wv;\s*)?([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i)?.[1]?.trim();
    return model && !/ใช้|zh-|en-|wv/i.test(model) ? model : 'Android 手机';
  }
  if (/Windows/i.test(ua)) return 'Windows 电脑';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac 电脑';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux 电脑';
  return deviceType;
}
let deviceName = detectDeviceName();
try { deviceName = localStorage.getItem('relay-board-device-name') || deviceName; } catch {}
const $ = (id) => document.getElementById(id);
const editor = $('editor');
const composer = document.querySelector('.composer');
const imageDraft = $('imageDraft');
const draftImage = $('draftImage');
const draftImageName = $('draftImageName');
const draftImageMeta = $('draftImageMeta');
const favoriteButton = $('favoriteButton');
const favoriteMenu = $('favoriteMenu');
const favoriteList = $('favoriteList');
const exportButton = $('exportButton');
const exportMenu = $('exportMenu');
const pageProgress = $('pageProgress');
const pageProgressFill = $('pageProgressFill');
const pageTopNode = $('pageTopNode');
const pageComposerNode = $('pageComposerNode');
const searchButton = $('searchButton');
const historySearch = $('historySearch');
const historySearchInput = $('historySearchInput');
const clearSearchButton = $('clearSearchButton');
const itemsEl = $('items');
const messageRail = $('messageRail');
const apiBase = (document.querySelector('meta[name="relay-api-base"]')?.content || '').trim().replace(/\/$/, '');
const apiUrl = (path) => `${apiBase}${path}`;
const sidebarToggle = $('sidebarToggle');
const sidebarClose = $('sidebarClose');
const sidebarBackdrop = $('sidebarBackdrop');
const roomSidebar = $('roomSidebar');
const roomList = $('roomList');
const accountButton = $('accountButton');
const accountLabel = $('accountLabel');
const authDialog = $('authDialog');
const authClose = $('authClose');
const loginForm = $('loginForm');
const accountPane = $('accountPane');
const authError = $('authError');
let authState = { enabled: false, authenticated: false, user: null };
let turnstileWidgetId = null;
let turnstileToken = '';
let connectionRetryTimer;
let connectionRetryDelay = 1500;
const roomCacheDbName = 'relay-board-room-cache';
function applyDeviceName() { $('deviceNameText').textContent = `${deviceType} · ${deviceName}`; }
applyDeviceName();
const itemStore = new Map();
const favoriteStore = new Map();
const fallbackFavoriteStore = new Map();
let eventSource;
let toastTimer;
let pendingImage = null;
let searchQuery = '';
let messageRailHideTimer;
let pageProgressHideTimer;
const imageLimitBytes = 8 * 1024 * 1024;
const imageHardLimitBytes = 200 * 1024 * 1024;

function updateComposerState() {
  if (!composer) return;
  const hasContent = Boolean(editor.innerText.trim() || pendingImage);
  composer.classList.toggle('is-expanded', hasContent || composer.matches(':focus-within'));
}

function resizeComposerEditor() {
  if (!composer || !editor) return;
  if (!composer.classList.contains('is-expanded')) {
    editor.style.height = '';
    editor.style.overflowY = 'hidden';
    return;
  }
  const previousScrollTop = editor.scrollTop;
  const minHeight = 120;
  const maxHeight = Math.min(300, Math.max(minHeight, Math.round((window.visualViewport?.height || window.innerHeight) * .34)));
  editor.style.height = 'auto';
  const contentHeight = editor.scrollHeight;
  editor.style.height = `${Math.min(maxHeight, Math.max(minHeight, contentHeight))}px`;
  editor.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  editor.scrollTop = previousScrollTop;
}

function revealMessageRail() {
  if (messageRail.hidden) return;
  messageRail.classList.add('is-visible');
  clearTimeout(messageRailHideTimer);
  messageRailHideTimer = window.setTimeout(() => {
    if (!messageRail.matches(':hover')) messageRail.classList.remove('is-visible');
  }, 900);
}

function revealPageProgress() {
  pageProgress.classList.add('is-visible');
  clearTimeout(pageProgressHideTimer);
  pageProgressHideTimer = window.setTimeout(() => {
    if (!pageProgress.matches(':hover')) pageProgress.classList.remove('is-visible');
  }, 900);
}

const themeToggle = $('themeToggle');
const themeLabel = themeToggle.querySelector('[data-theme-label]');
function applyTheme(theme) {
  const activeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = activeTheme;
  const isLight = activeTheme === 'light';
  themeToggle.setAttribute('aria-pressed', String(isLight));
  themeToggle.setAttribute('aria-label', isLight ? '切换到暗色主题' : '切换到亮色主题');
  themeLabel.textContent = isLight ? '暗色' : '亮色';
}
let savedTheme = 'light';
try { savedTheme = localStorage.getItem('relay-board-theme') || 'light'; } catch {}
applyTheme(savedTheme);
themeToggle.onclick = () => {
  const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);
  try { localStorage.setItem('relay-board-theme', nextTheme); } catch {}
};

$('roomCode').textContent = room.slice(0, 8).toUpperCase();
$('roomKey').textContent = room;

function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function setConnectionState(state, fromCache = false) {
  if (state === 'live') { $('statusDot').className = 'status-dot live'; $('connectionText').textContent = '房间已连接'; return; }
  if (state === 'offline') { $('statusDot').className = 'status-dot offline'; $('connectionText').textContent = fromCache ? '离线缓存 · 等待恢复' : '等待服务恢复'; return; }
  $('statusDot').className = 'status-dot'; $('connectionText').textContent = '正在连接';
}

function openRoomCacheDb() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => { const request = indexedDB.open(roomCacheDbName, 1); request.onupgradeneeded = () => request.result.createObjectStore('rooms', { keyPath: 'room' }); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null); });
}
async function saveRoomCache() {
  const record = { room, updatedAt: Date.now(), items: [...itemStore.values()].slice(-100) }; const db = await openRoomCacheDb();
  if (!db) { try { localStorage.setItem(`relay-board-room-${room}`, JSON.stringify(record)); } catch {} return; }
  try { await new Promise((resolve, reject) => { const transaction = db.transaction('rooms', 'readwrite'); transaction.objectStore('rooms').put(record); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); } catch {}
  db.close();
}
async function restoreRoomCache() {
  const db = await openRoomCacheDb(); let record = null;
  if (!db) { try { record = JSON.parse(localStorage.getItem(`relay-board-room-${room}`) || 'null'); } catch {} }
  else { record = await new Promise((resolve) => { const request = db.transaction('rooms', 'readonly').objectStore('rooms').get(room); request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null); }); db.close(); }
  if (!record?.items?.length) return false; itemStore.clear(); record.items.forEach((item) => itemStore.set(item.id, item)); renderAll(); requestAnimationFrame(scrollToHash); return true;
}

const roomHistoryKey = 'relay-board-room-history';
function readRoomHistory() { try { return JSON.parse(localStorage.getItem(roomHistoryKey) || '[]').filter((entry) => /^[a-zA-Z0-9_-]{8,64}$/.test(entry.room)); } catch { return []; } }
function rememberRoom() {
  const records = readRoomHistory().filter((entry) => entry.room !== room);
  records.unshift({ room, seenAt: Date.now() });
  try { localStorage.setItem(roomHistoryKey, JSON.stringify(records.slice(0, 20))); } catch {}
}
function renderRoomList() {
  roomList.replaceChildren();
  readRoomHistory().forEach((entry) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `room-list-item${entry.room === room ? ' is-current' : ''}`; button.disabled = authState.enabled && !authState.authenticated; button.dataset.requiresAuth = 'true';
    const code = document.createElement('code'); code.textContent = entry.room.slice(0, 8).toUpperCase();
    const small = document.createElement('small'); small.textContent = entry.room === room ? '当前' : '房间';
    button.append(code, small); button.onclick = () => { if (!button.disabled) location.href = `?room=${encodeURIComponent(entry.room)}`; }; roomList.append(button);
  });
}
function toggleSidebar(open) {
  const next = open ?? !roomSidebar.classList.contains('is-open');
  roomSidebar.classList.toggle('is-open', next); roomSidebar.setAttribute('aria-hidden', String(!next)); sidebarToggle.setAttribute('aria-expanded', String(next)); sidebarBackdrop.hidden = !next;
}
function setStaticMode(staticMode) {
  document.body.classList.toggle('guest-mode', staticMode);
  const remoteIds = ['addContentButton', 'shareButton', 'copyKey', 'newRoom', 'sendButton', 'pasteSendButton', 'analyzeButton'];
  remoteIds.forEach((id) => { const element = $(id); if (element) { element.disabled = staticMode; element.dataset.requiresAuth = 'true'; } });
  document.querySelector('label[for="fileInput"]')?.classList.toggle('is-auth-disabled', staticMode);
  const fileInput = $('fileInput'); if (fileInput) { fileInput.disabled = staticMode; fileInput.dataset.requiresAuth = 'true'; }
  $('sidebarNewRoom').disabled = staticMode; $('sidebarNewRoom').dataset.requiresAuth = 'true'; $('sidebarModeLabel').textContent = staticMode ? '未登录 · 静态模式' : '已登录 · 同步开启';
  renderRoomList();
}
function renderAccountState() {
  const user = authState.user;
  accountLabel.textContent = user ? user.username : '登录';
  accountButton.setAttribute('aria-label', user ? `账户 ${user.username}` : '登录账户');
  $('accountName').textContent = user?.username || '账户'; $('accountRole').textContent = user?.role === 'admin' ? '管理员账户' : '普通账户';
  loginForm.hidden = Boolean(user); accountPane.hidden = !user;
  $('adminToggle').hidden = user?.role !== 'admin';
  $('passwordToggle').hidden = user?.role !== 'admin';
  if (user?.role !== 'admin') { $('adminPanel').hidden = true; $('passwordPanel').hidden = true; }
  setStaticMode(authState.enabled && !authState.authenticated);
}
function openAuthDialog() { authError.hidden = true; authDialog.hidden = false; accountButton.setAttribute('aria-expanded', 'true'); if (!authState.user) $('authUsername').focus(); }
function closeAuthDialog() { authDialog.hidden = true; accountButton.setAttribute('aria-expanded', 'false'); }
function ensureTurnstile() {
  if (!authState.turnstileSitekey) return;
  $('turnstileWrap').hidden = false;
  const render = () => { if (!window.turnstile || turnstileWidgetId !== null) return; turnstileWidgetId = window.turnstile.render('#turnstileWidget', { sitekey: authState.turnstileSitekey, theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', callback: (token) => { turnstileToken = token; }, 'expired-callback': () => { turnstileToken = ''; }, 'error-callback': () => { turnstileToken = ''; } }); };
  if (window.turnstile) render();
  else if (!document.querySelector('#turnstileScript')) { const script = document.createElement('script'); script.id = 'turnstileScript'; script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true; script.onload = render; document.head.append(script); }
}
async function loadAuthSession() {
  try {
    const response = await fetch(apiUrl('/api/auth/session'), { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    authState = { enabled: Boolean(data.enabled), authenticated: Boolean(data.authenticated), user: data.user || null, turnstileSitekey: data.turnstileSitekey || null };
    renderAccountState();
  } catch {}
}
async function authRequest(path, options = {}) {
  const response = await fetch(apiUrl(path), { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'auth_request_failed');
  return data;
}
async function loadAdminUsers() {
  if (authState.user?.role !== 'admin') return;
  const list = $('userList'); list.textContent = '正在读取账户…';
  try { const data = await authRequest('/api/auth/users'); list.replaceChildren(...(data.users || []).map((user) => { const row = document.createElement('div'); row.className = 'user-list-item'; const copy = document.createElement('div'); const name = document.createElement('span'); name.textContent = user.username; const meta = document.createElement('small'); meta.textContent = user.role === 'admin' ? '管理员' : user.disabled ? '已停用' : '普通账户'; copy.append(name, meta); row.append(copy); if (user.role !== 'admin') { const actions = document.createElement('div'); actions.className = 'user-list-actions'; const edit = document.createElement('button'); edit.className = 'mini-button'; edit.type = 'button'; edit.textContent = '编辑'; edit.onclick = () => openUserEditor(user); const remove = document.createElement('button'); remove.className = 'mini-button danger'; remove.type = 'button'; remove.textContent = '删除'; remove.onclick = () => deleteUser(user); actions.append(edit, remove); row.append(actions); } else { const current = document.createElement('small'); current.textContent = '当前管理员'; row.append(current); } return row; })); }
  catch { list.textContent = '管理员账户接口尚未连接'; }
}
function openUserEditor(user) { $('editUserId').value = user.id; $('editUsername').value = user.username; $('editPassword').value = ''; $('editDisabled').checked = Boolean(user.disabled); $('editUserError').hidden = true; $('userEditor').hidden = false; $('editUsername').focus(); }
function closeUserEditor() { $('userEditor').hidden = true; $('editUserForm').reset(); }
async function deleteUser(user) { if (!window.confirm(`确定删除账户“${user.username}”吗？`)) return; try { await authRequest(`/api/auth/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' }); closeUserEditor(); loadAdminUsers(); showToast('账户已删除'); } catch (error) { showToast(error.message === 'user_not_found' ? '账户不存在' : '删除账户失败'); } }

const favoriteDbName = 'relay-board-favorites';
function openFavoriteDb() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(favoriteDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('items', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function favoriteFallbackRead() {
  try { return JSON.parse(localStorage.getItem(`relay-board-favorites-${room}`) || '[]'); } catch { return [...fallbackFavoriteStore.values()]; }
}

function favoriteFallbackWrite(records) {
  try { localStorage.setItem(`relay-board-favorites-${room}`, JSON.stringify(records)); }
  catch { fallbackFavoriteStore.clear(); records.forEach((item) => fallbackFavoriteStore.set(item.id, item)); }
}

async function loadFavorites() {
  const db = await openFavoriteDb();
  if (!db) { favoriteFallbackRead().forEach((item) => favoriteStore.set(item.id, item)); return; }
  const records = await new Promise((resolve) => {
    const request = db.transaction('items', 'readonly').objectStore('items').getAll();
    request.onsuccess = () => resolve(request.result.filter((item) => item.room === room));
    request.onerror = () => resolve([]);
  });
  records.forEach((item) => favoriteStore.set(item.id, item)); db.close();
}

async function saveFavorite(item) {
  const record = { ...item, room, favoriteAt: Date.now() };
  const db = await openFavoriteDb();
  if (!db) {
    const records = favoriteFallbackRead().filter((entry) => entry.id !== item.id); records.push(record); favoriteFallbackWrite(records);
  } else {
    try {
      await new Promise((resolve, reject) => { const transaction = db.transaction('items', 'readwrite'); transaction.objectStore('items').put(record); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error || new Error('favorite_write_failed')); });
      db.close();
    } catch {
      db.close();
      const records = favoriteFallbackRead().filter((entry) => entry.id !== item.id); records.push(record); favoriteFallbackWrite(records);
    }
  }
  favoriteStore.set(item.id, record);
}

async function deleteFavorite(id) {
  const db = await openFavoriteDb();
  if (!db) {
    favoriteFallbackWrite(favoriteFallbackRead().filter((item) => item.id !== id));
  } else {
    await new Promise((resolve, reject) => { const transaction = db.transaction('items', 'readwrite'); transaction.objectStore('items').delete(id); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); db.close();
  }
  favoriteStore.delete(id);
}

function favoritePreview(item) {
  const kind = item.kind === 'bundle' ? '文字 + 图片' : item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '文字';
  const text = String(item.text || '').replace(/\s+/g, ' ').trim();
  return text ? `${kind} · ${text}`.slice(0, 70) : `${kind} · ${item.name || '无标题消息'}`;
}

function renderFavorites() {
  favoriteList.replaceChildren();
  if (!favoriteStore.size) { favoriteList.innerHTML = '<div class="favorite-empty">还没有收藏消息</div>'; return; }
  [...favoriteStore.values()].sort((a, b) => b.favoriteAt - a.favoriteAt).forEach((item) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'favorite-list-item';
    if (item.data && item.mime?.startsWith('image/')) { const image = document.createElement('img'); image.src = item.data; image.alt = ''; button.append(image); }
    const copy = document.createElement('span'); copy.className = 'favorite-list-copy'; copy.innerHTML = `<strong>${escapeHtml(favoritePreview(item))}</strong><span>点击放入输入框</span>`; button.append(copy);
    button.onclick = () => loadFavoriteIntoComposer(item); favoriteList.append(button);
  });
}

function loadFavoriteIntoComposer(item) {
  if (item.format === 'rich' && item.html) editor.innerHTML = sanitize(item.html);
  else editor.innerHTML = escapeHtml(item.text || '').replace(/\n/g, '<br>');
  if (item.data && item.mime?.startsWith('image/')) {
    pendingImage = { data: item.data, mime: item.mime, name: item.name, previewUrl: '' };
    draftImage.src = item.data; draftImageName.textContent = item.name || '收藏图片'; imageDraft.hidden = false;
  } else clearImageDraft();
  favoriteMenu.hidden = true; favoriteButton.setAttribute('aria-expanded', 'false'); updateComposerState(); resizeComposerEditor(); editor.focus(); showToast('收藏消息已放入输入框');
}

async function toggleFavorite(item) {
  if (favoriteStore.has(item.id)) {
    favoriteStore.delete(item.id); renderAll(); renderFavorites(); showToast('已取消收藏');
    try { await deleteFavorite(item.id); } catch {}
    return;
  }
  const record = { ...item, room, favoriteAt: Date.now() };
  favoriteStore.set(item.id, record); renderAll(); renderFavorites(); showToast('已加入收藏');
  try { await saveFavorite(item); } catch { showToast('已加入收藏（本次打开有效）'); }
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function sanitize(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const allowed = new Set(['B','STRONG','I','EM','U','S','H1','H2','H3','P','BR','UL','OL','LI','A','BLOCKQUOTE','PRE','CODE']);
  for (const node of [...doc.body.querySelectorAll('*')]) {
    if (!allowed.has(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
    for (const attr of [...node.attributes]) {
      if (node.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value)) { node.setAttribute('rel', 'noreferrer noopener'); node.setAttribute('target', '_blank'); }
      else node.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML;
}

function relativeTime(timestamp) {
  const seconds = Math.max(1, Math.floor((Date.now() - Number(timestamp)) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function itemKindLabel(item) {
  return item.kind === 'bundle' ? '文字 + 图片' : item.kind === 'text' ? (item.format === 'rich' ? '富文本' : '纯文本') : item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '文件';
}

function itemDeviceLabel(item) {
  return ['电脑', '手机', '平板', '其他设备'].includes(item.deviceType) ? item.deviceType : '其他设备';
}

function roomUrl() {
  const url = new URL(location.href); url.hash = ''; return url.href;
}

function cliExportUrl() {
  return apiUrl(`/api/room/${room}/export`);
}

function messageUrl(item) {
  const url = new URL(roomUrl()); url.hash = `item-${item.id}`; return url.href;
}

function analysisUrl(item) {
  const url = new URL('analysis.html', document.baseURI);
  url.searchParams.set('room', room);
  url.searchParams.set('item', item.id);
  return url.href;
}

async function copyAnalysisLink(item) {
  try { await navigator.clipboard.writeText(analysisUrl(item)); showToast('分享链接已复制'); }
  catch { showToast('分享链接复制失败'); }
}

function messageUrls(item) {
  const matches = String(item.text || '').match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  return [...new Set(matches.map((value) => value.replace(/[),.;!?，。！？；：、）》】]+$/g, '')))];
}

function createUrlMenu(item) {
  const urls = messageUrls(item);
  if (!urls.length) return null;
  const wrap = document.createElement('div'); wrap.className = 'url-menu-wrap';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'mini-button'; trigger.textContent = '复制网址';
  const menu = document.createElement('div'); menu.className = 'url-menu'; menu.hidden = true;
  trigger.title = `识别到 ${urls.length} 个网址`;
  urls.forEach((value, index) => {
    const option = document.createElement('button'); option.type = 'button'; option.textContent = urls.length > 1 ? `网址 ${index + 1} · ${value}` : value; option.title = value; option.onclick = async () => { try { await navigator.clipboard.writeText(value); showToast('网址已复制'); } catch { showToast('网址复制失败'); } menu.hidden = true; };
    menu.append(option);
  });
  trigger.onclick = (event) => { event.stopPropagation(); document.querySelectorAll('.url-menu').forEach((other) => { if (other !== menu) other.hidden = true; }); menu.hidden = !menu.hidden; };
  wrap.append(trigger, menu); return wrap;
}

function sortedItems() { return [...itemStore.values()].sort((a, b) => a.createdAt - b.createdAt); }

function visibleItems() {
  const query = searchQuery.trim().toLocaleLowerCase();
  if (!query) return sortedItems();
  return sortedItems().filter((item) => [item.text, item.html, item.name, item.deviceType, item.deviceName, itemKindLabel(item)].some((value) => String(value || '').toLocaleLowerCase().includes(query)));
}

function exportTime(timestamp) { return new Date(Number(timestamp)).toLocaleString('zh-CN', { hour12: false }); }

function exportDownload(content, filename, type) {
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportText() {
  const lines = [`Relay Board / ${room}`, `导出时间：${exportTime(Date.now())}`, ''];
  sortedItems().forEach((item, index) => { lines.push(`# ${index + 1} · ${itemDeviceLabel(item)}${item.deviceName ? ` · ${item.deviceName}` : ''} · ${itemKindLabel(item)} · ${exportTime(item.createdAt)}`); lines.push(item.text || `[${itemKindLabel(item)}${item.name ? `：${item.name}` : ''}]`); lines.push(''); });
  exportDownload(lines.join('\n'), `relay-board-${room}.txt`, 'text/plain;charset=utf-8'); showToast('文本格式已导出');
}

function exportJson() {
  const archive = { format: 'relay-board-full-v1', room, exportedAt: new Date().toISOString(), exportedFromDevice: deviceType, items: sortedItems() };
  exportDownload(JSON.stringify(archive, null, 2), `relay-board-${room}-full.json`, 'application/json;charset=utf-8'); showToast('完整房间已导出');
}

function markdownQuote(value) { return String(value || '').split('\n').map((line) => `> ${line || ' '}`).join('\n'); }

function exportCodex() {
  const lines = [`# Relay Board 参考资料`, '', `- 房间：\`${room}\``, `- 导出时间：${exportTime(Date.now())}`, `- 用途：可直接提供给 Codex 作为上下文参考`, ''];
  sortedItems().forEach((item, index) => {
    lines.push(`## 消息 ${index + 1}`, '', `- 主人：${item.clientId && item.clientId === clientId ? '我' : '其他设备'}`, `- 设备：${itemDeviceLabel(item)}`, `- 设备名称：${item.deviceName || '未命名'}`, `- 类型：${itemKindLabel(item)}`, `- 时间：${exportTime(item.createdAt)}`, '');
    if (item.text) lines.push('### 文字', '', markdownQuote(item.text), '');
    if (item.data && item.mime?.startsWith('image/')) lines.push('### 图片', '', `![${item.name || '图片'}](${item.data})`, '');
    else if (item.data) lines.push(`### 附件：${item.name || itemKindLabel(item)}`, '', `[打开附件](${item.data})`, '');
  });
  exportDownload(lines.join('\n'), `relay-board-${room}-codex.md`, 'text/markdown;charset=utf-8'); showToast('Codex 参考 Markdown 已导出');
}

function exportRoom(format) {
  if (format === 'api') return navigator.clipboard.writeText(cliExportUrl()).then(() => { exportMenu.hidden = true; exportButton.setAttribute('aria-expanded', 'false'); showToast('CLI 读取地址已复制'); }).catch(() => showToast('地址复制失败'));
  if (!itemStore.size) return showToast('房间还没有可导出的消息');
  if (format === 'json') exportJson(); else if (format === 'codex') exportCodex(); else exportText();
  exportMenu.hidden = true; exportButton.setAttribute('aria-expanded', 'false');
}

function appendItemText(content, item) {
  if (!item.text) return;
  if (item.format === 'rich' && item.html) {
    const richText = document.createElement('div'); richText.className = 'item-text'; richText.innerHTML = sanitize(item.html); content.append(richText);
  } else {
    const plainText = document.createElement('pre'); plainText.className = 'item-text'; plainText.textContent = item.text; content.append(plainText);
  }
}

function appendItemImage(content, item) {
  if (!item.data) return;
  const img = document.createElement('img'); img.className = 'item-media'; img.src = item.data; img.alt = item.name || '上传图片'; content.append(img);
}

function renderItem(item) {
  const mine = item.clientId && item.clientId === clientId;
  const node = document.createElement('article'); node.className = `item ${mine ? 'mine' : 'remote'}`; node.dataset.id = item.id; node.id = `item-${item.id}`; node.title = '双击复制内容';
  const kind = itemKindLabel(item);
  const content = document.createElement('div'); content.className = 'item-content';
  if (item.kind === 'text') appendItemText(content, item);
  else if (item.kind === 'bundle') { appendItemText(content, item); appendItemImage(content, item); }
  else if (item.kind === 'image') appendItemImage(content, item);
  else if (item.kind === 'video') { const video = document.createElement('video'); video.className = 'item-media'; video.controls = true; video.preload = 'metadata'; video.src = item.data; content.append(video); }
  else content.innerHTML = `<p>📎 ${escapeHtml(item.name || '文件')}</p>`;
  const actions = document.createElement('div'); actions.className = 'item-actions';
  if (item.kind === 'bundle') {
    const copyText = document.createElement('button'); copyText.className = 'mini-button'; copyText.textContent = '仅复制文字'; copyText.onclick = () => copyTextOnly(item);
    const download = document.createElement('a'); download.className = 'mini-button'; download.textContent = '下载'; download.download = item.name || `image-${item.id}`; download.href = item.data; download.style.textDecoration = 'none';
    const copy = document.createElement('button'); copy.className = 'mini-button'; copy.textContent = '复制'; copy.onclick = () => copyAll(item);
    actions.append(copyText, download, copy);
  } else {
    const download = document.createElement('a'); download.className = 'mini-button'; download.textContent = '下载'; download.download = item.name || `${item.kind}-${item.id}`; download.href = item.kind === 'text' ? URL.createObjectURL(new Blob([item.text], { type: 'text/plain;charset=utf-8' })) : item.data; download.style.textDecoration = 'none';
    const urlMenu = createUrlMenu(item);
    if (urlMenu) actions.append(urlMenu);
    actions.append(download);
  }
  const analysisLink = document.createElement('button'); analysisLink.className = 'mini-button analysis-link-action'; analysisLink.textContent = '分享链接'; analysisLink.title = '分享只包含这条消息的分析卡片'; analysisLink.onclick = (event) => { event.stopPropagation(); copyAnalysisLink(item); };
  actions.append(analysisLink);
  const favorite = document.createElement('button'); favorite.className = 'mini-button favorite-action'; favorite.textContent = favoriteStore.has(item.id) ? '★ 已收藏' : '☆ 收藏'; favorite.onclick = () => toggleFavorite(item);
  const remove = document.createElement('button'); remove.className = 'mini-button'; remove.textContent = '移除'; remove.onclick = () => removeItem(item.id);
  actions.append(favorite, remove);
  const device = `${itemDeviceLabel(item)}${item.deviceName ? ` · ${escapeHtml(item.deviceName)}` : ''}`;
  node.innerHTML = `<div class="item-meta"><span class="item-sender">${mine ? '我' : '其他设备'}</span><span class="item-device">${device}</span><span class="item-kind">${kind}</span><time>${relativeTime(item.createdAt)}</time></div>`;
  node.addEventListener('dblclick', (event) => { if (!event.target.closest('button, a, .url-menu')) copyItem(item).catch(() => showToast('复制失败')); });
  node.append(content, actions); return node;
}

function renderMessageRail() {
  const records = visibleItems();
  messageRail.replaceChildren();
  messageRail.hidden = !records.length;
  if (!records.length) return;
  const track = document.createElement('div'); track.className = 'message-rail-track';
  const fill = document.createElement('span'); fill.className = 'message-rail-fill'; track.append(fill);
  records.forEach((item, index) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'message-rail-node';
    node.dataset.index = index; node.title = `第 ${index + 1} 条 · ${itemDeviceLabel(item)}${item.deviceName ? ` · ${item.deviceName}` : ''}`;
    const railPreview = item.kind === 'text'
      ? String(item.text || '').replace(/\s+/g, ' ').trim()
      : item.kind === 'bundle'
        ? [String(item.text || '').replace(/\s+/g, ' ').trim(), item.name || '图片内容'].filter(Boolean).join(' · ')
        : `${item.name || item.kind || '媒体内容'}`;
    node.dataset.preview = `${railPreview.slice(0, 96)}${railPreview.length > 96 ? '…' : ''}`;
    node.setAttribute('aria-label', `查看第 ${index + 1} 条消息：${node.dataset.preview || '媒体内容'}`);
    node.innerHTML = `<i></i><span>${String(index + 1).padStart(2, '0')}</span>`;
    node.style.top = records.length === 1 ? '50%' : `${index / (records.length - 1) * 100}%`;
    node.onclick = () => {
      revealMessageRail();
      const target = document.getElementById(`item-${item.id}`);
      if (!target) return;
      itemsEl.scrollTo({ top: Math.max(0, target.offsetTop - 18), behavior: 'smooth' });
      history.replaceState(null, '', `${location.pathname}${location.search}#item-${item.id}`);
      updateMessageRail(index);
    };
    track.append(node);
  });
  messageRail.append(track);
  updateMessageRail();
}

function updateMessageRail(forcedIndex = null) {
  if (messageRail.hidden) return;
  const nodes = [...messageRail.querySelectorAll('.message-rail-node')];
  const items = [...itemsEl.querySelectorAll('.item')];
  if (!nodes.length || !items.length) return;
  let activeIndex = forcedIndex;
  if (activeIndex === null) {
    activeIndex = 0;
    items.forEach((item, index) => { if (item.offsetTop <= itemsEl.scrollTop + 80) activeIndex = index; });
  }
  nodes.forEach((node, index) => node.classList.toggle('active', index === activeIndex));
  const fill = messageRail.querySelector('.message-rail-fill');
  if (fill) fill.style.height = `${nodes.length === 1 ? 50 : activeIndex / (nodes.length - 1) * 100}%`;
}

function renderAll() {
  const nearBottom = itemsEl.scrollHeight - itemsEl.scrollTop - itemsEl.clientHeight < 80;
  const records = visibleItems();
  itemsEl.replaceChildren(...records.map(renderItem));
  renderMessageRail();
  $('itemCount').textContent = searchQuery.trim() ? `${records.length}/${itemStore.size}` : itemStore.size; $('emptyState').hidden = records.length > 0;
  if (nearBottom || itemStore.size <= 1) requestAnimationFrame(() => { itemsEl.scrollTop = itemsEl.scrollHeight; });
}

async function loadRoom() {
  const response = await fetch(apiUrl(`/api/room/${room}`), { cache: 'no-store', credentials: 'include' }); if (!response.ok) throw new Error('room_load_failed');
  const data = await response.json(); itemStore.clear(); data.items.forEach((item) => itemStore.set(item.id, item)); renderAll(); requestAnimationFrame(scrollToHash); saveRoomCache();
}

function scrollToHash() {
  if (!location.hash.startsWith('#item-')) return;
  document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function connectEvents() {
  eventSource?.close(); eventSource = new EventSource(apiUrl(`/api/room/${room}/events`), { withCredentials: true });
  eventSource.addEventListener('ready', () => { clearTimeout(connectionRetryTimer); connectionRetryDelay = 1500; setConnectionState('live'); loadRoom().catch(() => {}); });
  eventSource.addEventListener('item', (event) => { const item = JSON.parse(event.data); itemStore.set(item.id, item); renderAll(); saveRoomCache(); });
  eventSource.addEventListener('remove', (event) => { itemStore.delete(JSON.parse(event.data).id); renderAll(); saveRoomCache(); });
  eventSource.onerror = () => { setConnectionState('offline', itemStore.size > 0); scheduleConnectionRetry(); };
}

function scheduleConnectionRetry() {
  clearTimeout(connectionRetryTimer);
  connectionRetryTimer = window.setTimeout(async () => {
    try { await loadRoom(); connectEvents(); connectionRetryDelay = 1500; }
    catch { setConnectionState('offline', itemStore.size > 0); connectionRetryDelay = Math.min(30000, Math.round(connectionRetryDelay * 1.7)); scheduleConnectionRetry(); }
  }, connectionRetryDelay);
}

function readFileData(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

function clearImageDraft() {
  if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
  pendingImage = null; imageDraft.hidden = true; draftImage.removeAttribute('src'); draftImageName.textContent = '待发送图片'; draftImageMeta.textContent = '会和这条文字一起发送';
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')); };
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('image_encode_failed')), type, quality));
}

async function compressImage(file) {
  const image = await imageFromFile(file);
  const maxSides = [2560, 2200, 1900, 1600, 1400];
  const qualities = [.84, .76, .68, .58, .48];
  const outputType = 'image/webp';
  for (const maxSide of maxSides) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of qualities) {
      const blob = await canvasBlob(canvas, outputType, quality);
      if (blob.size <= imageLimitBytes) return { file: new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: outputType }), originalBytes: file.size, compressedBytes: blob.size };
    }
  }
  throw new Error('image_compress_failed');
}

async function queueImage(file) {
  if (!file || !file.type.startsWith('image/')) return showToast('这里只能加入图片');
  if (file.size > imageHardLimitBytes) return showToast('图片超过 200MB 限制');
  let selectedFile = file; let compressed = false;
  if (file.size > imageLimitBytes) {
    if (!window.confirm(`这张图片是 ${formatBytes(file.size)}，超过 ${formatBytes(imageLimitBytes)} 限制。是否压缩后放入房间？`)) return showToast('已取消加入图片');
    selectedFile = (await compressImage(file)).file; compressed = true;
  }
  if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
  const previewUrl = URL.createObjectURL(selectedFile);
  pendingImage = { data: await readFileData(selectedFile), originalData: compressed ? await readFileData(file) : '', mime: selectedFile.type, name: selectedFile.name, previewUrl };
  draftImage.src = previewUrl; draftImageName.textContent = selectedFile.name || '待发送图片'; draftImageMeta.textContent = compressed ? `已压缩到 ${formatBytes(selectedFile.size)}，会和这条文字一起发送` : `图片 ${formatBytes(selectedFile.size)}，会和这条文字一起发送`; imageDraft.hidden = false; updateComposerState(); showToast(compressed ? '图片已压缩并加入当前消息' : '图片已加入当前消息');
}

async function submitComposer() {
  const rich = $('preserveFormat').checked;
  const text = editor.innerText.trim();
  if (!text && !pendingImage) return showToast('先输入文字或加入一张图片');
  const payload = pendingImage
    ? { kind: 'bundle', text, html: rich ? editor.innerHTML : '', format: rich ? 'rich' : 'plain', data: pendingImage.data, originalData: pendingImage.originalData || undefined, mime: pendingImage.mime, name: pendingImage.name, clientId, deviceType, deviceName }
    : { kind: 'text', text, html: rich ? editor.innerHTML : '', format: rich ? 'rich' : 'plain', clientId, deviceType, deviceName };
  const response = await fetch(apiUrl(`/api/room/${room}/items`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) return showToast('内容没有放入房间');
  editor.innerHTML = ''; clearImageDraft(); composer?.classList.remove('is-expanded'); resizeComposerEditor(); showToast('已放入房间');
}

async function submitFile(file) {
  if (!file) return;
  if (file.size > 200 * 1024 * 1024) return showToast('文件超过 200MB 限制');
  const data = await readFileData(file);
  const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
  const response = await fetch(apiUrl(`/api/room/${room}/items`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, data, mime: file.type, name: file.name, clientId, deviceType, deviceName }) });
  if (!response.ok) return showToast('文件上传失败');
  showToast('媒体已放入房间');
}

async function copyTextOnly(item) {
  if (!item.text) return showToast('这条消息没有文字');
  await navigator.clipboard.writeText(item.text); showToast('文字已复制');
}

function bundleClipboardHtml(item) {
  const textHtml = item.format === 'rich' && item.html ? sanitize(item.html) : `<pre>${escapeHtml(item.text || '')}</pre>`;
  const imageHtml = item.data ? `<p><img src="${item.data}" alt="${escapeHtml(item.name || '图片')}"></p>` : '';
  return `${textHtml}${imageHtml}`;
}

async function copyAll(item) {
  if (!navigator.clipboard?.write || !window.ClipboardItem) return copyTextOnly(item).then(() => showToast('文字已复制，图片可点击下载'));
  try {
    const imageBlob = await fetch(item.data).then((response) => response.blob());
    const imageType = item.mime || imageBlob.type || 'image/png';
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([item.text || ''], { type: 'text/plain' }),
      'text/html': new Blob([bundleClipboardHtml(item)], { type: 'text/html' }),
      [imageType]: imageBlob
    })]);
    showToast('文字和图片已复制');
  } catch {
    await copyTextOnly(item); showToast('文字已复制，图片可点击下载');
  }
}

async function copyItem(item) {
  if (item.kind === 'bundle') return copyAll(item);
  if (item.kind !== 'text') return navigator.clipboard?.writeText(item.data).then(() => showToast('链接已复制'));
  try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([item.text], { type: 'text/plain' }), 'text/html': new Blob([sanitize(item.html)], { type: 'text/html' }) })]); }
  catch { await navigator.clipboard.writeText(item.text); }
  showToast('内容已复制');
}

async function copyLatestItem() {
  const item = sortedItems().at(-1);
  if (!item) return showToast('还没有可复制的消息');
  if (item.kind === 'bundle' || item.kind === 'text') return item.kind === 'bundle' ? copyAll(item) : copyItem(item);
  if (item.data && item.mime?.startsWith('image/') && navigator.clipboard?.write && window.ClipboardItem) {
    try {
      const blob = await fetch(item.data).then((response) => response.blob());
      await navigator.clipboard.write([new ClipboardItem({ [item.mime || blob.type || 'image/png']: blob })]);
      showToast('最新图片已按原格式复制');
      return;
    } catch {}
  }
  return copyItem(item);
}

function loadItemIntoComposer(item) {
  if (item.format === 'rich' && item.html) editor.innerHTML = sanitize(item.html);
  else editor.innerHTML = escapeHtml(item.text || '').replace(/\n/g, '<br>');
  if (item.data && item.mime?.startsWith('image/')) {
    pendingImage = { data: item.data, mime: item.mime, name: item.name, previewUrl: '' };
    draftImage.src = item.data; draftImageName.textContent = item.name || '最新消息图片'; draftImageMeta.textContent = '会和这条文字一起发送'; imageDraft.hidden = false;
  } else clearImageDraft();
  updateComposerState(); resizeComposerEditor();
}

async function pasteClipboardAndSend() {
  let text = '';
  let imageBlob = null;
  try {
    if (navigator.clipboard?.read) {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) => type.startsWith('image/'));
        if (imageType && !imageBlob) imageBlob = await clipboardItem.getType(imageType);
        if (!text && clipboardItem.types.includes('text/plain')) text = await (await clipboardItem.getType('text/plain')).text();
      }
    } else if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
  } catch {
    try { text = await navigator.clipboard.readText(); } catch { throw new Error('clipboard_read_failed'); }
  }
  if (!text.trim() && !imageBlob) return showToast('剪贴板里没有可发送内容');
  editor.innerHTML = text ? escapeHtml(text).replace(/\n/g, '<br>') : '';
  clearImageDraft();
  if (imageBlob) await queueImage(new File([imageBlob], `clipboard-image.${imageBlob.type.split('/')[1] || 'png'}`, { type: imageBlob.type }));
  updateComposerState(); resizeComposerEditor();
  await submitComposer();
  showToast('剪贴板内容已粘贴并发送');
}

async function removeItem(id) {
  const response = await fetch(apiUrl(`/api/room/${room}/items/${id}`), { method: 'DELETE' });
  if (response.ok) { itemStore.delete(id); renderAll(); showToast('已移除'); }
}

$('sendButton').onclick = () => submitComposer().catch(() => showToast('发送失败，请检查连接'));
$('pasteSendButton').onclick = () => pasteClipboardAndSend().catch(() => showToast('读取剪贴板失败，请允许网页访问剪贴板'));
$('fileInput').onchange = (event) => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  const task = file.type.startsWith('image/') ? queueImage(file) : submitFile(file);
  task.catch(() => showToast('上传失败'));
};
$('removeDraftImage').onclick = clearImageDraft;
$('preserveFormat').onchange = (event) => { $('formatHint').textContent = event.target.checked ? '富文本会保留标题、列表、链接和基础样式；图片可和文字一起发送，超过 8MB 会询问压缩' : '只保留纯文字，适合复制命令和配置；图片可和文字一起发送，超过 8MB 会询问压缩'; };
$('deviceNameButton').onclick = () => {
  const next = window.prompt('给这台设备起个名字（例如：办公室电脑）', deviceName);
  if (next === null) return;
  const value = next.trim().slice(0, 32);
  if (!value) return showToast('设备名称不能为空');
  deviceName = value;
  try { localStorage.setItem('relay-board-device-name', deviceName); } catch {}
  applyDeviceName(); showToast('设备名称已更新');
};
$('favoriteButton').onclick = (event) => { event.stopPropagation(); const open = favoriteMenu.hidden; favoriteMenu.hidden = !open; favoriteButton.setAttribute('aria-expanded', String(open)); if (open) renderFavorites(); };
exportButton.onclick = (event) => { event.stopPropagation(); const open = exportMenu.hidden; exportMenu.hidden = !open; exportButton.setAttribute('aria-expanded', String(open)); };
exportMenu.querySelectorAll('[data-export]').forEach((button) => { button.onclick = () => exportRoom(button.dataset.export); });
searchButton.onclick = (event) => { event.stopPropagation(); const open = historySearch.hidden; historySearch.hidden = !open; searchButton.setAttribute('aria-expanded', String(open)); if (open) historySearchInput.focus(); };
historySearchInput.oninput = (event) => { searchQuery = event.target.value; renderAll(); };
clearSearchButton.onclick = () => { searchQuery = ''; historySearchInput.value = ''; historySearch.hidden = true; searchButton.setAttribute('aria-expanded', 'false'); renderAll(); };
document.addEventListener('click', (event) => {
  if (!favoriteMenu.hidden && !favoriteMenu.contains(event.target) && event.target !== favoriteButton) { favoriteMenu.hidden = true; favoriteButton.setAttribute('aria-expanded', 'false'); }
  if (!exportMenu.hidden && !exportMenu.contains(event.target) && event.target !== exportButton) { exportMenu.hidden = true; exportButton.setAttribute('aria-expanded', 'false'); }
  if (!historySearch.hidden && !historySearch.contains(event.target) && event.target !== searchButton) { historySearch.hidden = true; searchButton.setAttribute('aria-expanded', 'false'); }
  document.querySelectorAll('.url-menu').forEach((menu) => { if (!menu.contains(event.target) && !event.target.closest('.url-menu-wrap')) menu.hidden = true; });
});
$('shareButton').onclick = () => navigator.clipboard.writeText(location.href).then(() => showToast('房间链接已复制'));
$('addContentButton').onclick = () => { alignComposerView(); editor.focus(); showToast('输入框已定位'); };
let heroClickTimer;
$('boardHeading').addEventListener('click', (event) => {
  if (event.target.closest('button, a, input, textarea')) return;
  clearTimeout(heroClickTimer); heroClickTimer = window.setTimeout(() => copyLatestItem().catch(() => showToast('复制最新消息失败')), 260);
});
pageTopNode.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
pageComposerNode.onclick = () => { alignComposerView(); editor.focus(); };
pageProgress.onclick = (event) => {
  if (event.target.closest('.page-node')) return;
  const composer = document.querySelector('.composer');
  const composerTarget = composer ? Math.max(1, composer.getBoundingClientRect().top + window.scrollY - 24) : 1;
  if (window.scrollY > composerTarget / 2) window.scrollTo({ top: 0, behavior: 'smooth' });
  else { alignComposerView(); editor.focus(); }
};
function updatePageProgress() {
  const composer = document.querySelector('.composer');
  if (!composer) return;
  const composerTarget = Math.max(1, composer.getBoundingClientRect().top + window.scrollY - 24);
  const progress = Math.min(1, Math.max(0, window.scrollY / composerTarget));
  pageProgressFill.style.height = `${progress * 100}%`;
  pageTopNode.classList.toggle('active', progress < 0.08);
  pageComposerNode.classList.toggle('active', progress > 0.92);
}
window.addEventListener('scroll', () => { updatePageProgress(); revealPageProgress(); }, { passive: true });
window.addEventListener('resize', updatePageProgress);
updatePageProgress();
$('copyKey').onclick = () => navigator.clipboard.writeText(room).then(() => showToast('房间密钥已复制'));
$('newRoom').onclick = () => { if ($('newRoom').disabled) return; const nextRoom = makeRoom(); rememberRoom(); location.href = `?room=${nextRoom}`; };
$('sidebarNewRoom').onclick = () => { if ($('sidebarNewRoom').disabled) return; const nextRoom = makeRoom(); rememberRoom(); location.href = `?room=${nextRoom}`; };
$('sidebarToggle').onclick = () => toggleSidebar(); $('sidebarClose').onclick = () => toggleSidebar(false); $('sidebarBackdrop').onclick = () => toggleSidebar(false);
$('accountButton').onclick = () => { if (authState.user) { authDialog.hidden = false; accountButton.setAttribute('aria-expanded', 'true'); } else openAuthDialog(); };
$('authClose').onclick = closeAuthDialog;
authDialog.addEventListener('click', (event) => { if (event.target === authDialog) closeAuthDialog(); });
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); authError.hidden = true;
  try { const data = await authRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('authUsername').value.trim(), password: $('authPassword').value, turnstileToken }) }); authState = { enabled: true, authenticated: true, user: data.user }; renderAccountState(); closeAuthDialog(); showToast('登录成功'); location.reload(); }
  catch (error) { authError.textContent = error.message === 'captcha_required' ? '请完成验证码后再试' : error.message === 'too_many_attempts' ? '尝试次数过多，请稍后再试' : error.message === 'setup_required' ? '管理员账户尚未初始化' : '账户名或密码不正确'; authError.hidden = false; if (error.message === 'captcha_required') ensureTurnstile(); }
});
$('logoutButton').onclick = async () => { try { await authRequest('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {} location.reload(); };
$('adminToggle').onclick = () => { const panel = $('adminPanel'); panel.hidden = !panel.hidden; if (!panel.hidden) loadAdminUsers(); };
$('addUserForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await authRequest('/api/auth/users', { method: 'POST', body: JSON.stringify({ username: $('newUsername').value.trim(), password: $('newPassword').value }) }); $('newUsername').value = ''; $('newPassword').value = ''; showToast('账户已添加'); loadAdminUsers(); } catch (error) { showToast(error.message === 'username_exists' ? '账户名已存在' : '添加账户失败'); } });
$('cancelEditUser').onclick = closeUserEditor;
$('editUserForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = $('editUserError'); error.hidden = true; try { await authRequest(`/api/auth/users/${encodeURIComponent($('editUserId').value)}`, { method: 'PATCH', body: JSON.stringify({ username: $('editUsername').value.trim(), password: $('editPassword').value, disabled: $('editDisabled').checked }) }); closeUserEditor(); loadAdminUsers(); showToast('账户已修改'); } catch (requestError) { error.textContent = requestError.message === 'username_exists' ? '账户名已存在' : requestError.message === 'password_too_short' ? '新密码至少 8 位' : '账户修改失败'; error.hidden = false; } });
$('passwordToggle').onclick = () => { const panel = $('passwordPanel'); panel.hidden = !panel.hidden; if (!panel.hidden) $('currentPassword').focus(); };
$('passwordForm').addEventListener('submit', async (event) => { event.preventDefault(); const error = $('passwordError'); error.hidden = true; if ($('newAdminPassword').value !== $('confirmAdminPassword').value) { error.textContent = '两次新密码不一致'; error.hidden = false; return; } try { await authRequest('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('currentPassword').value, newPassword: $('newAdminPassword').value }) }); $('passwordForm').reset(); $('passwordPanel').hidden = true; showToast('管理员密码已修改'); } catch (requestError) { error.textContent = requestError.message === 'current_password_invalid' ? '当前密码不正确' : requestError.message === 'password_invalid' ? '新密码至少 8 位' : '密码修改失败'; error.hidden = false; } });
$('analyzeButton').onclick = async () => {
  const result = $('analysisResult'); result.hidden = false; result.textContent = '正在分析…';
  try { const response = await fetch(apiUrl(`/api/room/${room}/analyze`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: $('analysisPrompt').value }) }); const data = await response.json(); result.textContent = data.text || data.message || '没有可显示的分析结果。'; }
  catch { result.textContent = '分析请求失败，请稍后再试。'; }
};

editor.addEventListener('paste', (event) => {
  const clipboardItems = [...(event.clipboardData?.items || [])];
  const imageItem = clipboardItems.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
  const image = imageItem?.getAsFile() || [...(event.clipboardData?.files || [])].find((file) => file.type.startsWith('image/'));
  if (image) {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    if (text) document.execCommand('insertText', false, text);
    queueImage(image).catch(() => showToast('图片加入失败'));
    return;
  }
  if (!$('preserveFormat').checked) { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); }
});
editor.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitComposer().catch(() => showToast('发送失败，请检查连接')); } });
function alignComposerView() {
  itemsEl.scrollTop = itemsEl.scrollHeight;
  const composer = document.querySelector('.composer');
  if (!composer) return;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const targetTop = Math.max(12, viewportHeight - composer.getBoundingClientRect().height - 18);
  const delta = composer.getBoundingClientRect().top - targetTop;
  if (Math.abs(delta) > 6) window.scrollBy({ top: delta, behavior: 'smooth' });
}
editor.addEventListener('input', () => { updateComposerState(); resizeComposerEditor(); });
editor.addEventListener('pointerdown', () => { composer?.classList.add('is-expanded'); window.setTimeout(alignComposerView, 0); });
editor.addEventListener('focus', () => { updateComposerState(); resizeComposerEditor(); alignComposerView(); window.setTimeout(alignComposerView, 120); });
editor.addEventListener('blur', () => window.setTimeout(() => { updateComposerState(); resizeComposerEditor(); }, 120));
window.visualViewport?.addEventListener('resize', () => { if (document.activeElement === editor) alignComposerView(); });
window.addEventListener('hashchange', scrollToHash);
itemsEl.addEventListener('scroll', () => { updateMessageRail(); revealMessageRail(); }, { passive: true });
editor.addEventListener('dragover', (event) => event.preventDefault());
editor.addEventListener('drop', (event) => { event.preventDefault(); const file = [...event.dataTransfer.files][0]; if (!file) return; const task = file.type.startsWith('image/') ? queueImage(file) : submitFile(file); task.catch(() => showToast('上传失败')); });

rememberRoom(); renderAccountState();
window.addEventListener('online', () => { connectionRetryDelay = 1000; scheduleConnectionRetry(); });
window.addEventListener('offline', () => setConnectionState('offline', itemStore.size > 0));
loadFavorites().catch(() => {}).then(loadAuthSession).then(() => {
  if (authState.enabled && !authState.authenticated) { $('statusDot').className = 'status-dot offline'; $('connectionText').textContent = '未登录 · 静态模式'; renderAll(); return; }
  return loadRoom().then(connectEvents);
}).catch(async () => { const fromCache = await restoreRoomCache(); setConnectionState('offline', fromCache); scheduleConnectionRetry(); });
