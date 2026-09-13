// UWAGA: Wklej poniżej swój link do webhooka z Google Apps Script!
const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx2PUdp6AyROHIr97rmxa_pCVJmKHXrgYseOZBRoVkQnmKiVU_l_-jSP2Ux_gAA7gNfuA/exec';

let state = {
  inspections: [], feedings: [], treatments: [], izos: []
};

function getWebhookUrl() {
  return localStorage.getItem('gsheet_webhook') || DEFAULT_WEBHOOK;
}

const isValid = (row) => row && row.id && String(row.id).trim() !== '' && row.hiveNum && parseInt(row.hiveNum) > 0;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initHives();
  initForms();
  fetchFromGoogleSheets();
  
  const syncBtn = document.getElementById('btn-sync-now');
  if (syncBtn) {
    syncBtn.addEventListener('click', fetchFromGoogleSheets);
  }
  
  // Kalkulator daty leczenia dla IZO
  const izoDateInput = document.getElementById('input-izo-date');
  if (izoDateInput) {
    izoDateInput.addEventListener('change', (e) => {
      updateIzoLeczenieDate(e.target.value);
    });
  }
});

function updateIzoLeczenieDate(sourceDateStr) {
  if (!sourceDateStr) return;
  let d = new Date(sourceDateStr);
  if (!isNaN(d)) {
    d.setDate(d.getDate() + 24);
    const kiedyLeczycEl = document.getElementById('input-izo-kiedy-leczyc');
    if (kiedyLeczycEl) {
      kiedyLeczycEl.value = d.toISOString().split('T')[0];
    }
  }
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      const tabContent = document.getElementById(targetBtn.dataset.tab);
      if(tabContent) tabContent.classList.add('active');
      if(targetBtn.dataset.tab === 'tab-todo') renderTodos();
    });
  });
  
  const hTabs = ['inspections', 'feedings', 'treatments', 'izos'];
  hTabs.forEach(type => {
    const btn = document.getElementById(`btn-view-${type}`);
    if (btn) {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-tab-toggle').forEach(el => el.classList.remove('active'));
        e.currentTarget.classList.add('active');
        hTabs.forEach(t => {
          const wrapper = document.getElementById(`wrapper-${t}-table`);
          if (wrapper) wrapper.classList.add('hidden');
        });
        const targetWrapper = document.getElementById(`wrapper-${type}-table`);
        if (targetWrapper) targetWrapper.classList.remove('hidden');
      });
    }
  });
}

function initHives() {
  const renderGrid = (start, end, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    for(let i = start; i <= end; i++) {
      grid.innerHTML += `
        <div class="hive-card">
          <div class="hive-number">${i}</div>
          <div id="hive-desc-${i}" style="margin: 6px 0; font-size: 0.85rem; color: #4b5563; min-height: 2.5rem; line-height: 1.2;">Ładowanie danych...</div>
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
  for(let i = 1; i <= 18; i++) {
    let descDiv = document.getElementById(`hive-desc-${i}`);
    if(!descDiv) continue;
    
    let hiveInspections = state.inspections.filter(r => String(r.hiveNum) === String(i)).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if(hiveInspections.length > 0) {
        let last = hiveInspections[0];
        let dateOnly = fd(last.timestamp).split(',')[0];
        descDiv.innerHTML = `<b>${dateOnly}</b><br>Czerw: ${last.ramkiCzerwiu} | Pokarm: ${last.pokarm}`;
    } else {
        descDiv.innerHTML = `<span style="color:#9ca3af;">Brak przeglądów</span>`;
    }
  }
}

function openForm(type, hiveNum) {
  document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
  
  let tabContent = document.getElementById(`tab-${type}`);
  if (tabContent) tabContent.classList.add('active');
  
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const nowStr = now.toISOString().slice(0,16);

  const selectHive = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`);
  if (selectHive) selectHive.innerHTML = `<option value="${hiveNum}">${hiveNum}</option>`;
  
  const inputDate = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
  if (inputDate) inputDate.value = nowStr;
  
  if (type === 'izo') {
    updateIzoLeczenieDate(nowStr);
  }

  const form = document.getElementById(`${type}-form`);
  if (form) delete form.dataset.editId;
  
  const btn = document.getElementById(`btn-submit-${type}`);
  if(btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ'); 

  renderLocalHistory(type, hiveNum);
}

function fd(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('pl-PL', {dateStyle: 'short', timeStyle: 'short'});
}

function renderGlobalTables() {
  const tbodyInsp = document.getElementById('sheet-tbody');
  const tbodyFeed = document.getElementById('feedings-tbody');
  const tbodyTreat = document.getElementById('treatments-tbody');
  const tbodyIzo = document.getElementById('izos-tbody');
  
  if(tbodyInsp) tbodyInsp.innerHTML = state.inspections.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.rodzina || ''}</td><td>${r.matka || ''}</td><td>${r.jaja || ''}</td>
      <td>${r.ramkiCzerwiu || ''}</td><td>${r.pokarm || ''}</td><td>${r.polkorpus || ''}</td><td>${r.dzialania || ''}</td><td>${r.przyszleDzialania || ''}</td>
      <td>
        <button onclick="editRecord('${r.id}', 'inspection')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'inspection')" class="btn-small" style="background:red; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if(tbodyFeed) tbodyFeed.innerHTML = state.feedings.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.kgCukru || ''} kg</td><td>${r.uwagi || ''}</td>
      <td>
        <button onclick="editRecord('${r.id}', 'feeding')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'feeding')" class="btn-small" style="background:red; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if(tbodyTreat) tbodyTreat.innerHTML = state.treatments.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.preparat || ''}</td><td>${r.uwagi || ''}</td>
      <td>
        <button onclick="editRecord('${r.id}', 'treatment')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'treatment')" class="btn-small" style="background:red; color:white;">🗑️</button>
      </td>
    </tr>`).join('');

  if(tbodyIzo) tbodyIzo.innerHTML = state.izos.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).map(r => `
    <tr>
      <td>${fd(r.timestamp)}</td><td><b>${r.hiveNum}</b></td><td>${r.izoType || ''}</td><td>Ramka: ${r.ramka || ''}</td>
      <td style="color:#dc2626; font-weight:bold;">${r.kiedyLeczyc || ''}</td>
      <td>
        <button onclick="editRecord('${r.id}', 'izo')" class="btn-small">✏️</button>
        <button onclick="deleteRecord('${r.id}', 'izo')" class="btn-small" style="background:red; color:white;">🗑️</button>
      </td>
    </tr>`).join('');
}

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
    if(type === 'inspection') details = `Czerw: ${r.ramkiCzerwiu}, Plan: ${r.przyszleDzialania}`;
    if(type === 'feeding') details = `Syrop: ${r.kgCukru}kg, Uwagi: ${r.uwagi}`;
    if(type === 'treatment') details = `Lek: ${r.preparat}, Uwagi: ${r.uwagi}`;
    if(type === 'izo') details = `Operacja: ${r.izoType}, Ramka: ${r.ramka}<br><span style="color:#dc2626; font-weight:bold;">Kiedy leczyć: ${r.kiedyLeczyc || '-'}</span>`;
    
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
  if(!ul) return;
  let todos = state.inspections.filter(i => i.przyszleDzialania && i.przyszleDzialania.trim() !== '' && i.przyszleDzialania.trim().toLowerCase() !== 'brak planów').sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  if(todos.length === 0) { ul.innerHTML = '<li>Brak zaplanowanych zadań.</li>'; return; }
  
  ul.innerHTML = todos.map(t => {
    const isDone = localStorage.getItem('todo_done_' + t.id) === 'true';
    const checked = isDone ? 'checked' : '';
    const strike = isDone ? 'text-decoration: line-through; color: #9ca3af;' : '';
    
    return `<li style="padding: 10px; border-bottom: 1px solid #e5e7eb; display:flex; align-items:center; gap:10px;">
      <input type="checkbox" onchange="toggleTodo('${t.id}', this.checked)" ${checked} style="width:20px; height:20px;">
      <div style="flex:1; ${strike}">
        <b>${t.hiveNum}</b> (${fd(t.timestamp)}): ${t.przyszleDzialania}
      </div>
      <button onclick="editRecord('${t.id}', 'inspection')" class="btn-small">✏️ Edytuj wpis</button>
    </li>`;
  }).join('');
}

function toggleTodo(id, isDone) {
  localStorage.setItem('todo_done_' + id, isDone);
  renderTodos();
}

async function deleteRecord(id, type) {
  if(!confirm("Na pewno usunąć ten wpis?")) return;
  try {
    await fetch(getWebhookUrl(), { method: 'POST', body: JSON.stringify({ action: 'delete', type: type, id: id }) });
    alert("Wpis usunięto pomyślnie.");
    fetchFromGoogleSheets();
  } catch(e) { alert("Błąd usuwania wpisu!"); }
}

function editRecord(id, type) {
  const record = state[type + 's'].find(r => r.id === id);
  if(!record) return;
  openForm(type, record.hiveNum);
  
  const form = document.getElementById(`${type}-form`);
  if(form) form.dataset.editId = id; 
  const btn = document.getElementById(`btn-submit-${type}`);
  if(btn) btn.innerHTML = btn.innerHTML.replace('ZAPISZ', 'ZAKTUALIZUJ');

  const tzOffset = new Date().getTimezoneOffset() * 60000;
  const localISOTime = (new Date(new Date(record.timestamp) - tzOffset)).toISOString().slice(0, 16);
  
  const dateInput = document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`);
  if(dateInput) dateInput.value = localISOTime;

  if (type === 'inspection') {
    const m = document.querySelector(`input[name="matka"][value="${record.matka}"]`);
    if(m) m.checked = true;
    const j = document.querySelector(`input[name="jaja"][value="${record.jaja}"]`);
    if(j) j.checked = true;
    const p = document.querySelector(`input[name="pokarm"][value="${record.pokarm}"]`);
    if(p) p.checked = true;
    const rc = document.getElementById('ramki-czerwiu');
    if(rc) rc.value = record.ramkiCzerwiu;
    const rodz = document.querySelector(`input[name="rodzina"][value="${record.rodzina}"]`);
    if(rodz) rodz.checked = true;
    const polk = document.querySelector(`input[name="polkorpus"][value="${record.polkorpus}"]`);
    if(polk) polk.checked = true;
    const dzial = document.getElementById('input-dzialania');
    if(dzial) dzial.value = record.dzialania;
    const przyszl = document.getElementById('input-przyszle-dzialania');
    if(przyszl) przyszl.value = record.przyszleDzialania;
  } else if (type === 'feeding') {
    const kg = document.getElementById('input-feeding-kg');
    if(kg) kg.value = record.kgCukru;
    const uwagi = document.getElementById('input-feeding-notes');
    if(uwagi) uwagi.value = record.uwagi;
  } else if (type === 'treatment') {
    const prep = document.getElementById('input-treatment-preparat');
    if(prep) prep.value = record.preparat;
    const uwagi = document.getElementById('input-treatment-notes');
    if(uwagi) uwagi.value = record.uwagi;
  } else if (type === 'izo') {
    const izoT = document.querySelector(`input[name="izoType"][value="${record.izoType}"]`);
    if(izoT) izoT.checked = true;
    const ramka = document.getElementById('input-izo-ramka');
    if(ramka) ramka.value = record.ramka;
    const kiedy = document.getElementById('input-izo-kiedy-leczyc');
    if(kiedy) kiedy.value = record.kiedyLeczyc;
  }
}

function initForms() {
  ['inspection', 'feeding', 'treatment', 'izo'].forEach(type => {
    const form = document.getElementById(`${type}-form`);
    if(!form) return;
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formEl = e.target;
      const btn = formEl.querySelector('button[type="submit"]');
      if(btn) btn.disabled = true;
      setTimeout(() => { if(btn) btn.disabled = false; }, 2500);

      const isEdit = !!formEl.dataset.editId;
      let payload = {
        id: isEdit ? formEl.dataset.editId : Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        timestamp: document.getElementById(`input-${type === 'inspection' ? '' : type + '-'}date`).value,
        hiveNum: document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`).value
      };

      if(type === 'inspection') {
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
        payload = { ...payload, izoType: document.querySelector('input[name="izoType"]:checked')?.value || '', ramka: document.getElementById('input-izo-ramka')?.value || '1', kiedyLeczyc: document.getElementById('input-izo-kiedy-leczyc')?.value || '' };
      }

      const reqBody = isEdit ? { action: 'update', type: type, data: payload } : { type: type, ...payload };

      try {
        await fetch(getWebhookUrl(), { method: 'POST', body: JSON.stringify(reqBody) });
        alert(isEdit ? "Zaktualizowano wpis!" : "Zapisano wpis!");
        formEl.reset();
        delete formEl.dataset.editId;
        if(btn) btn.innerHTML = btn.innerHTML.replace('ZAKTUALIZUJ', 'ZAPISZ');
        fetchFromGoogleSheets();
      } catch(e) { alert("Błąd zapisu! Sprawdź połączenie."); }
    });
  });
}

function fetchFromGoogleSheets() {
  const url = getWebhookUrl();
  if (!url || url === DEFAULT_WEBHOOK) {
    console.warn("Zastępczy URL Webhooka - Skrypt wstrzymany. Podaj prawdziwy adres w app.js.");
    return;
  }
  fetch(url).then(r => r.json()).then(res => {
    if (res && typeof res === 'object') {
      if(Array.isArray(res.inspections)) state.inspections = res.inspections.filter(isValid);
      if(Array.isArray(res.feedings)) state.feedings = res.feedings.filter(isValid);
      if(Array.isArray(res.treatments)) state.treatments = res.treatments.filter(isValid);
      if(Array.isArray(res.izos)) state.izos = res.izos.filter(isValid);
      
      renderGlobalTables();
      renderTodos();
      updateHiveCards();
      
      ['inspection', 'feeding', 'treatment', 'izo'].forEach(type => {
         const selectObj = document.getElementById(`select-${type === 'inspection' ? '' : type + '-'}hive`);
         if(selectObj && selectObj.value) renderLocalHistory(type, selectObj.value);
      });
    }
  }).catch(() => console.log("Błąd synchronizacji."));
}
