// PASIEKA - SILNIK APLIKACJI Z DWUKIERUNKOWĄ SYNCHRONIZACJĄ (OFFLINE-FIRST)

const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbzPnyxsCd1qtle4cQWaH7b4xVmm7fTic2Cd0A2N4hdMQxlKKDbICO51-rblndVwrFEvGQ/exec
; 
let lastActiveGroupTab = 'tab-dom';

let state = {
  inspections: [],
  feedings: [],
  treatments: [],
  izos: [],
  syncPendingCount: 0,
  isSyncing: false
};

let sortState = {
  inspections: { col: 'timestamp', asc: false },
  feedings: { col: 'timestamp', asc: false },
  treatments: { col: 'timestamp', asc: false },
  izos: { col: 'timestamp', asc: false }
};

const TYPES = ['inspection', 'feeding', 'treatment', 'izo'];

function getWebhookUrl() {
  try {
    const custom = localStorage.getItem('gsheet_webhook');
    return (custom && custom.trim() !== '') ? custom.trim() : DEFAULT_WEBHOOK;
  } catch (e) {
    return DEFAULT_WEBHOOK;
  }
}

function isDateString(val) {
  if (val === null || val === undefined || val === '') return false;
  if (val instanceof Date) return true;
  const s = String(val).trim();
  if (/^\d{1,3}$/.test(s)) {
    const num = Number(s);
    if (num >= 1 && num <= 100) return false;
  }
  if (/\d{4}[-/.]\d{1,2}/.test(s) || /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(s) || s.includes('T') || s.includes('GMT')) {
    return true;
  }
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function isHiveNum(val) {
  if (val === null || val === undefined || val === '') return false;
  const s = String(val).trim();
  const n = parseInt(s);
  return !isNaN(n) && n >= 1 && n <= 100 && !s.includes('-') && !s.includes(':') && !s.includes('T') && !s.includes('GMT') && !s.includes('.');
}

function formatToPLDate(val) {
  if (!val) return '';
  let str = String(val).trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const parts = str.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  let d = new Date(str);
  if (isNaN(d.getTime())) return str;
  let dd = String(d.getDate()).padStart(2, '0');
  let mm = String(d.getMonth() + 1).padStart(2, '0');
  let yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatForDateInput(val) {
  if (!val) return '';
  let str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    let parts = str.split('.');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  let d = new Date(str);
  if (isNaN(d.getTime())) return '';
  let dd = String(d.getDate()).padStart(2, '0');
  let mm = String(d.getMonth() + 1).padStart(2, '0');
  let yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeRecord(type, row) {
  if (!row || typeof row !== 'object') return null;
  let id = row.id ? String(row.id).trim() : '';
  if (!id) return null;

  let rawHive = row.hiveNum;
  let rawTime = row.timestamp;
  let hiveNum = null;
  let timestampStr = null;

  if (isDateString(rawHive) && isHiveNum(rawTime)) {
    hiveNum = parseInt(rawTime);
    timestampStr = rawHive;
  } else if (isHiveNum(rawHive) && isDateString(rawTime)) {
    hiveNum = parseInt(rawHive);
    timestampStr = rawTime;
  } else if (isHiveNum(rawHive)) {
    hiveNum = parseInt(rawHive);
    timestampStr = rawTime;
  } else if (isHiveNum(rawTime)) {
    hiveNum = parseInt(rawTime);
    timestampStr = rawHive;
  } else {
    let matchH = String(rawHive).match(/\d+/);
    let matchT = String(rawTime).match(/\d+/);
    if (matchH && parseInt(matchH[0]) <= 100) {
      hiveNum = parseInt(matchH[0]);
      timestampStr = rawTime;
    } else if (matchT && parseInt(matchT[0]) <= 100) {
      hiveNum = parseInt(matchT[0]);
      timestampStr = rawHive;
    }
  }

  if (!hiveNum || isNaN(hiveNum) || hiveNum < 1 || hiveNum > 100) return null;
  let d = new Date(timestampStr);
  let finalTimestamp = (!isNaN(d.getTime())) ? d.toISOString() : new Date().toISOString();

  let normalized = {
    id: id,
    hiveNum: String(hiveNum),
    timestamp: finalTimestamp,
    updatedAt: row.updatedAt ? String(row.updatedAt) : Date.now().toString(),
    syncStatus: 'synced'
  };

  if (type === 'inspection') {
    normalized.rodzina = row.rodzina || '';
    normalized.matka = row.matka || '';
    normalized.jaja = row.jaja || '';
    normalized.ramkiCzerwiu = row.ramkiCzerwiu || '0';
    normalized.pokarm = row.pokarm || '';
    normalized.polkorpus = row.polkorpus || '0';
    normalized.dzialania = row.dzialania || '';
    normalized.przyszleDzialania = row.przyszleDzialania || '';
  } else if (type === 'feeding') {
    let kg = row.kgCukru;
    let uw = row.uwagi;
    if (isNaN(parseFloat(kg)) && !isNaN(parseFloat(uw))) {
      kg = uw;
      uw = row.updatedAt || '';
    }
    normalized.kgCukru = String(kg || '0');
    normalized.uwagi = String(uw || '');
  } else if (type === 'treatment') {
    normalized.preparat = row.preparat || '';
    normalized.uwagi = row.uwagi || '';
  } else if (type === 'izo') {
    let izoTypeVal = row.izoType || 'IZO-pocz';
    let rNum = row.ramka;
    if (isNaN(parseInt(rNum))) rNum = '1';
    normalized.izoType = String(izoTypeVal);
    normalized.ramka = String(rNum);
    normalized.kiedyLeczyc = formatToPLDate(row.kiedyLeczyc);
  }
  return normalized;
}

const DB_NAME = 'PasiekaDB';
const DB_VERSION = 1;
let db = null;

// Bezpiecznik 1.2s dla przeglądarki Brave (Tarcze potrafią zawiesić IndexedDB)
function initDB() {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    const timer = setTimeout(() => {
      console.warn("Przekroczono czas oczekiwania na IndexedDB (Brave Shields). Używam LocalStorage.");
      finish(null);
    }, 1200);

    try {
      if (!window.indexedDB) {
        clearTimeout(timer);
        finish(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => { clearTimeout(timer); finish(null); };
      request.onblocked = () => { clearTimeout(timer); finish(null); };
      request.onsuccess = (e) => {
        clearTimeout(timer);
        db = e.target.result;
        finish(db);
      };
      request.onupgradeneeded = (e) => {
        const dbInstance = e.target.result;
        TYPES.forEach(t => {
          const storeName = t + 's';
          if (!dbInstance.objectStoreNames.contains(storeName)) {
            dbInstance.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };
    } catch (err) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

async function getLocalRecords(type) {
  const storeName = type + 's';
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => {
          const res = req.result || [];
          if (res.length > 0) {
            saveAllToFallback(storeName, res);
            resolve(res);
          } else {
            resolve(getFallbackLocalStorage(storeName));
          }
        };
        req.onerror = () => resolve(getFallbackLocalStorage(storeName));
      } catch (e) { resolve(getFallbackLocalStorage(storeName)); }
    });
  }
  return getFallbackLocalStorage(storeName);
}

async function saveLocalRecord(type, record) {
  const storeName = type + 's';
  saveFallbackLocalStorage(storeName, record);
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) { resolve(true); }
    });
  }
  return true;
}

async function deleteLocalRecordPermanent(type, id) {
  const storeName = type + 's';
  deleteFallbackLocalStorage(storeName, id);
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (e) { resolve(true); }
    });
  }
  return true;
}

function getFallbackLocalStorage(storeName) {
  try { return JSON.parse(localStorage.getItem('pasieka_' + storeName) || '[]'); } catch (e) { return []; }
}
function saveAllToFallback(storeName, items) {
  try { localStorage.setItem('pasieka_' + storeName, JSON.stringify(items)); } catch (e) {}
}
function saveFallbackLocalStorage(storeName, record) {
  try {
    let items = getFallbackLocalStorage(storeName);
    const idx = items.findIndex(i => i.id === record.id);
    if (idx >= 0) items[idx] = record; else items.push(record);
    localStorage.setItem('pasieka_' + storeName, JSON.stringify(items));
  } catch (e) {}
  return true;
}
function deleteFallbackLocalStorage(storeName, id) {
  try {
    let items = getFallbackLocalStorage(storeName).filter(i => i.id !== id);
    localStorage.setItem('pasieka_' + storeName, JSON.stringify(items));
  } catch (e) {}
  return true;
}

// START APLIKACJI - Rysowanie uli przed bazą danych gwarantuje natychmiastowy widok
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initHives();
  initForms();
  initNetworkListeners();

  const syncBtn = document.getElementById('btn-sync-now');
  if (syncBtn) syncBtn.addEventListener('click', () => syncData(true));
  const headerSyncBtn = document.getElementById('btn-header-sync');
  if (headerSyncBtn) headerSyncBtn.addEventListener('click', () => syncData(true));
  
  const btnSaveWebhook = document.getElementById('btn-save-webhook');
  if (btnSaveWebhook) {
    btnSaveWebhook.addEventListener('click', () => {
      const urlInput = document.getElementById('input-webhook-url');
      if (urlInput && urlInput.value) {
        localStorage.setItem('gsheet_webhook', urlInput.value.trim());
        showToast("Zapisano nowy adres Webhooka!", "success");
        syncData(true);
      }
    });
  }

  const inputWebhook = document.getElementById('input-webhook-url');
  if (inputWebhook) inputWebhook.value = getWebhookUrl();

  const izoDateInput = document.getElementById('input-izo-date');
  if (izoDateInput) {
    izoDateInput.addEventListener('change', (e) => updateIzoLeczenieDate(e.target.value));
    izoDateInput.addEventListener('input', (e) => updateIzoLeczenieDate(e.target.value));
  }

  await initDB();
  await loadStateFromLocal();
  syncData(false);
});

async function loadStateFromLocal() {
  for (let t of TYPES) {
    state[t + 's'] = await getLocalRecords(t);
  }
  updatePendingCount();
  renderGlobalTables();
  renderTodos();
  updateHiveCards();
  updateSyncUI();
}

function updatePendingCount() {
  let count = 0;
  TYPES.forEach(t => {
    state[t + 's'].forEach(r => { if (r.syncStatus && r.syncStatus !== 'synced') count++; });
  });
  state.syncPendingCount = count;
}

function initNetworkListeners() {
  window.addEventListener('online', () => {
    updateSyncUI();
    showToast("Połączono z siecią 🟢 Synchronizuję...", "info");
    syncData(false);
  });
  window.addEventListener('offline', () => {
    updateSyncUI();
    showToast("Tryb Offline 🟠 Dane zapisywane w urządzeniu.", "warning");
  });
}

function updateSyncUI() {
  const badge = document.getElementById('sync-status-badge');
  if (!badge) return;
  if (state.isSyncing) {
    badge.className = 'sync-badge syncing';
    badge.innerHTML = '🔄 Synchronizacja...';
  } else if (!navigator.onLine) {
    badge.className = 'sync-badge offline';
    badge.innerHTML = `🟠 Offline ${state.syncPendingCount > 0 ? '(' + state.syncPendingCount + ')' : ''}`;
  } else if (state.syncPendingCount > 0) {
    badge.className = 'sync-badge pending';
    badge.innerHTML = `🟠 Oczekujące (${state.syncPendingCount})`;
  } else {
    badge.className = 'sync-badge synced';
    badge.innerHTML = '🟢 Połączono';
  }
}

async function syncData(userTriggered = false) {
  if (state.isSyncing) return;
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    if (userTriggered) showToast("Brak skonfigurowanego Webhooka w zakładce Arkusz / Ustawienia!", "warning");
    return;
  }
  if (!navigator.onLine) {
    if (userTriggered) showToast("Brak połączenia z siecią. Dane są bezpieczne na urządzeniu.", "warning");
    return;
  }
  state.isSyncing = true;
  updateSyncUI();

  try {
    const changesToUpload = [];
    TYPES.forEach(t => {
      const pluralType = t.endsWith('s') ? t : t + 's';
      state[t + 's'].forEach(r => {
        if (r.syncStatus && r.syncStatus !== 'synced') {
          let timeVal = r.timestamp;
          let hiveVal = String(r.hiveNum);
          if (isDateString(hiveVal) && isHiveNum(timeVal)) {
            const tmp = timeVal;
            timeVal = hiveVal;
            hiveVal = String(tmp);
          }
          changesToUpload.push({
            localType: t,
            type: pluralType,
            deleted: r.syncStatus === 'pending_delete',
            data: { ...r, timestamp: timeVal, hiveNum: hiveVal, syncStatus: undefined }
          });
        }
      });
    });

    if (changesToUpload.length > 0) {
      let batchSuccess = false;
      try {
        const batchResp = await fetch(webhookUrl, {
          method: 'POST',
          body: JSON.stringify({ action: 'batch_upsert', changes: changesToUpload })
        });
        const batchJson = await batchResp.json();
        if (batchJson && (batchJson.status === 'success' || (batchJson.message && batchJson.message.includes('Zaktualizowano')))) {
          batchSuccess = true;
        }
      } catch (errPost) { batchSuccess = false; }

      if (batchSuccess) {
        for (let change of changesToUpload) {
          if (change.deleted) await deleteLocalRecordPermanent(change.localType, change.data.id);
          else {
            const storeName = change.localType + 's';
            const rec = state[storeName].find(r => r.id === change.data.id);
            if (rec) { rec.syncStatus = 'synced'; await saveLocalRecord(change.localType, rec); }
          }
        }
      }
    }

    const response = await fetch(webhookUrl);
    const res = await response.json();
    if (res && typeof res === 'object') {
      for (let t of TYPES) {
        const storeName = t + 's';
        const rawRemoteList = Array.isArray(res[storeName]) ? res[storeName] : (Array.isArray(res[t]) ? res[t] : []);
        const remoteList = rawRemoteList.map(r => normalizeRecord(t, r)).filter(r => r !== null);
        const localList = state[storeName] || [];
        const localMap = new Map(localList.map(item => [item.id, item]));

        for (let remoteItem of remoteList) {
          const localItem = localMap.get(remoteItem.id);
          if (!localItem) {
            remoteItem.syncStatus = 'synced';
            await saveLocalRecord(t, remoteItem);
          } else {
            if (localItem.syncStatus !== 'synced') {
              const localTime = parseInt(localItem.updatedAt || '0');
              const remoteTime = parseInt(remoteItem.updatedAt || '0');
              if (remoteTime > localTime) {
                remoteItem.syncStatus = 'synced';
                await saveLocalRecord(t, remoteItem);
              }
            } else {
              remoteItem.syncStatus = 'synced';
              await saveLocalRecord(t, remoteItem);
            }
          }
        }
      }
      await loadStateFromLocal();
      if (userTriggered) showToast("Synchronizacja ukończona pomyślnie! 🐝", "success");
    }
  } catch (err) {
    console.error("Błąd synchronizacji:", err);
    if (userTriggered) showToast("Błąd połączenia z arkuszem. Sprawdź Tarcze Brave lub URL.", "error");
  } finally {
    state.isSyncing = false;
    updatePendingCount();
    updateSyncUI();
  }
}

function initForms() {
  TYPES.forEach(type => {
    const form = document.getElementById(`${type}-form`);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formEl = e.target;
      const btn = formEl.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      setTimeout(() => { if (btn) btn.disabled = false; }, 1200);

      const isEdit = !!formEl.dataset.editId;
      const recordId = isEdit ? formEl.dataset.editId : 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const nowTime = Date.now().toString();
      const currentHiveNum = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`).value;

      let payload = {
        id: recordId,
        timestamp: document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value,
        hiveNum: currentHiveNum,
        updatedAt: nowTime,
        syncStatus: 'pending_save'
      };

      if (type === 'inspection') {
        payload = { ...payload,
          matka: document.querySelector('input[name="matka"]:checked')?.value || '',
          jaja: document.querySelector('input[name="jaja"]:checked')?.value || '',
          pokarm: document.querySelector('input[name="pokarm"]:checked')?.value || '',
          ramkiCzerwiu: document.getElementById('ramki-czerwiu')?.value || '0',
          rodzina: document.querySelector('input[name="rodzina"]:checked')?.value || '',
          polkorpus: document.querySelector('input[name="polkorpus"]:checked')?.value || '0',
          dzialania: document.getElementById('input-dzialania')?.value || '',
          przyszleDzialania: document.getElementById('input-przyszle-dzialania')?.value || ''
        };
      } else if (type === 'feeding') {
        payload = { ...payload, kgCukru: document.getElementById('input-feeding-kg')?.value || '0', uwagi: document.getElementById('input-feeding-notes')?.value || '' };
      } else if (type === 'treatment') {
        payload = { ...payload, preparat: document.getElementById('input-treatment-preparat')?.value || '', uwagi: document.getElementById('input-treatment-notes')?.value || '' };
      } else if (type === 'izo') {
        payload = { ...payload, 
          izoType: document.querySelector('input[name="izoType"]:checked')?.value || 'IZO-pocz', 
          ramka: document.getElementById('input-izo-ramka')?.value || '1', 
          kiedyLeczyc: formatToPLDate(document.getElementById('input-izo-kiedy-leczyc')?.value) 
        };
      }

      await saveLocalRecord(type, payload);
      await loadStateFromLocal();
      showToast(isEdit ? "Zaktualizowano wpis!" : "Zapisano wpis w pamięci!", "success");
      
      delete formEl.dataset.editId;
      if (btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ');
      
      // Odświeżenie formularza i tabeli historii pod formularzem
      openForm(type, currentHiveNum);
      if (navigator.onLine) syncData(false);
    });
  });
}

async function deleteRecord(id, type) {
  if (!confirm("Na pewno usunąć ten wpis?")) return;
  const storeName = type + 's';
  const item = state[storeName].find(r => r.id === id);
  if (item) {
    const hiveNum = item.hiveNum;
    item.syncStatus = 'pending_delete';
    item.updatedAt = Date.now().toString();
    await saveLocalRecord(type, item);
    await loadStateFromLocal();
    renderLocalHistory(type, hiveNum);
    showToast("Wpis usunięty.", "warning");
    if (navigator.onLine) syncData(false);
  }
}

function editRecord(id, type) {
  const record = state[type + 's'].find(r => r.id === id);
  if (!record) return;
  openForm(type, record.hiveNum);
  const form = document.getElementById(`${type}-form`);
  if (form) form.dataset.editId = id;
  const btn = document.getElementById(`btn-submit-${type}`);
  if (btn) btn.innerHTML = btn.innerHTML.replace('ZAPISZ', 'ZAKTUALIZUJ');

  const d = new Date(record.timestamp);
  if (!isNaN(d.getTime())) {
    const tzOffset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
    const dateInput = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
    if (dateInput) dateInput.value = localISOTime;
  }

  if (type === 'inspection') {
    const m = document.querySelector(`input[name="matka"][value="${record.matka}"]`); if (m) m.checked = true;
    const j = document.querySelector(`input[name="jaja"][value="${record.jaja}"]`); if (j) j.checked = true;
    const p = document.querySelector(`input[name="pokarm"][value="${record.pokarm}"]`); if (p) p.checked = true;
    const rc = document.getElementById('ramki-czerwiu'); if (rc) rc.value = record.ramkiCzerwiu;
    const rodz = document.querySelector(`input[name="rodzina"][value="${record.rodzina}"]`); if (rodz) rodz.checked = true;
    const polk = document.querySelector(`input[name="polkorpus"][value="${record.polkorpus}"]`); if (polk) polk.checked = true;
    const dzial = document.getElementById('input-dzialania'); if (dzial) dzial.value = record.dzialania;
    const przyszl = document.getElementById('input-przyszle-dzialania'); if (przyszl) przyszl.value = record.przyszleDzialania;
  } else if (type === 'feeding') {
    const kg = document.getElementById('input-feeding-kg'); if (kg) kg.value = record.kgCukru;
    const uwagi = document.getElementById('input-feeding-notes'); if (uwagi) uwagi.value = record.uwagi;
  } else if (type === 'treatment') {
    const prep = document.getElementById('input-treatment-preparat'); if (prep) prep.value = record.preparat;
    const uwagi = document.getElementById('input-treatment-notes'); if (uwagi) uwagi.value = record.uwagi;
  } else if (type === 'izo') {
    const izoT = document.querySelector(`input[name="izoType"][value="${record.izoType}"]`); if (izoT) izoT.checked = true;
    const ramka = document.getElementById('input-izo-ramka'); if (ramka) ramka.value = record.ramka;
    const kiedy = document.getElementById('input-izo-kiedy-leczyc'); 
    if (kiedy) kiedy.value = formatForDateInput(record.kiedyLeczyc);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      const tabId = targetBtn.dataset.tab;
      if (['tab-dom', 'tab-zbior', 'tab-las'].includes(tabId)) {
        lastActiveGroupTab = tabId;
      }
      const tabContent = document.getElementById(tabId);
      if (tabContent) tabContent.classList.add('active');
      if (tabId === 'tab-todo') renderTodos();
      if (tabId === 'tab-sheet') renderGlobalTables();
    });
  });
}

function goBackToHives() {
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${lastActiveGroupTab}"]`) || document.querySelector('.tab-btn[data-tab="tab-dom"]');
  if (targetBtn) targetBtn.click();
}

function goToHistory(pluralType) {
  const sheetTabBtn = document.querySelector('.tab-btn[data-tab="tab-sheet"]');
  if (sheetTabBtn && !sheetTabBtn.classList.contains('active')) {
    sheetTabBtn.click();
  }
  const wrapper = document.getElementById(`wrapper-${pluralType}-table`);
  if (wrapper) {
    wrapper.classList.remove('hidden');
    setTimeout(() => {
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}

function saveQueenDesc(hiveNum) {
  const input = document.getElementById(`queen-input-${hiveNum}`);
  if (input) {
    try {
      localStorage.setItem(`pasieka_queen_${hiveNum}`, input.value.trim());
      showToast(`Zapisano opis matki dla Ula ${hiveNum} 👑`, 'success');
    } catch (e) {
      showToast("Błąd zapisu pamięci lokalnej", "error");
    }
  }
}

function initHives() {
  const renderGrid = (start, end, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    let html = '';
    for (let i = start; i <= end; i++) {
      let savedQueen = '';
      try { savedQueen = localStorage.getItem(`pasieka_queen_${i}`) || ''; } catch (e) {}
      html += `
        <div class="hive-card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; border-bottom:2px solid #fde68a; padding-bottom:8px; margin-bottom:8px;">
            <div class="hive-number" style="font-size:2.1rem; font-weight:900; color:#b45309; text-decoration:underline; line-height:1;">Ul ${i}</div>
            <div style="display:flex; flex:1; gap:4px; align-items:center;">
              <input type="text" id="queen-input-${i}" value="${savedQueen.replace(/"/g, '&quot;')}" placeholder="👑 Opis matki..." class="input-control" style="padding:5px 8px; font-size:0.85rem; flex:1;" onchange="saveQueenDesc(${i})">
              <button type="button" class="btn-small" onclick="saveQueenDesc(${i})" title="Zapisz opis matki" style="padding:5px 8px; background:#fef3c7; border:1px solid #f59e0b;">💾</button>
            </div>
          </div>
          <div id="hive-desc-${i}" style="margin: 6px 0; min-height: 4.5rem;">Ładowanie danych...</div>
          <div style="display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap;">
            <button type="button" class="btn-small" style="flex:1; font-weight:bold;" onclick="openForm('inspection', ${i})">📋 Przegląd</button>
            <button type="button" class="btn-small" style="flex:1; font-weight:bold; background:#fef3c7; color:#92400e;" onclick="openForm('feeding', ${i})">🍯 Pokarm</button>
            <button type="button" class="btn-small" style="flex:1; font-weight:bold; background:#fee2e2; color:#991b1b;" onclick="openForm('treatment', ${i})">💉 Lek</button>
            <button type="button" class="btn-small" style="flex:1; font-weight:bold; background:#e0e7ff; color:#3730a3;" onclick="openForm('izo', ${i})">🗃️ IZO</button>
          </div>
        </div>`;
    }
    grid.innerHTML = html;
  };
  renderGrid(1, 6, 'hives-grid-dom');
  renderGrid(7, 12, 'hives-grid-zbior');
  renderGrid(13, 18, 'hives-grid-las');
}

function updateHiveCards() {
  for (let i = 1; i <= 18; i++) {
    let descDiv = document.getElementById(`hive-desc-${i}`);
    if (!descDiv) continue;
    let hiveInspections = state.inspections
      .filter(r => String(r.hiveNum) === String(i) && r.syncStatus !== 'pending_delete')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (hiveInspections.length > 0) {
      let last = hiveInspections[0];
      descDiv.innerHTML = `
        <div class="hive-last-inspection" style="font-size:0.88rem; line-height:1.4;">
          <div style="display:flex; justify-content:space-between; font-weight:bold; color:#374151; margin-bottom:4px;">
            <span>📅 ${fd(last.timestamp)}</span>
            <span style="color:#047857;">${last.rodzina || 'Rodzina OK'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:2px 8px;">
            <div>👑 Matka: <b>${last.matka || '-'}</b></div>
            <div>🥚 Jaja: <b>${last.jaja || '-'}</b></div>
            <div>🪮 Czerw: <b>${last.ramkiCzerwiu || '0'} r.</b></div>
            <div>🍯 Pokarm: <b>${last.pokarm || '-'}</b></div>
            <div>📦 Nadstawki: <b>${last.polkorpus || '0'}</b></div>
          </div>
          ${last.dzialania ? `<div style="margin-top:4px; color:#4b5563;">🛠️ <b>Działania:</b> ${last.dzialania}</div>` : ''}
          ${last.przyszleDzialania && last.przyszleDzialania.trim() !== '0' && last.przyszleDzialania.trim().toLowerCase() !== 'brak' ? `<div style="margin-top:4px; background:#ecfdf5; color:#065f46; padding:3px 6px; border-radius:4px;">📋 <b>Plan:</b> ${last.przyszleDzialania}</div>` : ''}
        </div>
      `;
    } else {
      descDiv.innerHTML = `<span style="color:#9ca3af; font-style:italic; font-size:0.85rem;">Brak historii przeglądów</span>`;
    }
  }
}

function openForm(type, hiveNum) {
  const num = parseInt(hiveNum);
  if (num >= 1 && num <= 6) lastActiveGroupTab = 'tab-dom';
  else if (num >= 7 && num <= 12) lastActiveGroupTab = 'tab-zbior';
  else if (num >= 13 && num <= 18) lastActiveGroupTab = 'tab-las';

  document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
  let tabContent = document.getElementById(`tab-${type}`);
  if (tabContent) tabContent.classList.add('active');

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const nowStr = now.toISOString().slice(0, 16);

  const selectHive = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`);
  if (selectHive) {
    let opts = '';
    for (let i = 1; i <= 18; i++) {
      opts += `<option value="${i}" ${i === num ? 'selected' : ''}>Ul ${i}</option>`;
    }
    selectHive.innerHTML = opts;
    selectHive.onchange = (e) => renderLocalHistory(type, e.target.value);
  }

  const inputDate = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
  if (inputDate) inputDate.value = nowStr;

  if (type === 'izo') updateIzoLeczenieDate(nowStr);

  const form = document.getElementById(`${type}-form`);
  if (form) delete form.dataset.editId;
  const btn = document.getElementById(`btn-submit-${type}`);
  if (btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ');

  renderLocalHistory(type, hiveNum);
}

function updateIzoLeczenieDate(sourceDateStr) {
  if (!sourceDateStr) return;
  let d = new Date(sourceDateStr);
  if (!isNaN(d.getTime())) {
    d.setDate(d.getDate() + 24);
    const kiedyLeczycEl = document.getElementById('input-izo-kiedy-leczyc');
    if (kiedyLeczycEl) {
      let yyyy = d.getFullYear();
      let mm = String(d.getMonth() + 1).padStart(2, '0');
      let dd = String(d.getDate()).padStart(2, '0');
      kiedyLeczycEl.value = `${yyyy}-${mm}-${dd}`;
    }
  }
}

function fd(d) {
  if (!d) return '';
  const dateObj = new Date(d);
  if (isNaN(dateObj.getTime())) return String(d);
  return dateObj.toLocaleString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sortTableBy(pluralType, col) {
  if (sortState[pluralType].col === col) {
    sortState[pluralType].asc = !sortState[pluralType].asc;
  } else {
    sortState[pluralType].col = col;
    sortState[pluralType].asc = true;
  }
  renderGlobalTables();
}

function sortRecords(list, pluralType) {
  const { col, asc } = sortState[pluralType];
  const dir = asc ? 1 : -1;
  return [...list].sort((a, b) => {
    let valA = a[col] ?? '';
    let valB = b[col] ?? '';
    if (col === 'timestamp') {
      return (new Date(valA).getTime() - new Date(valB).getTime()) * dir;
    }
    if (col === 'hiveNum' || col === 'ramkiCzerwiu' || col === 'polkorpus' || col === 'kgCukru' || col === 'ramka') {
      return ((parseFloat(valA) || 0) - (parseFloat(valB) || 0)) * dir;
    }
    return String(valA).localeCompare(String(valB), 'pl') * dir;
  });
}

function buildSortHeader(pluralType, columns) {
  const { col, asc } = sortState[pluralType];
  return `<tr>` + columns.map(c => {
    if (!c.key) return `<th>${c.label}</th>`;
    const arrow = col === c.key ? (asc ? ' ▲' : ' ▼') : ' ↕';
    return `<th onclick="sortTableBy('${pluralType}', '${c.key}')" style="cursor:pointer; user-select:none;" title="Kliknij, aby posortować">${c.label}<span style="font-size:0.75rem; opacity:0.7;">${arrow}</span></th>`;
  }).join('') + `</tr>`;
}

function renderGlobalTables() {
  // Nagłówki z obsługą sortowania
  const headInsp = document.getElementById('head-inspections');
  const headFeed = document.getElementById('head-feedings');
  const headTreat = document.getElementById('head-treatments');
  const headIzo = document.getElementById('head-izos');

  if (headInsp) headInsp.innerHTML = buildSortHeader('inspections', [
    { key: 'timestamp', label: 'Data' }, { key: 'hiveNum', label: 'Ul' }, { key: 'rodzina', label: 'Rodzina' },
    { key: 'matka', label: 'Matka' }, { key: 'jaja', label: 'Jaja' }, { key: 'ramkiCzerwiu', label: 'Czerw' },
    { key: 'pokarm', label: 'Pokarm' }, { key: 'polkorpus', label: 'Nadst.' }, { key: 'dzialania', label: 'Działania' },
    { key: 'przyszleDzialania', label: 'Plan' }, { key: null, label: 'Akcje' }
  ]);

  if (headFeed) headFeed.innerHTML = buildSortHeader('feedings', [
    { key: 'timestamp', label: 'Data' }, { key: 'hiveNum', label: 'Ul' }, { key: 'kgCukru', label: 'Ilość (kg)' },
    { key: 'uwagi', label: 'Uwagi' }, { key: null, label: 'Akcje' }
  ]);

  if (headTreat) headTreat.innerHTML = buildSortHeader('treatments', [
    { key: 'timestamp', label: 'Data' }, { key: 'hiveNum', label: 'Ul' }, { key: 'preparat', label: 'Preparat' },
    { key: 'uwagi', label: 'Dawka / Uwagi' }, { key: null, label: 'Akcje' }
  ]);

  if (headIzo) headIzo.innerHTML = buildSortHeader('izos', [
    { key: 'timestamp', label: 'Data' }, { key: 'hiveNum', label: 'Ul' }, { key: 'izoType', label: 'Operacja' },
    { key: 'ramka', label: 'Ramka' }, { key: 'kiedyLeczyc', label: 'Kiedy leczyć' }, { key: null, label: 'Akcje' }
  ]);

  const tbodyInsp = document.getElementById('sheet-tbody');
  const tbodyFeed = document.getElementById('feedings-tbody');
  const tbodyTreat = document.getElementById('treatments-tbody');
  const tbodyIzo = document.getElementById('izos-tbody');

  const activeInsp = sortRecords(state.inspections.filter(r => r.syncStatus !== 'pending_delete'), 'inspections');
  const activeFeed = sortRecords(state.feedings.filter(r => r.syncStatus !== 'pending_delete'), 'feedings');
  const activeTreat = sortRecords(state.treatments.filter(r => r.syncStatus !== 'pending_delete'), 'treatments');
  const activeIzo = sortRecords(state.izos.filter(r => r.syncStatus !== 'pending_delete'), 'izos');

  if (tbodyInsp) tbodyInsp.innerHTML = activeInsp.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.rodzina || ''}</td><td>${r.matka || ''}</td><td>${r.jaja || ''}</td>
      <td>${r.ramkiCzerwiu || ''}</td><td>${r.pokarm || ''}</td><td>${r.polkorpus || ''}</td><td>${r.dzialania || ''}</td><td>${r.przyszleDzialania || ''}</td>
      <td style="white-space:nowrap;">
        <button onclick="editRecord('${r.id}', 'inspection')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'inspection')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if (tbodyFeed) tbodyFeed.innerHTML = activeFeed.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.kgCukru || ''} kg</td><td>${r.uwagi || ''}</td>
      <td style="white-space:nowrap;">
        <button onclick="editRecord('${r.id}', 'feeding')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'feeding')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if (tbodyTreat) tbodyTreat.innerHTML = activeTreat.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.preparat || ''}</td><td>${r.uwagi || ''}</td>
      <td style="white-space:nowrap;">
        <button onclick="editRecord('${r.id}', 'treatment')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'treatment')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if (tbodyIzo) tbodyIzo.innerHTML = activeIzo.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.izoType || ''}</td><td>${r.ramka || ''}</td>
      <td style="color:#dc2626; font-weight:bold;">${r.kiedyLeczyc || ''}</td>
      <td style="white-space:nowrap;">
        <button onclick="editRecord('${r.id}', 'izo')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'izo')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');
}

// Pełna tabela historii dla wybranego ula i kategorii pod formularzem
function renderLocalHistory(type, hiveNum) {
  const container = document.getElementById(`local-${type}-history`);
  if (!container) return;
  let data = state[type + 's']
    .filter(d => String(d.hiveNum) === String(hiveNum) && d.syncStatus !== 'pending_delete')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (data.length === 0) {
    container.innerHTML = `<p style="color:#6b7280; font-style:italic; padding:8px;">Brak wcześniejszych wpisów dla Ula ${hiveNum} w tej kategorii.</p>`;
    return;
  }

  let tableHtml = `<div class="table-scroll-container"><table class="data-table"><thead>`;
  if (type === 'inspection') {
    tableHtml += `<tr><th>Data</th><th>Rodzina</th><th>Matka</th><th>Jaja</th><th>Czerw</th><th>Pokarm</th><th>Nadst.</th><th>Działania</th><th>Plan</th><th>Akcje</th></tr></thead><tbody>`;
    tableHtml += data.map(r => `
      <tr>
        <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
        <td>${r.rodzina || ''}</td><td>${r.matka || ''}</td><td>${r.jaja || ''}</td>
        <td>${r.ramkiCzerwiu || ''}</td><td>${r.pokarm || ''}</td><td>${r.polkorpus || ''}</td>
        <td>${r.dzialania || ''}</td><td>${r.przyszleDzialania || ''}</td>
        <td style="white-space:nowrap;">
          <button type="button" onclick="editRecord('${r.id}', 'inspection')" class="btn-small">✏️</button>
          <button type="button" onclick="deleteRecord('${r.id}', 'inspection')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
        </td>
      </tr>`).join('');
  } else if (type === 'feeding') {
    tableHtml += `<tr><th>Data</th><th>Ilość (kg)</th><th>Uwagi</th><th>Akcje</th></tr></thead><tbody>`;
    tableHtml += data.map(r => `
      <tr>
        <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
        <td><b>${r.kgCukru || ''} kg</b></td><td>${r.uwagi || ''}</td>
        <td style="white-space:nowrap;">
          <button type="button" onclick="editRecord('${r.id}', 'feeding')" class="btn-small">✏️</button>
          <button type="button" onclick="deleteRecord('${r.id}', 'feeding')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
        </td>
      </tr>`).join('');
  } else if (type === 'treatment') {
    tableHtml += `<tr><th>Data</th><th>Preparat</th><th>Dawka / Uwagi</th><th>Akcje</th></tr></thead><tbody>`;
    tableHtml += data.map(r => `
      <tr>
        <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
        <td><b>${r.preparat || ''}</b></td><td>${r.uwagi || ''}</td>
        <td style="white-space:nowrap;">
          <button type="button" onclick="editRecord('${r.id}', 'treatment')" class="btn-small">✏️</button>
          <button type="button" onclick="deleteRecord('${r.id}', 'treatment')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
        </td>
      </tr>`).join('');
  } else if (type === 'izo') {
    tableHtml += `<tr><th>Data</th><th>Operacja</th><th>Ramka</th><th>Kiedy leczyć</th><th>Akcje</th></tr></thead><tbody>`;
    tableHtml += data.map(r => `
      <tr>
        <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
        <td><b>${r.izoType || ''}</b></td><td>${r.ramka || ''}</td>
        <td style="color:#dc2626; font-weight:bold;">${r.kiedyLeczyc || '-'}</td>
        <td style="white-space:nowrap;">
          <button type="button" onclick="editRecord('${r.id}', 'izo')" class="btn-small">✏️</button>
          <button type="button" onclick="deleteRecord('${r.id}', 'izo')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
        </td>
      </tr>`).join('');
  }
  tableHtml += `</tbody></table></div>`;
  container.innerHTML = tableHtml;
}

function renderTodos() {
  const ul = document.getElementById('todo-list');
  if (!ul) return;
  let todos = state.inspections.filter(i => {
    if (i.syncStatus === 'pending_delete') return false;
    const val = (i.przyszleDzialania || '').trim();
    const lower = val.toLowerCase();
    return val.length > 0 && lower !== '0' && lower !== 'brak' && lower !== 'brak planów' && lower !== 'brak planu' && lower !== 'brak uwag' && lower !== 'nie' && lower !== '-';
  });

  // Sortowanie: najpierw niewykonane, potem najnowsze
  todos.sort((a, b) => {
    const doneA = localStorage.getItem('todo_done_' + a.id) === 'true' ? 1 : 0;
    const doneB = localStorage.getItem('todo_done_' + b.id) === 'true' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  if (todos.length === 0) {
    ul.innerHTML = '<li style="padding:16px; color:#6b7280; font-style:italic;">Brak zaplanowanych zadań.</li>';
    return;
  }

  ul.innerHTML = todos.map(t => {
    const isDone = localStorage.getItem('todo_done_' + t.id) === 'true';
    const bg = isDone ? '#f3f4f6' : '#ecfdf5';
    const border = isDone ? '#d1d5db' : '#10b981';
    const strike = isDone ? 'text-decoration: line-through; color: #9ca3af;' : 'color: #111827;';
    return `<li style="padding: 12px 14px; border: 2px solid ${border}; display:flex; align-items:center; gap:12px; background:${bg}; margin-bottom:8px; border-radius:8px;">
      <button type="button" onclick="toggleTodo('${t.id}')" style="width:32px; height:32px; font-weight:900; font-size:1.1rem; border:2px solid #047857; border-radius:6px; background:${isDone ? '#d1fae5' : '#fff'}; color:#065f46; cursor:pointer; display:flex; align-items:center; justify-content:center;">
        ${isDone ? 'X' : ''}
      </button>
      <div style="flex:1; ${strike}">
        <span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:6px; font-weight:bold; font-size:0.85rem; margin-right:6px;">Ul ${t.hiveNum}</span>
        <small style="color:#6b7280; margin-right:8px;">(${fd(t.timestamp)})</small>
        <span style="font-weight:700;">${t.przyszleDzialania}</span>
      </div>
      <button type="button" onclick="editRecord('${t.id}', 'inspection')" class="btn-small">✏️ Edytuj</button>
    </li>`;
  }).join('');
}

function toggleTodo(id) {
  const current = localStorage.getItem('todo_done_' + id) === 'true';
  localStorage.setItem('todo_done_' + id, !current);
  renderTodos();
}

function showToast(msg, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = msg;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}
