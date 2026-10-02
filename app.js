// PASIEKA - SILNIK APLIKACJI Z DWUKIERUNKOWĄ SYNCHRONIZACJĄ (OFFLINE-FIRST)

const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbzPnyxsCd1qtle4cQWaH7b4xVmm7fTic2Cd0A2N4hdMQxlKKDbICO51-rblndVwrFEvGQ/exec
'; 
let state = {
  inspections: [],
  feedings: [],
  treatments: [],
  izos: [],
  syncPendingCount: 0,
  isSyncing: false
};

const TYPES = ['inspection', 'feeding', 'treatment', 'izo'];

// Konfiguracja sortowania dla głównej Historii (Excel-style)
let sortConfig = {
  inspections: { col: 'timestamp', dir: 'desc' },
  feedings: { col: 'timestamp', dir: 'desc' },
  treatments: { col: 'timestamp', dir: 'desc' },
  izos: { col: 'timestamp', dir: 'desc' }
};

function getWebhookUrl() {
  const custom = localStorage.getItem('gsheet_webhook');
  return (custom && custom.trim() !== '') ? custom.trim() : DEFAULT_WEBHOOK;
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

  if (isDateString(rawHive) && isHiveNum(rawTime)) { hiveNum = parseInt(rawTime); timestampStr = rawHive; } 
  else if (isHiveNum(rawHive) && isDateString(rawTime)) { hiveNum = parseInt(rawHive); timestampStr = rawTime; } 
  else if (isHiveNum(rawHive)) { hiveNum = parseInt(rawHive); timestampStr = rawTime; } 
  else if (isHiveNum(rawTime)) { hiveNum = parseInt(rawTime); timestampStr = rawHive; } 
  else {
    let matchH = String(rawHive).match(/^\d+$/);
    let matchT = String(rawTime).match(/^\d+$/);
    if (matchH && parseInt(matchH[0]) <= 100) { hiveNum = parseInt(matchH[0]); timestampStr = rawTime; } 
    else if (matchT && parseInt(matchT[0]) <= 100) { hiveNum = parseInt(matchT[0]); timestampStr = rawHive; }
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
    normalized.rodzina = row.rodzina || ''; normalized.matka = row.matka || ''; normalized.jaja = row.jaja || '';
    normalized.ramkiCzerwiu = row.ramkiCzerwiu || '0'; normalized.pokarm = row.pokarm || ''; normalized.polkorpus = row.polkorpus || '0';
    normalized.dzialania = row.dzialania || ''; normalized.przyszleDzialania = row.przyszleDzialania || '';
  } else if (type === 'feeding') {
    let kg = row.kgCukru; let uw = row.uwagi;
    if (isNaN(parseFloat(kg)) && !isNaN(parseFloat(uw))) { kg = uw; uw = row.updatedAt || ''; }
    normalized.kgCukru = String(kg || '0'); normalized.uwagi = String(uw || '');
  } else if (type === 'treatment') {
    normalized.preparat = row.preparat || ''; normalized.uwagi = row.uwagi || '';
  } else if (type === 'izo') {
    let izoTypeVal = row.izoType || row.ramka || 'IZO-pocz';
    if (String(izoTypeVal).includes('Ul')) izoTypeVal = row.ramka || 'IZO-pocz';
    let rNum = row.ramka;
    if (isNaN(parseInt(rNum)) && !isNaN(parseInt(row.kiedyLeczyc))) { rNum = row.kiedyLeczyc; }
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
    if (!window.indexedDB) { resolve(null); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => resolve(null);
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      TYPES.forEach(t => {
        const storeName = t + 's';
        if (!dbInstance.objectStoreNames.contains(storeName)) dbInstance.createObjectStore(storeName, { keyPath: 'id' });
      });
    };
  });
}

async function getLocalRecords(type) {
  const storeName = type + 's';
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve(getFallbackLocalStorage(storeName));
      } catch (e) { resolve(getFallbackLocalStorage(storeName)); }
    });
  }
  return getFallbackLocalStorage(storeName);
}

async function saveLocalRecord(type, record) {
  const storeName = type + 's';
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(saveFallbackLocalStorage(storeName, record));
      } catch (e) { resolve(saveFallbackLocalStorage(storeName, record)); }
    });
  }
  return saveFallbackLocalStorage(storeName, record);
}

async function deleteLocalRecordPermanent(type, id) {
  const storeName = type + 's';
  if (db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(deleteFallbackLocalStorage(storeName, id));
      } catch (e) { resolve(deleteFallbackLocalStorage(storeName, id)); }
    });
  }
  return deleteFallbackLocalStorage(storeName, id);
}

function getFallbackLocalStorage(storeName) {
  try { return JSON.parse(localStorage.getItem('pasieka_' + storeName) || '[]'); } catch (e) { return []; }
}
function saveFallbackLocalStorage(storeName, record) {
  let items = getFallbackLocalStorage(storeName);
  const idx = items.findIndex(i => i.id === record.id);
  if (idx >= 0) items[idx] = record; else items.push(record);
  localStorage.setItem('pasieka_' + storeName, JSON.stringify(items));
  return true;
}
function deleteFallbackLocalStorage(storeName, id) {
  let items = getFallbackLocalStorage(storeName).filter(i => i.id !== id);
  localStorage.setItem('pasieka_' + storeName, JSON.stringify(items));
  return true;
}

window.saveQueen = function(hiveNum) {
  const input = document.getElementById('queen-input-' + hiveNum);
  if (input) {
    localStorage.setItem('queen_' + hiveNum, input.value);
    showToast('💾 Zapisano matkę dla ula ' + hiveNum, 'success');
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  await loadStateFromLocal();
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
  if (izoDateInput) izoDateInput.addEventListener('change', (e) => updateIzoLeczenieDate(e.target.value));

  syncData(false);
});

async function loadStateFromLocal() {
  for (let t of TYPES) state[t + 's'] = await getLocalRecords(t);
  updatePendingCount();
  renderGlobalTables();
  renderTodos();
  updateHiveCards();
  updateSyncUI();
}

function updatePendingCount() {
  let count = 0;
  TYPES.forEach(t => { state[t + 's'].forEach(r => { if (r.syncStatus && r.syncStatus !== 'synced') count++; }); });
  state.syncPendingCount = count;
}

function initNetworkListeners() {
  window.addEventListener('online', () => { updateSyncUI(); syncData(false); });
  window.addEventListener('offline', () => { updateSyncUI(); showToast("Tryb Offline 🟠 Brak połączenia.", "warning"); });
}

function updateSyncUI() {
  const badge = document.getElementById('sync-status-badge');
  if (!badge) return;
  if (state.isSyncing) { badge.className = 'sync-badge syncing'; badge.innerHTML = '🔄 Synchronizacja...'; }
  else if (!navigator.onLine) { badge.className = 'sync-badge offline'; badge.innerHTML = `🟠 Offline ${state.syncPendingCount > 0 ? '(' + state.syncPendingCount + ')' : ''}`; }
  else if (state.syncPendingCount > 0) { badge.className = 'sync-badge pending'; badge.innerHTML = `🟠 Oczekujące (${state.syncPendingCount})`; }
  else { badge.className = 'sync-badge synced'; badge.innerHTML = '🟢 Połączono'; }
}

async function syncData(userTriggered = false) {
  if (state.isSyncing) return;
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) { if (userTriggered) showToast("Brak Webhooka w zakładce Ustawienia!", "warning"); return; }
  if (!navigator.onLine) { if (userTriggered) showToast("Brak połączenia z siecią.", "warning"); return; }
  state.isSyncing = true; updateSyncUI();

  try {
    const changesToUpload = [];
    TYPES.forEach(t => {
      state[t + 's'].forEach(r => {
        if (r.syncStatus && r.syncStatus !== 'synced') {
          let timeVal = r.timestamp; let hiveVal = String(r.hiveNum);
          if (isDateString(hiveVal) && isHiveNum(timeVal)) { const tmp = timeVal; timeVal = hiveVal; hiveVal = String(tmp); }
          changesToUpload.push({ localType: t, type: t + 's', deleted: r.syncStatus === 'pending_delete', data: { ...r, timestamp: timeVal, hiveNum: hiveVal, syncStatus: undefined } });
        }
      });
    });

    if (changesToUpload.length > 0) {
      let batchSuccess = false;
      try {
        const batchResp = await fetch(webhookUrl, { method: 'POST', body: JSON.stringify({ action: 'batch_upsert', changes: changesToUpload }) });
        const batchJson = await batchResp.json();
        if (batchJson && (batchJson.status === 'success' || (batchJson.message && batchJson.message.includes('Zaktualizowano')))) batchSuccess = true;
      } catch (errPost) { batchSuccess = false; }

      if (!batchSuccess) {
        for (let change of changesToUpload) {
          try {
            const reqBody = change.deleted ? { action: 'delete', type: change.type, id: change.data.id } : { type: change.type, ...change.data };
            const singleResp = await fetch(webhookUrl, { method: 'POST', body: JSON.stringify(reqBody) });
            const singleJson = await singleResp.json();
            if (singleJson && singleJson.status === 'success') {
              if (change.deleted) await deleteLocalRecordPermanent(change.localType, change.data.id);
              else { const rec = state[change.localType + 's'].find(r => r.id === change.data.id); if (rec) { rec.syncStatus = 'synced'; await saveLocalRecord(change.localType, rec); } }
            }
          } catch (eSingle) {}
        }
      } else {
        for (let change of changesToUpload) {
          if (change.deleted) await deleteLocalRecordPermanent(change.localType, change.data.id);
          else { const rec = state[change.localType + 's'].find(r => r.id === change.data.id); if (rec) { rec.syncStatus = 'synced'; await saveLocalRecord(change.localType, rec); } }
        }
      }
    }

    const response = await fetch(webhookUrl);
    const res = await response.json();
    if (res && typeof res === 'object') {
      for (let t of TYPES) {
        const storeName = t + 's';
        const rawList = Array.isArray(res[storeName]) ? res[storeName] : (Array.isArray(res[t]) ? res[t] : []);
        const remoteList = rawList.map(r => normalizeRecord(t, r)).filter(r => r !== null);
        const localMap = new Map(state[storeName].map(item => [item.id, item]));

        for (let remoteItem of remoteList) {
          const localItem = localMap.get(remoteItem.id);
          if (!localItem || (localItem.syncStatus !== 'synced' && parseInt(remoteItem.updatedAt || '0') > parseInt(localItem.updatedAt || '0'))) {
            remoteItem.syncStatus = 'synced'; await saveLocalRecord(t, remoteItem);
          } else if (localItem && localItem.syncStatus === 'synced') {
            remoteItem.syncStatus = 'synced'; await saveLocalRecord(t, remoteItem);
          }
        }
      }
      await loadStateFromLocal();
      if (userTriggered) showToast("Synchronizacja ukończona pomyślnie! 🐝", "success");
    }
  } catch (err) {
    if (userTriggered) showToast("Błąd synchronizacji.", "error");
  } finally {
    state.isSyncing = false; updatePendingCount(); updateSyncUI();
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
      setTimeout(() => { if (btn) btn.disabled = false; }, 1500);

      const isEdit = !!formEl.dataset.editId;
      const recordId = isEdit ? formEl.dataset.editId : 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const nowTime = Date.now().toString();
      const hNum = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`).value;

      let payload = {
        id: recordId,
        timestamp: document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value,
        hiveNum: hNum,
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
          izoType: document.querySelector('input[name="izoType"]:checked')?.value || '', 
          ramka: document.getElementById('input-izo-ramka')?.value || '1', 
          kiedyLeczyc: formatToPLDate(document.getElementById('input-izo-kiedy-leczyc')?.value) 
        };
      }

      await saveLocalRecord(type, payload);
      await loadStateFromLocal();
      renderLocalHistory(type, hNum);
      
      showToast(isEdit ? "Zaktualizowano wpis!" : "Zapisano wpis w pasiece!", "success");
      formEl.reset();
      delete formEl.dataset.editId;
      if (btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ');
      
      // Auto-przeliczanie daty IZO po czyszczeniu formularza jeśli to był tab IZO
      if(type === 'izo') {
          const now = new Date();
          now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
          const nowStr = now.toISOString().slice(0, 16);
          document.getElementById('input-izo-date').value = nowStr;
          updateIzoLeczenieDate(nowStr);
          document.getElementById('select-izo-hive').value = hNum;
      }
      
      if (navigator.onLine) syncData(false);
    });
  });
}

async function deleteRecord(id, type) {
  if (!confirm("Na pewno usunąć ten wpis?")) return;
  const storeName = type + 's';
  const item = state[storeName].find(r => r.id === id);
  if (item) {
    const cNum = item.hiveNum;
    item.syncStatus = 'pending_delete';
    item.updatedAt = Date.now().toString();
    await saveLocalRecord(type, item);
    await loadStateFromLocal();
    renderLocalHistory(type, cNum); 
    showToast("Wpis oznaczony do usunięcia.", "warning");
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

  const tzOffset = new Date().getTimezoneOffset() * 60000;
  const localISOTime = (new Date(new Date(record.timestamp) - tzOffset)).toISOString().slice(0, 16);
  const dateInput = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
  if (dateInput) {
      dateInput.value = localISOTime;
      if(type === 'izo') updateIzoLeczenieDate(localISOTime);
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
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      const tabContent = document.getElementById(targetBtn.dataset.tab);
      if (tabContent) tabContent.classList.add('active');
      if (targetBtn.dataset.tab === 'tab-todo') renderTodos();
    });
  });

  const hTabs = ['inspections', 'feedings', 'treatments', 'izos'];
  hTabs.forEach(type => {
    const btn = document.getElementById(`btn-view-${type}`);
    if (btn) {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-tab-toggle').forEach(el => el.classList.remove('active'));
        e.currentTarget.classList.add('active');
        hTabs.forEach(t => { const w = document.getElementById(`wrapper-${t}-table`); if (w) w.classList.add('hidden'); });
        const tw = document.getElementById(`wrapper-${type}-table`);
        if (tw) tw.classList.remove('hidden');
      });
    }
  });
}

window.goToHistory = function(type) {
  const histTab = document.querySelector('[data-tab="tab-sheet"]');
  if(histTab) histTab.click();
  const btn = document.getElementById(`btn-view-${type}`);
  if(btn) btn.click();
  const wrapper = document.getElementById(`wrapper-${type}-table`);
  if(wrapper) wrapper.scrollIntoView({ behavior: 'smooth' });
};

function initHives() {
  const renderGrid = (start, end, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = start; i <= end; i++) {
      const savedQueen = localStorage.getItem('queen_' + i) || '';
      grid.innerHTML += `
        <div class="hive-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="hive-number" style="font-weight: 900; font-size: 2.8rem; color: #b45309; text-decoration: underline;">${i}</div>
            <div style="display:flex; flex-direction:column; gap:4px; flex:1; margin-left:15px;">
              <input type="text" id="queen-input-${i}" value="${savedQueen}" placeholder="Matka (np. Krainka)" style="padding:6px; font-size:0.9rem; border:1px solid #ccc; border-radius:4px; background:#fff9e6;">
              <button onclick="saveQueen(${i})" class="btn-small" style="font-size:0.8rem; padding:4px; background:#d97706; color:white; border:none; border-radius:4px;">💾 Zapisz</button>
            </div>
          </div>
          <div id="hive-desc-${i}" style="margin: 6px 0; min-height: 5rem;">Ładowanie danych...</div>
          <div style="display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap;">
            <button class="btn-small" style="flex:1;" onclick="openForm('inspection', ${i})">📋 Przegląd</button>
            <button class="btn-small" style="flex:1;" onclick="openForm('feeding', ${i})">🍯 Pokarm</button>
            <button class="btn-small" style="flex:1;" onclick="openForm('treatment', ${i})">💉 Lek</button>
            <button class="btn-small" style="flex:1;" onclick="openForm('izo', ${i})">🗃️ IZO</button>
          </div>
        </div>`;
    }
  };
  renderGrid(1, 6, 'hives-grid-dom');
  renderGrid(7, 12, 'hives-grid-zbior');
  renderGrid(13, 18, 'hives-grid-las');
}

function updateHiveCards() {
  for (let i = 1; i <= 18; i++) {
    let descDiv = document.getElementById(`hive-desc-${i}`);
    if (!descDiv) continue;
    let hiveInspections = state.inspections.filter(r => String(r.hiveNum) === String(i) && r.syncStatus !== 'pending_delete').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (hiveInspections.length > 0) {
      let last = hiveInspections[0];
      descDiv.innerHTML = `
        <div class="hive-last-inspection">
          <div class="hive-last-header">
            <span class="hive-last-date">📅 ${fd(last.timestamp)}</span>
            <span class="hive-last-rodzina">${last.rodzina || 'Rodzina OK'}</span>
          </div>
          <div class="hive-last-grid">
            <div>👑 Matka: <b>${last.matka || '-'}</b></div>
            <div>🥚 Jaja: <b>${last.jaja || '-'}</b></div>
            <div>🪮 Czerw: <b>${last.ramkiCzerwiu || '0'} r.</b></div>
            <div>🍯 Pokarm: <b>${last.pokarm || '-'}</b></div>
            <div>📦 Nadstawki: <b>${last.polkorpus || '0'}</b></div>
          </div>
          ${last.dzialania ? `<div class="hive-last-dzialania">🛠️ <b>Działania:</b> ${last.dzialania}</div>` : ''}
          ${last.przyszleDzialania && last.przyszleDzialania.trim() !== '0' && last.przyszleDzialania.trim().toLowerCase() !== 'brak' ? `<div class="hive-last-plan">📋 <b>Plan:</b> ${last.przyszleDzialania}</div>` : ''}
        </div>
      `;
    } else {
      descDiv.innerHTML = `<span style="color:#9ca3af; font-style:italic; font-size:0.85rem;">Brak historii przeglądów</span>`;
    }
  }
}

function openForm(type, hiveNum) {
  document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
  let tabContent = document.getElementById(`tab-${type}`);
  if (tabContent) tabContent.classList.add('active');

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const nowStr = now.toISOString().slice(0, 16);

  const selectHive = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`);
  if (selectHive) selectHive.innerHTML = `<option value="${hiveNum}">${hiveNum}</option>`;
  const inputDate = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
  if (inputDate) inputDate.value = nowStr;

  renderLocalHistory(type, hiveNum);

  if (type === 'izo') updateIzoLeczenieDate(nowStr);

  const form = document.getElementById(`${type}-form`);
  if (form) delete form.dataset.editId;
  const btn = document.getElementById(`btn-submit-${type}`);
  if (btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ');
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
  return new Date(d).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

window.sortGlobal = function(type, col) {
  if (sortConfig[type].col === col) {
    sortConfig[type].dir = sortConfig[type].dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortConfig[type].col = col;
    sortConfig[type].dir = 'asc';
  }
  renderGlobalTables();
};

function sortArray(arr, conf) {
  return arr.sort((a, b) => {
    let valA = a[conf.col] || '';
    let valB = b[conf.col] || '';
    
    if (conf.col === 'timestamp' || conf.col === 'kiedyLeczyc') {
      valA = new Date(valA).getTime() || 0; valB = new Date(valB).getTime() || 0;
    } else if (['hiveNum', 'ramkiCzerwiu', 'polkorpus', 'kgCukru', 'ramka'].includes(conf.col)) {
      valA = parseFloat(valA) || 0; valB = parseFloat(valB) || 0;
    } else {
      valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase();
    }
    
    if (valA < valB) return conf.dir === 'asc' ? -1 : 1;
    if (valA > valB) return conf.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function getSortIcon(type, col) {
  if (sortConfig[type].col === col) return sortConfig[type].dir === 'asc' ? ' 🔼' : ' 🔽';
  return '';
}

function renderGlobalTables() {
  const tbodyInsp = document.getElementById('sheet-tbody');
  const tbodyFeed = document.getElementById('feedings-tbody');
  const tbodyTreat = document.getElementById('treatments-tbody');
  const tbodyIzo = document.getElementById('izos-tbody');
  
  const headInsp = document.getElementById('head-inspections');
  if(headInsp) headInsp.innerHTML = `
    <tr>
      <th class="sortable" onclick="sortGlobal('inspections', 'timestamp')">Data${getSortIcon('inspections','timestamp')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'hiveNum')">Ul${getSortIcon('inspections','hiveNum')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'rodzina')">Rodzina${getSortIcon('inspections','rodzina')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'matka')">Matka${getSortIcon('inspections','matka')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'jaja')">Jaja${getSortIcon('inspections','jaja')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'ramkiCzerwiu')">Czerw${getSortIcon('inspections','ramkiCzerwiu')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'pokarm')">Pokarm${getSortIcon('inspections','pokarm')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'polkorpus')">Nadst.${getSortIcon('inspections','polkorpus')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'dzialania')">Działania${getSortIcon('inspections','dzialania')}</th>
      <th class="sortable" onclick="sortGlobal('inspections', 'przyszleDzialania')">Plan${getSortIcon('inspections','przyszleDzialania')}</th>
      <th>Akcje</th>
    </tr>`;

  const headFeed = document.getElementById('head-feedings');
  if(headFeed) headFeed.innerHTML = `
    <tr>
      <th class="sortable" onclick="sortGlobal('feedings', 'timestamp')">Data${getSortIcon('feedings','timestamp')}</th>
      <th class="sortable" onclick="sortGlobal('feedings', 'hiveNum')">Ul${getSortIcon('feedings','hiveNum')}</th>
      <th class="sortable" onclick="sortGlobal('feedings', 'kgCukru')">Cukier (kg)${getSortIcon('feedings','kgCukru')}</th>
      <th class="sortable" onclick="sortGlobal('feedings', 'uwagi')">Syrop/Uwagi${getSortIcon('feedings','uwagi')}</th>
      <th>Akcje</th>
    </tr>`;

  const headTreat = document.getElementById('head-treatments');
  if(headTreat) headTreat.innerHTML = `
    <tr>
      <th class="sortable" onclick="sortGlobal('treatments', 'timestamp')">Data${getSortIcon('treatments','timestamp')}</th>
      <th class="sortable" onclick="sortGlobal('treatments', 'hiveNum')">Ul${getSortIcon('treatments','hiveNum')}</th>
      <th class="sortable" onclick="sortGlobal('treatments', 'preparat')">Lek${getSortIcon('treatments','preparat')}</th>
      <th class="sortable" onclick="sortGlobal('treatments', 'uwagi')">Uwagi${getSortIcon('treatments','uwagi')}</th>
      <th>Akcje</th>
    </tr>`;

  const headIzo = document.getElementById('head-izos');
  if(headIzo) headIzo.innerHTML = `
    <tr>
      <th class="sortable" onclick="sortGlobal('izos', 'timestamp')">Data${getSortIcon('izos','timestamp')}</th>
      <th class="sortable" onclick="sortGlobal('izos', 'hiveNum')">Ul${getSortIcon('izos','hiveNum')}</th>
      <th class="sortable" onclick="sortGlobal('izos', 'izoType')">Operacja${getSortIcon('izos','izoType')}</th>
      <th class="sortable" onclick="sortGlobal('izos', 'ramka')">Ramka${getSortIcon('izos','ramka')}</th>
      <th class="sortable" onclick="sortGlobal('izos', 'kiedyLeczyc')">Kiedy Leczyć${getSortIcon('izos','kiedyLeczyc')}</th>
      <th>Akcje</th>
    </tr>`;

  const activeInsp = sortArray(state.inspections.filter(r => r.syncStatus !== 'pending_delete'), sortConfig.inspections);
  const activeFeed = sortArray(state.feedings.filter(r => r.syncStatus !== 'pending_delete'), sortConfig.feedings);
  const activeTreat = sortArray(state.treatments.filter(r => r.syncStatus !== 'pending_delete'), sortConfig.treatments);
  const activeIzo = sortArray(state.izos.filter(r => r.syncStatus !== 'pending_delete'), sortConfig.izos);

  if (tbodyInsp) tbodyInsp.innerHTML = activeInsp.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.rodzina || ''}</td><td>${r.matka || ''}</td><td>${r.jaja || ''}</td>
      <td>${r.ramkiCzerwiu || ''}</td><td>${r.pokarm || ''}</td><td>${r.polkorpus || ''}</td><td>${r.dzialania || ''}</td><td>${r.przyszleDzialania || ''}</td>
      <td><button onclick="editRecord('${r.id}', 'inspection')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'inspection')" class="btn-small" style="background:red; color:white;">🗑️</button></td>
    </tr>`).join('');

  if (tbodyFeed) tbodyFeed.innerHTML = activeFeed.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.kgCukru || ''}</td><td>${r.uwagi || ''}</td>
      <td><button onclick="editRecord('${r.id}', 'feeding')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'feeding')" class="btn-small" style="background:red; color:white;">🗑️</button></td>
    </tr>`).join('');

  if (tbodyTreat) tbodyTreat.innerHTML = activeTreat.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.preparat || ''}</td><td>${r.uwagi || ''}</td>
      <td><button onclick="editRecord('${r.id}', 'treatment')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'treatment')" class="btn-small" style="background:red; color:white;">🗑</button></td>
    </tr>`).join('');

  if (tbodyIzo) tbodyIzo.innerHTML = activeIzo.map(r => `
    <tr>
      <td>${fd(r.timestamp)} ${r.syncStatus === 'pending_save' ? '🟠' : ''}</td><td><b>${r.hiveNum}</b></td><td>${r.izoType || ''}</td><td>${r.ramka || ''}</td>
      <td style="color:#dc2626; font-weight:bold;">${r.kiedyLeczyc || ''}</td>
      <td><button onclick="editRecord('${r.id}', 'izo')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'izo')" class="btn-small" style="background:red; color:white;">🗑️</button></td>
    </tr>`).join('');
}

function renderLocalHistory(type, hiveNum) {
  const container = document.getElementById(`local-${type}-history`);
  if (!container) return;
  
  let data = state[type + 's'].filter(d => String(d.hiveNum) === String(hiveNum) && d.syncStatus !== 'pending_delete').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  if (data.length === 0) { 
    container.innerHTML = `<div style='padding:10px; color:#6b7280; font-style:italic;'>Brak wcześniejszych wpisów z kategorii <b>${type.toUpperCase()}</b> dla Ula ${hiveNum}.</div>`; 
    return; 
  }
  
  let tableHTML = `<h3 style="margin: 5px 0 10px 0; font-size:1.1rem; color:#b45309;">Historia (Ul ${hiveNum})</h3>
    <div class="table-scroll-container"><table class="data-table" style="width:100%;"><thead><tr>`;
  
  if (type === 'inspection') {
    tableHTML += `<th>Data</th><th>Czerw</th><th>Pokarm</th><th>Działania</th><th>Akcje</th></tr></thead><tbody>`;
    tableHTML += data.map(r => `<tr>
      <td>${fd(r.timestamp)}</td><td>${r.ramkiCzerwiu || ''}</td>
      <td>${r.pokarm || ''}</td><td>${r.dzialania || ''}</td>
      <td><button onclick="editRecord('${r.id}', '${type}')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', '${type}')" class="btn-small" style="background:red; color:white;">🗑️</button></td></tr>`).join('');
  } 
  else if (type === 'feeding') {
    tableHTML += `<th>Data</th><th>Cukier (kg)</th><th>Syrop/Uwagi</th><th>Akcje</th></tr></thead><tbody>`;
    tableHTML += data.map(r => `<tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.kgCukru || ''} kg</b></td><td>${r.uwagi || ''}</td>
      <td><button onclick="editRecord('${r.id}', '${type}')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', '${type}')" class="btn-small" style="background:red; color:white;">🗑️</button></td></tr>`).join('');
  } 
  else if (type === 'treatment') {
    tableHTML += `<th>Data</th><th>Preparat</th><th>Dawka / Uwagi</th><th>Akcje</th></tr></thead><tbody>`;
    tableHTML += data.map(r => `<tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.preparat || ''}</b></td><td>${r.uwagi || ''}</td>
      <td><button onclick="editRecord('${r.id}', '${type}')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', '${type}')" class="btn-small" style="background:red; color:white;">🗑️</button></td></tr>`).join('');
  } 
  else if (type === 'izo') {
    tableHTML += `<th>Data</th><th>Operacja (IZO)</th><th>Ramka</th><th>Kiedy Leczyć</th><th>Akcje</th></tr></thead><tbody>`;
    tableHTML += data.map(r => `<tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.izoType || ''}</b></td><td>${r.ramka || ''}</td><td style="color:#dc2626; font-weight:bold;">${r.kiedyLeczyc || ''}</td>
      <td><button onclick="editRecord('${r.id}', '${type}')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', '${type}')" class="btn-small" style="background:red; color:white;">🗑️</button></td></tr>`).join('');
  }
  
  tableHTML += `</tbody></table></div>`;
  container.innerHTML = tableHTML;
}

function renderTodos() {
  const ul = document.getElementById('todo-list');
  if (!ul) return;
  let todos = state.inspections.filter(i => {
    if (i.syncStatus === 'pending_delete') return false;
    const val = (i.przyszleDzialania || '').trim().toLowerCase();
    return val.length > 0 && !['0', 'brak', 'brak planów', 'brak planu', 'brak uwag', 'brak dzialan', 'brak działań', 'nie', '-'].includes(val);
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (todos.length === 0) { ul.innerHTML = '<li style="padding:16px; color:#6b7280; font-style:italic;">Brak zaplanowanych zadań.</li>'; return; }

  ul.innerHTML = todos.map(t => {
    const isDone = localStorage.getItem('todo_done_' + t.id) === 'true';
    const checked = isDone ? 'checked' : '';
    const strike = isDone ? 'text-decoration: line-through; color: #9ca3af;' : '';
    return `<li style="padding: 12px 14px; border-bottom: 1px solid #e5e7eb; display:flex; align-items:center; gap:12px; background:#f9fafb; margin-bottom:6px; border-radius:8px;">
      <input type="checkbox" onchange="toggleTodo('${t.id}', this.checked)" ${checked} style="width:20px; height:20px; cursor:pointer;">
      <div style="flex:1; ${strike}">
        <span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:6px; font-weight:bold; font-size:0.85rem; margin-right:6px;">Ul ${t.hiveNum}</span>
        <small style="color:#6b7280; margin-right:8px;">(${fd(t.timestamp)})</small>
        <span style="font-weight:600;">${t.przyszleDzialania}</span>
      </div>
      <button onclick="editRecord('${t.id}', 'inspection')" class="btn-small">✏️ Edytuj wpis</button>
    </li>`;
  }).join('');
}

function toggleTodo(id, isDone) {
  localStorage.setItem('todo_done_' + id, isDone);
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
