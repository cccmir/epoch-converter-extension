// Detects Unix timestamps under the mouse cursor anywhere on the page and
// shows a small tooltip with the converted date.
(function () {
  let enabled = true;
  let pinnedZones = []; // [{ id, label }], configured from the popup

  if (window.chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ hoverEnabled: true, pinnedTimezones: [] }, (data) => {
      enabled = data.hoverEnabled;
      pinnedZones = data.pinnedTimezones || [];
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.hoverEnabled) enabled = changes.hoverEnabled.newValue;
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

  // Plausible epoch ranges: roughly year 2001 - 2100.
  const SEC_MIN = 9e8;
  const SEC_MAX = 4.1e9;
  const MS_MIN = SEC_MIN * 1000;
  const MS_MAX = SEC_MAX * 1000;

  let tooltipHost = null;
  let shadow = null;
  let lastValue = null;

  function ensureTooltip() {
    if (tooltipHost) return;
    tooltipHost = document.createElement('div');
    tooltipHost.style.cssText =
      'all:initial; position:fixed; z-index:2147483647; pointer-events:none; display:none;';
    document.documentElement.appendChild(tooltipHost);
    shadow = tooltipHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .tip {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        background: #1d1d1f;
        color: #fff;
        padding: 7px 10px;
        border-radius: 7px;
        box-shadow: 0 3px 12px rgba(0,0,0,0.3);
        line-height: 1.55;
        white-space: nowrap;
      }
      .row { display: flex; gap: 8px; }
      .tag { color: #9aa0a6; min-width: 62px; }
    `;
    shadow.appendChild(style);
    const box = document.createElement('div');
    box.className = 'tip';
    box.id = 'box';
    shadow.appendChild(box);
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
      if (abs >= secs || name === 'second') {
        return rtf.format(Math.round(diffSec / secs), name);
      }
    }
    return '';
  }

  function showTooltip(x, y, epochLabel, epochValue, ms) {
    ensureTooltip();
    const d = new Date(ms);
    const box = shadow.getElementById('box');
    const rows = [
      [epochLabel, epochValue],
      ['Local', d.toString()],
      ['UTC', d.toUTCString()]
    ];
    for (const z of pinnedZones) {
      rows.push([z.label, `${formatInZone(d, z.id)} (${getOffsetLabel(d, z.id)})`]);
    }
    rows.push(['Relative', formatRelative(ms)]);
    box.innerHTML = rows
      .map(([tag, val]) => `<div class="row"><span class="tag">${tag}</span><span>${escapeHtml(val)}</span></div>`)
      .join('');

    const offset = 14;
    tooltipHost.style.display = 'block';
    tooltipHost.style.left = (x + offset) + 'px';
    tooltipHost.style.top = (y + offset) + 'px';

    requestAnimationFrame(() => {
      const rect = tooltipHost.getBoundingClientRect();
      let left = x + offset;
      let top = y + offset;
      if (rect.right > window.innerWidth) left = window.innerWidth - rect.width - 8;
      if (rect.bottom > window.innerHeight) top = y - rect.height - offset;
      tooltipHost.style.left = left + 'px';
      tooltipHost.style.top = top + 'px';
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function hideTooltip() {
    if (tooltipHost) tooltipHost.style.display = 'none';
    lastValue = null;
  }

  function isDigit(c) { return c >= '0' && c <= '9'; }

  function getDigitRunAtOffset(text, offset) {
    let start = offset;
    let end = offset;
    while (start > 0 && isDigit(text[start - 1])) start--;
    while (end < text.length && isDigit(text[end])) end++;
    if (start === end) return null;
    // Reject if immediately preceded/followed by a decimal point + more digits
    // forming a longer non-integer token (e.g. version numbers, IPs) —
    // still fine for our purposes since we just read the contiguous digits.
    return { value: text.slice(start, end), start, end };
  }

  function classify(numStr) {
    const len = numStr.length;
    const value = Number(numStr);
    if (len === 10 && value >= SEC_MIN && value <= SEC_MAX) {
      return { label: 'Epoch (s)', ms: value * 1000 };
    }
    if (len === 13 && value >= MS_MIN && value <= MS_MAX) {
      return { label: 'Epoch (ms)', ms: value };
    }
    return null;
  }

  function shouldSkip(target) {
    if (!target || !target.tagName) return true;
    if (['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE'].includes(target.tagName)) return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function getRangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos || !pos.offsetNode) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      return range;
    }
    return null;
  }

  let scheduled = false;
  let lastEvent = null;

  document.addEventListener('mousemove', (e) => {
    lastEvent = e;
    if (!enabled) {
      hideTooltip();
      return;
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      handleMove(lastEvent);
    });
  }, { passive: true });

  function handleMove(e) {
    if (!e || shouldSkip(e.target)) {
      hideTooltip();
      return;
    }
    const range = getRangeFromPoint(e.clientX, e.clientY);
    if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
      hideTooltip();
      return;
    }
    const text = range.startContainer.textContent;
    const found = getDigitRunAtOffset(text, range.startOffset);
    if (!found) {
      hideTooltip();
      return;
    }
    const info = classify(found.value);
    if (!info) {
      hideTooltip();
      return;
    }
    if (lastValue === found.value && tooltipHost && tooltipHost.style.display === 'block') {
      tooltipHost.style.left = (e.clientX + 14) + 'px';
      tooltipHost.style.top = (e.clientY + 14) + 'px';
      return;
    }
    lastValue = found.value;
    showTooltip(e.clientX, e.clientY, info.label, found.value, info.ms);
  }

  document.addEventListener('mouseleave', hideTooltip);
  window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
  window.addEventListener('blur', hideTooltip);
})();
