// PASIEKA v9.3 - FIX WERYFIKACYJNY (GWARANCJA POPRAWNEGO SKOPIOWANIA KODU)

// 👇 JEŚLI CHCESZ, WKLEJ SWÓJ LINK WEBHOOKA MIĘDZY APOSTROFY PONIŻEJ:
const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbzPnyxsCd1qtle4cQWaH7b4xVmm7fTic2Cd0A2N4hdMQxlKKDbICO51-rblndVwrFEvGQ/exec'; 

let lastActiveHiveTab = 'tab-dom';
let currentTodoSubtab = 'ALL';
let pendingSyncRetry = false;

let state = {
  inspections: [],
  feedings: [],
  treatments: [],
  izos: [],
  syncPendingCount: 0,
  isSyncing: false
};

let sortConfig = {
  inspections: { key: 'timestamp', dir: 'desc' },
  feedings: { key: 'timestamp', dir: 'desc' },
  treatments: { key: 'timestamp', dir: 'desc' },
  izos: { key: 'timestamp', dir: 'desc' }
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

function getCurrentLocalISO() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

async function forceHardResetCache() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (let r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (let k of keys) await caches.delete(k);
    }
    showToast("Pamięć cache plików wyczyszczona! Przeładowuję...", "success");
    setTimeout(() => window.location.reload(true), 700);
  } catch (e) {
    window.location.reload(true);
  }
}

function isStandaloneNote(rec) {
  if (!rec) return false;
  return String(rec.rodzina) === 'NOTATKA_ZROBIC' || String(rec.id).startsWith('todo_');
}

function isQueenRecord(rec) {
  if (!rec) return false;
  return String(rec.rodzina) === 'OPIS_MATKI' || String(rec.id).startsWith('queen_hive_');
}

function isSystemInspectionRecord(rec) {
  return isStandaloneNote(rec) || isQueenRecord(rec);
}

function getTodoTargetLabel(rec) {
  if (!rec) return '🏠 Ul 1';
  if (!isStandaloneNote(rec)) {
    return `🏠 Ul ${rec.hiveNum} (Przegląd)`;
  }
  const scope = String(rec.matka || '').trim().toUpperCase();
  if (scope === 'CAŁA PASIEKA' || String(rec.hiveNum) === '99') return '🐝 Cała Pasieka (1-18)';
  if (scope === 'PASIEKA DOM' || String(rec.hiveNum) === '91') return '🏡 Cała Pasieka DOM (1-6)';
  if (scope === 'PASIEKA ZBIÓR' || String(rec.hiveNum) === '92') return '🌾 Cała Pasieka ZBIÓR (7-12)';
  if (scope === 'PASIEKA LAS' || String(rec.hiveNum) === '93') return '🌲 Cała Pasieka LAS (13-18)';
  if (scope.startsWith('UL ')) return `🏠 ${scope}`;
  return `🏠 Ul ${rec.hiveNum}`;
}

function cleanTodoText(str) {
  return String(str || '').replace(/^\[X\]\s*/i, '').trim();
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
    let parts = str.split('-');
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
    let matchH = String(rawHive).match(/^\d+$/);
    let matchT = String(rawTime).match(/^\d+$/);
    if (matchH && parseInt(matchH[0]) <= 100) {
      hiveNum = parseInt(matchH[0]);
      timestampStr = rawTime;
    } else if (matchT && parseInt(matchT[0]) <= 100) {
      hiveNum = parseInt(matchT[0]);
      timestampStr = rawHive;
    }
  }

  if (!hiveNum || isNaN(hiveNum) || hiveNum < 1 || hiveNum > 100) {
    if (id.startsWith('queen_hive_')) {
      hiveNum = parseInt(id.replace('queen_hive_', '')) || 1;
    } else if (id.startsWith('todo_') || String(row.rodzina) === 'NOTATKA_ZROBIC') {
      hiveNum = 1;
    } else {
      return null;
    }
  }

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
    normalized.rodzina = row.rodzina !== undefined ? String(row.rodzina) : '';
    normalized.matka = row.matka !== undefined ? String(row.matka) : '';
    normalized.jaja = row.jaja !== undefined ? String(row.jaja) : '';
    normalized.ramkiCzerwiu = row.ramkiCzerwiu !== undefined ? String(row.ramkiCzerwiu) : '0';
    normalized.pokarm = row.pokarm !== undefined ? String(row.pokarm) : '';
    normalized.polkorpus = row.polkorpus !== undefined ? String(row.polkorpus) : '0';
    normalized.dzialania = row.dzialania !== undefined ? String(row.dzialania) : '';
    normalized.przyszleDzialania = row.przyszleDzialania !== undefined ? String(row.przyszleDzialania) : '';
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
    let izoTypeVal = row.izoType || row.ramka || 'IZO-pocz';
    if (String(izoTypeVal).includes('Ul')) izoTypeVal = row.ramka || 'IZO-pocz';
    let rNum = row.ramka;
    if (isNaN(parseInt(rNum)) && !isNaN(parseInt(row.kiedyLeczyc))) {
      rNum = row.kiedyLeczyc;
    }
    normalized.izoType = String(izoTypeVal);
    normalized.ramka = String(rNum || '1');
    normalized.kiedyLeczyc = formatToPLDate(row.kiedyLeczyc);
  }
  return normalized;
}

const DB_NAME = 'PasiekaDB';
const DB_VERSION = 1;
let db = null;

function initDB() {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (val) => { if (!resolved) { resolved = true; resolve(val); } };
    setTimeout(() => finish(null), 800);
    try {
      if (!window.indexedDB) { finish(null); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
      request.onsuccess = (e) => { db = e.target.result; finish(db); };
      request.onupgradeneeded = (e) => {
        const dbInstance = e.target.result;
        TYPES.forEach(t => {
          const storeName = t + 's';
          if (!dbInstance.objectStoreNames.contains(storeName)) {
            dbInstance.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };
    } catch (err) { finish(null); }
  });
}

function getBackupTodosMap() {
  try {
    const raw = localStorage.getItem('pasieka_todos_backup');
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) { return {}; }
}

function saveToBackupTodos(record) {
  if (!record || !record.id) return;
  try {
    const map = getBackupTodosMap();
    map[record.id] = record;
    localStorage.setItem('pasieka_todos_backup', JSON.stringify(map));
  } catch (e) {}
}

function removeFromBackupTodos(id) {
  try {
    const map = getBackupTodosMap();
    if (map[id]) {
      delete map[id];
      localStorage.setItem('pasieka_todos_backup', JSON.stringify(map));
    }
  } catch (e) {}
}

function getFallbackLocalStorage(storeName) {
  try { return JSON.parse(localStorage.getItem('pasieka_' + storeName) || '[]'); } catch (e) { return []; }
}

function saveFallbackLocalStorageAll(storeName, items) {
  try { localStorage.setItem('pasieka_' + storeName, JSON.stringify(items)); } catch (e) {}
}

async function getLocalRecords(type) {
  const storeName = type + 's';
  const mergedMap = new Map();

  if (Array.isArray(state[storeName])) {
    state[storeName].forEach(item => {
      if (item && item.id) mergedMap.set(item.id, item);
    });
  }

  const lsItems = getFallbackLocalStorage(storeName);
  lsItems.forEach(item => {
    if (item && item.id) {
      const existing = mergedMap.get(item.id);
      if (!existing || parseInt(item.updatedAt || '0') >= parseInt(existing.updatedAt || '0')) {
        mergedMap.set(item.id, item);
      }
    }
  });

  if (type === 'inspection') {
    const todoBackup = getBackupTodosMap();
    Object.values(todoBackup).forEach(todoItem => {
      if (todoItem && todoItem.id) {
        const existing = mergedMap.get(todoItem.id);
        if (!existing || parseInt(todoItem.updatedAt || '0') >= parseInt(existing.updatedAt || '0')) {
          mergedMap.set(todoItem.id, todoItem);
        }
      }
    });
  }

  if (db) {
    const dbItems = await new Promise((resolve) => {
      let done = false;
      const finish = (res) => { if (!done) { done = true; resolve(res); } };
      setTimeout(() => finish([]), 400);
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => finish(req.result || []);
        req.onerror = () => finish([]);
      } catch (e) { finish([]); }
    });

    dbItems.forEach(item => {
      if (item && item.id) {
        const existing = mergedMap.get(item.id);
        if (!existing) {
          mergedMap.set(item.id, item);
        } else if (existing.syncStatus !== 'pending_delete' && parseInt(item.updatedAt || '0') > parseInt(existing.updatedAt || '0')) {
          mergedMap.set(item.id, item);
        }
      }
    });
  }

  const finalList = Array.from(mergedMap.values());
  saveFallbackLocalStorageAll(storeName, finalList);
  state[storeName] = finalList;
  return finalList;
}

async function saveLocalRecord(type, record) {
  const storeName = type + 's';
  if (!Array.isArray(state[storeName])) state[storeName] = [];

  const memIdx = state[storeName].findIndex(i => i.id === record.id);
  if (memIdx >= 0) state[storeName][memIdx] = record;
  else state[storeName].push(record);

  const lsList = getFallbackLocalStorage(storeName);
  const lsMap = new Map();
  lsList.forEach(i => { if (i && i.id) lsMap.set(i.id, i); });
  state[storeName].forEach(i => { if (i && i.id) lsMap.set(i.id, i); });
  lsMap.set(record.id, record);
  const combinedList = Array.from(lsMap.values());
  saveFallbackLocalStorageAll(storeName, combinedList);
  state[storeName] = combinedList;

  if (type === 'inspection' && (isStandaloneNote(record) || cleanTodoText(record.przyszleDzialania).length > 0)) {
    if (record.syncStatus === 'pending_delete') {
      removeFromBackupTodos(record.id);
    } else {
      saveToBackupTodos(record);
    }
  }

  if (db) {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
    } catch (e) {}
  }
  return true;
}

async function deleteLocalRecordPermanent(type, id) {
  const storeName = type + 's';
  if (Array.isArray(state[storeName])) {
    state[storeName] = state[storeName].filter(i => i.id !== id);
  }
  const lsItems = getFallbackLocalStorage(storeName).filter(i => i.id !== id);
  saveFallbackLocalStorageAll(storeName, lsItems);
  if (type === 'inspection') {
    removeFromBackupTodos(id);
  }
  if (db) {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
    } catch (e) {}
  }
  return true;
}

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initHives();
  initForms();
  initTodoForm();
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
        try { localStorage.setItem('gsheet_webhook', urlInput.value.trim()); } catch (e) {}
        showToast("Zapisano adres Webhooka! Synchronizuję...", "success");
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
  await migrateLocalQueensToSyncRecords();
  syncData(false);
});

async function migrateLocalQueensToSyncRecords() {
  let migrated = false;
  for (let i = 1; i <= 18; i++) {
    let localNote = '';
    try { localNote = (localStorage.getItem(`pasieka_queen_${i}`) || '').trim(); } catch (e) {}
    const existingRec = state.inspections.find(r => r.id === `queen_hive_${i}` && r.syncStatus !== 'pending_delete');
    if (localNote && !existingRec) {
      const payload = {
        id: `queen_hive_${i}`,
        timestamp: new Date().toISOString(),
        hiveNum: String(i),
        rodzina: 'OPIS_MATKI',
        matka: 'TAK',
        jaja: 'TAK',
        ramkiCzerwiu: '0',
        pokarm: 'OK',
        polkorpus: '0',
        dzialania: localNote,
        przyszleDzialania: '',
        updatedAt: Date.now().toString(),
        syncStatus: 'pending_save'
      };
      await saveLocalRecord('inspection', payload);
      migrated = true;
    }
  }
  if (migrated) {
    await loadStateFromLocal();
  }
}

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
    showToast("Tryb Offline 🟠 Dane bezpieczne w pamięci urządzenia.", "warning");
  });
}

function updateSyncUI() {
  const badge = document.getElementById('sync-status-badge');
  if (!badge) return;
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    badge.className = 'sync-badge offline';
    badge.innerHTML = '⚠️ Brak Webhooka (Ustawienia)';
    return;
  }
  if (state.isSyncing) {
    badge.className = 'sync-badge syncing';
    badge.innerHTML = '🔄 Synchronizacja...';
  } else if (!navigator.onLine) {
    badge.className = 'sync-badge offline';
    badge.innerHTML = `🟠 Offline ${state.syncPendingCount > 0 ? '(' + state.syncPendingCount + ')' : ''}`;
  } else if (state.syncPendingCount > 0) {
    badge.className = 'sync-badge pending';
    badge.innerHTML = `🟠 Zapisano lokalnie (${state.syncPendingCount})`;
  } else {
    badge.className = 'sync-badge synced';
    badge.innerHTML = '🟢 Połączono';
  }
}

async function syncData(userTriggered = false) {
  if (state.isSyncing) {
    pendingSyncRetry = true;
    return;
  }
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    updateSyncUI();
    if (userTriggered) {
      showToast("Zadania są zapisane lokalnie. Aby wysłać do Google Sheets, wklej link Webhooka w zakładce 📊 Arkusz!", "warning");
    }
    return;
  }
  if (!navigator.onLine) {
    if (userTriggered) showToast("Brak internetu. Twoje zadania są bezpiecznie zapisane w przeglądarce!", "warning");
    return;
  }
  state.isSyncing = true;
  updateSyncUI();

  try {
    for (let t of TYPES) {
      state[t + 's'] = await getLocalRecords(t);
    }

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
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'batch_upsert', changes: changesToUpload })
        });
        const batchJson = await batchResp.json();
        if (batchJson && batchJson.message && batchJson.message.includes('Zaktualizowano')) {
          batchSuccess = true;
        }
      } catch (errPost) { batchSuccess = false; }

      if (!batchSuccess) {
        for (let change of changesToUpload) {
          try {
            const reqBody = change.deleted 
              ? { action: 'delete', type: change.type, localType: change.localType, id: change.data.id }
              : { type: change.type, localType: change.localType, ...change.data };
            const singleResp = await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify(reqBody)
            });
            const singleJson = await singleResp.json();
            if (singleJson && (singleJson.status === 'success' || (singleJson.message && singleJson.message.includes('Zapisano')))) {
              if (change.deleted) {
                await deleteLocalRecordPermanent(change.localType, change.data.id);
              }
            }
          } catch (eSingle) { console.error("Błąd wysyłki pojedynczej:", eSingle); }
        }
      } else {
        for (let change of changesToUpload) {
          if (change.deleted) {
            await deleteLocalRecordPermanent(change.localType, change.data.id);
          }
        }
      }
    }

    const sep = webhookUrl.includes('?') ? '&' : '?';
    const response = await fetch(`${webhookUrl}${sep}_t=${Date.now()}`, { cache: 'no-store' });
    const res = await response.json();
    if (res && typeof res === 'object') {
      for (let t of TYPES) {
        const storeName = t + 's';
        const rawRemoteList = Array.isArray(res[storeName]) ? res[storeName] : (Array.isArray(res[t]) ? res[t] : []);
        const remoteList = rawRemoteList.map(r => normalizeRecord(t, r)).filter(r => r !== null);
        
        const localList = await getLocalRecords(t);
        const localMap = new Map(localList.map(item => [item.id, item]));

        for (let remoteItem of remoteList) {
          const localItem = localMap.get(remoteItem.id);
          if (!localItem) {
            remoteItem.syncStatus = 'synced';
            await saveLocalRecord(t, remoteItem);
          } else {
            if (localItem.syncStatus === 'pending_delete') {
              continue;
            }
            const localTime = parseInt(localItem.updatedAt || '0');
            const remoteTime = parseInt(remoteItem.updatedAt || '0');
            if (remoteTime >= localTime) {
              remoteItem.syncStatus = 'synced';
              await saveLocalRecord(t, remoteItem);
            } else {
              localItem.syncStatus = 'synced';
              await saveLocalRecord(t, localItem);
            }
          }
        }
      }
      await loadStateFromLocal();
      if (userTriggered) showToast("Synchronizacja ukończona pomyślnie! 🐝", "success");
    }
  } catch (err) {
    console.error("Błąd synchronizacji:", err);
    if (userTriggered) showToast("Połączenie z Google Sheets niedostępne – wszystkie zadania są bezpieczne lokalnie!", "warning");
  } finally {
    state.isSyncing = false;
    await loadStateFromLocal();
    if (pendingSyncRetry) {
      pendingSyncRetry = false;
      setTimeout(() => syncData(false), 500);
    }
  }
}

function toggleTodoScopeSelect() {
  const scopeRadio = document.querySelector('input[name="todoScopeType"]:checked');
  const pasiekaBox = document.getElementById('todo-scope-pasieka-box');
  const hiveBox = document.getElementById('todo-scope-hive-box');
  if (!scopeRadio || !pasiekaBox || !hiveBox) return;

  if (scopeRadio.value === 'UL') {
    pasiekaBox.classList.add('hidden');
    hiveBox.classList.remove('hidden');
  } else {
    pasiekaBox.classList.remove('hidden');
    hiveBox.classList.add('hidden');
  }
}

function switchTodoSubtab(mode) {
  currentTodoSubtab = mode;
  const cardPending = document.getElementById('card-todo-pending');
  const cardDone = document.getElementById('card-todo-done');
  const btnAll = document.getElementById('subtab-btn-all');
  const btnPending = document.getElementById('subtab-btn-pending');
  const btnDone = document.getElementById('subtab-btn-done');

  if (btnAll) btnAll.style.opacity = mode === 'ALL' ? '1' : '0.65';
  if (btnPending) btnPending.style.opacity = mode === 'PENDING' ? '1' : '0.65';
  if (btnDone) btnDone.style.opacity = mode === 'DONE' ? '1' : '0.65';

  if (cardPending && cardDone) {
    if (mode === 'PENDING') {
      cardPending.classList.remove('hidden');
      cardDone.classList.add('hidden');
    } else if (mode === 'DONE') {
      cardPending.classList.add('hidden');
      cardDone.classList.remove('hidden');
    } else {
      cardPending.classList.remove('hidden');
      cardDone.classList.remove('hidden');
    }
  }
}

function initTodoForm() {
  const form = document.getElementById('todo-form');
  const dateInput = document.getElementById('input-todo-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = getCurrentLocalISO();
  }
  toggleTodoScopeSelect();
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-todo');
    if (btn) btn.disabled = true;
    setTimeout(() => { if (btn) btn.disabled = false; }, 500);

    const isEdit = !!form.dataset.editId;
    const recordId = isEdit ? form.dataset.editId : 'todo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    
    const singleTargetSelect = document.getElementById('select-todo-target');
    const scopeRadio = document.querySelector('input[name="todoScopeType"]:checked');
    
    let safeHiveNum = '1';
    let scopeLabel = 'CAŁA PASIEKA';

    if (scopeRadio) {
      const scopeType = scopeRadio.value;
      const pasiekaVal = document.getElementById('select-todo-pasieka')?.value || 'CAŁA PASIEKA';
      const hiveVal = document.getElementById('select-todo-hive')?.value || '1';
      if (scopeType === 'UL') {
        safeHiveNum = String(hiveVal);
        scopeLabel = `UL ${hiveVal}`;
      } else {
        scopeLabel = pasiekaVal;
        if (pasiekaVal === 'PASIEKA DOM') safeHiveNum = '1';
        else if (pasiekaVal === 'PASIEKA ZBIÓR') safeHiveNum = '7';
        else if (pasiekaVal === 'PASIEKA LAS') safeHiveNum = '13';
        else safeHiveNum = '1';
      }
    } else if (singleTargetSelect) {
      const targetVal = singleTargetSelect.value;
      if (['CAŁA PASIEKA', '99'].includes(targetVal)) {
        safeHiveNum = '1'; scopeLabel = 'CAŁA PASIEKA';
      } else if (['PASIEKA DOM', '91'].includes(targetVal)) {
        safeHiveNum = '1'; scopeLabel = 'PASIEKA DOM';
      } else if (['PASIEKA ZBIÓR', '92'].includes(targetVal)) {
        safeHiveNum = '7'; scopeLabel = 'PASIEKA ZBIÓR';
      } else if (['PASIEKA LAS', '93'].includes(targetVal)) {
        safeHiveNum = '13'; scopeLabel = 'PASIEKA LAS';
      } else {
        safeHiveNum = String(targetVal); scopeLabel = `UL ${targetVal}`;
      }
    }

    const dateVal = document.getElementById('input-todo-date')?.value || getCurrentLocalISO();
    const textVal = cleanTodoText(document.getElementById('input-todo-text')?.value || '');
    const initStatus = document.querySelector('input[name="todoInitStatus"]:checked')?.value || 'TODO';

    if (!textVal) {
      showToast("Wpisz treść notatki!", "warning");
      return;
    }

    let isDone = (initStatus === 'DONE');
    if (isEdit && !document.querySelector('input[name="todoInitStatus"]')) {
      const existing = state.inspections.find(r => r.id === recordId);
      if (existing) isDone = isTodoDone(existing);
    }

    const finalText = isDone ? `[X] ${textVal}` : textVal;

    const payload = {
      id: recordId,
      timestamp: new Date(dateVal).toISOString(),
      hiveNum: String(safeHiveNum),
      rodzina: 'NOTATKA_ZROBIC',
      matka: scopeLabel,
      jaja: 'TAK',
      ramkiCzerwiu: '0',
      pokarm: 'OK',
      polkorpus: '0',
      dzialania: isDone ? 'WYKONANE' : 'DO ZROBIENIA',
      przyszleDzialania: finalText,
      updatedAt: Date.now().toString(),
      syncStatus: 'pending_save'
    };

    try {
      localStorage.setItem('todo_done_' + recordId, isDone.toString());
    } catch (err) {}

    await saveLocalRecord('inspection', payload);
    renderTodos();
    updatePendingCount();
    updateSyncUI();
    resetTodoForm();
    showToast(isEdit ? "Zaktualizowano notatkę!" : `Dodano zadanie! (Łącznie na liście: ${getAllValidTodos().length})`, "success");

    if (navigator.onLine) syncData(false);
  });
}

function resetTodoForm() {
  const form = document.getElementById('todo-form');
  if (form) delete form.dataset.editId;
  const title = document.getElementById('todo-form-title');
  if (title) title.innerText = '➕ Dodaj Niezależną Notatkę / Zadanie';
  const btn = document.getElementById('btn-submit-todo');
  if (btn) btn.innerHTML = '💾 ZAPISZ NOTATKĘ I SYNCHRONIZUJ';
  const cancelBtn = document.getElementById('btn-cancel-todo-edit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  const textInput = document.getElementById('input-todo-text');
  if (textInput) textInput.value = '';
  
  const radioPasieka = document.querySelector('input[name="todoScopeType"][value="PASIEKA"]');
  if (radioPasieka) radioPasieka.checked = true;
  toggleTodoScopeSelect();

  const pasiekaSelect = document.getElementById('select-todo-pasieka');
  if (pasiekaSelect) pasiekaSelect.value = 'CAŁA PASIEKA';

  const singleTargetSelect = document.getElementById('select-todo-target');
  if (singleTargetSelect) singleTargetSelect.value = 'CAŁA PASIEKA';

  const hiveSelect = document.getElementById('select-todo-hive');
  if (hiveSelect) hiveSelect.value = '1';

  const statusTodo = document.querySelector('input[name="todoInitStatus"][value="TODO"]');
  if (statusTodo) statusTodo.checked = true;

  const dateInput = document.getElementById('input-todo-date');
  if (dateInput) dateInput.value = getCurrentLocalISO();
}

function editStandaloneTodo(id) {
  const rec = state.inspections.find(r => r.id === id);
  if (!rec) return;

  const todoTabBtn = document.querySelector('.tab-btn[data-tab="tab-todo"]');
  if (todoTabBtn && !todoTabBtn.classList.contains('active')) {
    todoTabBtn.click();
  }

  const form = document.getElementById('todo-form');
  if (form) form.dataset.editId = id;

  const title = document.getElementById('todo-form-title');
  if (title) title.innerText = '✏️ Edycja Niezależnej Notatki / Zadania';

  const btn = document.getElementById('btn-submit-todo');
  if (btn) btn.innerHTML = '💾 ZAKTUALIZUJ NOTATKĘ';

  const cancelBtn = document.getElementById('btn-cancel-todo-edit');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  const scope = String(rec.matka || '').trim().toUpperCase();
  const singleTargetSelect = document.getElementById('select-todo-target');
  if (singleTargetSelect) {
    if (['CAŁA PASIEKA', 'PASIEKA DOM', 'PASIEKA ZBIÓR', 'PASIEKA LAS'].includes(scope)) {
      singleTargetSelect.value = scope;
    } else {
      singleTargetSelect.value = String(rec.hiveNum || '1');
    }
  }

  if (['CAŁA PASIEKA', 'PASIEKA DOM', 'PASIEKA ZBIÓR', 'PASIEKA LAS'].includes(scope)) {
    const rPas = document.querySelector('input[name="todoScopeType"][value="PASIEKA"]');
    if (rPas) rPas.checked = true;
    toggleTodoScopeSelect();
    const selPas = document.getElementById('select-todo-pasieka');
    if (selPas) selPas.value = scope;
  } else {
    const rUl = document.querySelector('input[name="todoScopeType"][value="UL"]');
    if (rUl) rUl.checked = true;
    toggleTodoScopeSelect();
    const selHive = document.getElementById('select-todo-hive');
    if (selHive) selHive.value = String(rec.hiveNum || '1');
  }

  const doneNow = isTodoDone(rec);
  const statusRadio = document.querySelector(`input[name="todoInitStatus"][value="${doneNow ? 'DONE' : 'TODO'}"]`);
  if (statusRadio) statusRadio.checked = true;

  const tzOffset = new Date().getTimezoneOffset() * 60000;
  let parsedDate = new Date(rec.timestamp);
  if (isNaN(parsedDate.getTime())) parsedDate = new Date();
  const localISOTime = (new Date(parsedDate - tzOffset)).toISOString().slice(0, 16);

  const dateInput = document.getElementById('input-todo-date');
  if (dateInput) dateInput.value = localISOTime;

  const textInput = document.getElementById('input-todo-text');
  if (textInput) textInput.value = cleanTodoText(rec.przyszleDzialania);

  window.scrollTo({ top: 0, behavior: 'smooth' });
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
      setTimeout(() => { if (btn) btn.disabled = false; }, 800);

      const isEdit = !!formEl.dataset.editId;
      const recordId = isEdit ? formEl.dataset.editId : 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const nowTime = Date.now().toString();
      const currentHive = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`).value;
      const currentDateVal = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value;

      let payload = {
        id: recordId,
        timestamp: new Date(currentDateVal).toISOString(),
        hiveNum: String(currentHive),
        updatedAt: nowTime,
        syncStatus: 'pending_save'
      };

      if (type === 'inspection') {
        let rawPlan = document.getElementById('input-przyszle-dzialania')?.value || '';
        if (isEdit) {
          const prevRec = state.inspections.find(r => r.id === recordId);
          if (prevRec && isTodoDone(prevRec) && rawPlan.trim() !== '' && !rawPlan.trim().toUpperCase().startsWith('[X]')) {
            rawPlan = `[X] ${cleanTodoText(rawPlan)}`;
          }
        }
        payload = { ...payload,
          matka: document.querySelector('input[name="matka"]:checked')?.value || '',
          jaja: document.querySelector('input[name="jaja"]:checked')?.value || '',
          pokarm: document.querySelector('input[name="pokarm"]:checked')?.value || '',
          ramkiCzerwiu: document.getElementById('ramki-czerwiu')?.value || '0',
          rodzina: document.querySelector('input[name="rodzina"]:checked')?.value || '',
          polkorpus: document.querySelector('input[name="polkorpus"]:checked')?.value || '0',
          dzialania: document.getElementById('input-dzialania')?.value || '',
          przyszleDzialania: rawPlan
        };
      } else if (type === 'feeding') {
        payload = { ...payload, kgCukru: document.getElementById('input-feeding-kg')?.value || '0', uwagi: document.getElementById('input-feeding-notes')?.value || '' };
      } else if (type === 'treatment') {
        payload = { ...payload, preparat: document.getElementById('input-treatment-preparat')?.value || '', uwagi: document.getElementById('input-treatment-notes')?.value || '' };
      } else if (type === 'izo') {
        let wyliczonaData = document.getElementById('input-izo-kiedy-leczyc')?.value;
        if (!wyliczonaData && currentDateVal) {
          updateIzoLeczenieDate(currentDateVal);
          wyliczonaData = document.getElementById('input-izo-kiedy-leczyc')?.value;
        }
        payload = { ...payload, 
          izoType: document.querySelector('input[name="izoType"]:checked')?.value || 'IZO-pocz', 
          ramka: document.getElementById('input-izo-ramka')?.value || '1', 
          kiedyLeczyc: formatToPLDate(wyliczonaData) 
        };
      }

      await saveLocalRecord(type, payload);
      await loadStateFromLocal();
      showToast(isEdit ? "Zaktualizowano wpis!" : "Zapisano wpis w pasiece!", "success");
      
      delete formEl.dataset.editId;
      if (btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ');
      
      openForm(type, currentHive);
      if (navigator.onLine) syncData(false);
    });
  });
}

async function deleteRecord(id, type, currentHiveNum = null) {
  if (!confirm("Na pewno usunąć ten wpis?")) return;
  const storeName = type + 's';
  const item = state[storeName].find(r => r.id === id);
  if (type === 'inspection') removeFromBackupTodos(id);
  if (item) {
    const hiveToRefresh = currentHiveNum || item.hiveNum;
    item.syncStatus = 'pending_delete';
    item.updatedAt = Date.now().toString();
    await saveLocalRecord(type, item);
    await loadStateFromLocal();
    if (hiveToRefresh && parseInt(hiveToRefresh) <= 18) renderLocalHistory(type, hiveToRefresh);
    showToast("Wpis został usunięty.", "warning");
    if (navigator.onLine) syncData(false);
  }
}

function editRecord(id, type) {
  const record = state[type + 's'].find(r => r.id === id);
  if (!record) return;

  if (type === 'inspection' && isStandaloneNote(record)) {
    editStandaloneTodo(id);
    return;
  }

  openForm(type, record.hiveNum);
  const form = document.getElementById(`${type}-form`);
  if (form) form.dataset.editId = id;
  const btn = document.getElementById(`btn-submit-${type}`);
  if (btn) btn.innerHTML = btn.innerHTML.replace('ZAPISZ', 'ZAKTUALIZUJ');

  const tzOffset = new Date().getTimezoneOffset() * 60000;
  let parsedDate = new Date(record.timestamp);
  if (isNaN(parsedDate.getTime())) parsedDate = new Date();
  const localISOTime = (new Date(parsedDate - tzOffset)).toISOString().slice(0, 16);
  const dateInput = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
  if (dateInput) dateInput.value = localISOTime;

  if (type === 'inspection') {
    const m = document.querySelector(`input[name="matka"][value="${record.matka}"]`); if (m) m.checked = true;
    const j = document.querySelector(`input[name="jaja"][value="${record.jaja}"]`); if (j) j.checked = true;
    const p = document.querySelector(`input[name="pokarm"][value="${record.pokarm}"]`); if (p) p.checked = true;
    const rc = document.getElementById('ramki-czerwiu'); if (rc) rc.value = record.ramkiCzerwiu;
    const rodz = document.querySelector(`input[name="rodzina"][value="${record.rodzina}"]`); if (rodz) rodz.checked = true;
    const polk = document.querySelector(`input[name="polkorpus"][value="${record.polkorpus}"]`); if (polk) polk.checked = true;
    const dzial = document.getElementById('input-dzialania'); if (dzial) dzial.value = record.dzialania;
    const przyszl = document.getElementById('input-przyszle-dzialania'); if (przyszl) przyszl.value = cleanTodoText(record.przyszleDzialania);
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
    if (kiedy) {
      const formatted = formatForDateInput(record.kiedyLeczyc);
      if (formatted) kiedy.value = formatted;
      else updateIzoLeczenieDate(localISOTime);
    }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      const targetTabId = targetBtn.dataset.tab;
      if (['tab-dom', 'tab-zbior', 'tab-las'].includes(targetTabId)) {
        lastActiveHiveTab = targetTabId;
      }
      const tabContent = document.getElementById(targetTabId);
      if (tabContent) tabContent.classList.add('active');
      if (targetTabId === 'tab-todo') {
        const dateInput = document.getElementById('input-todo-date');
        const form = document.getElementById('todo-form');
        if (dateInput && form && !form.dataset.editId) {
          dateInput.value = getCurrentLocalISO();
        }
        renderTodos();
      }
      if (targetTabId === 'tab-sheet') renderGlobalTables();
    });
  });
}

function goBackToHives() {
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${lastActiveHiveTab}"]`) || document.querySelector('.tab-btn[data-tab="tab-dom"]');
  if (targetBtn) targetBtn.click();
}

function goToHistory(pluralType) {
  const sheetBtn = document.querySelector('.tab-btn[data-tab="tab-sheet"]');
  if (sheetBtn) sheetBtn.click();
  setTimeout(() => {
    const wrapper = document.getElementById(`wrapper-${pluralType}-table`);
    if (wrapper) {
      wrapper.classList.remove('hidden');
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
}

async function saveQueenNote(hiveNum) {
  const input = document.getElementById(`queen-note-${hiveNum}`);
  if (!input) return;
  const noteText = input.value.trim();
  const recordId = `queen_hive_${hiveNum}`;

  try {
    localStorage.setItem(`pasieka_queen_${hiveNum}`, noteText);
  } catch (e) {}

  const payload = {
    id: recordId,
    timestamp: new Date().toISOString(),
    hiveNum: String(hiveNum),
    rodzina: 'OPIS_MATKI',
    matka: 'TAK',
    jaja: 'TAK',
    ramkiCzerwiu: '0',
    pokarm: 'OK',
    polkorpus: '0',
    dzialania: noteText,
    przyszleDzialania: '',
    updatedAt: Date.now().toString(),
    syncStatus: 'pending_save'
  };

  await saveLocalRecord('inspection', payload);
  await loadStateFromLocal();
  showToast(`Zapisano matkę Ula ${hiveNum} 👑`, 'success');
  if (navigator.onLine) syncData(false);
}

function getQueenNote(hiveNum) {
  const rec = (state.inspections || []).find(r => r.id === `queen_hive_${hiveNum}` && r.syncStatus !== 'pending_delete');
  if (rec && rec.dzialania !== undefined) {
    try { localStorage.setItem(`pasieka_queen_${hiveNum}`, rec.dzialania); } catch (e) {}
    return rec.dzialania;
  }
  try { return localStorage.getItem(`pasieka_queen_${hiveNum}`) || ''; } catch (e) { return ''; }
}

function initHives() {
  const renderGrid = (start, end, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    let html = '';
    for (let i = start; i <= end; i++) {
      const qNote = getQueenNote(i).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `
        <div class="hive-card">
          <div class="hive-card-top">
            <div class="hive-number-prominent">Ul ${i}</div>
            <div class="queen-note-box">
              <span>👑</span>
              <input type="text" id="queen-note-${i}" value="${qNote}" placeholder="Opis matki (np. Krainka 25)" onchange="saveQueenNote(${i})">
              <button type="button" class="btn-queen-save" onclick="saveQueenNote(${i})" title="Zapisz i synchronizuj opis matki">💾</button>
            </div>
          </div>
          <div id="hive-desc-${i}" style="margin: 8px 0; min-height: 4.5rem;">
            <span style="color:#9ca3af; font-style:italic; font-size:0.85rem;">Brak historii przeglądów</span>
          </div>
          <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
            <button type="button" class="btn-small" style="flex:1;" onclick="openForm('inspection', ${i})">📋 Przegląd</button>
            <button type="button" class="btn-small" style="flex:1;" onclick="openForm('feeding', ${i})">🍯 Pokarm</button>
            <button type="button" class="btn-small" style="flex:1;" onclick="openForm('treatment', ${i})">💉 Lek</button>
            <button type="button" class="btn-small" style="flex:1;" onclick="openForm('izo', ${i})">🗃️ IZO</button>
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
    const qInput = document.getElementById(`queen-note-${i}`);
    if (qInput && document.activeElement !== qInput) {
      qInput.value = getQueenNote(i);
    }

    let descDiv = document.getElementById(`hive-desc-${i}`);
    if (!descDiv) continue;
    let hiveInspections = state.inspections
      .filter(r => String(r.hiveNum) === String(i) && r.syncStatus !== 'pending_delete' && !isSystemInspectionRecord(r))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (hiveInspections.length > 0) {
      let last = hiveInspections[0];
      const planClean = cleanTodoText(last.przyszleDzialania);
      const planDone = isTodoDone(last);
      descDiv.innerHTML = `
        <div class="hive-last-inspection">
          <div class="hive-last-header">
            <span class="hive-last-date">📅 ${fd(last.timestamp)}</span>
            <span class="hive-last-rodzina">${last.rodzina || 'Średnia'}</span>
          </div>
          <div class="hive-last-grid">
            <div>👑 Matka: <b>${last.matka || '-'}</b></div>
            <div>🥚 Jaja: <b>${last.jaja || '-'}</b></div>
            <div>🪮 Czerw: <b>${last.ramkiCzerwiu || '0'} r.</b></div>
            <div>🍯 Pokarm: <b>${last.pokarm || '-'}</b></div>
            <div>📦 Nadstawki: <b>${last.polkorpus || '0'}</b></div>
          </div>
          ${last.dzialania ? `<div class="hive-last-dzialania">🛠️ <b>Działania:</b> ${last.dzialania}</div>` : ''}
          ${planClean && planClean !== '0' && planClean.toLowerCase() !== 'brak' ? `<div class="hive-last-plan" style="${planDone ? 'text-decoration:line-through; opacity:0.75;' : ''}">📋 <b>Plan:</b> ${planClean} ${planDone ? '✅' : ''}</div>` : ''}
        </div>
      `;
    } else {
      descDiv.innerHTML = `<span style="color:#9ca3af; font-style:italic; font-size:0.85rem;">Brak historii przeglądów</span>`;
    }
  }
}

function openForm(type, hiveNum) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  let tabContent = document.getElementById(`tab-${type}`);
  if (tabContent) tabContent.classList.add('active');

  const nowStr = getCurrentLocalISO();

  const selectHive = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`);
  if (selectHive) {
    let optionsHtml = '';
    for (let u = 1; u <= 18; u++) {
      optionsHtml += `<option value="${u}" ${String(u) === String(hiveNum) ? 'selected' : ''}>Ul ${u}</option>`;
    }
    selectHive.innerHTML = optionsHtml;
    selectHive.onchange = (e) => renderLocalHistory(type, e.target.value);
  }

  const inputDate = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
  if (inputDate) inputDate.value = nowStr;

  if (type === 'izo') {
    updateIzoLeczenieDate(nowStr);
  }

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
  return dateObj.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

function sortTableBy(pluralType, key) {
  const current = sortConfig[pluralType];
  if (current.key === key) {
    current.dir = current.dir === 'asc' ? 'desc' : 'asc';
  } else {
    current.key = key;
    current.dir = 'asc';
  }
  renderGlobalTables();
}

function getSortedRecords(pluralType) {
  const cfg = sortConfig[pluralType];
  let list = (state[pluralType] || []).filter(r => r.syncStatus !== 'pending_delete');
  if (pluralType === 'inspections') {
    list = list.filter(r => !isSystemInspectionRecord(r));
  }
  return list.sort((a, b) => {
    let valA = a[cfg.key];
    let valB = b[cfg.key];

    if (cfg.key === 'timestamp') {
      valA = new Date(valA || 0).getTime();
      valB = new Date(valB || 0).getTime();
    } else if (['hiveNum', 'ramkiCzerwiu', 'polkorpus', 'kgCukru', 'ramka'].includes(cfg.key)) {
      valA = parseFloat(valA) || 0;
      valB = parseFloat(valB) || 0;
    } else {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
    }

    if (valA < valB) return cfg.dir === 'asc' ? -1 : 1;
    if (valA > valB) return cfg.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderSortableHeader(pluralType, columns) {
  const thead = document.getElementById(`head-${pluralType}`);
  if (!thead) return;
  const cfg = sortConfig[pluralType];
  const ths = columns.map(col => {
    if (!col.key) return `<th>${col.label}</th>`;
    const arrow = cfg.key === col.key ? (cfg.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
    return `<th class="sortable" onclick="sortTableBy('${pluralType}', '${col.key}')">${col.label}<span style="font-size:0.75rem; color:#d97706;">${arrow}</span></th>`;
  }).join('');
  thead.innerHTML = `<tr>${ths}</tr>`;
}

function renderGlobalTables() {
  renderSortableHeader('inspections', [
    { key: 'timestamp', label: 'Data i Czas' },
    { key: 'hiveNum', label: 'Ul' },
    { key: 'rodzina', label: 'Rodzina' },
    { key: 'matka', label: 'Matka' },
    { key: 'jaja', label: 'Jaja' },
    { key: 'ramkiCzerwiu', label: 'Czerw' },
    { key: 'pokarm', label: 'Pokarm' },
    { key: 'polkorpus', label: 'Nadstawki' },
    { key: 'dzialania', label: 'Wykonane Działania' },
    { key: 'przyszleDzialania', label: 'Planowane Działania' },
    { key: null, label: 'Akcje' }
  ]);

  renderSortableHeader('feedings', [
    { key: 'timestamp', label: 'Data i Czas' },
    { key: 'hiveNum', label: 'Ul' },
    { key: 'kgCukru', label: 'Ilość (kg)' },
    { key: 'uwagi', label: 'Uwagi / Syrop' },
    { key: null, label: 'Akcje' }
  ]);

  renderSortableHeader('treatments', [
    { key: 'timestamp', label: 'Data i Czas' },
    { key: 'hiveNum', label: 'Ul' },
    { key: 'preparat', label: 'Preparat / Metoda' },
    { key: 'uwagi', label: 'Dawka / Uwagi' },
    { key: null, label: 'Akcje' }
  ]);

  renderSortableHeader('izos', [
    { key: 'timestamp', label: 'Data i Czas' },
    { key: 'hiveNum', label: 'Ul' },
    { key: 'izoType', label: 'Operacja (IZO)' },
    { key: 'ramka', label: 'Po ramce' },
    { key: 'kiedyLeczyc', label: 'Kiedy Leczyć' },
    { key: null, label: 'Akcje' }
  ]);

  const tbodyInsp = document.getElementById('sheet-tbody');
  const tbodyFeed = document.getElementById('feedings-tbody');
  const tbodyTreat = document.getElementById('treatments-tbody');
  const tbodyIzo = document.getElementById('izos-tbody');

  const activeInsp = getSortedRecords('inspections');
  const activeFeed = getSortedRecords('feedings');
  const activeTreat = getSortedRecords('treatments');
  const activeIzo = getSortedRecords('izos');

  if (tbodyInsp) tbodyInsp.innerHTML = activeInsp.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
      <td><b>Ul ${r.hiveNum}</b></td>
      <td>${r.rodzina || ''}</td>
      <td>${r.matka || ''}</td>
      <td>${r.jaja || ''}</td>
      <td>${r.ramkiCzerwiu || '0'}</td>
      <td>${r.pokarm || ''}</td>
      <td>${r.polkorpus || '0'}</td>
      <td>${r.dzialania || ''}</td>
      <td>${cleanTodoText(r.przyszleDzialania) || ''} ${isTodoDone(r) && cleanTodoText(r.przyszleDzialania) ? '✅' : ''}</td>
      <td>
        <button type="button" onclick="editRecord('${r.id}', 'inspection')" class="btn-small">✏️</button>
        <button type="button" onclick="deleteRecord('${r.id}', 'inspection')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if (tbodyFeed) tbodyFeed.innerHTML = activeFeed.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
      <td><b>Ul ${r.hiveNum}</b></td>
      <td><b>${r.kgCukru || '0'} kg</b></td>
      <td>${r.uwagi || ''}</td>
      <td>
        <button type="button" onclick="editRecord('${r.id}', 'feeding')" class="btn-small">✏️</button>
        <button type="button" onclick="deleteRecord('${r.id}', 'feeding')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if (tbodyTreat) tbodyTreat.innerHTML = activeTreat.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
      <td><b>Ul ${r.hiveNum}</b></td>
      <td><b>${r.preparat || ''}</b></td>
      <td>${r.uwagi || ''}</td>
      <td>
        <button type="button" onclick="editRecord('${r.id}', 'treatment')" class="btn-small">✏️</button>
        <button type="button" onclick="deleteRecord('${r.id}', 'treatment')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if (tbodyIzo) tbodyIzo.innerHTML = activeIzo.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
      <td><b>Ul ${r.hiveNum}</b></td>
      <td><b>${r.izoType || ''}</b></td>
      <td>Ramka: ${r.ramka || ''}</td>
      <td style="color:#dc2626; font-weight:bold;">${formatToPLDate(r.kiedyLeczyc) || ''}</td>
      <td>
        <button type="button" onclick="editRecord('${r.id}', 'izo')" class="btn-small">✏️</button>
        <button type="button" onclick="deleteRecord('${r.id}', 'izo')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
      </td>
    </tr>`).join('');
}

function renderLocalHistory(type, hiveNum) {
  const container = document.getElementById(`local-${type}-history`);
  if (!container) return;
  let data = (state[type + 's'] || [])
    .filter(d => String(d.hiveNum) === String(hiveNum) && d.syncStatus !== 'pending_delete' && !(type === 'inspection' && isSystemInspectionRecord(d)))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (data.length === 0) {
    container.innerHTML = `<p style="padding:10px; color:#6b7280; font-style:italic;">Brak wcześniejszych wpisów w tej kategorii dla Ula ${hiveNum}.</p>`;
    return;
  }
  
  if (type === 'inspection') {
    container.innerHTML = `
      <div class="table-scroll-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Data</th><th>Rodzina</th><th>Matka</th><th>Jaja</th><th>Czerw</th><th>Pokarm</th><th>Nadstawki</th><th>Wykonane Działania</th><th>Plan</th><th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr>
                <td><b>${fd(r.timestamp)}</b> ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
                <td>${r.rodzina || '-'}</td>
                <td>${r.matka || '-'}</td>
                <td>${r.jaja || '-'}</td>
                <td><b>${r.ramkiCzerwiu || '0'}</b></td>
                <td>${r.pokarm || '-'}</td>
                <td>${r.polkorpus || '0'}</td>
                <td>${r.dzialania || '-'}</td>
                <td>${cleanTodoText(r.przyszleDzialania) || '-'} ${isTodoDone(r) && cleanTodoText(r.przyszleDzialania) ? '✅' : ''}</td>
                <td>
                  <button type="button" onclick="editRecord('${r.id}', 'inspection')" class="btn-small">✏️</button>
                  <button type="button" onclick="deleteRecord('${r.id}', 'inspection', '${hiveNum}')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } else if (type === 'feeding') {
    container.innerHTML = `
      <div class="table-scroll-container">
        <table class="data-table">
          <thead>
            <tr><th>Data</th><th>Ul</th><th>Ilość (kg)</th><th>Uwagi</th><th>Akcje</th></tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr>
                <td><b>${fd(r.timestamp)}</b> ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
                <td>Ul ${r.hiveNum}</td>
                <td><b>${r.kgCukru || '0'} kg</b></td>
                <td>${r.uwagi || '-'}</td>
                <td>
                  <button type="button" onclick="editRecord('${r.id}', 'feeding')" class="btn-small">✏️</button>
                  <button type="button" onclick="deleteRecord('${r.id}', 'feeding', '${hiveNum}')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } else if (type === 'treatment') {
    container.innerHTML = `
      <div class="table-scroll-container">
        <table class="data-table">
          <thead>
            <tr><th>Data</th><th>Ul</th><th>Preparat / Metoda</th><th>Dawka / Uwagi</th><th>Akcje</th></tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr>
                <td><b>${fd(r.timestamp)}</b> ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
                <td>Ul ${r.hiveNum}</td>
                <td><b>${r.preparat || '-'}</b></td>
                <td>${r.uwagi || '-'}</td>
                <td>
                  <button type="button" onclick="editRecord('${r.id}', 'treatment')" class="btn-small">✏️</button>
                  <button type="button" onclick="deleteRecord('${r.id}', 'treatment', '${hiveNum}')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } else if (type === 'izo') {
    container.innerHTML = `
      <div class="table-scroll-container">
        <table class="data-table">
          <thead>
            <tr><th>Data</th><th>Ul</th><th>Operacja</th><th>Po ramce</th><th>Kiedy leczyć (+24 dni)</th><th>Akcje</th></tr>
          </thead>
          <tbody>
            ${data.map(r => `
              <tr>
                <td><b>${fd(r.timestamp)}</b> ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td>
                <td>Ul ${r.hiveNum}</td>
                <td><b>${r.izoType || '-'}</b></td>
                <td>Ramka ${r.ramka || '-'}</td>
                <td style="color:#dc2626; font-weight:bold;">${formatToPLDate(r.kiedyLeczyc) || '-'}</td>
                <td>
                  <button type="button" onclick="editRecord('${r.id}', 'izo')" class="btn-small">✏️</button>
                  <button type="button" onclick="deleteRecord('${r.id}', 'izo', '${hiveNum}')" class="btn-small" style="background:#dc2626; color:white;">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }
}

function buildTodoItemHTML(t) {
  const isDone = isTodoDone(t);
  const standalone = isStandaloneNote(t);
  const strike = isDone ? 'text-decoration: line-through; color: #6b7280;' : '';
  const boxMark = isDone ? '✓' : '&nbsp;';
  const boxStyle = isDone 
    ? 'background:#059669; color:white; border:2px solid #047857;' 
    : 'background:white; color:#111827; border:2px solid #d97706;';

  const targetBadgeLabel = getTodoTargetLabel(t);
  const isWholeApiary = standalone && String(t.matka || '').toUpperCase().includes('PASIEKA');
  const badgeColor = isWholeApiary
    ? 'background:#d1fae5; color:#065f46; border:1px solid #34d399;' 
    : 'background:#fef3c7; color:#92400e; border:1px solid #f59e0b;';
  const typeLabel = standalone ? '📝 Niezależna notatka' : '📋 Notatka z przeglądu';
  const statusBadge = isDone 
    ? '<span style="background:#059669; color:#fff; padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:bold;">✅ WYKONANE</span>'
    : '<span style="background:#f59e0b; color:#fff; padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:bold;">⏳ DO ZROBIENIA</span>';
  const textClean = cleanTodoText(t.przyszleDzialania);

  return `<li style="padding: 12px 14px; border: 1px solid ${isDone ? '#a7f3d0' : '#fde68a'}; display:flex; align-items:center; gap:12px; background:${isDone ? '#f0fdf4' : '#fffbeb'}; margin-bottom:8px; border-radius:8px; flex-wrap:wrap;">
    <button type="button" onclick="toggleTodo('${t.id}')" style="width:36px; height:36px; font-weight:900; font-size:1.15rem; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; ${boxStyle}" title="Kliknij, aby zmienić status (Wykonane / Niewykonane)">
      ${boxMark}
    </button>
    <div style="flex:1; min-width:200px;">
      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:4px;">
        ${statusBadge}
        <span style="${badgeColor} padding:2px 8px; border-radius:6px; font-weight:bold; font-size:0.85rem;">${targetBadgeLabel}</span>
        <span style="font-size:0.78rem; color:#374151; background:#e5e7eb; padding:2px 6px; border-radius:4px;">${typeLabel}</span>
        <small style="color:#4b5563; font-weight:bold;">📅 ${fd(t.timestamp)} ${t.syncStatus === 'pending_save' ? '🟠' : ''}</small>
      </div>
      <div style="font-weight:700; font-size:1.02rem; word-break:break-word; ${strike}">${textClean}</div>
    </div>
    <div style="display:flex; gap:6px; align-items:center;">
      <button type="button" onclick="toggleTodo('${t.id}')" class="btn-small" style="background:${isDone ? '#f59e0b' : '#059669'}; color:white; font-weight:bold;">
        ${isDone ? '↩ Niewykonane' : '✓ Wykonane'}
      </button>
      <button type="button" onclick="editRecord('${t.id}', 'inspection')" class="btn-small" title="Edytuj">✏️</button>
      <button type="button" onclick="deleteRecord('${t.id}', 'inspection')" class="btn-small" style="background:#dc2626; color:white;" title="Usuń">🗑️</button>
    </div>
  </li>`;
}

function getAllValidTodos() {
  const combinedMap = new Map();

  (state.inspections || []).forEach(item => {
    if (item && item.id) combinedMap.set(item.id, item);
  });

  const backupMap = getBackupTodosMap();
  Object.values(backupMap).forEach(item => {
    if (item && item.id && !combinedMap.has(item.id)) {
      combinedMap.set(item.id, item);
      state.inspections.push(item);
    }
  });

  return Array.from(combinedMap.values()).filter(i => {
    if (i.syncStatus === 'pending_delete') return false;
    if (isQueenRecord(i)) return false;
    const val = cleanTodoText(i.przyszleDzialania);
    const lower = val.toLowerCase();
    return val.length > 0 && lower !== '0' && lower !== 'brak' && lower !== 'brak planów' && lower !== 'brak planu' && lower !== 'brak uwag' && lower !== 'brak dzialan' && lower !== 'brak działań' && lower !== 'nie' && lower !== '-';
  });
}

function renderTodos() {
  const ulPending = document.getElementById('todo-list-pending');
  const ulDone = document.getElementById('todo-list-done');
  const ulSingle = document.getElementById('todo-list');

  const allTodos = getAllValidTodos();

  if (ulPending && ulDone) {
    const pendingList = allTodos
      .filter(t => !isTodoDone(t))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const doneTabList = allTodos.slice().sort((a, b) => {
      const doneA = isTodoDone(a) ? 1 : 0;
      const doneB = isTodoDone(b) ? 1 : 0;
      if (doneA !== doneB) return doneB - doneA;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    const countAllEl = document.getElementById('count-todo-all');
    const countPendingEl = document.getElementById('count-todo-pending');
    const countDoneEl = document.getElementById('count-todo-done');
    if (countAllEl) countAllEl.innerText = allTodos.length;
    if (countPendingEl) countPendingEl.innerText = pendingList.length;
    if (countDoneEl) countDoneEl.innerText = doneTabList.length;

    ulPending.innerHTML = pendingList.length === 0
      ? '<li style="padding:14px; color:#6b7280; font-style:italic;">Brak bieżących zadań do zrobienia – wszystko wykonane! 🎉</li>'
      : pendingList.map(t => buildTodoItemHTML(t)).join('');

    ulDone.innerHTML = doneTabList.length === 0
      ? '<li style="padding:14px; color:#6b7280; font-style:italic;">Brak zapisanych notatek niezależnych i zadań z przeglądów.</li>'
      : doneTabList.map(t => buildTodoItemHTML(t)).join('');
  } else if (ulSingle) {
    const sorted = allTodos.slice().sort((a, b) => {
      const doneA = isTodoDone(a);
      const doneB = isTodoDone(b);
      if (doneA !== doneB) return doneA ? 1 : -1;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    ulSingle.innerHTML = sorted.length === 0
      ? '<li style="padding:14px; color:#6b7280; font-style:italic;">Brak zaplanowanych zadań i notatek! 🎉</li>'
      : sorted.map(t => buildTodoItemHTML(t)).join('');
  }
}

function isTodoDone(recordOrId) {
  let rec = typeof recordOrId === 'object' ? recordOrId : state.inspections.find(r => r.id === recordOrId);
  if (rec) {
    if (String(rec.przyszleDzialania || '').trim().toUpperCase().startsWith('[X]')) return true;
    if (isStandaloneNote(rec) && rec.dzialania === 'WYKONANE') return true;
    if (isStandaloneNote(rec) && rec.dzialania === 'DO ZROBIENIA') return false;
  }
  const id = typeof recordOrId === 'object' ? recordOrId.id : recordOrId;
  try { return localStorage.getItem('todo_done_' + id) === 'true'; } catch (e) { return false; }
}

async function toggleTodo(id) {
  let rec = state.inspections.find(r => r.id === id);
  if (!rec) {
    const backup = getBackupTodosMap();
    rec = backup[id];
  }
  if (!rec) return;

  const currentlyDone = isTodoDone(rec);
  const newDone = !currentlyDone;
  const cleanText = cleanTodoText(rec.przyszleDzialania);

  rec.przyszleDzialania = newDone ? `[X] ${cleanText}` : cleanText;
  if (isStandaloneNote(rec)) {
    rec.dzialania = newDone ? 'WYKONANE' : 'DO ZROBIENIA';
  }
  rec.updatedAt = Date.now().toString();
  rec.syncStatus = 'pending_save';

  try {
    localStorage.setItem('todo_done_' + id, newDone.toString());
  } catch (e) {}

  await saveLocalRecord('inspection', rec);
  renderTodos();
  updateHiveCards();
  updatePendingCount();
  updateSyncUI();
  showToast(newDone ? "Oznaczono jako WYKONANE (Zrobione) ✅" : "Oznaczono jako NIEWYKONANE (Do zrobienia) ⏳", "info");
  if (navigator.onLine) syncData(false);
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

// ⬇️ TEN LOG NA SAMYM DOLE MUSI BYĆ SKOPIOWANY! Zabezpiecza aplikację przed błędem składni.
console.log("PASIEKA v9.3: Kod app.js załadowany w całości!");
