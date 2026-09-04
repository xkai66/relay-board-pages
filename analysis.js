const params = new URLSearchParams(location.search);
const room = params.get('room') || '';
const itemId = params.get('item') || '';
const app = document.querySelector('#analysisApp');
const apiBase = document.querySelector('meta[name="relay-api-base"]')?.content.trim().replace(/\/$/, '') || '';
function apiUrl(path) { return `${apiBase}${path}`; }

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function sanitize(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  template.content.querySelectorAll('script,style,iframe,object,embed,form').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => [...node.attributes].forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (name.startsWith('on') || ['srcdoc', 'formaction'].includes(name)) node.removeAttribute(attribute.name);
    if (['href', 'src'].includes(name) && !/^(https?:|mailto:|data:image\/)/i.test(value)) node.removeAttribute(attribute.name);
  }));
  return template.innerHTML;
}

function kindLabel(item) {
  return item.kind === 'bundle' ? '文字 + 图片' : item.kind === 'text' ? (item.format === 'rich' ? '富文本' : '纯文本') : item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '文件';
}

function formatTime(timestamp) {
  return new Date(Number(timestamp)).toLocaleString('zh-CN', { hour12: false });
}

function showState(message) {
  app.replaceChildren(Object.assign(document.createElement('div'), { className: 'analysis-state', textContent: message }));
}

function clipboardHtml(item) {
  const textHtml = item.format === 'rich' && item.html ? sanitize(item.html) : `<pre>${escapeHtml(item.text || '')}</pre>`;
  const imageHtml = item.data && item.mime?.startsWith('image/') ? `<p><img src="${item.data}" alt="${escapeHtml(item.name || '图片')}"></p>` : '';
  return `${textHtml}${imageHtml}`;
}

async function copyMessage(item) {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      const clipboardData = { 'text/plain': new Blob([item.text || ''], { type: 'text/plain' }) };
      if (item.html) clipboardData['text/html'] = new Blob([sanitize(item.html)], { type: 'text/html' });
      if (item.data && item.mime?.startsWith('image/')) {
        const imageBlob = await fetch(item.data).then((response) => response.blob());
        clipboardData[item.mime || imageBlob.type || 'image/png'] = imageBlob;
      }
      await navigator.clipboard.write([new ClipboardItem(clipboardData)]);
      return item.data && item.mime?.startsWith('image/') ? '文字和图片已复制' : '内容已复制';
    } catch {}
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(item.text || '');
    return item.text ? '文字已复制' : '图片请长按保存';
  }
  throw new Error('clipboard_unavailable');
}

function downloadItem(item) {
  const link = document.createElement('a');
  link.className = 'button quiet'; link.textContent = '下载'; link.download = item.name || `${item.kind}-${item.id}`;
  if (item.data) link.href = item.data;
  else { link.href = URL.createObjectURL(new Blob([item.text || ''], { type: 'text/plain;charset=utf-8' })); link.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(link.href), 1000), { once: true }); }
  link.style.textDecoration = 'none';
  return link;
}

function renderItem(item) {
  const card = document.createElement('article');
  card.className = 'shared-analysis-card';
  const inner = document.createElement('div');
  inner.className = 'shared-analysis-inner';
  const meta = document.createElement('div');
  meta.className = 'shared-analysis-meta';
  meta.innerHTML = `<strong>ANALYSIS CARD</strong><span>${escapeHtml(kindLabel(item))}</span><span>·</span><span>${escapeHtml(formatTime(item.createdAt))}</span>`;
  const content = document.createElement('div');
  content.className = 'shared-analysis-content';
  if (item.text) {
    if (item.format === 'rich' && item.html) content.innerHTML = sanitize(item.html);
    else { const text = document.createElement('pre'); text.textContent = item.text; content.append(text); }
  }
  if (item.data && item.mime?.startsWith('image/')) { const image = document.createElement('img'); image.src = item.data; image.alt = item.name || '消息图片'; content.append(image); }
  const actions = document.createElement('div');
  actions.className = 'shared-analysis-actions';
  const copyText = document.createElement('button');
  copyText.className = 'button quiet'; copyText.type = 'button'; copyText.textContent = '仅复制文字'; copyText.hidden = !item.text;
  copyText.onclick = async () => { try { await navigator.clipboard.writeText(item.text || ''); copyText.textContent = '文字已复制'; setTimeout(() => { copyText.textContent = '仅复制文字'; }, 1400); } catch { copyText.textContent = '复制失败'; } };
  const copy = document.createElement('button');
  copy.className = 'button primary'; copy.type = 'button'; copy.textContent = '复制';
  copy.onclick = async () => { try { copy.textContent = await copyMessage(item); setTimeout(() => { copy.textContent = '复制'; }, 1400); } catch { copy.textContent = '复制失败'; setTimeout(() => { copy.textContent = '复制'; }, 1400); } };
  actions.append(copyText, downloadItem(item), copy);
  inner.append(meta, content, actions);
  card.append(inner);
  return card;
}

async function load() {
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(room) || !/^[-a-f0-9]{20,}$/i.test(itemId)) return showState('分享链接无效');
  try {
    const response = await fetch(apiUrl(`/api/room/${encodeURIComponent(room)}/export`), { credentials: 'include' });
    if (!response.ok) throw new Error('not_found');
    const data = await response.json();
    const item = data.items.find((entry) => entry.id === itemId);
    if (!item) return showState('这条消息已不存在或已过期');
    const topbar = document.createElement('div');
    topbar.className = 'analysis-topbar';
    const label = document.createElement('span'); label.textContent = 'RELAY BOARD / SINGLE MESSAGE';
    topbar.append(label);
    app.replaceChildren(topbar, renderItem(item));
  } catch { showState('分析卡片加载失败，请稍后重试'); }
}

try { const savedTheme = localStorage.getItem('relay-board-theme-v2'); if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'ivory') document.documentElement.dataset.theme = savedTheme; } catch {}
load();
