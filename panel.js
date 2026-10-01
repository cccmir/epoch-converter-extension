// Epoch DevTools panel: a Network-tab-like view (table + headers/body/timing
// detail pane) plus a paste box, with every epoch timestamp underlined for
// hover-to-convert. Chrome doesn't expose the native Network panel's DOM to
// extensions, so this is a dedicated panel built to feel like it.

// --- Epoch detection helpers ---
const SEC_MIN = 9e8;
const SEC_MAX = 4.1e9;
const MS_MIN = SEC_MIN * 1000;
const MS_MAX = SEC_MAX * 1000;

function classify(numStr) {
  const len = numStr.length;
  const value = Number(numStr);
  if (len === 10 && value >= SEC_MIN && value <= SEC_MAX) return { label: 'Epoch (s)', ms: value * 1000 };
  if (len === 13 && value >= MS_MIN && value <= MS_MAX) return { label: 'Epoch (ms)', ms: value };
  return null;
}

function formatRelative(ms) {
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units = [
    ['year', 31536000], ['month', 2592000], ['day', 86400],
    ['hour', 3600], ['minute', 60], ['second', 1]
  ];
  for (const [name, secs] of units) {
    if (abs >= secs || name === 'second') return rtf.format(Math.round(diffSec / secs), name);
  }
  return '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function annotate(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/\b\d{13}\b|\b\d{10}\b/g, (match) => {
    const info = classify(match);
    if (!info) return match;
    return `<span class="epoch" data-ms="${info.ms}" data-raw="${match}" data-label="${info.label}">${match}</span>`;
  });
}

function formatSize(bytes) {
  if (bytes == null || isNaN(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatTime(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return '–';
  if (ms < 1000) return Math.round(ms) + ' ms';
  return (ms / 1000).toFixed(2) + ' s';
}

function typeLabel(mimeType) {
  if (!mimeType) return 'other';
  if (mimeType.includes('json')) return 'json';
  if (mimeType.includes('html')) return 'html';
  if (mimeType.includes('css')) return 'css';
  if (mimeType.includes('javascript') || mimeType.includes('ecmascript')) return 'js';
  if (mimeType.startsWith('image/')) return 'img';
  if (mimeType.includes('font')) return 'font';
  return 'other';
}

// --- Pinned timezones (configured from the popup, read-only here) ---
let pinnedZones = [];
if (window.chrome && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get({ pinnedTimezones: [] }, (data) => {
    pinnedZones = data.pinnedTimezones || [];
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.pinnedTimezones) pinnedZones = changes.pinnedTimezones.newValue || [];
  });
}

function getOffsetLabel(date, timeZone) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
    const part = dtf.formatToParts(date).find((p) => p.type === 'timeZoneName');
    if (!part) return '';
    let label = part.value.replace('GMT', 'UTC');
    if (label === 'UTC') label = 'UTC+0';
    return label;
  } catch (e) {
    return '';
  }
}

function formatInZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).format(date);
  } catch (e) {
    return '–';
  }
}

function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    return (segments.pop() || u.hostname) + (u.search ? u.search : '');
  } catch (e) {
    return url;
  }
}

// --- JSON tree renderer (Preview tab) ---
function jsonToHtml(value, keyLabel) {
  const keyHtml = keyLabel != null
    ? `<span class="json-key">"${escapeHtml(keyLabel)}"</span><span class="json-brace">: </span>`
    : '';

  if (value === null) {
    return `<div class="json-line">${keyHtml}<span class="json-null">null</span></div>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `<div class="json-line">${keyHtml}<span class="json-brace">[]</span></div>`;
    }
    const children = value.map((v) => jsonToHtml(v, null)).join('');
    return `<details class="json-node" open><summary>${keyHtml}<span class="json-brace">[</span><span class="json-count">${value.length} item${value.length === 1 ? '' : 's'}</span></summary>` +
      `<div class="json-children">${children}</div><div class="json-line json-brace">]</div></details>`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return `<div class="json-line">${keyHtml}<span class="json-brace">{}</span></div>`;
    }
    const children = keys.map((k) => jsonToHtml(value[k], k)).join('');
    return `<details class="json-node" open><summary>${keyHtml}<span class="json-brace">{</span><span class="json-count">${keys.length} key${keys.length === 1 ? '' : 's'}</span></summary>` +
      `<div class="json-children">${children}</div><div class="json-line json-brace">}</div></details>`;
  }

  if (typeof value === 'number') {
    const numStr = String(value);
    const info = classify(numStr);
    const numHtml = info
      ? `<span class="epoch json-number" data-ms="${info.ms}" data-raw="${numStr}" data-label="${info.label}">${numStr}</span>`
      : `<span class="json-number">${numStr}</span>`;
    return `<div class="json-line">${keyHtml}${numHtml}</div>`;
  }

  if (typeof value === 'boolean') {
    return `<div class="json-line">${keyHtml}<span class="json-bool">${value}</span></div>`;
  }

  // string
  return `<div class="json-line">${keyHtml}<span class="json-string">"${annotate(String(value))}"</span></div>`;
}

// --- Tooltip ---
const tooltip = document.createElement('div');
tooltip.id = 'tooltip';
document.body.appendChild(tooltip);

function showTooltip(x, y, label, raw, ms) {
  const d = new Date(ms);
  const rows = [
    [label, raw],
    ['Local', d.toString()],
    ['UTC', d.toUTCString()]
  ];
  for (const z of pinnedZones) {
    rows.push([z.label, `${formatInZone(d, z.id)} (${getOffsetLabel(d, z.id)})`]);
  }
  rows.push(['Relative', formatRelative(ms)]);
  tooltip.innerHTML = rows.map(([tag, val]) => `<div class="row"><span class="tag">${tag}</span><span>${escapeHtml(val)}</span></div>`).join('');
  tooltip.style.display = 'block';
  const offset = 14;
  tooltip.style.left = (x + offset) + 'px';
  tooltip.style.top = (y + offset) + 'px';
  requestAnimationFrame(() => {
    const rect = tooltip.getBoundingClientRect();
    let left = x + offset, top = y + offset;
    if (rect.right > window.innerWidth) left = window.innerWidth - rect.width - 8;
    if (rect.bottom > window.innerHeight) top = y - rect.height - offset;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  });
}

function hideTooltip() {
  tooltip.style.display = 'none';
}

function wireHover(container) {
  container.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.epoch');
    if (!target) return;
    showTooltip(e.clientX, e.clientY, target.dataset.label, target.dataset.raw, Number(target.dataset.ms));
  });
  container.addEventListener('mousemove', (e) => {
    if (tooltip.style.display !== 'block') return;
    if (!e.target.closest('.epoch')) return;
    const offset = 14;
    tooltip.style.left = (e.clientX + offset) + 'px';
    tooltip.style.top = (e.clientY + offset) + 'px';
  });
  container.addEventListener('mouseout', (e) => {
    if (e.target.closest('.epoch')) hideTooltip();
  });
}

// --- Tabs (Network / Paste) ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
  });
});

// --- Paste tab ---
const pasteInput = document.getElementById('pasteInput');
const pasteViewer = document.getElementById('pasteViewer');
wireHover(pasteViewer);

pasteInput.addEventListener('input', () => {
  const text = pasteInput.value;
  if (!text.trim()) {
    pasteViewer.innerHTML = '';
    return;
  }
  let display = text;
  try {
    display = JSON.stringify(JSON.parse(text), null, 2);
  } catch (e) {
    // not JSON, show as-is
  }
  pasteViewer.innerHTML = annotate(display);
});

// --- Network tab ---
const requestList = document.getElementById('requestList');
const detailPane = document.getElementById('detailPane');
const splitter = document.getElementById('splitter');
const search = document.getElementById('search');
const typeFilter = document.getElementById('typeFilter');
const preserveLog = document.getElementById('preserveLog');
const clearBtn = document.getElementById('clearBtn');

let requests = [];
let nextId = 1;
let selectedId = null;
let sortKey = null;
let sortDir = 1;
const MAX_REQUESTS = 300;

// --- Detail pane resize + hide, persisted across sessions ---
function loadPaneState() {
  try {
    const width = localStorage.getItem('epochDetailWidth');
    if (width) detailPane.style.width = width + 'px';
  } catch (e) { /* localStorage unavailable */ }
}
loadPaneState();

(function wireSplitter() {
  let dragging = false;
  splitter.addEventListener('mousedown', (e) => {
    dragging = true;
    splitter.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = document.querySelector('.split').getBoundingClientRect();
    let newWidth = rect.right - e.clientX;
    newWidth = Math.max(240, Math.min(rect.width - 200, newWidth));
    detailPane.style.width = newWidth + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    try { localStorage.setItem('epochDetailWidth', parseInt(detailPane.style.width, 10)); } catch (e) { /* ignore */ }
  });
})();

function openDetailPane() {
  detailPane.style.display = 'flex';
  splitter.style.display = '';
}

function closeDetailPane() {
  detailPane.style.display = 'none';
  splitter.style.display = 'none';
}

function getFiltered() {
  const filterText = search.value.trim().toLowerCase();
  const type = typeFilter.value;
  let list = requests;
  if (filterText) list = list.filter((r) => r.url.toLowerCase().includes(filterText));
  if (type) list = list.filter((r) => r.type === type);
  if (sortKey) {
    list = [...list].sort((a, b) => (a[sortKey] - b[sortKey]) * sortDir);
  }
  return list;
}

function renderList() {
  const filtered = getFiltered();

  document.querySelectorAll('.table-header .sortable').forEach((el) => {
    el.classList.toggle('active-sort', el.dataset.sort === sortKey);
  });

  if (filtered.length === 0) {
    requestList.innerHTML = '<div class="empty-hint">No requests captured yet. Reload the page or trigger a request.</div>';
    return;
  }

  requestList.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const r of filtered) {
    const item = document.createElement('div');
    item.className = 'req-item' + (r.id === selectedId ? ' selected' : '');
    item.innerHTML = `
      <span class="cell col-name" title="${escapeHtml(r.url)}">${escapeHtml(r.name)}</span>
      <span class="cell col-method">${escapeHtml(r.method)}</span>
      <span class="cell col-status ${r.status >= 500 ? 'status-5' : r.status >= 400 ? 'status-4' : ''}">${r.status}</span>
      <span class="cell col-type">${r.type}</span>
      <span class="cell col-size">${formatSize(r.size)}</span>
      <span class="cell col-time">${formatTime(r.time)}</span>
    `;
    item.addEventListener('click', () => {
      selectedId = r.id;
      renderList();
      openDetailPane();
      renderDetail(r);
    });
    frag.appendChild(item);
  }
  requestList.appendChild(frag);
}

function getResponseText(entry, limit) {
  let display = entry.body || '';
  if (display.length > limit) {
    display = display.slice(0, limit) + '\n\n… (truncated, response too large)';
  } else if (entry.mimeType && entry.mimeType.includes('json')) {
    try { display = JSON.stringify(JSON.parse(display), null, 2); } catch (e) { /* leave as-is */ }
  }
  return display;
}

function renderDetail(entry) {
  detailPane.innerHTML = `
    <div class="detail-tabs">
      <button class="dtab active" data-dtab="headers">Headers</button>
      <button class="dtab" data-dtab="preview">Preview</button>
      <button class="dtab" data-dtab="response">Response</button>
      <button class="dtab" data-dtab="payload">Payload</button>
      <button class="dtab" data-dtab="timing">Timing</button>
      <button class="detail-close" id="detailClose" title="Hide details panel">✕</button>
    </div>
    <div class="detail-body" id="detailBody"></div>
  `;
  const body = detailPane.querySelector('#detailBody');
  wireHover(body);

  detailPane.querySelector('#detailClose').addEventListener('click', closeDetailPane);

  function showHeaders() {
    const reqRows = (entry.reqHeaders || []).map((h) =>
      `<div class="hrow"><span class="hname">${escapeHtml(h.name)}</span><span class="hval">${annotate(h.value)}</span></div>`
    ).join('') || '<div class="hempty">None</div>';
    const resRows = (entry.resHeaders || []).map((h) =>
      `<div class="hrow"><span class="hname">${escapeHtml(h.name)}</span><span class="hval">${annotate(h.value)}</span></div>`
    ).join('') || '<div class="hempty">None</div>';
    body.innerHTML = `
      <details class="hsection" open><summary>General</summary>
        <div class="hrow"><span class="hname">Request URL</span><span class="hval">${annotate(entry.url)}</span></div>
        <div class="hrow"><span class="hname">Method</span><span class="hval">${escapeHtml(entry.method)}</span></div>
        <div class="hrow"><span class="hname">Status</span><span class="hval">${entry.status} ${escapeHtml(entry.statusText || '')}</span></div>
      </details>
      <details class="hsection" open><summary>Response Headers</summary>${resRows}</details>
      <details class="hsection" open><summary>Request Headers</summary>${reqRows}</details>
    `;
  }

  function showPreview() {
    let obj = null;
    try { obj = JSON.parse(entry.body); } catch (e) { /* not JSON */ }
    if (obj === null) {
      body.innerHTML = '<div class="hempty">Response is not valid JSON — see the Response tab.</div>';
      return;
    }
    body.innerHTML = `<div class="json-tree">${jsonToHtml(obj, null)}</div>`;
  }

  function showResponse() {
    body.innerHTML = `<pre class="body-pre">${annotate(getResponseText(entry, 300000))}</pre>`;
  }

  function showPayload() {
    let html = '';
    try {
      const u = new URL(entry.url);
      const params = [...u.searchParams.entries()];
      if (params.length) {
        const rows = params.map(([k, v]) =>
          `<div class="hrow"><span class="hname">${escapeHtml(k)}</span><span class="hval">${annotate(v)}</span></div>`
        ).join('');
        html += `<details class="hsection" open><summary>Query String Parameters</summary>${rows}</details>`;
      }
    } catch (e) { /* invalid URL, skip */ }

    const postData = entry.postData;
    if (postData && (postData.text || (postData.params && postData.params.length))) {
      if (postData.params && postData.params.length) {
        const rows = postData.params.map((p) =>
          `<div class="hrow"><span class="hname">${escapeHtml(p.name)}</span><span class="hval">${annotate(p.value || '')}</span></div>`
        ).join('');
        html += `<details class="hsection" open><summary>Form Data</summary>${rows}</details>`;
      } else {
        let payloadText = postData.text;
        if (postData.mimeType && postData.mimeType.includes('json')) {
          try { payloadText = JSON.stringify(JSON.parse(payloadText), null, 2); } catch (e) { /* leave as-is */ }
        }
        html += `<details class="hsection" open><summary>Request Payload</summary><pre class="body-pre">${annotate(payloadText)}</pre></details>`;
      }
    }

    if (!html) html = '<div class="hempty">No query string parameters or request payload.</div>';
    body.innerHTML = html;
  }

  function showTiming() {
    const t = entry.timings || {};
    const phases = ['blocked', 'dns', 'ssl', 'connect', 'send', 'wait', 'receive'];
    const rows = phases.map((k) => {
      const v = t[k];
      return `<div class="hrow"><span class="hname">${k}</span><span class="hval">${v != null && v >= 0 ? v.toFixed(2) + ' ms' : '–'}</span></div>`;
    }).join('');
    body.innerHTML = `<details class="hsection" open><summary>Timing</summary>${rows}<div class="hrow"><span class="hname">Total</span><span class="hval">${formatTime(entry.time)}</span></div></details>`;
  }

  const showers = { headers: showHeaders, preview: showPreview, response: showResponse, payload: showPayload, timing: showTiming };

  detailPane.querySelectorAll('.dtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      detailPane.querySelectorAll('.dtab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      showers[btn.dataset.dtab]();
    });
  });

  showHeaders();
}

document.querySelectorAll('.table-header .sortable').forEach((el) => {
  el.addEventListener('click', () => {
    const key = el.dataset.sort;
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = 1; }
    renderList();
  });
});

if (window.chrome && chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    const mimeType = (request.response.content && request.response.content.mimeType) || '';
    request.getContent((content) => {
      if (content == null) return;
      let size = request.response.content && request.response.content.size;
      if (size == null || size < 0) {
        try { size = new Blob([content]).size; } catch (e) { size = content.length; }
      }
      const entry = {
        id: nextId++,
        method: request.request.method,
        url: request.request.url,
        name: nameFromUrl(request.request.url),
        status: request.response.status,
        statusText: request.response.statusText,
        mimeType,
        type: typeLabel(mimeType),
        body: content,
        size,
        time: request.time,
        reqHeaders: request.request.headers,
        resHeaders: request.response.headers,
        timings: request.timings,
        postData: request.request.postData
      };
      requests.unshift(entry);
      if (requests.length > MAX_REQUESTS) requests.pop();
      renderList();
    });
  });

  if (chrome.devtools.network.onNavigated) {
    chrome.devtools.network.onNavigated.addListener(() => {
      if (preserveLog.checked) return;
      requests = [];
      selectedId = null;
      detailPane.innerHTML = '<div class="detail-empty">Select a request to see its details.</div>';
      renderList();
    });
  }
}

search.addEventListener('input', renderList);
typeFilter.addEventListener('change', renderList);
clearBtn.addEventListener('click', () => {
  requests = [];
  selectedId = null;
  detailPane.innerHTML = '<div class="detail-empty">Select a request to see its details.</div>';
  renderList();
});

renderList();
