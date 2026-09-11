// APLIKACJA PASIECZNA - LOGIKA FRONTENDU
// UWAGA: Wklej poniżej swój link do webhooka!
const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx2PUdp6AyROHIr97rmxa_pCVJmKHXrgYseOZBRoVkQnmKiVU_l_-jSP2Ux_gAA7gNfuA/exec';

let state = {
  inspections: [], feedings: [], treatments: [], izos: []
};

function getWebhookUrl() {
  return localStorage.getItem('gsheet_webhook') || DEFAULT_WEBHOOK;
}

// Zabezpieczenie danych – ignoruje zepsute lub puste wiersze
const isValid = (row) => row && row.id && String(row.id).trim() !== '' && row.hiveNum && parseInt(row.hiveNum) > 0;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initHives();
  initForms();
  fetchFromGoogleSheets();
  
  document.getElementById('btn-sync-now').addEventListener('click', fetchFromGoogleSheets);
});

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(e.target.dataset.tab).classList.add('active');
      if(e.target.dataset.tab === 'tab-todo') renderTodos();
    });
  });
  
  // Zakładki w Historii
  const hTabs = ['inspections', 'feedings', 'treatments', 'izos'];
  hTabs.forEach(type => {
    document.getElementById(`btn-view-${type}`).addEventListener('click', (e) => {
      document.querySelectorAll('.btn-tab-toggle').forEach(el => el.classList.remove('active'));
      e.target.classList.add('active');
      hTabs.forEach(t => document.getElementById(`wrapper-${t}-table`).classList.add('hidden'));
      document.getElementById(`wrapper-${type}-table`).classList.remove('hidden');
    });
  });
}

function initHives() {
  const renderGrid = (start, end, gridId) => {
    const grid = document.getElementById(gridId);
    grid.innerHTML = '';
    for(let i = start; i <= end; i++) {
      grid.innerHTML += `
        <div class="hive-card">
          <div class="hive-number">${i}</div>
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

function openForm(type, hiveNum) {
  document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-tab="tab-${type}"]`).classList.add('active');
  document.getElementById(`tab-${type}`).classList.add('active');
  
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const nowStr = now.toISOString().slice(0,16);

  document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`).innerHTML = `<option value="${hiveNum}">${hiveNum}</option>`;
  document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value = nowStr;
  
  // Wyczyść ewentualny stan edycji
  const form = document.getElementById(`${type}-form`);
  delete form.dataset.editId;
  const btn = document.getElementById(`btn-submit-${type}`);
  if(btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUaLIZUJ', 'ZAPISZ'); 

  renderLocalHistory(type, hiveNum);
}

// FORMATOWANIE DATY
function fd(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('pl-PL', {dateStyle: 'short', timeStyle: 'short'});
}

// GLOBALNE RENDEROWANIE TABEL
function renderGlobalTables() {
  const tbodyInsp = document.getElementById('sheet-tbody');
  const tbodyFeed = document.getElementById('feedings-tbody');
  const tbodyTreat = document.getElementById('treatments-tbody');
  const tbodyIzo = document.getElementById('izos-tbody');
  
  tbodyInsp.innerHTML = state.inspections.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.rodzina}</td><td>${r.matka}</td><td>${r.jaja}</td>
      <td>${r.ramkiCzerwiu}</td><td>${r.pokarm}</td><td>${r.polkorpus}</td><td>${r.dzialania}</td><td>${r.przyszleDzialania}</td>
      <td><button onclick="editRecord('${r.id}', 'inspection')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'inspection')" class="btn-small" style="background:red; color:white;">🗑️</button></td>
    </tr>`).join('');

  tbodyFeed.innerHTML = state.feedings.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.kgCukru} kg</td><td>${r.uwagi}</td>
      <td><button onclick="editRecord('${r.id}', 'feeding')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'feeding')" class="btn-small" style="background:red; color:white;">🗑️</button></td>
    </tr>`).join('');

  tbodyTreat.innerHTML = state.treatments.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.preparat}</td><td>${r.uwagi}</td>
      <td><button onclick="editRecord('${r.id}', 'treatment')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'treatment')" class="btn-small" style="background:red; color:white;">🗑️</button></td>
    </tr>`).join('');

  tbodyIzo.innerHTML = state.izos.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.izoType}</td><td>Ramka: ${r.ramka}</td>
      <td><button onclick="editRecord('${r.id}', 'izo')" class="btn-small">✏️</button> <button onclick="deleteRecord('${r.id}', 'izo')" class="btn-small" style="background:red; color:white;">🗑️</button></td>
    </tr>`).join('');
}

// LOKALNE RENDEROWANIE TABEL POD FORMULARZAMI
function renderLocalHistory(type, hiveNum) {
  const container = document.getElementById(`local-${type}-history`);
  if(!container) return;
  
  let data = state[type + 's'];
  let filtered = data.filter(d => String(d.hiveNum) === String(hiveNum)).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  if(filtered.length === 0) {
    container.innerHTML = "Brak wpisów...";
    return;
  }

  container.innerHTML = filtered.map(r => {
    let details = '';
    if(type === 'inspection') details = `Czerw: ${r.ramkiCzerwiu}, Matka: ${r.matka}, Plan: ${r.przyszleDzialania}`;
    if(type === 'feeding') details = `Syrop: ${r.kgCukru}kg, Uwagi: ${r.uwagi}`;
    if(type === 'treatment') details = `Lek: ${r.preparat}, Uwagi: ${r.uwagi}`;
    if(type === 'izo') details = `Operacja: ${r.izoType}, Po ramce: ${r.ramka}`;
    
    return `<div style="border-bottom: 1px solid #ccc; padding: 8px 0; display:flex; justify-content:space-between; align-items:center;">
      <div style="flex:1;"><b>${fd(r.timestamp)}</b><br><small>${details}</small></div>
      <div>
         <button onclick="editRecord('${r.id}', '${type}')" class="btn-small">✏️</button>
         <button onclick="deleteRecord('${r.id}', '${type}')" class="btn-small" style="background:red; color:white;">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function renderTodos() {
  const ul = document.getElementById('todo-list');
  let todos = state.inspections.filter(i => i.przyszleDzialania && i.przyszleDzialania.trim() !== '').sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  if(todos.length === 0) { ul.innerHTML = '<li>Brak zaplanowanych zadań.</li>'; return; }
  ul.innerHTML = todos.map(t => `<li style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
    <b>Ul ${t.hiveNum}</b> (${fd(t.timestamp)}): ${t.przyszleDzialania}
  </li>`).join('');
}

// AKCJE KASOWANIA I EDYCJI Z APLIKACJI
async function deleteRecord(id, type) {
  if(!confirm("Na pewno usunąć ten wpis?")) return;
  const url = getWebhookUrl();
  try {
    await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'delete', type: type, id: id }) });
    alert("Wpis usunięto.");
    fetchFromGoogleSheets();
  } catch(e) { alert("Błąd usuwania!"); }
}

function editRecord(id, type) {
  const record = state[type + 's'].find(r => r.id === id);
  if(!record) return;
  openForm(type, record.hiveNum);
  
  const form = document.getElementById(`${type}-form`);
  form.dataset.editId = id; // ZNACZNIK EDYCJI
  const btn = document.getElementById(`btn-submit-${type}`);
  btn.innerHTML = btn.innerHTML.replace('ZAPISZ', 'ZAKTUALIZUJ');

  const tzOffset = new Date().getTimezoneOffset() * 60000;
  const localISOTime = (new Date(new Date(record.timestamp) - tzOffset)).toISOString().slice(0, 16);
  
  document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value = localISOTime;

  if (type === 'inspection') {
    document.querySelector(`input[name="matka"][value="${record.matka}"]`).checked = true;
    document.querySelector(`input[name="jaja"][value="${record.jaja}"]`).checked = true;
    document.querySelector(`input[name="pokarm"][value="${record.pokarm}"]`).checked = true;
    document.getElementById('ramki-czerwiu').value = record.ramkiCzerwiu;
    document.querySelector(`input[name="rodzina"][value="${record.rodzina}"]`).checked = true;
    document.querySelector(`input[name="polkorpus"][value="${record.polkorpus}"]`).checked = true;
    document.getElementById('input-dzialania').value = record.dzialania;
    document.getElementById('input-przyszle-dzialania').value = record.przyszleDzialania;
  } else if (type === 'feeding') {
    document.getElementById('input-feeding-kg').value = record.kgCukru;
    document.getElementById('input-feeding-notes').value = record.uwagi;
  } else if (type === 'treatment') {
    document.getElementById('input-treatment-preparat').value = record.preparat;
    document.getElementById('input-treatment-notes').value = record.uwagi;
  } else if (type === 'izo') {
    document.querySelector(`input[name="izoType"][value="${record.izoType}"]`).checked = true;
    document.getElementById('input-izo-ramka').value = record.ramka;
  }
}

// WYSYŁANIE DO GOOGLE SHEETS
function initForms() {
  ['inspection', 'feeding', 'treatment', 'izo'].forEach(type => {
    document.getElementById(`${type}-form`).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; // Zabezpieczenie przed wieloklikiem
      setTimeout(() => btn.disabled = false, 2500);

      const isEdit = !!form.dataset.editId;
      let payload = {
        id: isEdit ? form.dataset.editId : Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        timestamp: document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value,
        hiveNum: document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`).value,
        hiveName: ''
      };

      if(type === 'inspection') {
        payload = { ...payload,
          matka: document.querySelector('input[name="matka"]:checked').value,
          matkaInfo: '',
          jaja: document.querySelector('input[name="jaja"]:checked').value,
          pokarm: document.querySelector('input[name="pokarm"]:checked').value,
          ramkiCzerwiu: document.getElementById('ramki-czerwiu').value,
          rodzina: document.querySelector('input[name="rodzina"]:checked').value,
          polkorpus: document.querySelector('input[name="polkorpus"]:checked').value,
          dzialania: document.getElementById('input-dzialania').value,
          przyszleDzialania: document.getElementById('input-przyszle-dzialania').value
        };
      } else if (type === 'feeding') {
        payload = { ...payload, kgCukru: document.getElementById('input-feeding-kg').value, uwagi: document.getElementById('input-feeding-notes').value };
      } else if (type === 'treatment') {
        payload = { ...payload, preparat: document.getElementById('input-treatment-preparat').value, uwagi: document.getElementById('input-treatment-notes').value };
      } else if (type === 'izo') {
        payload = { ...payload, izoType: document.querySelector('input[name="izoType"]:checked').value, ramka: document.getElementById('input-izo-ramka').value };
      }

      const reqBody = isEdit ? { action: 'update', type: type, data: payload } : { type: type, ...payload };

      try {
        await fetch(getWebhookUrl(), { method: 'POST', body: JSON.stringify(reqBody) });
        alert(isEdit ? "Zaktualizowano pomyślnie!" : "Zapisano pomyślnie!");
        form.reset();
        delete form.dataset.editId;
        btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ');
        fetchFromGoogleSheets();
      } catch(e) { alert("Błąd zapisu!"); }
    });
  });
}

function fetchFromGoogleSheets() {
  const url = getWebhookUrl();
  if (!url) return;
  fetch(url).then(r => r.json()).then(res => {
    if (res && typeof res === 'object') {
      if(Array.isArray(res.inspections)) state.inspections = res.inspections.filter(isValid);
      if(Array.isArray(res.feedings)) state.feedings = res.feedings.filter(isValid);
      if(Array.isArray(res.treatments)) state.treatments = res.treatments.filter(isValid);
      if(Array.isArray(res.izos)) state.izos = res.izos.filter(isValid);
      
      renderGlobalTables();
      renderTodos();
      
      // Odświeżenie otwartej lokalnej historii
      ['inspection', 'feeding', 'treatment', 'izo'].forEach(type => {
         const selectObj = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`);
         if(selectObj && selectObj.value) renderLocalHistory(type, selectObj.value);
      });
    }
  }).catch(() => console.log("Błąd synchronizacji"));
}
