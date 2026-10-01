// --- Live current timestamp ---
const currentEpochEl = document.getElementById('currentEpoch');
const currentHumanEl = document.getElementById('currentHuman');

function tick() {
  const now = new Date();
  const seconds = Math.floor(now.getTime() / 1000);
  currentEpochEl.textContent = seconds.toString();
  currentHumanEl.textContent = now.toString();
}
tick();
setInterval(tick, 1000);

// --- Timestamp -> Human date ---
const epochInput = document.getElementById('epochInput');
const epochUnit = document.getElementById('epochUnit');
const resultLocal = document.getElementById('resultLocal');
const resultUtc = document.getElementById('resultUtc');
const resultIso = document.getElementById('resultIso');
const resultRelative = document.getElementById('resultRelative');
const pinnedZoneRowsEl = document.getElementById('pinnedZoneRows');
const adhocZoneSearch1 = document.getElementById('adhocZoneSearch1');
const adhocZoneRow1 = document.getElementById('adhocZoneRow1');
let adhocZone1 = null;

function renderPinnedRows(container, ms) {
  if (!pinnedZones.length) { container.innerHTML = ''; return; }
  const date = new Date(ms);
  container.innerHTML = pinnedZones.map((z) =>
    `<div class="result-line"><span class="tag">${escapeHtml(z.label)}</span><span>${formatInZone(date, z.id)} <span class="offset-badge">${getOffsetLabel(date, z.id)}</span></span></div>`
  ).join('');
}

function renderAdhocRow(ms) {
  if (!adhocZone1) { adhocZoneRow1.innerHTML = ''; return; }
  const date = new Date(ms);
  adhocZoneRow1.innerHTML = `<div class="result-line"><span class="tag">${escapeHtml(zoneLabelFromId(adhocZone1))}</span><span>${formatInZone(date, adhocZone1)} <span class="offset-badge">${getOffsetLabel(date, adhocZone1)}</span></span></div>`;
}

adhocZoneSearch1.addEventListener('input', () => {
  const val = adhocZoneSearch1.value.trim();
  adhocZone1 = allZonesSet.has(val) ? val : null;
  updateEpochToDate();
});

function detectUnit(numStr) {
  const digits = numStr.replace('-', '').length;
  if (digits <= 10) return 's';
  if (digits <= 13) return 'ms';
  if (digits <= 16) return 'us';
  return 'ns';
}

function toMillis(value, unit) {
  switch (unit) {
    case 's': return value * 1000;
    case 'ms': return value;
    case 'us': return value / 1000;
    case 'ns': return value / 1e6;
    default: return value * 1000;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// --- Timezones ---
const CURATED_ZONES = [
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Denver', label: 'Denver' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Sao_Paulo', label: 'São Paulo' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Paris', label: 'Paris' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Europe/Moscow', label: 'Moscow' },
  { id: 'Africa/Cairo', label: 'Cairo' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Kolkata', label: 'India' },
  { id: 'Asia/Shanghai', label: 'Shanghai' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' }
];

const allZones = (typeof Intl.supportedValuesOf === 'function') ? Intl.supportedValuesOf('timeZone') : [];
const allZonesSet = new Set(allZones);

function zoneLabelFromId(id) {
  const curated = CURATED_ZONES.find((z) => z.id === id);
  if (curated) return curated.label;
  const last = id.split('/').pop() || id;
  return last.replace(/_/g, ' ');
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

function getTzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return asUTC - date.getTime();
}

// Converts a wall-clock date/time in an arbitrary IANA zone to a UTC epoch,
// using Intl to read that zone's actual (DST-aware) offset and converging
// on it iteratively — no timezone database/library needed.
function zonedTimeToUtcMs(y, mo, d, h, mi, se, timeZone) {
  let guess = Date.UTC(y, mo - 1, d, h, mi, se);
  for (let i = 0; i < 2; i++) {
    const offset = getTzOffsetMs(new Date(guess), timeZone);
    guess = Date.UTC(y, mo - 1, d, h, mi, se) - offset;
  }
  return guess;
}

let pinnedZones = []; // [{ id, label }]

function loadPinned(cb) {
  if (!(window.chrome && chrome.storage && chrome.storage.sync)) { cb && cb(); return; }
  chrome.storage.sync.get({ pinnedTimezones: [] }, (data) => {
    pinnedZones = data.pinnedTimezones || [];
    cb && cb();
  });
}

function savePinned() {
  if (window.chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.set({ pinnedTimezones: pinnedZones });
  }
}

const curatedZonesEl = document.getElementById('curatedZones');
const pinnedListEl = document.getElementById('pinnedList');
const zoneSearch = document.getElementById('zoneSearch');
const zoneSearchAdd = document.getElementById('zoneSearchAdd');
const allZonesList = document.getElementById('allZonesList');

allZonesList.innerHTML = allZones.map((z) => `<option value="${z}"></option>`).join('');

function renderZoneUI() {
  curatedZonesEl.innerHTML = CURATED_ZONES.map((z) => {
    const isPinned = pinnedZones.some((p) => p.id === z.id);
    const disabled = (!isPinned && pinnedZones.length >= 3) ? 'disabled' : '';
    return `<button class="zone-chip${isPinned ? ' pinned' : ''}" data-id="${z.id}" data-label="${z.label}" ${disabled}>${z.label}</button>`;
  }).join('');

  pinnedListEl.innerHTML = pinnedZones.length
    ? pinnedZones.map((z) => `<span class="pinned-chip">${escapeHtml(z.label)}<button class="remove-zone" data-id="${z.id}" title="Unpin">✕</button></span>`).join('')
    : '<span class="hint">No pinned zones yet — pick one above.</span>';

  renderDateTzOptions();
  updateEpochToDate();
  updateDateToEpoch();
}

curatedZonesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.zone-chip');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.id;
  if (pinnedZones.some((p) => p.id === id) || pinnedZones.length >= 3) return;
  pinnedZones.push({ id, label: btn.dataset.label });
  savePinned();
  renderZoneUI();
});

pinnedListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.remove-zone');
  if (!btn) return;
  pinnedZones = pinnedZones.filter((p) => p.id !== btn.dataset.id);
  savePinned();
  renderZoneUI();
});

zoneSearchAdd.addEventListener('click', () => {
  const id = zoneSearch.value.trim();
  if (!id || !allZonesSet.has(id) || pinnedZones.length >= 3 || pinnedZones.some((p) => p.id === id)) return;
  pinnedZones.push({ id, label: zoneLabelFromId(id) });
  savePinned();
  zoneSearch.value = '';
  renderZoneUI();
});

if (window.chrome && chrome.storage && chrome.storage.sync) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.pinnedTimezones) {
      pinnedZones = changes.pinnedTimezones.newValue || [];
      renderZoneUI();
    }
  });
}

function formatRelative(ms) {
  const diffMs = ms - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  const units = [
    ['year', 31536000], ['month', 2592000], ['day', 86400],
    ['hour', 3600], ['minute', 60], ['second', 1]
  ];
  for (const [name, secs] of units) {
    if (abs >= secs || name === 'second') {
      const val = Math.round(diffSec / secs);
      const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
      return rtf.format(val, name);
    }
  }
  return '';
}

function clearEpochToDateResult(message) {
  resultLocal.textContent = message || '–';
  resultUtc.textContent = '–';
  resultIso.textContent = '–';
  resultRelative.textContent = '–';
  pinnedZoneRowsEl.innerHTML = '';
  adhocZoneRow1.innerHTML = '';
}

function updateEpochToDate() {
  const raw = epochInput.value.trim();
  if (!raw) { clearEpochToDateResult('–'); return; }
  if (!/^-?\d+$/.test(raw)) { clearEpochToDateResult('Invalid number'); return; }
  const value = parseInt(raw, 10);
  const unit = epochUnit.value === 'auto' ? detectUnit(raw) : epochUnit.value;
  const ms = toMillis(value, unit);
  const date = new Date(ms);
  if (isNaN(date.getTime())) { clearEpochToDateResult('Out of range'); return; }
  resultLocal.textContent = date.toString();
  resultUtc.textContent = date.toUTCString();
  resultIso.textContent = date.toISOString();
  resultRelative.textContent = formatRelative(ms);
  renderPinnedRows(pinnedZoneRowsEl, ms);
  renderAdhocRow(ms);
}

epochInput.addEventListener('input', updateEpochToDate);
epochUnit.addEventListener('change', updateEpochToDate);

// --- Human date -> Timestamp ---
const dateInput = document.getElementById('dateInput');
const dateTz = document.getElementById('dateTz');
const dateTzCustomRow = document.getElementById('dateTzCustomRow');
const dateTzCustomInput = document.getElementById('dateTzCustomInput');
const resultSeconds = document.getElementById('resultSeconds');
const resultMs = document.getElementById('resultMs');
const useNowBtn = document.getElementById('useNowBtn');

function renderDateTzOptions() {
  const current = dateTz.value;
  dateTz.innerHTML = '';
  const opts = [
    { value: 'local', text: 'Local time' },
    { value: 'utc', text: 'UTC' },
    ...pinnedZones.map((z) => ({ value: 'tz:' + z.id, text: z.label })),
    { value: 'custom', text: 'More zones…' }
  ];
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.value;
    el.textContent = o.text;
    dateTz.appendChild(el);
  }
  if ([...dateTz.options].some((o) => o.value === current)) dateTz.value = current;
  dateTzCustomRow.style.display = dateTz.value === 'custom' ? '' : 'none';
}

dateTz.addEventListener('change', () => {
  dateTzCustomRow.style.display = dateTz.value === 'custom' ? '' : 'none';
  updateDateToEpoch();
});
dateTzCustomInput.addEventListener('input', updateDateToEpoch);

function pad(n) { return n.toString().padStart(2, '0'); }

function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

useNowBtn.addEventListener('click', () => {
  dateInput.value = toLocalInputValue(new Date());
  updateDateToEpoch();
});

function updateDateToEpoch() {
  const raw = dateInput.value;
  if (!raw) {
    resultSeconds.textContent = '–';
    resultMs.textContent = '–';
    return;
  }
  const [datePart, timePart] = raw.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, se] = (timePart || '00:00:00').split(':').map(Number);

  const mode = dateTz.value;
  let ms;
  if (mode === 'utc') {
    ms = Date.UTC(y, mo - 1, d, h, mi, se || 0);
  } else if (mode === 'local') {
    ms = new Date(y, mo - 1, d, h, mi, se || 0).getTime();
  } else if (mode.startsWith('tz:')) {
    ms = zonedTimeToUtcMs(y, mo, d, h, mi, se || 0, mode.slice(3));
  } else if (mode === 'custom') {
    const tz = dateTzCustomInput.value.trim();
    if (!allZonesSet.has(tz)) {
      resultSeconds.textContent = 'Pick a valid zone';
      resultMs.textContent = '–';
      return;
    }
    ms = zonedTimeToUtcMs(y, mo, d, h, mi, se || 0, tz);
  }
  resultSeconds.textContent = Math.floor(ms / 1000).toString();
  resultMs.textContent = ms.toString();
}

dateInput.addEventListener('input', updateDateToEpoch);
dateTz.addEventListener('change', updateDateToEpoch);

// --- On-page hover toggle ---
const hoverToggle = document.getElementById('hoverToggle');

if (window.chrome && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get({ hoverEnabled: true }, (data) => {
    hoverToggle.checked = data.hoverEnabled;
  });
  hoverToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ hoverEnabled: hoverToggle.checked });
  });
}

// --- Copy to clipboard ---
const toast = document.getElementById('toast');
let toastTimer;

document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const targetId = btn.getAttribute('data-copy-target');
    const text = document.getElementById(targetId).textContent;
    if (!text || text === '–') return;
    try {
      await navigator.clipboard.writeText(text);
      toast.textContent = `Copied "${text}"`;
    } catch (e) {
      toast.textContent = 'Copy failed';
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.textContent = ''; }, 1500);
  });
});

// --- Init ---
loadPinned(renderZoneUI);
