/**
 * OSTATECZNA LOGIKA APLIKACJI ASYSTENT PASIEKA WLKP (Rozbudowana o IZO oraz listę zadań)
 */

document.addEventListener('DOMContentLoaded', () => {
  const TOTAL_HIVES = 18;
  
  const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx2PUdp6AyROHIr97rmxa_pCVJmKHXrgYseOZBRoVkQnmKiVU_l_-jSP2Ux_gAA7gNfuA/exec'; 

  const KEYS = {
    INSPECTIONS: 'pasieka_wlkp_inspections_v2',
    FEEDINGS: 'pasieka_wlkp_feedings_v2',
    TREATMENTS: 'pasieka_wlkp_treatments_v2',
    IZOS: 'pasieka_wlkp_izos_v2',
    NAMES: 'pasieka_wlkp_hive_names_v2',
    QUEENS: 'pasieka_wlkp_hive_queens_v2',
    THEME: 'pasieka_theme_mode',
    WEBHOOK: 'pasieka_gsheet_webhook_v2'
  };

  function getWebhookUrl() {
    return localStorage.getItem(KEYS.WEBHOOK) || DEFAULT_WEBHOOK;
  }

  const Store = {
    get: (key, def) => { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } },
    set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  };

  let inspections = Store.get(KEYS.INSPECTIONS, []);
  let feedings = Store.get(KEYS.FEEDINGS, []);
  let treatments = Store.get(KEYS.TREATMENTS, []);
  let izos = Store.get(KEYS.IZOS, []);
  
  let hiveNames = Store.get(KEYS.NAMES, {});
  let hiveQueens = Store.get(KEYS.QUEENS, {});

  let activeTab = 'tab-dom';
  let isVoiceActive = false;
  let recognition = null;
  let isDictatingField = false; 
  let editingInspectionId = null;
  let editingFeedingId = null;
  let editingTreatmentId = null;
  let editingIzoId = null;

  const escapeHtml = str => String(str || '').replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[m]));
  const formatPL = dStr => {
    if (!dStr) return '';
    const d = new Date(dStr);
    return isNaN(d) ? dStr : `${d.toLocaleDateString('pl-PL')} ${d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'})}`;
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
    btnTheme: qsid('btn-theme-toggle'), btnVoice: qsid('btn-voice-master'),
    voiceStatus: qsid('voice-status-bar'), voiceText: qsid('voice-status-text'),
    btnStopVoice: qsid('btn-stop-voice'), tabs: qsa('.tab-btn'), contents: qsa('.tab-content'),
    grids: { dom: qsid('hives-grid-dom'), zbior: qsid('hives-grid-zbior'), las: qsid('hives-grid-las') },
    
    inspForm: qsid('inspection-form'), selHive: qsid('select-hive'), dateInsp: qsid('input-date'),
    ramki: qsid('ramki-czerwiu'), cbRamkiNw: qsid('cb-ramki-niewiem'), ramkiWrap: qsid('ramki-stepper-wrap'),
    dzialania: qsid('input-dzialania'), przyszle: qsid('input-przyszle-dzialania'),
    
    feedForm: qsid('feeding-form'), selFeedHive: qsid('select-feeding-hive'), dateFeed: qsid('input-feeding-date'),
    kgFeed: qsid('input-feeding-kg'), notesFeed: qsid('input-feeding-notes'),
    
    treatForm: qsid('treatment-form'), selTreatHive: qsid('select-treatment-hive'), dateTreat: qsid('input-treatment-date'),
    prepTreat: qsid('input-treatment-preparat'), notesTreat: qsid('input-treatment-notes'),
    
    izoForm: qsid('izo-form'), selIzoHive: qsid('select-izo-hive'), dateIzo: qsid('input-izo-date'),
    ramkaIzo: qsid('input-izo-ramka'),

    modal: qsid('hive-history-modal'), modalContent: qsid('modal-history-content'),
    sheetTbody: qsid('sheet-tbody'), mainFeedTbody: qsid('feedings-tbody'),
    mainTreatTbody: qsid('treatments-tbody'), mainIzoTbody: qsid('izos-tbody'),
    filterHive: qsid('filter-hive-select'),
    
    todoList: qsid('todo-list'),
    
    localInspHist: qsid('local-inspection-history'),
    localFeedHist: qsid('local-feeding-history'),
    localTreatHist: qsid('local-treatment-history'),
    localIzoHist: qsid('local-izo-history'),
    
    webhook: qsid('input-gsheet-webhook'), btnSaveWebhook: qsid('btn-save-webhook'),
    btnShowGsheetScript: qsid('btn-show-gsheet-script'), gsheetScriptDetails: qsid('gsheet-script-details'),
    btnSyncNow: qsid('btn-sync-now'),
    
    wrapInsp: qsid('wrapper-inspections-table'), wrapFeed: qsid('wrapper-feedings-table'), 
    wrapTreat: qsid('wrapper-treatments-table'), wrapIzo: qsid('wrapper-izos-table'),
    btnVInsp: qsid('btn-view-inspections'), btnVFeed: qsid('btn-view-feedings'), 
    btnVTreat: qsid('btn-view-treatments'), btnVIzo: qsid('btn-view-izos')
  };

  initTheme();
  if (DOM.dateInsp) DOM.dateInsp.value = getDatetimeLocal();
  if (DOM.dateFeed) DOM.dateFeed.value = getDatetimeLocal();
  if (DOM.dateTreat) DOM.dateTreat.value = getDatetimeLocal();
  if (DOM.dateIzo) DOM.dateIzo.value = getDatetimeLocal();
  
  renderHivesGrid();
  renderSheetTable();
  initVoiceRecognition();

  if (DOM.webhook) {
      let savedUrl = localStorage.getItem(KEYS.WEBHOOK);
      if (!savedUrl && DEFAULT_WEBHOOK !== 'TUTAJ_WKLEJ_TWOJ_ADRES_URL_WEBHOOKA') {
          savedUrl = DEFAULT_WEBHOOK;
      }
      DOM.webhook.value = savedUrl || '';
  }

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
      } else {
        alert('⚠️ Niepoprawny format! Link musi zaczynać się od https://script.google.com/macros/s/');
      }
    });
  }

  if (DOM.btnSyncNow) {
    DOM.btnSyncNow.addEventListener('click', () => {
      const url = getWebhookUrl();
      if (!url || url === 'TUTAJ_WKLEJ_TWOJ_ADRES_URL_WEBHOOKA') { 
          alert('Brak skonfigurowanego adresu URL.'); 
          return; 
      }
      DOM.btnSyncNow.disabled = true;
      DOM.btnSyncNow.textContent = '⏳ Synchronizacja...';

      fetchFromGoogleSheets()
        .then(count => alert(`Zsynchronizowano pomyślnie. Nowe rekordy: ${count}.`))
        .catch(err => alert('Błąd synchronizacji z Google Sheets.'))
        .finally(() => { DOM.btnSyncNow.disabled = false; DOM.btnSyncNow.textContent = '🔄 Synchronizuj z Sheets'; });
    });
  }

  setTimeout(() => fetchFromGoogleSheets().catch(() => {}), 1500);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);

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
      if (cardBtn.classList.contains('btn-add-izo')) openIzoForHive(hId);
      if (cardBtn.classList.contains('btn-open-modal-history')) openHiveHistoryModal(hId);
      if (cardBtn.classList.contains('btn-rename-hive')) promptRenameHive(hId);
      if (cardBtn.classList.contains('btn-edit-queen')) promptEditQueen(hId);
      return;
    }

    if (e.target === DOM.modal || e.target.id === 'btn-close-modal' || e.target.classList.contains('btn-close')) {
      DOM.modal.classList.add('hidden');
    }
    
    const actionBtn = e.target.closest('button[data-id]');
    if (actionBtn) {
      e.stopPropagation();
      const id = actionBtn.dataset.id;
      if (actionBtn.classList.contains('btn-delete-inspection')) { if (confirm('Usunąć wpis przeglądu?')) deleteRecord('inspections', id); }
      if (actionBtn.classList.contains('btn-delete-feeding-row')) { if (confirm('Usunąć wpis karmienia?')) deleteRecord('feedings', id); }
      if (actionBtn.classList.contains('btn-delete-treatment-row')) { if (confirm('Usunąć wpis leczenia?')) deleteRecord('treatments', id); }
      if (actionBtn.classList.contains('btn-delete-izo-row')) { if (confirm('Usunąć ten wpis IZO?')) deleteRecord('izos', id); }
      
      if (actionBtn.classList.contains('btn-edit-inspection')) { DOM.modal.classList.add('hidden'); openInspectionForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-feeding-row')) { DOM.modal.classList.add('hidden'); openFeedingForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-treatment-row')) { DOM.modal.classList.add('hidden'); openTreatmentForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-izo-row')) { DOM.modal.classList.add('hidden'); openIzoForEdit(id); }
    }
  });

  const attachChangeSelect = (sel, formTitle, titlePrefix) => {
    if(sel) sel.addEventListener('change', e => {
      qsid(formTitle).textContent = `${titlePrefix} Ula № ${e.target.value}`;
      renderLocalHistory(e.target.value);
    });
  };
  attachChangeSelect(DOM.selHive, 'form-hive-title', 'Przegląd');
  attachChangeSelect(DOM.selFeedHive, 'form-feeding-title', '🍯 Karmienie');
  attachChangeSelect(DOM.selTreatHive, 'form-treatment-title', '💉 Leczenie');
  attachChangeSelect(DOM.selIzoHive, 'form-izo-title', '🗃️ Izolator');
  
  if (DOM.filterHive) DOM.filterHive.addEventListener('change', () => { renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); renderIzosTable(); });

  if (DOM.btnVInsp && DOM.btnVFeed && DOM.btnVTreat && DOM.btnVIzo) {
    DOM.btnVInsp.addEventListener('click', () => toggleTableViews('insp'));
    DOM.btnVFeed.addEventListener('click', () => toggleTableViews('feed'));
    DOM.btnVTreat.addEventListener('click', () => toggleTableViews('treat'));
    DOM.btnVIzo.addEventListener('click', () => toggleTableViews('izo'));
  }

  function toggleTableViews(view) {
    DOM.btnVInsp.classList.toggle('active', view === 'insp');
    DOM.btnVFeed.classList.toggle('active', view === 'feed');
    DOM.btnVTreat.classList.toggle('active', view === 'treat');
    DOM.btnVIzo.classList.toggle('active', view === 'izo');

    if (DOM.wrapInsp) DOM.wrapInsp.classList.toggle('hidden', view !== 'insp');
    if (DOM.wrapFeed) DOM.wrapFeed.classList.toggle('hidden', view !== 'feed');
    if (DOM.wrapTreat) DOM.wrapTreat.classList.toggle('hidden', view !== 'treat');
    if (DOM.wrapIzo) DOM.wrapIzo.classList.toggle('hidden', view !== 'izo');

    if (view === 'insp') renderSheetTable();
    if (view === 'feed') renderFeedingsTable();
    if (view === 'treat') renderTreatmentsTable();
    if (view === 'izo') renderIzosTable();
  }

  // --- SUBMITY ---
  if (DOM.inspForm) {
    DOM.inspForm.addEventListener('submit', e => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; setTimeout(() => submitBtn.disabled = false, 2500); }
      
      const hId = parseInt(DOM.selHive.value);
      const payload = {
        id: editingInspectionId || (Date.now().toString(36) + Math.random().toString(36).substr(2)),
        hiveNum: hId, hiveName: getHiveName(hId), matkaInfo: hiveQueens[hId] || 'Brak opisu',
        timestamp: DOM.dateInsp.value ? new Date(DOM.dateInsp.value).toISOString() : new Date().toISOString(),
        matka: qs('input[name="matka"]:checked').value,
        jaja: qs('input[name="jaja"]:checked').value,
        ramkiCzerwiu: DOM.cbRamkiNw.checked ? 'NIE WIEM' : (parseInt(DOM.ramki.value) || 0),
        pokarm: qs('input[name="pokarm"]:checked').value,
        polkorpus: parseInt(qs('input[name="polkorpus"]:checked').value) || 0,
        rodzina: qs('input[name="rodzina"]:checked').value,
        dzialania: DOM.dzialania.value.trim() || 'Brak uwag',
        przyszleDzialania: DOM.przyszle.value.trim() || 'Brak planów'
      };

      if (editingInspectionId) {
        const idx = inspections.findIndex(i => i.id === editingInspectionId);
        if (idx > -1) inspections[idx] = payload;
        editingInspectionId = null;
      } else inspections.unshift(payload);

      Store.set(KEYS.INSPECTIONS, inspections);
      sendToGoogleSheets(payload, 'inspection');
      DOM.inspForm.reset();
      renderHivesGrid(); renderSheetTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  if (DOM.feedForm) {
    DOM.feedForm.addEventListener('submit', e => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; setTimeout(() => submitBtn.disabled = false, 2500); }
      
      const hId = parseInt(DOM.selFeedHive.value);
      const payload = {
        id: editingFeedingId || (Date.now().toString(36) + "_f_" + Math.random().toString(36).substr(2)),
        hiveNum: hId, hiveName: getHiveName(hId),
        timestamp: DOM.dateFeed.value ? new Date(DOM.dateFeed.value).toISOString() : new Date().toISOString(),
        kgCukru: parseFloat(DOM.kgFeed.value) || 0,
        uwagi: DOM.notesFeed.value.trim() || 'Syrop 3:2'
      };

      if (editingFeedingId) {
        const idx = feedings.findIndex(f => f.id === editingFeedingId);
        if (idx > -1) feedings[idx] = payload;
        editingFeedingId = null;
      } else feedings.unshift(payload);

      Store.set(KEYS.FEEDINGS, feedings);
      sendToGoogleSheets(payload, 'feeding');
      DOM.notesFeed.value = '';
      renderHivesGrid(); renderFeedingsTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  if (DOM.treatForm) {
    DOM.treatForm.addEventListener('submit', e => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; setTimeout(() => submitBtn.disabled = false, 2500); }
      
      const hId = parseInt(DOM.selTreatHive.value);
      const payload = {
        id: editingTreatmentId || (Date.now().toString(36) + "_t_" + Math.random().toString(36).substr(2)),
        hiveNum: hId, hiveName: getHiveName(hId),
        timestamp: DOM.dateTreat.value ? new Date(DOM.dateTreat.value).toISOString() : new Date().toISOString(),
        preparat: DOM.prepTreat.value.trim(), uwagi: DOM.notesTreat.value.trim() || 'Brak uwag'
      };

      if (editingTreatmentId) {
        const idx = treatments.findIndex(t => t.id === editingTreatmentId);
        if (idx > -1) treatments[idx] = payload;
        editingTreatmentId = null;
      } else treatments.unshift(payload);

      Store.set(KEYS.TREATMENTS, treatments);
      sendToGoogleSheets(payload, 'treatment');
      DOM.prepTreat.value = ''; DOM.notesTreat.value = '';
      renderHivesGrid(); renderTreatmentsTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  if (DOM.izoForm) {
    DOM.izoForm.addEventListener('submit', e => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; setTimeout(() => submitBtn.disabled = false, 2500); }
      
      const hId = parseInt(DOM.selIzoHive.value);
      const payload = {
        id: editingIzoId || (Date.now().toString(36) + "_i_" + Math.random().toString(36).substr(2)),
        hiveNum: hId, hiveName: getHiveName(hId),
        timestamp: DOM.dateIzo.value ? new Date(DOM.dateIzo.value).toISOString() : new Date().toISOString(),
        izoType: qs('input[name="izoType"]:checked').value,
        ramka: DOM.ramkaIzo.value.trim()
      };

      if (editingIzoId) {
        const idx = izos.findIndex(t => t.id === editingIzoId);
        if (idx > -1) izos[idx] = payload;
        editingIzoId = null;
      } else izos.unshift(payload);

      Store.set(KEYS.IZOS, izos);
      sendToGoogleSheets(payload, 'izo');
      DOM.ramkaIzo.value = '';
      renderHivesGrid(); renderIzosTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  function renderHivesGrid() {
    updateHiveSelects();
    [DOM.grids.dom, DOM.grids.zbior, DOM.grids.las].forEach(g => g && (g.innerHTML = ''));
    
    const frags = { dom: document.createDocumentFragment(), zbior: document.createDocumentFragment(), las: document.createDocumentFragment() };

    for (let i = 1; i <= TOTAL_HIVES; i++) {
      const inspList = inspections.filter(x => x.hiveNum === i);
      const last = inspList[0];
      const hName = getHiveName(i);
      
      const card = document.createElement('div');
      card.className = `hive-card card-${getHiveCategory(i)}`;
      
      const rCzerw = last ? (last.ramkiCzerwiu === 'NIE WIEM' ? 'NIE WIEM 🤷' : `${last.ramkiCzerwiu} ramek`) : '0';
      const pk = last && last.polkorpus > 0 ? `${last.polkorpus} 📦` : '0 (brak)';
      
      let matkaHtml = '<span class="status-badge neg">NIE/Brak</span>';
      if(last?.matka === 'TAK') matkaHtml = '<span class="status-badge pos">TAK 👑</span>';
      if(last?.matka === 'NIE WIEM') matkaHtml = '<span class="status-badge" style="background:#6b7280;color:white;">NIE WIEM</span>';

      card.innerHTML = `
        <div class="hive-card-header">
          <div>
            <span class="hive-num">🐝 ${escapeHtml(hName)}</span>
            <div style="font-size: 0.85rem; color: var(--primary-hover); font-weight: 600; display: flex; align-items: center; gap: 6px;">
              <span>👑 Matka: ${escapeHtml(hiveQueens[i] || (last ? last.matkaInfo : 'Nieokreślona'))}</span>
              <button class="btn-small btn-edit-queen" data-hive="${i}" style="font-size: 0.7rem; padding: 1px 5px;">✏️</button>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <span class="last-date">${last ? formatPL(last.timestamp) : 'Brak przeglądu'}</span>
            <button class="btn-small btn-rename-hive" data-hive="${i}" style="font-size: 0.75rem; padding: 2px 6px;">✏️</button>
          </div>
        </div>
        <div class="hive-details">
          <div class="detail-item"><strong>Matka:</strong> ${matkaHtml}</div>
          <div class="detail-item"><strong>Jaja:</strong> ${last?.jaja === 'TAK' ? '<span class="status-badge pos">TAK 🥚</span>' : '<span class="status-badge neg">NIE/Brak</span>'}</div>
          <div class="detail-item"><strong>Czerw:</strong> ${rCzerw}</div>
          <div class="detail-item"><strong>Pokarm:</strong> ${last?.pokarm === 'OK' ? '<span class="status-badge pos">OK 🍯</span>' : '<span class="status-badge neg">BRAK ⚠️</span>'}</div>
          <div class="detail-item"><strong>Półkorpus:</strong> <span class="badge-count">${escapeHtml(pk)}</span></div>
          <div class="detail-item"><strong>Rodzina:</strong> <span class="badge-count">${escapeHtml(last?.rodzina || 'Brak danych')}</span></div>
        </div>
        <div class="hive-action-text"><strong>Wyk:</strong> "${escapeHtml((last?.dzialania || 'Brak').substring(0, 42))}"</div>
        <div class="hive-action-text" style="background: #fef3c7; color: #92400e;"><strong>Plan:</strong> "${escapeHtml((last?.przyszleDzialania || 'Brak').substring(0, 42))}"</div>
        
        <!-- PRZYCISKI (4 Akcje) -->
        <div class="hive-card-footer" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 10px;">
          <button class="btn-card-action primary btn-add-inspection" data-hive="${i}" style="font-size:0.7rem; padding:6px 1px;" title="Przegląd">📝 Przeg.</button>
          <button class="btn-card-action btn-add-feeding" data-hive="${i}" style="background: #d97706; color: white; font-size:0.7rem; padding:6px 1px;" title="Karmienie">🍯 Karm.</button>
          <button class="btn-card-action btn-add-treatment" data-hive="${i}" style="background: #dc2626; color: white; font-size:0.7rem; padding:6px 1px;" title="Leczenie">💉 Lecz.</button>
          <button class="btn-card-action btn-add-izo" data-hive="${i}" style="background: #4f46e5; color: white; font-size:0.7rem; padding:6px 1px;" title="IZO">🗃️ IZO</button>
        </div>
        <div style="margin-top: 4px; text-align: center;">
          <button class="btn-card-action btn-open-modal-history" data-hive="${i}" style="background: #4b5563; color: white; width: 100%; font-size:0.8rem; padding:6px;" title="Historia">📜 Pełna Historia Ula</button>
        </div>
      `;
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
    data.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = mapper(item);
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function renderSheetTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? inspections : inspections.filter(i => i.hiveNum === parseInt(filter));
    
    renderTable(list, DOM.sheetTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong>${escapeHtml(i.hiveName)}</strong></td>
      <td><span class="badge-count" style="font-size:0.75rem;">${escapeHtml(i.rodzina || 'Silna')}</span></td>
      <td>${i.matka === 'TAK' ? '👑 TAK' : (i.matka === 'NIE WIEM' ? '🤷 NW' : '❌ NIE')}</td>
      <td>${i.jaja === 'TAK' ? '🥚 TAK' : '❌ NIE'}</td>
      <td>${i.ramkiCzerwiu === 'NIE WIEM' ? 'NW' : i.ramkiCzerwiu + 'r'}</td>
      <td>${i.pokarm === 'OK' ? '🍯 OK' : '⚠️ BRAK'}</td>
      <td><strong>${i.polkorpus || 0} n.</strong></td>
      <td>${escapeHtml(i.dzialania)}</td>
      <td><em style="color:#b45309;">${escapeHtml(i.przyszleDzialania)}</em></td>
      <td><button class="btn-delete-row btn-delete-inspection" data-id="${i.id}">🗑️</button></td>
    `, 12);
  }

  function renderFeedingsTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? feedings : feedings.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.mainFeedTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong>${escapeHtml(i.hiveName)}</strong></td>
      <td><strong style="color:#b45309;">${i.kgCukru} kg</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td>
        <button class="btn-edit-row btn-edit-feeding-row" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-feeding-row" data-id="${i.id}">🗑️</button>
      </td>
    `, 6);
  }

  function renderTreatmentsTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? treatments : treatments.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.mainTreatTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong>${escapeHtml(i.hiveName)}</strong></td>
      <td><strong style="color:#991b1b;">${escapeHtml(i.preparat)}</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td>
        <button class="btn-edit-row btn-edit-treatment-row" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-treatment-row" data-id="${i.id}">🗑️</button>
      </td>
    `, 6);
  }
  
  function renderIzosTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? izos : izos.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.mainIzoTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong>${escapeHtml(i.hiveName)}</strong></td>
      <td><strong style="color:#3730a3;">${escapeHtml(i.izoType)}</strong></td>
      <td>Po ramce: ${escapeHtml(i.ramka)}</td>
      <td>
        <button class="btn-edit-row btn-edit-izo-row" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-izo-row" data-id="${i.id}">🗑️</button>
      </td>
    `, 6);
  }

  function renderTodoList() {
    if (!DOM.todoList) return;
    const todos = inspections
      .filter(i => i.przyszleDzialania && i.przyszleDzialania.toLowerCase() !== 'brak planów' && i.przyszleDzialania.trim() !== '')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if(todos.length === 0) {
       DOM.todoList.innerHTML = '<li style="padding:10px;">Brak zadań w planach. Wszystko zrobione! 🎉</li>';
       return;
    }
    DOM.todoList.innerHTML = todos.map(t => `<li style="padding:12px; border-bottom:1px solid #d1fae5; font-size:1rem;">
      <strong style="color:#047857;">[${formatPL(t.timestamp)}] Ul № ${t.hiveNum} (${escapeHtml(t.hiveName)}):</strong><br>
      <span style="color:#064e3b; display:inline-block; margin-top:4px;">👉 ${escapeHtml(t.przyszleDzialania)}</span>
    </li>`).join('');
  }

  function renderLocalHistory(hiveNum) {
    const hId = parseInt(hiveNum);
    
    const hiveInsp = inspections.filter(item => item.hiveNum === hId);
    if(DOM.localInspHist) {
      if (!hiveInsp.length) DOM.localInspHist.innerHTML = '<p style="color:#6b7280; font-size:0.9rem; padding:8px;">Brak wpisów.</p>';
      else DOM.localInspHist.innerHTML = hiveInsp.map(item => `<div style="background:var(--bg-color); border:1px solid var(--border-color); padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — ${escapeHtml(item.dzialania)}</div>
        </div>`).join('');
    }

    const hiveFeed = feedings.filter(item => item.hiveNum === hId);
    if(DOM.localFeedHist) {
      if (!hiveFeed.length) DOM.localFeedHist.innerHTML = '<p style="color:#6b7280; font-size:0.9rem; padding:8px;">Brak wpisów.</p>';
      else DOM.localFeedHist.innerHTML = hiveFeed.map(item => `<div style="background:#fffbf0; border:1px solid #fde68a; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#b45309;">${item.kgCukru} kg</strong> (${escapeHtml(item.uwagi)})</div>
        </div>`).join('');
    }

    const hiveTreat = treatments.filter(item => item.hiveNum === hId);
    if(DOM.localTreatHist) {
      if (!hiveTreat.length) DOM.localTreatHist.innerHTML = '<p style="color:#6b7280; font-size:0.9rem; padding:8px;">Brak wpisów.</p>';
      else DOM.localTreatHist.innerHTML = hiveTreat.map(item => `<div style="background:#fef2f2; border:1px solid #fca5a5; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#991b1b;">${escapeHtml(item.preparat)}</strong> (${escapeHtml(item.uwagi)})</div>
        </div>`).join('');
    }
    
    const hiveIzos = izos.filter(item => item.hiveNum === hId);
    if(DOM.localIzoHist) {
      if (!hiveIzos.length) DOM.localIzoHist.innerHTML = '<p style="color:#6b7280; font-size:0.9rem; padding:8px;">Brak wpisów.</p>';
      else DOM.localIzoHist.innerHTML = hiveIzos.map(item => `<div style="background:#eef2ff; border:1px solid #c7d2fe; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#3730a3;">${escapeHtml(item.izoType)}</strong> (Po ramce: ${item.ramka})</div>
          <div>
            <button class="btn-edit-row btn-edit-izo-row" data-id="${item.id}" style="padding:2px 6px;">✏️</button>
            <button class="btn-delete-row btn-delete-izo-row" data-id="${item.id}" style="padding:2px 6px;">🗑️</button>
          </div>
        </div>`).join('');
    }
  }

  function deleteRecord(type, id) {
    deleteFromGoogleSheets(type, id);
    if (type === 'inspections') { inspections = inspections.filter(x => x.id !== id); Store.set(KEYS.INSPECTIONS, inspections); renderSheetTable(); }
    if (type === 'feedings') { feedings = feedings.filter(x => x.id !== id); Store.set(KEYS.FEEDINGS, feedings); renderFeedingsTable(); }
    if (type === 'treatments') { treatments = treatments.filter(x => x.id !== id); Store.set(KEYS.TREATMENTS, treatments); renderTreatmentsTable(); }
    if (type === 'izos') { izos = izos.filter(x => x.id !== id); Store.set(KEYS.IZOS, izos); renderIzosTable(); }
    renderHivesGrid();
    renderLocalHistory(DOM.selHive.value || 1); 
  }

  function deleteFromGoogleSheets(type, id) {
    const url = getWebhookUrl();
    if (!url || url === 'TUTAJ_WKLEJ_TWOJ_ADRES_URL_WEBHOOKA') return;
    const payloadStr = JSON.stringify({ action: 'delete', type: type, id: id });
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' }));
    else fetch(url, { method: 'POST', mode: 'no-cors', body: payloadStr }).catch(console.error);
  }

  function openInspectionForHive(hId) {
    DOM.selHive.value = hId; qsid('form-hive-title').textContent = `Przegląd: ${getHiveName(hId)}`;
    DOM.dateInsp.value = getDatetimeLocal(); editingInspectionId = null;
    renderLocalHistory(hId); switchTab('tab-inspection');
  }
  function openFeedingForHive(hId) {
    DOM.selFeedHive.value = hId; qsid('form-feeding-title').textContent = `🍯 Karmienie: ${getHiveName(hId)}`;
    DOM.dateFeed.value = getDatetimeLocal(); editingFeedingId = null;
    renderLocalHistory(hId); switchTab('tab-feeding');
  }
  function openTreatmentForHive(hId) {
    DOM.selTreatHive.value = hId; qsid('form-treatment-title').textContent = `💉 Leczenie: ${getHiveName(hId)}`;
    DOM.dateTreat.value = getDatetimeLocal(); editingTreatmentId = null;
    renderLocalHistory(hId); switchTab('tab-treatment');
  }
  function openIzoForHive(hId) {
    DOM.selIzoHive.value = hId; qsid('form-izo-title').textContent = `🗃️ Izolator: ${getHiveName(hId)}`;
    DOM.dateIzo.value = getDatetimeLocal(); editingIzoId = null;
    renderLocalHistory(hId); switchTab('tab-izo');
  }

  function openInspectionForEdit(id) {
    const item = inspections.find(i => i.id === id); if (!item) return;
    editingInspectionId = id; DOM.selHive.value = item.hiveNum;
    DOM.dateInsp.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.dzialania.value = item.dzialania || ''; DOM.przyszle.value = item.przyszleDzialania || '';
    renderLocalHistory(item.hiveNum); switchTab('tab-inspection');
  }
  function openFeedingForEdit(id) {
    const item = feedings.find(i => i.id === id); if (!item) return;
    editingFeedingId = id; DOM.selFeedHive.value = item.hiveNum;
    DOM.dateFeed.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.kgFeed.value = item.kgCukru || 3; DOM.notesFeed.value = item.uwagi || '';
    renderLocalHistory(item.hiveNum); switchTab('tab-feeding');
  }
  function openTreatmentForEdit(id) {
    const item = treatments.find(t => t.id === id); if (!item) return;
    editingTreatmentId = id; DOM.selTreatHive.value = item.hiveNum;
    DOM.dateTreat.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.prepTreat.value = item.preparat || ''; DOM.notesTreat.value = item.uwagi || '';
    renderLocalHistory(item.hiveNum); switchTab('tab-treatment');
  }
  function openIzoForEdit(id) {
    const item = izos.find(i => i.id === id); if (!item) return;
    editingIzoId = id; DOM.selIzoHive.value = item.hiveNum;
    DOM.dateIzo.value = getDatetimeLocal(new Date(item.timestamp));
    if(item.izoType === 'IZO-pocz') qs('input[name="izoType"][value="IZO-pocz"]').checked = true;
    else qs('input[name="izoType"][value="IZO-koniec"]').checked = true;
    DOM.ramkaIzo.value = item.ramka || '';
    renderLocalHistory(item.hiveNum); switchTab('tab-izo');
  }

  function switchTab(tabId) {
    activeTab = tabId;
    DOM.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    DOM.contents.forEach(c => c.classList.toggle('active', c.id === tabId));
    
    if (tabId === 'tab-sheet') { renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); renderIzosTable(); }
    if (tabId === 'tab-todo') { renderTodoList(); }
    if (['tab-dom', 'tab-zbior', 'tab-las'].includes(tabId)) renderHivesGrid();
  }

  function updateHiveSelects() {
    const opts = Array.from({length: TOTAL_HIVES}, (_, i) => `<option value="${i+1}">${getHiveName(i+1)} (Ul № ${i+1})</option>`).join('');
    if (DOM.selHive) DOM.selHive.innerHTML = opts;
    if (DOM.selFeedHive) DOM.selFeedHive.innerHTML = opts;
    if (DOM.selTreatHive) DOM.selTreatHive.innerHTML = opts;
    if (DOM.selIzoHive) DOM.selIzoHive.innerHTML = opts;
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
    if (n && n.trim()) { hiveNames[id] = n.trim(); Store.set(KEYS.NAMES, hiveNames); renderHivesGrid(); renderSheetTable(); }
  }

  function promptEditQueen(id) {
    const n = prompt(`Wpisz opis matki dla Ula № ${id}:`, hiveQueens[id] || '');
    if (n !== null) { hiveQueens[id] = n.trim(); Store.set(KEYS.QUEENS, hiveQueens); renderHivesGrid(); renderSheetTable(); }
  }

  function sendToGoogleSheets(record, type = 'inspection') {
    const url = getWebhookUrl();
    if (!url || url === 'TUTAJ_WKLEJ_TWOJ_ADRES_URL_WEBHOOKA') return;
    const payloadStr = JSON.stringify({ ...record, type: type, timestamp: formatPL(record.timestamp) });
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' }));
    else fetch(url, { method: 'POST', mode: 'no-cors', body: payloadStr }).catch(console.error);
  }

  function fetchFromGoogleSheets() {
    const url = getWebhookUrl();
    if (!url || url === 'TUTAJ_WKLEJ_TWOJ_ADRES_URL_WEBHOOKA') return Promise.reject();
    
    return fetch(url).then(r => r.json()).then(res => {
      let count = 0;
      const isValid = (row) => row && row.id && String(row.id).trim() !== '' && row.hiveNum && parseInt(row.hiveNum) > 0;

      if (res && typeof res === 'object') {
        if (Array.isArray(res.inspections)) {
          res.inspections.filter(isValid).forEach(rm => {
            if (!inspections.some(lc => lc.id === rm.id)) { inspections.push(rm); count++; }
          });
          Store.set(KEYS.INSPECTIONS, inspections);
        }
        if (Array.isArray(res.feedings)) {
          res.feedings.filter(isValid).forEach(rm => {
            if (!feedings.some(lc => lc.id === rm.id)) { feedings.push(rm); count++; }
          });
          Store.set(KEYS.FEEDINGS, feedings);
        }
        if (Array.isArray(res.treatments)) {
          res.treatments.filter(isValid).forEach(rm => {
            if (!treatments.some(lc => lc.id === rm.id)) { treatments.push(rm); count++; }
          });
          Store.set(KEYS.TREATMENTS, treatments);
        }
        if (Array.isArray(res.izos)) {
          res.izos.filter(isValid).forEach(rm => {
            if (!izos.some(lc => lc.id === rm.id)) { izos.push(rm); count++; }
          });
          Store.set(KEYS.IZOS, izos);
        }
        
        renderHivesGrid(); renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); renderIzosTable();
        renderLocalHistory(DOM.selHive ? DOM.selHive.value : 1);
        if(activeTab === 'tab-todo') renderTodoList();
      }
      return count;
    });
  }

  function openHiveHistoryModal(hiveNum) {
    const nameOfHive = getHiveName(hiveNum);
    const hiveInsp = inspections.filter(item => item.hiveNum === hiveNum);
    const hiveFeed = feedings.filter(item => item.hiveNum === hiveNum);
    const hiveTreat = treatments.filter(item => item.hiveNum === hiveNum);
    const hiveIzos = izos.filter(item => item.hiveNum === hiveNum);
    
    qsid('modal-hive-title').textContent = `📜 Historia Ula: ${nameOfHive}`;

    let html = `<h4 style="color:#b45309; border-bottom:2px solid #fef3c7; padding-bottom:4px;">📋 Przeglądy (${hiveInsp.length})</h4>`;
    if (!hiveInsp.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else hiveInsp.forEach(item => {
        html += `<div style="background:var(--bg-color); border:1px solid var(--border-color); padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — ${escapeHtml(item.dzialania)}</div>
        </div>`;
    });

    html += `<h4 style="color:#d97706; border-bottom:2px solid #fef3c7; padding-bottom:4px; margin-top:12px;">🍯 Karmienie (${hiveFeed.length})</h4>`;
    if (!hiveFeed.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else hiveFeed.forEach(item => {
        html += `<div style="background:#fffbf0; border:1px solid #fde68a; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#b45309;">${item.kgCukru} kg</strong> (${escapeHtml(item.uwagi)})</div>
        </div>`;
    });

    html += `<h4 style="color:#991b1b; border-bottom:2px solid #fee2e2; padding-bottom:4px; margin-top:12px;">💉 Leczenie (${hiveTreat.length})</h4>`;
    if (!hiveTreat.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else hiveTreat.forEach(item => {
        html += `<div style="background:#fef2f2; border:1px solid #fca5a5; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#991b1b;">${escapeHtml(item.preparat)}</strong> (${escapeHtml(item.uwagi)})</div>
        </div>`;
    });
    
    html += `<h4 style="color:#3730a3; border-bottom:2px solid #e0e7ff; padding-bottom:4px; margin-top:12px;">🗃️ IZO (${hiveIzos.length})</h4>`;
    if (!hiveIzos.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else hiveIzos.forEach(item => {
        html += `<div style="background:#eef2ff; border:1px solid #c7d2fe; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#3730a3;">${escapeHtml(item.izoType)}</strong> (Ramka: ${item.ramka})</div>
        </div>`;
    });

    DOM.modalContent.innerHTML = html;
    DOM.modal.classList.remove('hidden');
  }

  function initVoiceRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return DOM.btnVoice ? (DOM.btnVoice.style.display = 'none') : null;
    recognition = new SR();
    recognition.lang = 'pl-PL'; recognition.continuous = true;
    recognition.onstart = () => { isVoiceActive = true; DOM.voiceStatus.classList.remove('hidden'); DOM.btnVoice.classList.add('active'); };
    recognition.onend = () => isVoiceActive ? recognition.start() : stopVoiceMaster();
    recognition.onresult = e => {
      DOM.voiceText.textContent = `Słyszano: "${e.results[e.results.length - 1][0].transcript.trim().toLowerCase()}"`;
    };
  }

  function stopVoiceMaster() {
    isVoiceActive = isDictatingField = false;
    try { recognition?.stop(); } catch {}
    if (DOM.voiceStatus) DOM.voiceStatus.classList.add('hidden');
    if (DOM.btnVoice) DOM.btnVoice.classList.remove('active');
  }

  if (DOM.btnVoice) {
    DOM.btnVoice.addEventListener('click', () => {
      if (isVoiceActive) stopVoiceMaster();
      else { isVoiceActive = true; try { recognition.start(); } catch{} }
    });
  }
});
