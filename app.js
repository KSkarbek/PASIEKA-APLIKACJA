// PASIEKA - SILNIK APLIKACJI Z DWUKIERUNKOWĄ SYNCHRONIZACJĄ I NOTATKAMI ZROBIĆ (ODPORNY NA TARCZE BRAVE)

const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbzPnyxsCd1qtle4cQWaH7b4xVmm7fTic2Cd0A2N4hdMQxlKKDbICO51-rblndVwrFEvGQ/exec'; 
let lastActiveHiveTab = 'tab-dom';

let state = {
  inspections: [],
  feedings: [],
  treatments: [],
  izos: [],
  syncPendingCount: 0,
  isSyncing: false
};

// Stan sortowania tabel (jak w Excelu)
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

function isStandaloneNote(rec) {
  return rec && String(rec.rodzina) === 'NOTATKA_ZROBIC';
}

function getTodoTargetLabel(hiveNum) {
  const num = String(hiveNum);
  if (num === '99') return '🐝 Ogólna (Cała Pasieka)';
  if (num === '91') return '🏡 Pasieka DOM';
  if (num === '92') return '🌾 Pasieka ZBIÓR';
  if (num === '93') return '🌲 Pasieka LAS';
  return `Ul ${num}`;
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

// BAZA DANYCH Z BEZPIECZNIKIEM CZASOWYM DLA BRAVE
const DB_NAME = 'PasiekaDB';
const DB_VERSION = 1;
let db = null;

function initDB() {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (val) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };
    // Jeśli Brave zawiesi IndexedDB, po 1.2 sekundy przechodzimy na LocalStorage
    setTimeout(() => finish(null), 1200);

    try {
      if (!window.indexedDB) {
        finish(null);
        return;
      }
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
    } catch (err) {
      console.warn("IndexedDB zablokowane przez przeglądarkę, używam LocalStorage:", err);
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
          saveFallbackLocalStorageAll(storeName, res);
          resolve(res);
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
function saveFallbackLocalStorageAll(storeName, items) {
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

// INICJALIZACJA APLIKACJI - NAJPIERW KAFELKI I INTERFEJS, POTEM BAZA
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Natychmiast rysujemy kafelki uli, formularz ZROBIĆ i zakładki
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

  // 2. Dopiero teraz inicjujemy bazę i ładujemy zapisane dane
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
    showToast("Połączono z siecią 🟢 Rozpoczynam synchronizację...", "info");
    syncData(false);
  });
  window.addEventListener('offline', () => {
    updateSyncUI();
    showToast("Tryb Offline 🟠 Dane zapisywane w pamięci urządzenia.", "warning");
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
    if (userTriggered) showToast("Wklej najpierw link Webhooka w zakładce Arkusz / Ustawienia!", "warning");
    return;
  }
  if (!navigator.onLine) {
    if (userTriggered) showToast("Brak internetu. Dane są bezpieczne na urządzeniu.", "warning");
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

      if (!batchSuccess) {
        for (let change of changesToUpload) {
          try {
            const reqBody = change.deleted 
              ? { action: 'delete', type: change.type, id: change.data.id }
              : { type: change.type, ...change.data };
            const singleResp = await fetch(webhookUrl, { method: 'POST', body: JSON.stringify(reqBody) });
            const singleJson = await singleResp.json();
            if (singleJson && (singleJson.status === 'success' || (singleJson.message && singleJson.message.includes('Zapisano')))) {
              if (change.deleted) await deleteLocalRecordPermanent(change.localType, change.data.id);
              else {
                const storeName = change.localType + 's';
                const rec = state[storeName].find(r => r.id === change.data.id);
                if (rec) { rec.syncStatus = 'synced'; await saveLocalRecord(change.localType, rec); }
              }
            }
          } catch (eSingle) { console.error("Błąd wysyłki pojedynczej:", eSingle); }
        }
      } else {
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
    if (userTriggered) showToast("Błąd połączenia z Arkuszem Google. Sprawdź Tarcze Brave!", "error");
  } finally {
    state.isSyncing = false;
    updatePendingCount();
    updateSyncUI();
  }
}

// OBSŁUGA NIEZALEŻNEGO FORMULARZA W ZAKŁADCE ZROBIĆ
function initTodoForm() {
  const form = document.getElementById('todo-form');
  const dateInput = document.getElementById('input-todo-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = getCurrentLocalISO();
  }
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-todo');
    if (btn) btn.disabled = true;
    setTimeout(() => { if (btn) btn.disabled = false; }, 1000);

    const isEdit = !!form.dataset.editId;
    const recordId = isEdit ? form.dataset.editId : 'todo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const targetHive = document.getElementById('select-todo-target')?.value || '99';
    const dateVal = document.getElementById('input-todo-date')?.value || getCurrentLocalISO();
    const textVal = cleanTodoText(document.getElementById('input-todo-text')?.value || '');

    if (!textVal) {
      showToast("Wpisz treść notatki!", "warning");
      return;
    }

    // Zachowaj status [X] podczas edycji, jeśli zadanie było już odhaczone
    let existingDone = false;
    if (isEdit) {
      const existingRec = state.inspections.find(r => r.id === recordId);
      if (existingRec && isTodoDone(existingRec)) existingDone = true;
    }

    const finalText = existingDone ? `[X] ${textVal}` : textVal;

    const payload = {
      id: recordId,
      timestamp: dateVal,
      hiveNum: String(targetHive),
      rodzina: 'NOTATKA_ZROBIC',
      matka: '-',
      jaja: '-',
      ramkiCzerwiu: '0',
      pokarm: '-',
      polkorpus: '0',
      dzialania: existingDone ? 'WYKONANE' : '',
      przyszleDzialania: finalText,
      updatedAt: Date.now().toString(),
      syncStatus: 'pending_save'
    };

    await saveLocalRecord('inspection', payload);
    await loadStateFromLocal();
    resetTodoForm();
    showToast(isEdit ? "Zaktualizowano notatkę!" : "Dodano nową notatkę do ZROBIĆ!", "success");

    if (navigator.onLine) syncData(false);
  });
}

function resetTodoForm() {
  const form = document.getElementById('todo-form');
  if (form) {
    delete form.dataset.editId;
  }
  const title = document.getElementById('todo-form-title');
  if (title) title.innerText = '➕ Dodaj Notatkę / Zadanie do Zrobienia';
  const btn = document.getElementById('btn-submit-todo');
  if (btn) btn.innerHTML = '💾 ZAPISZ NOTATKĘ (SYNCHRONIZUJ)';
  const cancelBtn = document.getElementById('btn-cancel-todo-edit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  const textInput = document.getElementById('input-todo-text');
  if (textInput) textInput.value = '';
  const targetSelect = document.getElementById('select-todo-target');
  if (targetSelect) targetSelect.value = '99';
  const dateInput = document.getElementById('input-todo-date');
  if (dateInput) dateInput.value = getCurrentLocalISO();
}

function editStandaloneTodo(id) {
  const rec = state.inspections.find(r => r.id === id);
  if (!rec) return;

  // Upewnij się, że jesteśmy w zakładce ZROBIĆ
  const todoTabBtn = document.querySelector('.tab-btn[data-tab="tab-todo"]');
  if (todoTabBtn && !todoTabBtn.classList.contains('active')) {
    todoTabBtn.click();
  }

  const form = document.getElementById('todo-form');
  if (form) form.dataset.editId = id;

  const title = document.getElementById('todo-form-title');
  if (title) title.innerText = '✏️ Edycja Notatki / Zadania';

  const btn = document.getElementById('btn-submit-todo');
  if (btn) btn.innerHTML = '💾 ZAKTUALIZUJ NOTATKĘ';

  const cancelBtn = document.getElementById('btn-cancel-todo-edit');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  const targetSelect = document.getElementById('select-todo-target');
  if (targetSelect) targetSelect.value = String(rec.hiveNum || '99');

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
      setTimeout(() => { if (btn) btn.disabled = false; }, 1200);

      const isEdit = !!formEl.dataset.editId;
      const recordId = isEdit ? formEl.dataset.editId : 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const nowTime = Date.now().toString();
      const currentHive = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`).value;
      const currentDateVal = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value;

      let payload = {
        id: recordId,
        timestamp: currentDateVal,
        hiveNum: String(currentHive),
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
  if (item) {
    const hiveToRefresh = currentHiveNum || item.hiveNum;
    item.syncStatus = 'pending_delete';
    item.updatedAt = Date.now().toString();
    await saveLocalRecord(type, item);
    await loadStateFromLocal();
    if (hiveToRefresh && parseInt(hiveToRefresh) <= 18) renderLocalHistory(type, hiveToRefresh);
    showToast("Wpis oznaczony do usunięcia.", "warning");
    if (navigator.onLine) syncData(false);
  }
}

function editRecord(id, type) {
  const record = state[type + 's'].find(r => r.id === id);
  if (!record) return;

  // Jeśli to niezależna notatka z zakładki ZROBIĆ, otwórz ją w formularzu ZROBIĆ
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

function saveQueenNote(hiveNum) {
  const input = document.getElementById(`queen-note-${hiveNum}`);
  if (!input) return;
  try {
    localStorage.setItem(`pasieka_queen_${hiveNum}`, input.value.trim());
    showToast(`Zapisano opis matki dla Ula ${hiveNum} 👑`, 'success');
  } catch (e) {
    showToast('Błąd zapisu opisu matki', 'error');
  }
}

function getQueenNote(hiveNum) {
  try { return localStorage.getItem(`pasieka_queen_${hiveNum}`) || ''; } catch (e) { return ''; }
}

function initHives() {
  const renderGrid = (start, end, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    let html = '';
    for (let i = start; i <= end; i++) {
      const qNote = getQueenNote(i).replace(/"/g, '&quot;');
      html += `
        <div class="hive-card">
          <div class="hive-card-top">
            <div class="hive-number-prominent">Ul ${i}</div>
            <div class="queen-note-box">
              <span>👑</span>
              <input type="text" id="queen-note-${i}" value="${qNote}" placeholder="Opis matki (np. Krainka 25)" onchange="saveQueenNote(${i})">
              <button type="button" class="btn-queen-save" onclick="saveQueenNote(${i})" title="Zapisz opis matki">💾</button>
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
    let descDiv = document.getElementById(`hive-desc-${i}`);
    if (!descDiv) continue;
    // Ignorujemy niezależne notatki przy wyświetlaniu ostatniego fizycznego przeglądu ula
    let hiveInspections = state.inspections
      .filter(r => String(r.hiveNum) === String(i) && r.syncStatus !== 'pending_delete' && !isStandaloneNote(r))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (hiveInspections.length > 0) {
      let last = hiveInspections[0];
      const planClean = cleanTodoText(last.przyszleDzialania);
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
          ${planClean && planClean !== '0' && planClean.toLowerCase() !== 'brak' ? `<div class="hive-last-plan">📋 <b>Plan:</b> ${planClean}</div>` : ''}
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
  // W tabeli przeglądów uli ukrywamy niezależne notatki ogólne (są widoczne w zakładce ZROBIĆ)
  if (pluralType === 'inspections') {
    list = list.filter(r => !isStandaloneNote(r));
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
      <td>${cleanTodoText(r.przyszleDzialania) || ''}</td>
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
    .filter(d => String(d.hiveNum) === String(hiveNum) && d.syncStatus !== 'pending_delete' && !(type === 'inspection' && isStandaloneNote(d)))
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
                <td>${cleanTodoText(r.przyszleDzialania) || '-'}</td>
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

// RENDEROWANIE ZADAŃ I NOTATEK W ZAKŁADCE ZROBIĆ (Z SYNCHRONIZACJĄ STATUSU [X])
function renderTodos() {
  const ul = document.getElementById('todo-list');
  if (!ul) return;
  let todos = state.inspections.filter(i => {
    if (i.syncStatus === 'pending_delete') return false;
    const val = cleanTodoText(i.przyszleDzialania);
    const lower = val.toLowerCase();
    return val.length > 0 && lower !== '0' && lower !== 'brak' && lower !== 'brak planów' && lower !== 'brak planu' && lower !== 'brak uwag' && lower !== 'brak dzialan' && lower !== 'brak działań' && lower !== 'nie' && lower !== '-';
  });

  // Sortowanie: najpierw zadania NIEWYKONANE, potem wykonane; wewnątrz grupy według daty
  todos.sort((a, b) => {
    const doneA = isTodoDone(a) ? 1 : 0;
    const doneB = isTodoDone(b) ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  if (todos.length === 0) {
    ul.innerHTML = '<li style="padding:16px; color:#6b7280; font-style:italic;">Brak zaplanowanych zadań i notatek do wykonania.</li>';
    return;
  }

  ul.innerHTML = todos.map(t => {
    const isDone = isTodoDone(t);
    const standalone = isStandaloneNote(t);
    const strike = isDone ? 'text-decoration: line-through; color: #9ca3af;' : '';
    const boxMark = isDone ? 'X' : '&nbsp;';
    const boxStyle = isDone 
      ? 'background:#059669; color:white; border:2px solid #047857;' 
      : 'background:white; color:#111827; border:2px solid #374151;';

    const targetBadgeLabel = getTodoTargetLabel(t.hiveNum);
    const badgeColor = standalone 
      ? 'background:#d1fae5; color:#065f46; border:1px solid #34d399;' 
      : 'background:#fef3c7; color:#92400e;';
    const typeLabel = standalone ? '📝 Notatka' : '📋 Z przeglądu';
    const textClean = cleanTodoText(t.przyszleDzialania);

    return `<li style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; display:flex; align-items:center; gap:12px; background:${isDone ? '#f3f4f6' : '#ecfdf5'}; margin-bottom:8px; border-radius:8px; flex-wrap:wrap;">
      <button type="button" onclick="toggleTodo('${t.id}')" style="width:34px; height:34px; font-weight:900; font-size:1.1rem; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; ${boxStyle}" title="Oznacz jako wykonane / niewykonane">
        ${boxMark}
      </button>
      <div style="flex:1; min-width:200px; ${strike}">
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:4px;">
          <span style="${badgeColor} padding:2px 8px; border-radius:6px; font-weight:bold; font-size:0.85rem;">${targetBadgeLabel}</span>
          <span style="font-size:0.78rem; color:#4b5563; background:#e5e7eb; padding:2px 6px; border-radius:4px;">${typeLabel}</span>
          <small style="color:#6b7280; font-weight:bold;">📅 ${fd(t.timestamp)} ${t.syncStatus === 'pending_save' ? '🟠' : ''}</small>
        </div>
        <div style="font-weight:700; font-size:1.02rem; word-break:break-word;">${textClean}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button type="button" onclick="editRecord('${t.id}', 'inspection')" class="btn-small" title="Edytuj">✏️</button>
        <button type="button" onclick="deleteRecord('${t.id}', 'inspection')" class="btn-small" style="background:#dc2626; color:white;" title="Usuń">🗑️</button>
      </div>
    </li>`;
  }).join('');
}

function isTodoDone(recordOrId) {
  let rec = typeof recordOrId === 'object' ? recordOrId : state.inspections.find(r => r.id === recordOrId);
  if (rec) {
    if (String(rec.przyszleDzialania || '').trim().toUpperCase().startsWith('[X]')) return true;
    if (isStandaloneNote(rec) && rec.dzialania === 'WYKONANE') return true;
  }
  const id = typeof recordOrId === 'object' ? recordOrId.id : recordOrId;
  try { return localStorage.getItem('todo_done_' + id) === 'true'; } catch (e) { return false; }
}

async function toggleTodo(id) {
  const rec = state.inspections.find(r => r.id === id);
  if (!rec) return;

  const currentlyDone = isTodoDone(rec);
  const newDone = !currentlyDone;
  const cleanText = cleanTodoText(rec.przyszleDzialania);

  // Zapisujemy znacznik [X] bezpośrednio w polu przyszleDzialania, aby zsynchronizował się z Arkuszem Google i drugim urządzeniem
  rec.przyszleDzialania = newDone ? `[X] ${cleanText}` : cleanText;
  if (isStandaloneNote(rec)) {
    rec.dzialania = newDone ? 'WYKONANE' : '';
  }
  rec.updatedAt = Date.now().toString();
  rec.syncStatus = 'pending_save';

  try {
    localStorage.setItem('todo_done_' + id, newDone.toString());
  } catch (e) {}

  await saveLocalRecord('inspection', rec);
  await loadStateFromLocal();
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
