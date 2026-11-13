// PASIEKA v9.2 - CAŁKOWITA BLOKADA ZNIKANIA ZADAŃ (SYNCHRONICZNY ZAPIS + DEDYKOWANY REJESTR ZADAŃ)

// 👇 JEŚLI CHCESZ, WKLEJ SWÓJ LINK WEBHOOKA MIĘDZY APOSTROFY PONIŻEJ:
const DEFAULT_WEBHOOK = ''; 

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

// ROZPOZNAWANIE REKORDÓW SPECJALNYCH
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

// ============================================================================
// NIEZAWODNY MAGAZYN DANYCH (SYNCHRONICZNY LOCALSTORAGE + KOPIA ZAPASOWA ZADAŃ)
// Eliminuje błąd wyścigu transakcji IndexedDB w Brave, który kasował poprzednie zadania!
// ============================================================================
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

// Bezpieczny odczyt łączący pamięć state, localStorage, backup zadań oraz IndexedDB
async function getLocalRecords(type) {
  const storeName = type + 's';
  const mergedMap = new Map();

  // 1. Najpierw wczytaj to, co już jest w pamięci RAM (state)
  if (Array.isArray(state[storeName])) {
    state[storeName].forEach(item => {
      if (item && item.id) mergedMap.set(item.id, item);
    });
  }

  // 2. Dodaj / zaktualizuj rekordy z localStorage
  const lsItems = getFallbackLocalStorage(storeName);
  lsItems.forEach(item => {
    if (item && item.id) {
      const existing = mergedMap.get(item.id);
      if (!existing || parseInt(item.updatedAt || '0') >= parseInt(existing.updatedAt || '0')) {
        mergedMap.set(item.id, item);
      }
    }
  });

  // 3. Dla przeglądów (inspections) dołącz również niezniszczalny backup zadań ZROBIĆ
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

  // 4. Sprawdź IndexedDB (z limitem czasu 400ms, żeby nigdy nie przywiesić Brave)
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
        // IndexedDB nigdy nie może nadpisać nowszego rekordu ani przywrócić usuniętego
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

// Natychmiastowy, atomowy zapis rekordu (zero gubienia poprzednich wpisów!)
async function saveLocalRecord(type, record) {
  const storeName = type + 's';
  if (!Array.isArray(state[storeName])) state[storeName] = [];

  // 1. Zaktualizuj w pamięci RAM (state)
  const memIdx = state[storeName].findIndex(i => i.id === record.id);
  if (memIdx >= 0) state[storeName][memIdx] = record;
  else state[storeName].push(record);

  // 2. Zaktualizuj w localStorage (łącząc z tym, co już tam jest)
  const lsList = getFallbackLocalStorage(storeName);
  const lsMap = new Map();
  lsList.forEach(i => { if (i && i.id) lsMap.set(i.id, i); });
  state[storeName].forEach(i => { if (i && i.id) lsMap.set(i.id, i); });
  lsMap.set(record.id, record);
  const combinedList = Array.from(lsMap.values());
  saveFallbackLocalStorageAll(storeName, combinedList);
  state[storeName] = combinedList;

  // 3. Jeśli to notatka ZROBIĆ lub przegląd z zadaniem – zapisz w dedykowanym backupie zadań
  if (type === 'inspection' && (isStandaloneNote(record) || cleanTodoText(record.przyszleDzialania).length > 0)) {
    if (record.syncStatus === 'pending_delete') {
      removeFromBackupTodos(record.id);
    } else {
      saveToBackupTodos(record);
    }
  }

  // 4. Zapisz w tle do IndexedDB (bez blokowania głównego wątku)
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

// INICJALIZACJA APLIKACJI
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

// BEZPIECZNA SYNCHRONIZACJA Z GOOGLE SHEETS (SCALAJĄCA – NIGDY NIE KASUJE ZADAŃ Z LISTY!)
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

    // Pobieranie aktualnego stanu z Google Sheets i bezpieczne scalanie (MERGE)
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
              // Nasza wersja lokalna jest nowsza lub właśnie została wysłana
              localItem.syncStatus = 'synced';
              await saveLocalRecord(t, localItem);
            }
          }
        }
        // CAŁKOWICIE USUNIĘTO PĘTLĘ KASUJĄCĄ LOKALNE WPISY PRZY SYNCHRONIZACJI!
        // Rekord znika wyłącznie wtedy, gdy sam klikniesz ikonkę kosza 🗑️.
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
  if (btnDone) btnDone.style.opacity = mode ===
