document.addEventListener('DOMContentLoaded', () => {
  const TOTAL_HIVES = 18;
  const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbyQQL4WLtFXlgo0nuvtGSzWxvoxfqbA0sK0zf_Hh7bflcwsNxZ9UM73leN_kEHWc0yNtw/exec';

  const KEYS = {
    INSPECTIONS: 'pasieka_wlkp_inspections_v1',
    FEEDINGS: 'pasieka_wlkp_feedings_v1',
    TREATMENTS: 'pasieka_wlkp_treatments_v1',
    NAMES: 'pasieka_wlkp_hive_names_v1',
    QUEENS: 'pasieka_wlkp_hive_queens_v1',
    THEME: 'pasieka_theme_mode',
    WEBHOOK: 'pasieka_gsheet_webhook_v1'
  };

  function getWebhookUrl() { return localStorage.getItem(KEYS.WEBHOOK) || DEFAULT_WEBHOOK; }

  const Store = {
    get: (key, def) => { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } },
    set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  };

  let inspections = Store.get(KEYS.INSPECTIONS, []);
  let feedings = Store.get(KEYS.FEEDINGS, []);
  let treatments = Store.get(KEYS.TREATMENTS, []);
  let hiveNames = Store.get(KEYS.NAMES, {});
  let hiveQueens = Store.get(KEYS.QUEENS, {});

  let activeTab = 'tab-dom';
  let editingInspectionId = null;
  let editingFeedingId = null;
  let editingTreatmentId = null;

  const escapeHtml = str => String(str || '').replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[m]));
  const formatPL = dStr => {
    const d = new Date(dStr);
    return `${d.toLocaleDateString('pl-PL')} ${d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'})}`;
  };
  const getDatetimeLocal = (d = new Date()) => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const getHiveName = id => hiveNames[id] || `Ul № ${id}`;
  const getHiveCategory = id => id <= 6 ? 'dom' : (id <= 12 ? 'zbior' : 'las');

  const qs = s => document.querySelector(s);
  const qsa = s => document.querySelectorAll(s);
  const qsid = id => document.getElementById(id);

  const DOM = {
    btnTheme: qsid('btn-theme-toggle'), tabs: qsa('.tab-btn'), contents: qsa('.tab-content'),
    grids: { dom: qsid('hives-grid-dom'), zbior: qsid('hives-grid-zbior'), las: qsid('hives-grid-las') },
    
    inspForm: qsid('inspection-form'), selHive: qsid('select-hive'), dateInsp: qsid('input-date'),
    ramki: qsid('ramki-czerwiu'), cbRamkiNw: qsid('cb-ramki-niewiem'), ramkiWrap: qsid('ramki-stepper-wrap'),
    dzialania: qsid('input-dzialania'), przyszle: qsid('input-przyszle-dzialania'),
    
    feedForm: qsid('feeding-form'), selFeedHive: qsid('select-feeding-hive'), dateFeed: qsid('input-feeding-date'),
    kgFeed: qsid('input-feeding-kg'), notesFeed: qsid('input-feeding-notes'),
    
    treatForm: qsid('treatment-form'), selTreatHive: qsid('select-treatment-hive'), dateTreat: qsid('input-treatment-date'),
    prepTreat: qsid('input-treatment-preparat'), notesTreat: qsid('input-treatment-notes'),

    inspHistTbody: qsid('tab-insp-history-tbody'),
    feedTbody: qsid('tab-feeding-tbody'), treatTbody: qsid('tab-treatment-tbody'),
    
    sheetTbody: qsid('sheet-tbody'), mainFeedTbody: qsid('feedings-tbody'), mainTreatTbody: qsid('treatments-tbody'),
    filterHive: qsid('filter-hive-select'),
    
    webhook: qsid('input-gsheet-webhook'), btnSaveWebhook: qsid('btn-save-webhook'),
    btnShowGsheetScript: qsid('btn-show-gsheet-script'), gsheetScriptDetails: qsid('gsheet-script-details'),
    btnSyncNow: qsid('btn-sync-now')
  };

  initTheme();
  if (DOM.dateInsp) DOM.dateInsp.value = getDatetimeLocal();
  if (DOM.dateFeed) DOM.dateFeed.value = getDatetimeLocal();
  if (DOM.dateTreat) DOM.dateTreat.value = getDatetimeLocal();
  
  renderHivesGrid();
  renderGlobalHistories();

  if (DOM.webhook) DOM.webhook.value = getWebhookUrl();
  if (DOM.btnShowGsheetScript && DOM.gsheetScriptDetails) {
    DOM.btnShowGsheetScript.addEventListener('click', (e) => {
      e.preventDefault();
      DOM.gsheetScriptDetails.classList.toggle('hidden');
    });
  }

  if (DOM.btnSaveWebhook && DOM.webhook) {
    DOM.btnSaveWebhook.addEventListener('click', (e) => {
      e.preventDefault();
      const url = DOM.webhook.value.trim();
      if (url.startsWith('https://script.google.com/macros/s/')) {
        localStorage.setItem(KEYS.WEBHOOK, url);
        alert('✅ Zapisano link webhooka Google Sheets!');
        fetchFromGoogleSheets().catch(() => {});
      } else if (url === '') {
        localStorage.removeItem(KEYS.WEBHOOK);
        DOM.webhook.value = DEFAULT_WEBHOOK;
        alert('🔄 Przywrócono domyślny link synchronizacji.');
      }
    });
  }

  if (DOM.btnSyncNow) {
    DOM.btnSyncNow.addEventListener('click', () => {
      const url = getWebhookUrl();
      if (!url) { alert('Brak skonfigurowanego adresu URL.'); return; }
      DOM.btnSyncNow.disabled = true;
      DOM.btnSyncNow.textContent = '⏳ Synchronizacja...';

      inspections.filter(r => !r._synced).forEach(rec => sendToGoogleSheets(rec, 'inspection'));
      feedings.filter(r => !r._synced).forEach(rec => sendToGoogleSheets(rec, 'feeding'));
      treatments.filter(r => !r._synced).forEach(rec => sendToGoogleSheets(rec, 'treatment'));

      fetchFromGoogleSheets()
        .then(addedCount => alert(`Synchronizacja zakończona sukcesem!\nPobrano z chmury: ${addedCount} nowych wpisów.`))
        .catch(() => alert('Wystąpił błąd pobierania danych z chmury.'))
        .finally(() => { DOM.btnSyncNow.disabled = false; DOM.btnSyncNow.textContent = '🔄 Synchronizuj z Google Sheets'; });
    });
  }

  setTimeout(() => fetchFromGoogleSheets().catch(() => {}), 1500);

  DOM.tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  if (DOM.cbRamkiNw) {
    DOM.cbRamkiNw.addEventListener('change', e => {
      const s = e.target.checked;
      DOM.ramki.disabled = qsid('btn-ramki-minus').disabled = qsid('btn-ramki-plus').disabled = s;
      DOM.ramkiWrap.style.opacity = s ? '0.4' : '1';
    });
  }

  document.addEventListener('click', e => {
    if(e.target.id === 'btn-ramki-minus' && !DOM.cbRamkiNw.checked) DOM.ramki.value = Math.max(0, (parseInt(DOM.ramki.value)||0)-1);
    if(e.target.id === 'btn-ramki-plus' && !DOM.cbRamkiNw.checked) DOM.ramki.value = Math.min(30, (parseInt(DOM.ramki.value)||0)+1);
    if(e.target.id === 'btn-kg-minus') DOM.kgFeed.value = Math.max(0.5, (parseFloat(DOM.kgFeed.value)||0)-0.5).toFixed(1);
    if(e.target.id === 'btn-kg-plus') DOM.kgFeed.value = Math.min(50, (parseFloat(DOM.kgFeed.value)||0)+0.5).toFixed(1);

    const cardBtn = e.target.closest('button[data-hive]');
    if (cardBtn) {
      e.stopPropagation();
      const hId = parseInt(cardBtn.dataset.hive);
      if (cardBtn.classList.contains('btn-add-inspection')) openInspectionForHive(hId);
      if (cardBtn.classList.contains('btn-add-feeding')) openFeedingForHive(hId);
      if (cardBtn.classList.contains('btn-add-treatment')) openTreatmentForHive(hId);
      if (cardBtn.classList.contains('btn-rename-hive')) promptRenameHive(hId);
      if (cardBtn.classList.contains('btn-edit-queen')) promptEditQueen(hId);
      return;
    }

    const actionBtn = e.target.closest('button[data-id]');
    if (actionBtn) {
      e.stopPropagation();
      const id = actionBtn.dataset.id;
      if (actionBtn.classList.contains('btn-delete-inspection') || actionBtn.classList.contains('btn-delete-row')) {
        if (confirm('Usunąć wpis przeglądu?')) deleteRecord('inspections', id);
      }
      if (actionBtn.classList.contains('btn-delete-feeding-row')) {
        if (confirm('Usunąć wpis karmienia?')) deleteRecord('feedings', id);
      }
      if (actionBtn.classList.contains('btn-delete-treatment-row')) {
        if (confirm('Usunąć wpis leczenia?')) deleteRecord('treatments', id);
      }
      if (actionBtn.classList.contains('btn-edit-inspection')) openInspectionForEdit(id);
      if (actionBtn.classList.contains('btn-edit-feeding-row')) openFeedingForEdit(id);
      if (actionBtn.classList.contains('btn-edit-treatment-row')) openTreatmentForEdit(id);
    }
  });

  if (DOM.selHive) DOM.selHive.addEventListener('change', e => {
    qsid('form-hive-title').textContent = `Przegląd: ${getHiveName(e.target.value)}`;
    renderFormHistoryInspection(e.target.value);
  });
  if (DOM.selFeedHive) DOM.selFeedHive.addEventListener('change', e => {
    qsid('form-feeding-title').textContent = `🍯 Karmienie: ${getHiveName(e.target.value)}`;
    renderFormHistoryFeeding(e.target.value);
  });
  if (DOM.selTreatHive) DOM.selTreatHive.addEventListener('change', e => {
    qsid('form-treatment-title').textContent = `💉 Leczenie: ${getHiveName(e.target.value)}`;
    renderFormHistoryTreatment(e.target.value);
  });
  if (DOM.filterHive) DOM.filterHive.addEventListener('change', renderGlobalHistories);

  if (DOM.inspForm) {
    DOM.inspForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selHive.value);
      const payload = {
        hiveNum: hId, hiveName: getHiveName(hId), matkaInfo: hiveQueens[hId] || 'Brak opisu',
        timestamp: DOM.dateInsp.value ? new Date(DOM.dateInsp.value).toISOString() : new Date().toISOString(),
        matka: qs('input[name="matka"]:checked').value, jaja: qs('input[name="jaja"]:checked').value,
        ramkiCzerwiu: DOM.cbRamkiNw.checked ? 'NIE WIEM' : (parseInt(DOM.ramki.value) || 0),
        pokarm: qs('input[name="pokarm"]:checked').value, polkorpus: parseInt(qs('input[name="polkorpus"]:checked').value) || 0,
        rodzina: qs('input[name="rodzina"]:checked').value,
        dzialania: DOM.dzialania.value.trim() || 'Brak uwag', przyszleDzialania: DOM.przyszle.value.trim() || 'Brak planów', _synced: false
      };

      if (editingInspectionId) {
        const idx = inspections.findIndex(i => i.id === editingInspectionId);
        if (idx > -1) inspections[idx] = { ...inspections[idx], ...payload, timestamp: DOM.dateInsp.value ? payload.timestamp : inspections[idx].timestamp };
        editingInspectionId = null;
      } else {
        payload.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        inspections.unshift(payload);
      }
      finalizeSave(KEYS.INSPECTIONS, inspections, payload, 'inspection', hId);
      DOM.inspForm.reset();
      if (DOM.cbRamkiNw) DOM.cbRamkiNw.dispatchEvent(new Event('change'));
    });
  }

  if (DOM.feedForm) {
    DOM.feedForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selFeedHive.value);
      const payload = {
        hiveNum: hId, hiveName: getHiveName(hId), timestamp: DOM.dateFeed.value ? new Date(DOM.dateFeed.value).toISOString() : new Date().toISOString(),
        kgCukru: parseFloat(DOM.kgFeed.value) || 0, uwagi: DOM.notesFeed.value.trim() || 'Syrop 3:2', _synced: false
      };

      if (editingFeedingId) {
        const idx = feedings.findIndex(f => f.id === editingFeedingId);
        if (idx > -1) feedings[idx] = { ...feedings[idx], ...payload, timestamp: DOM.dateFeed.value ? payload.timestamp : feedings[idx].timestamp };
        editingFeedingId = null;
      } else {
        payload.id = Date.now().toString(36) + "_f_" + Math.random().toString(36).substr(2);
        feedings.unshift(payload);
      }
      finalizeSave(KEYS.FEEDINGS, feedings, payload, 'feeding', hId);
      DOM.notesFeed.value = '';
    });
  }

  if (DOM.treatForm) {
    DOM.treatForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selTreatHive.value);
      const payload = {
        hiveNum: hId, hiveName: getHiveName(hId), timestamp: DOM.dateTreat.value ? new Date(DOM.dateTreat.value).toISOString() : new Date().toISOString(),
        preparat: DOM.prepTreat.value.trim(), uwagi: DOM.notesTreat.value.trim() || 'Brak uwag', _synced: false
      };

      if (editingTreatmentId) {
        const idx = treatments.findIndex(t => t.id === editingTreatmentId);
        if (idx > -1) treatments[idx] = { ...treatments[idx], ...payload, timestamp: DOM.dateTreat.value ? payload.timestamp : treatments[idx].timestamp };
        editingTreatmentId = null;
      } else {
        payload.id = Date.now().toString(36) + "_t_" + Math.random().toString(36).substr(2);
        treatments.unshift(payload);
      }
      finalizeSave(KEYS.TREATMENTS, treatments, payload, 'treatment', hId);
      DOM.prepTreat.value = DOM.notesTreat.value = '';
    });
  }

  function finalizeSave(storeKey, arr, payload, type, hId) {
    Store.set(storeKey, arr);
    sendToGoogleSheets(payload, type);
    renderHivesGrid();
    renderGlobalHistories();
    if(type === 'inspection') renderFormHistoryInspection(hId);
    if(type === 'feeding') renderFormHistoryFeeding(hId);
    if(type === 'treatment') renderFormHistoryTreatment(hId);
    switchTab(`tab-${getHiveCategory(hId)}`);
  }

  function renderHivesGrid() {
    updateHiveSelects();
    [DOM.grids.dom, DOM.grids.zbior, DOM.grids.las].forEach(g => g && (g.innerHTML = ''));
    const frags = { dom: document.createDocumentFragment(), zbior: document.createDocumentFragment(), las: document.createDocumentFragment() };

    for (let i = 1; i <= TOTAL_HIVES; i++) {
      const last = inspections.filter(x => x.hiveNum === i)[0];
      const card = document.createElement('div');
      card.className = `hive-card card-${getHiveCategory(i)}`;
      
      const rCzerw = last ? (last.ramkiCzerwiu === 'NIE WIEM' ? '🤷' : `${last.ramkiCzerwiu}r`) : '0';
      const pk = last && last.polkorpus > 0 ? `${last.polkorpus} 📦` : '0';
      
      card.innerHTML = `
        <div class="hive-card-header">
          <div>
            <span class="hive-num">🐝 ${escapeHtml(getHiveName(i))}</span>
            <div style="font-size: 0.85rem; color: var(--primary-hover); font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>👑 Matka: ${escapeHtml(hiveQueens[i] || (last ? last.matkaInfo : 'Nieokreślona'))}</span>
              <button class="btn-small btn-edit-queen" data-hive="${i}" style="font-size: 0.7rem; padding: 1px 5px;">✏️</button>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <span class="last-date">${last ? formatPL(last.timestamp) : 'Brak'}</span>
            <button class="btn-small btn-rename-hive" data-hive="${i}" style="font-size: 0.75rem; padding: 2px 6px;">✏️</button>
          </div>
        </div>
        <div class="hive-details">
          <div class="detail-item"><strong>Matka:</strong> ${last?.matka === 'TAK' ? '<span class="status-badge pos">TAK</span>' : '<span class="status-badge neg">Brak</span>'}</div>
          <div class="detail-item"><strong>Jaja:</strong> ${last?.jaja === 'TAK' ? '<span class="status-badge pos">TAK</span>' : '<span class="status-badge neg">Brak</span>'}</div>
          <div class="detail-item"><strong>Czerw:</strong> ${rCzerw}</div>
          <div class="detail-item"><strong>Pokarm:</strong> ${last?.pokarm === 'OK' ? '<span class="status-badge pos">OK</span>' : '<span class="status-badge neg">BRAK</span>'}</div>
          <div class="detail-item"><strong>Półkorpus:</strong> <span class="badge-count">${escapeHtml(pk)}</span></div>
          <div class="detail-item"><strong>Rodzina:</strong> <span class="badge-count">${escapeHtml(last?.rodzina || '-')}</span></div>
        </div>
        <div class="hive-action-text"><strong>Wyk:</strong> "${escapeHtml((last?.dzialania || 'Brak').substring(0, 42))}"</div>
        <div class="hive-action-text" style="background: #fef3c7; color: #92400e;"><strong>Plan:</strong> "${escapeHtml((last?.przyszleDzialania || 'Brak').substring(0, 42))}"</div>
        <div class="hive-card-footer" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-top: 10px;">
          <button class="btn-card-action primary btn-add-inspection" data-hive="${i}">📝 Przegląd</button>
          <button class="btn-card-action btn-add-feeding" data-hive="${i}" style="background: #d97706; color: white;">🍯</button>
          <button class="btn-card-action btn-add-treatment" data-hive="${i}" style="background: #991b1b; color: white;">💉 Leczenie</button>
        </div>
      `;
      card.addEventListener('click', e => { if(!e.target.closest('button')) openInspectionForHive(i); });
      frags[getHiveCategory(i)].appendChild(card);
    }
    
    if(DOM.grids.dom) DOM.grids.dom.appendChild(frags.dom);
    if(DOM.grids.zbior) DOM.grids.zbior.appendChild(frags.zbior);
    if(DOM.grids.las) DOM.grids.las.appendChild(frags.las);
  }

  function renderTable(data, tbody, mapper, noDataSpan) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.length) return tbody.innerHTML = `<tr><td colspan="${noDataSpan}" style="text-align:center;">Brak wpisów.</td></tr>`;
    const frag = document.createDocumentFragment();
    data.forEach(item => { const tr = document.createElement('tr'); tr.innerHTML = mapper(item); frag.appendChild(tr); });
    tbody.appendChild(frag);
  }

  // --- HISTORIE KONKRETNYCH FORMULARZY ---
  function renderFormHistoryInspection(hId) {
    const list = inspections.filter(i => i.hiveNum === parseInt(hId));
    qsid('insp-history-title').textContent = `📝 Historia Przeglądów: ${getHiveName(hId)}`;
    renderTable(list, DOM.inspHistTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td>${i.ramkiCzerwiu === 'NIE WIEM' ? '🤷' : i.ramkiCzerwiu + 'r'}</td>
      <td>${i.pokarm === 'OK' ? '🍯' : '⚠️'}</td>
      <td>${escapeHtml(i.dzialania)}</td>
      <td>
        <button class="btn-edit-row btn-edit-inspection" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-inspection" data-id="${i.id}">🗑️</button>
      </td>
    `, 5);
  }

  function renderFormHistoryFeeding(hId) {
    const list = feedings.filter(i => i.hiveNum === parseInt(hId));
    qsid('feed-history-title').textContent = `🍯 Historia Karmienia: ${getHiveName(hId)}`;
    const sum = list.reduce((acc, curr) => acc + (parseFloat(curr.kgCukru) || 0), 0);
    if(qsid('feeding-summary-text')) qsid('feeding-summary-text').textContent = `Łącznie podano: ${sum.toFixed(1)} kg cukru`;
    
    renderTable(list, DOM.feedTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><strong style="color:#b45309;">${i.kgCukru} kg</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td>
        <button class="btn-edit-row btn-edit-feeding-row" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-feeding-row" data-id="${i.id}">🗑️</button>
      </td>
    `, 4);
  }

  function renderFormHistoryTreatment(hId) {
    const list = treatments.filter(i => i.hiveNum === parseInt(hId));
    qsid('treat-history-title').textContent = `💉 Historia Leczenia: ${getHiveName(hId)}`;
    renderTable(list, DOM.treatTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><strong style="color:#991b1b;">${escapeHtml(i.preparat)}</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td>
        <button class="btn-edit-row btn-edit-treatment-row" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-treatment-row" data-id="${i.id}">🗑️</button>
      </td>
    `, 4);
  }

  // --- ZBIORCZE TABELE HISTORII (Arkusz) ---
  function renderGlobalHistories() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    
    const iList = filter === 'ALL' ? inspections : inspections.filter(i => i.hiveNum === parseInt(filter));
    renderTable(iList, DOM.sheetTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong>${escapeHtml(i.hiveName)}</strong></td>
      <td>${escapeHtml(i.rodzina || 'Silna')}</td>
      <td>${i.matka === 'TAK' ? '👑' : '❌'}</td>
      <td>${i.jaja === 'TAK' ? '🥚' : '❌'}</td>
      <td>${i.ramkiCzerwiu === 'NIE WIEM' ? '🤷' : i.ramkiCzerwiu + 'r'}</td>
      <td>${i.pokarm === 'OK' ? '🍯' : '⚠️'}</td>
      <td><strong>${i.polkorpus || 0} 📦</strong></td>
      <td>${escapeHtml(i.dzialania)}</td>
      <td><em style="color:#b45309;">${escapeHtml(i.przyszleDzialania)}</em></td>
      <td>
        <button class="btn-delete-row btn-delete-inspection" data-id="${i.id}">🗑️</button>
      </td>
    `, 12);

    const fList = filter === 'ALL' ? feedings : feedings.filter(i => i.hiveNum === parseInt(filter));
    renderTable(fList, DOM.mainFeedTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong>${escapeHtml(i.hiveName)}</strong></td>
      <td><strong style="color:#b45309;">${i.kgCukru} kg</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td><button class="btn-delete-row btn-delete-feeding-row" data-id="${i.id}">🗑️</button></td>
    `, 6);

    const tList = filter === 'ALL' ? treatments : treatments.filter(i => i.hiveNum === parseInt(filter));
    renderTable(tList, DOM.mainTreatTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong>${escapeHtml(i.hiveName)}</strong></td>
      <td><strong style="color:#991b1b;">${escapeHtml(i.preparat)}</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td><button class="btn-delete-row btn-delete-treatment-row" data-id="${i.id}">🗑️</button></td>
    `, 6);
  }

  function deleteFromGoogleSheets(type, id) {
    const url = getWebhookUrl();
    if (!url) return;
    const payloadStr = JSON.stringify({ action: 'delete', type: type, id: id });
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' }));
    else fetch(url, { method: 'POST', mode: 'no-cors', body: payloadStr }).catch(()=>{});
  }

  function deleteRecord(type, id) {
    deleteFromGoogleSheets(type, id);
    if (type === 'inspections') { inspections = inspections.filter(x => x.id !== id); Store.set(KEYS.INSPECTIONS, inspections); }
    if (type === 'feedings') { feedings = feedings.filter(x => x.id !== id); Store.set(KEYS.FEEDINGS, feedings); }
    if (type === 'treatments') { treatments = treatments.filter(x => x.id !== id); Store.set(KEYS.TREATMENTS, treatments); }
    
    renderHivesGrid();
    renderGlobalHistories();
    if (DOM.selHive.value) renderFormHistoryInspection(DOM.selHive.value);
    if (DOM.selFeedHive.value) renderFormHistoryFeeding(DOM.selFeedHive.value);
    if (DOM.selTreatHive.value) renderFormHistoryTreatment(DOM.selTreatHive.value);
  }

  function openInspectionForHive(hId) {
    DOM.selHive.value = hId;
    qsid('form-hive-title').textContent = `Przegląd: ${getHiveName(hId)}`;
    DOM.dateInsp.value = getDatetimeLocal();
    renderFormHistoryInspection(hId);
    
    const last = inspections.find(i => i.hiveNum === hId);
    if (last) {
      qsid(last.matka === 'TAK' ? 'matka-tak' : 'matka-nie').checked = true;
      qsid(last.jaja === 'TAK' ? 'jaja-tak' : 'jaja-nie').checked = true;
      if (last.ramkiCzerwiu === 'NIE WIEM') DOM.cbRamkiNw.checked = true;
      else { DOM.cbRamkiNw.checked = false; DOM.ramki.value = last.ramkiCzerwiu ?? 4; }
      if(DOM.cbRamkiNw) DOM.cbRamkiNw.dispatchEvent(new Event('change'));
      qsid(last.pokarm === 'OK' ? 'pokarm-ok' : 'pokarm-brak').checked = true;
      const pk = qsid(`polkorpus-${last.polkorpus ?? 0}`); if (pk) pk.checked = true;
      const rMap = {'Bardzo Silna': 'bs', 'Średnia': 'sr', 'Słaba': 'sl', 'BRAK': 'brak'};
      qsid(`rodzina-${rMap[last.rodzina] || 's'}`).checked = true;
    } else {
      if(DOM.cbRamkiNw) { DOM.cbRamkiNw.checked = false; DOM.cbRamkiNw.dispatchEvent(new Event('change')); }
      DOM.ramki.value = 4;
    }
    switchTab('tab-inspection');
  }

  function openInspectionForEdit(id) {
    const item = inspections.find(i => i.id === id);
    if (!item) return;
    editingInspectionId = id;
    openInspectionForHive(item.hiveNum);
    DOM.dateInsp.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.dzialania.value = item.dzialania || '';
    DOM.przyszle.value = item.przyszleDzialania || '';
    qsid('form-hive-title').textContent = `✏️ Edycja Przeglądu (Data: ${new Date(item.timestamp).toLocaleDateString('pl-PL')})`;
  }

  function openFeedingForHive(hId) {
    DOM.selFeedHive.value = hId;
    DOM.dateFeed.value = getDatetimeLocal();
    qsid('form-feeding-title').textContent = `🍯 Karmienie: ${getHiveName(hId)}`;
    editingFeedingId = null;
    renderFormHistoryFeeding(hId);
    switchTab('tab-feeding');
  }

  function openFeedingForEdit(id) {
    const item = feedings.find(i => i.id === id);
    if (!item) return;
    editingFeedingId = id;
    openFeedingForHive(item.hiveNum);
    DOM.dateFeed.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.kgFeed.value = item.kgCukru || 3;
    DOM.notesFeed.value = item.uwagi || '';
    qsid('form-feeding-title').textContent = `✏️ Edycja Karmienia (Data: ${new Date(item.timestamp).toLocaleDateString('pl-PL')})`;
  }

  function openTreatmentForHive(hId) {
    DOM.selTreatHive.value = hId;
    DOM.dateTreat.value = getDatetimeLocal();
    qsid('form-treatment-title').textContent = `💉 Leczenie: ${getHiveName(hId)}`;
    editingTreatmentId = null;
    renderFormHistoryTreatment(hId);
    switchTab('tab-treatment');
  }

  function openTreatmentForEdit(id) {
    const item = treatments.find(t => t.id === id);
    if (!item) return;
    editingTreatmentId = id;
    openTreatmentForHive(item.hiveNum);
    DOM.dateTreat.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.prepTreat.value = item.preparat || '';
    DOM.notesTreat.value = item.uwagi || '';
    qsid('form-treatment-title').textContent = `✏️ Edycja Leczenia (Data: ${new Date(item.timestamp).toLocaleDateString('pl-PL')})`;
  }

  function switchTab(tabId) {
    activeTab = tabId;
    DOM.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    DOM.contents.forEach(c => c.classList.toggle('active', c.id === tabId));
    if (tabId === 'tab-sheet') renderGlobalHistories();
    if (['tab-dom', 'tab-zbior', 'tab-las'].includes(tabId)) renderHivesGrid();
  }

  function updateHiveSelects() {
    const opts = Array.from({length: TOTAL_HIVES}, (_, i) => `<option value="${i+1}">${getHiveName(i+1)} (Ul № ${i+1})</option>`).join('');
    if (DOM.selHive) DOM.selHive.innerHTML = opts;
    if (DOM.selFeedHive) DOM.selFeedHive.innerHTML = opts;
    if (DOM.selTreatHive) DOM.selTreatHive.innerHTML = opts;
    if (DOM.filterHive) DOM.filterHive.innerHTML = '<option value="ALL">Wszystkie Ule (1-18)</option>' + opts;
  }

  function initTheme() {
    const isDark = Store.get(KEYS.THEME, 'light') === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    if (DOM.btnTheme) {
      DOM.btnTheme.textContent = isDark ? '🌙' : '☀️';
      DOM.btnTheme.addEventListener('click', () => {
        const d = document.body.classList.toggle('dark-mode');
        DOM.btnTheme.textContent = d ? '🌙' : '☀️';
        Store.set(KEYS.THEME, d ? 'dark' : 'light');
      });
    }
  }

  function promptRenameHive(id) {
    const n = prompt(`Podaj nazwę dla Ula № ${id}:`, getHiveName(id));
    if (n && n.trim()) { hiveNames[id] = n.trim(); Store.set(KEYS.NAMES, hiveNames); renderHivesGrid(); renderGlobalHistories(); }
  }

  function promptEditQueen(id) {
    const n = prompt(`Wpisz opis/oznaczenie matki dla Ula № ${id}:`, hiveQueens[id] || '');
    if (n !== null) { hiveQueens[id] = n.trim(); Store.set(KEYS.QUEENS, hiveQueens); renderHivesGrid(); renderGlobalHistories(); }
  }

  function sendToGoogleSheets(record, type = 'inspection') {
    const url = getWebhookUrl();
    if (!url || record._synced) return;
    const payloadStr = JSON.stringify({ ...record, type: type, timestamp: formatPL(record.timestamp) });

    if (navigator.sendBeacon) {
      if (navigator.sendBeacon(url, new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' }))) {
        record._synced = true; saveLocalRecordState(type); return;
      }
    }
    fetch(url, { method: 'POST', mode: 'no-cors', body: payloadStr }).then(() => {
      record._synced = true; saveLocalRecordState(type);
    }).catch(()=>{});
  }

  function saveLocalRecordState(type) {
    if (type === 'inspection') Store.set(KEYS.INSPECTIONS, inspections);
    if (type === 'feeding') Store.set(KEYS.FEEDINGS, feedings);
    if (type === 'treatment') Store.set(KEYS.TREATMENTS, treatments);
  }

  function fetchFromGoogleSheets() {
    const url = getWebhookUrl();
    if (!url) return Promise.reject();
    return fetch(url).then(r => r.json()).then(remote => {
      let addedTotal = 0;
      if (remote && typeof remote === 'object') {
        if (Array.isArray(remote.inspections)) {
          remote.inspections.forEach(rm => {
            const hNum = parseInt(rm.hiveNum, 10);
            if (isNaN(hNum) || !rm.id) return;
            rm.hiveNum = hNum;
            if (!inspections.some(lc => lc.id === rm.id)) { inspections.push(rm); addedTotal++; }
          });
          inspections.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          Store.set(KEYS.INSPECTIONS, inspections);
        }
        if (Array.isArray(remote.feedings)) {
          remote.feedings.forEach(rm => {
            const hNum = parseInt(rm.hiveNum, 10);
            if (isNaN(hNum) || !rm.id) return;
            rm.hiveNum = hNum;
            if (!feedings.some(lc => lc.id === rm.id)) { feedings.push(rm); addedTotal++; }
          });
          feedings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          Store.set(KEYS.FEEDINGS, feedings);
        }
        if (Array.isArray(remote.treatments)) {
          remote.treatments.forEach(rm => {
            const hNum = parseInt(rm.hiveNum, 10);
            if (isNaN(hNum) || !rm.id) return;
            rm.hiveNum = hNum;
            if (!treatments.some(lc => lc.id === rm.id)) { treatments.push(rm); addedTotal++; }
          });
          treatments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          Store.set(KEYS.TREATMENTS, treatments);
        }
        renderGlobalHistories();
        renderHivesGrid();
      }
      return addedTotal;
    });
  }
});
