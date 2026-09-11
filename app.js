/**
 * OSTATECZNA LOGIKA APLIKACJI ASYSTENT PASIEKA WLKP - 18 ULI Z DODATKIEM IZO I EDYCJĄ
 */

document.addEventListener('DOMContentLoaded', () => {
  const TOTAL_HIVES = 18;
  
  const DEFAULT_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx2PUdp6AyROHIr97rmxa_pCVJmKHXrgYseOZBRoVkQnmKiVU_l_-jSP2Ux_gAA7gNfuA/exec'; // Zastąp swoim linkiem

  const KEYS = {
    INSPECTIONS: 'pasieka_wlkp_inspections_v3',
    FEEDINGS: 'pasieka_wlkp_feedings_v3',
    TREATMENTS: 'pasieka_wlkp_treatments_v3',
    IZOS: 'pasieka_wlkp_izos_v3',
    NAMES: 'pasieka_wlkp_hive_names_v3',
    QUEENS: 'pasieka_wlkp_hive_queens_v3',
    THEME: 'pasieka_theme_mode',
    WEBHOOK: 'pasieka_gsheet_webhook_v3'
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
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
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
    izoRamka: qsid('input-izo-ramka'),

    modal: qsid('hive-history-modal'), modalContent: qsid('modal-history-content'),
    sheetTbody: qsid('sheet-tbody'), mainFeedTbody: qsid('feedings-tbody'),
    mainTreatTbody: qsid('treatments-tbody'), mainIzoTbody: qsid('izos-tbody'), filterHive: qsid('filter-hive-select'),
    
    webhook: qsid('input-gsheet-webhook'),
    btnSaveWebhook: qsid('btn-save-webhook'),
    btnShowGsheetScript: qsid('btn-show-gsheet-script'),
    gsheetScriptDetails: qsid('gsheet-script-details'),
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
      } else {
        alert('⚠️ Niepoprawny format! Link musi zaczynać się od https://script.google.com/macros/s/');
      }
    });
  }

  if (DOM.btnSyncNow) {
    DOM.btnSyncNow.addEventListener('click', () => {
      const url = getWebhookUrl();
      if (!url) { alert('Brak skonfigurowanego adresu URL.'); return; }

      DOM.btnSyncNow.disabled = true;
      DOM.btnSyncNow.textContent = '⏳ Synchronizacja...';

      fetchFromGoogleSheets()
        .then(count => {
          alert(`Synchronizacja zakończona sukcesem! Pobrano ${count} rekordów z Workspace.`);
        })
        .catch(err => {
          console.error(err);
          alert('Błąd synchronizacji z Google Sheets.');
        })
        .finally(() => {
          DOM.btnSyncNow.disabled = false;
          DOM.btnSyncNow.textContent = '🔄 Synchronizuj z Google Sheets';
        });
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

  // === OBSŁUGA KLIKNIĘĆ ===
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
      if (actionBtn.classList.contains('btn-delete-feeding')) { if (confirm('Usunąć wpis karmienia?')) deleteRecord('feedings', id); }
      if (actionBtn.classList.contains('btn-delete-treatment')) { if (confirm('Usunąć wpis leczenia?')) deleteRecord('treatments', id); }
      if (actionBtn.classList.contains('btn-delete-izo')) { if (confirm('Usunąć wpis IZO?')) deleteRecord('izos', id); }
      
      if (actionBtn.classList.contains('btn-edit-inspection')) { DOM.modal.classList.add('hidden'); openInspectionForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-feeding')) { DOM.modal.classList.add('hidden'); openFeedingForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-treatment')) { DOM.modal.classList.add('hidden'); openTreatmentForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-izo')) { DOM.modal.classList.add('hidden'); openIzoForEdit(id); }
    }
  });

  // Odświeżanie lokalnej historii przy zmianie ula z rozwijanej listy
  if (DOM.selHive) DOM.selHive.addEventListener('change', e => { qsid('form-hive-title').textContent = `Przegląd: Ul № ${e.target.value}`; renderLocalHistory('inspection', e.target.value); });
  if (DOM.selFeedHive) DOM.selFeedHive.addEventListener('change', e => { qsid('form-feeding-title').textContent = `🍯 Karmienie: Ul № ${e.target.value}`; renderLocalHistory('feeding', e.target.value); });
  if (DOM.selTreatHive) DOM.selTreatHive.addEventListener('change', e => { qsid('form-treatment-title').textContent = `💉 Leczenie: Ul № ${e.target.value}`; renderLocalHistory('treatment', e.target.value); });
  if (DOM.selIzoHive) DOM.selIzoHive.addEventListener('change', e => { qsid('form-izo-title').textContent = `🗃️ IZO: Ul № ${e.target.value}`; renderLocalHistory('izo', e.target.value); });
  
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
      const hId = parseInt(DOM.selHive.value);
      const isEdit = !!editingInspectionId;
      const payload = {
        id: isEdit ? editingInspectionId : (Date.now().toString(36) + Math.random().toString(36).substr(2)),
        hiveNum: hId,
        hiveName: getHiveName(hId),
        matkaInfo: hiveQueens[hId] || 'Brak opisu',
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

      if (isEdit) {
        const idx = inspections.findIndex(i => i.id === editingInspectionId);
        if (idx > -1) inspections[idx] = payload;
        editingInspectionId = null;
        qsid('btn-submit-inspection').innerHTML = '💾 ZAPISZ PRZEGLĄD';
      } else { inspections.unshift(payload); }

      Store.set(KEYS.INSPECTIONS, inspections);
      sendToGoogleSheets(payload, 'inspection', isEdit);
      DOM.inspForm.reset();
      renderHivesGrid();
      renderSheetTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  if (DOM.feedForm) {
    DOM.feedForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selFeedHive.value);
      const isEdit = !!editingFeedingId;
      const payload = {
        id: isEdit ? editingFeedingId : (Date.now().toString(36) + "_f_" + Math.random().toString(36).substr(2)),
        hiveNum: hId,
        hiveName: getHiveName(hId),
        timestamp: DOM.dateFeed.value ? new Date(DOM.dateFeed.value).toISOString() : new Date().toISOString(),
        kgCukru: parseFloat(DOM.kgFeed.value) || 0,
        uwagi: DOM.notesFeed.value.trim() || 'Syrop 3:2'
      };

      if (isEdit) {
        const idx = feedings.findIndex(f => f.id === editingFeedingId);
        if (idx > -1) feedings[idx] = payload;
        editingFeedingId = null;
        qsid('btn-submit-feeding').innerHTML = '💾 Zapisz Karmienie';
      } else { feedings.unshift(payload); }

      Store.set(KEYS.FEEDINGS, feedings);
      sendToGoogleSheets(payload, 'feeding', isEdit);
      DOM.notesFeed.value = '';
      renderHivesGrid();
      renderFeedingsTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  if (DOM.treatForm) {
    DOM.treatForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selTreatHive.value);
      const isEdit = !!editingTreatmentId;
      const payload = {
        id: isEdit ? editingTreatmentId : (Date.now().toString(36) + "_t_" + Math.random().toString(36).substr(2)),
        hiveNum: hId,
        hiveName: getHiveName(hId),
        timestamp: DOM.dateTreat.value ? new Date(DOM.dateTreat.value).toISOString() : new Date().toISOString(),
        preparat: DOM.prepTreat.value.trim(),
        uwagi: DOM.notesTreat.value.trim() || 'Brak uwag'
      };

      if (isEdit) {
        const idx = treatments.findIndex(t => t.id === editingTreatmentId);
        if (idx > -1) treatments[idx] = payload;
        editingTreatmentId = null;
        qsid('btn-submit-treatment').innerHTML = '💾 Zapisz Leczenie';
      } else { treatments.unshift(payload); }

      Store.set(KEYS.TREATMENTS, treatments);
      sendToGoogleSheets(payload, 'treatment', isEdit);
      DOM.prepTreat.value = '';
      DOM.notesTreat.value = '';
      renderHivesGrid();
      renderTreatmentsTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  if (DOM.izoForm) {
    DOM.izoForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selIzoHive.value);
      const isEdit = !!editingIzoId;
      const payload = {
        id: isEdit ? editingIzoId : (Date.now().toString(36) + "_i_" + Math.random().toString(36).substr(2)),
        hiveNum: hId,
        hiveName: getHiveName(hId),
        timestamp: DOM.dateIzo.value ? new Date(DOM.dateIzo.value).toISOString() : new Date().toISOString(),
        izoType: qs('input[name="izoType"]:checked').value,
        ramka: parseInt(DOM.izoRamka.value) || 0
      };

      if (isEdit) {
        const idx = izos.findIndex(t => t.id === editingIzoId);
        if (idx > -1) izos[idx] = payload;
        editingIzoId = null;
        qsid('btn-submit-izo').innerHTML = '💾 Zapisz IZO';
      } else { izos.unshift(payload); }

      Store.set(KEYS.IZOS, izos);
      sendToGoogleSheets(payload, 'izo', isEdit);
      renderHivesGrid();
      renderIzosTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  // --- RENDEROWANIE KAFELKÓW (4 PRZYCISKI NA DOLE: Przegląd, Pokarm, Lek, IZO) ---
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
          <div class="detail-item"><strong>Matka:</strong> ${last?.matka === 'TAK' ? '<span class="status-badge pos">TAK 👑</span>' : '<span class="status-badge neg">NIE/Brak</span>'}</div>
          <div class="detail-item"><strong>Jaja:</strong> ${last?.jaja === 'TAK' ? '<span class="status-badge pos">TAK 🥚</span>' : '<span class="status-badge neg">NIE/Brak</span>'}</div>
          <div class="detail-item"><strong>Czerw:</strong> ${rCzerw}</div>
          <div class="detail-item"><strong>Pokarm:</strong> ${last?.pokarm === 'OK' ? '<span class="status-badge pos">OK 🍯</span>' : '<span class="status-badge neg">BRAK ⚠️</span>'}</div>
          <div class="detail-item"><strong>Półkorpus:</strong> <span class="badge-count">${escapeHtml(pk)}</span></div>
          <div class="detail-item"><strong>Rodzina:</strong> <span class="badge-count">${escapeHtml(last?.rodzina || 'Brak danych')}</span></div>
        </div>
        <div class="hive-action-text"><strong>Wyk:</strong> "${escapeHtml((last?.dzialania || 'Brak').substring(0, 42))}"</div>
        <div class="hive-action-text" style="background: #fef3c7; color: #92400e;"><strong>Plan:</strong> "${escapeHtml((last?.przyszleDzialania || 'Brak').substring(0, 42))}"</div>
        
        <!-- KOMPAKTOWE 4 PRZYCISKI -->
        <div class="hive-card-footer" style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px; margin-top: 10px;">
          <button class="btn-card-action primary btn-add-inspection" data-hive="${i}" style="font-size:0.75rem; padding:6px 0;" title="Przegląd">📋 Przegląd</button>
          <button class="btn-card-action btn-add-feeding" data-hive="${i}" style="background: #d97706; color: white; font-size:0.75rem; padding:6px 0;" title="Karmienie">🍯 Pokarm</button>
          <button class="btn-card-action btn-add-treatment" data-hive="${i}" style="background: #dc2626; color: white; font-size:0.75rem; padding:6px 0;" title="Leczenie">💉 Lek</button>
          <button class="btn-card-action btn-add-izo" data-hive="${i}" style="background: #4f46e5; color: white; font-size:0.75rem; padding:6px 0;" title="IZO">🗃️ IZO</button>
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

  // --- RENDERY HISTORII (Arkusz Oraz Lokalne) ---
  function renderTable(data, tbody, mapper, noDataSpan) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.length) return tbody.innerHTML = `<tr><td colspan="${noDataSpan}" style="text-align:center;">Brak wpisów.</td></tr>`;
    const frag = document.createDocumentFragment();
    data.forEach(item => { const tr = document.createElement('tr'); tr.innerHTML = mapper(item); frag.appendChild(tr); });
    tbody.appendChild(frag);
  }

  function renderSheetTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? inspections : inspections.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.sheetTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><span class="badge-count" style="font-size:0.75rem;">${escapeHtml(i.rodzina || 'Silna')}</span></td>
      <td>${i.matka === 'TAK' ? '👑 TAK' : '❌ NIE'}</td>
      <td>${i.jaja === 'TAK' ? '🥚 TAK' : '❌ NIE'}</td>
      <td>${i.ramkiCzerwiu === 'NIE WIEM' ? 'NIE WIEM' : i.ramkiCzerwiu + 'r'}</td>
      <td>${i.pokarm === 'OK' ? '🍯 OK' : '⚠️ BRAK'}</td>
      <td><strong>${i.polkorpus || 0} nadst.</strong></td>
      <td>${escapeHtml(i.dzialania)}</td>
      <td><em style="color:#b45309;">${escapeHtml(i.przyszleDzialania)}</em></td>
      <td>
        <button class="btn-edit-row btn-edit-inspection" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-inspection" data-id="${i.id}">🗑️</button>
      </td>
    `, 11);
  }

  function renderFeedingsTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? feedings : feedings.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.mainFeedTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong style="color:#b45309;">${i.kgCukru} kg</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td>
        <button class="btn-edit-row btn-edit-feeding" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-feeding" data-id="${i.id}">🗑️</button>
      </td>
    `, 5);
  }

  function renderTreatmentsTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? treatments : treatments.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.mainTreatTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong style="color:#991b1b;">${escapeHtml(i.preparat)}</strong></td>
      <td>${escapeHtml(i.uwagi)}</td>
      <td>
        <button class="btn-edit-row btn-edit-treatment" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-treatment" data-id="${i.id}">🗑️</button>
      </td>
    `, 5);
  }

  function renderIzosTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? izos : izos.filter(i => i.hiveNum === parseInt(filter));
    if(!DOM.mainIzoTbody) return;
    renderTable(list, DOM.mainIzoTbody, i => `
      <td><strong>${formatPL(i.timestamp)}</strong></td>
      <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
      <td><strong style="color:#3730a3;">${escapeHtml(i.izoType)}</strong></td>
      <td>Po ramce: ${i.ramka}</td>
      <td>
        <button class="btn-edit-row btn-edit-izo" data-id="${i.id}">✏️</button>
        <button class="btn-delete-row btn-delete-izo" data-id="${i.id}">🗑️</button>
      </td>
    `, 5);
  }

  function renderLocalHistory(type, hId) {
    const container = qsid(`local-${type}-history`);
    if(!container) return;
    const source = type==='inspection'?inspections : type==='feeding'?feedings : type==='treatment'?treatments : izos;
    const list = source.filter(x => String(x.hiveNum) === String(hId)).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
    
    if(!list.length) { container.innerHTML = 'Brak wpisów...'; return; }
    
    container.innerHTML = list.map(item => {
      let desc = '';
      if(type==='inspection') desc = `Czerw: ${item.ramkiCzerwiu}, Plan: ${escapeHtml(item.przyszleDzialania)}`;
      if(type==='feeding') desc = `${item.kgCukru} kg (${escapeHtml(item.uwagi)})`;
      if(type==='treatment') desc = `${escapeHtml(item.preparat)} (${escapeHtml(item.uwagi)})`;
      if(type==='izo') desc = `${item.izoType}, ramka: ${item.ramka}`;
      
      return `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e5e7eb; padding:8px 0;">
        <div style="flex:1;"><b>${formatPL(item.timestamp)}</b><br><small>${desc}</small></div>
        <div>
          <button class="btn-small btn-edit-${type}" data-id="${item.id}">✏️</button>
          <button class="btn-small btn-delete-${type}" data-id="${item.id}" style="background:red;color:white;">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderTodos() {
    const ul = qsid('todo-list');
    if(!ul) return;
    
    // Filtr: bierzemy pod uwagę tylko ule, w których pole "Przyszłe działania" jest zapisane i nie brzmi "Brak planów" ani "Brak".
    const todos = inspections.filter(i => {
      if(!i.przyszleDzialania || i.przyszleDzialania.trim() === '') return false;
      const lower = i.przyszleDzialania.trim().toLowerCase();
      return lower !== 'brak planów' && lower !== 'brak';
    }).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if(todos.length === 0) { ul.innerHTML = '<li>Brak zaplanowanych zadań (lub we wszystkich ulach "Brak planów").</li>'; return; }
    
    ul.innerHTML = todos.map(t => `<li style="padding: 10px; border-bottom: 1px solid #e5e7eb; display:flex; gap:10px; align-items:center;">
      <div style="flex:1;">
        <b>Ul ${t.hiveNum}</b> <small>(${formatPL(t.timestamp)})</small><br/>
        <span style="color:#065f46; font-weight:500;">${escapeHtml(t.przyszleDzialania)}</span>
      </div>
      <button class="btn-small btn-edit-inspection" data-id="${t.id}">✏️</button>
    </li>`).join('');
  }

  function deleteRecord(type, id) {
    deleteFromGoogleSheets(type, id);
    if (type === 'inspections') { inspections = inspections.filter(x => x.id !== id); Store.set(KEYS.INSPECTIONS, inspections); }
    if (type === 'feedings') { feedings = feedings.filter(x => x.id !== id); Store.set(KEYS.FEEDINGS, feedings); }
    if (type === 'treatments') { treatments = treatments.filter(x => x.id !== id); Store.set(KEYS.TREATMENTS, treatments); }
    if (type === 'izos') { izos = izos.filter(x => x.id !== id); Store.set(KEYS.IZOS, izos); }
    
    renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); renderIzosTable();
    renderHivesGrid();
    
    // Odśwież lokalne formularze
    ['inspection','feeding','treatment','izo'].forEach(t => {
      const el = qsid(`select-${t==='inspection'?'':t+'-'}hive`);
      if(el && el.value) renderLocalHistory(t, el.value);
    });
  }

  function openInspectionForHive(hId) {
    DOM.selHive.value = hId;
    qsid('form-hive-title').textContent = `Przegląd: Ul № ${hId}`;
    DOM.dateInsp.value = getDatetimeLocal();
    editingInspectionId = null;
    qsid('btn-submit-inspection').innerHTML = '💾 ZAPISZ PRZEGLĄD';
    renderLocalHistory('inspection', hId);
    switchTab('tab-inspection');
  }

  function openFeedingForHive(hId) {
    DOM.selFeedHive.value = hId;
    qsid('form-feeding-title').textContent = `🍯 Karmienie: Ul № ${hId}`;
    DOM.dateFeed.value = getDatetimeLocal();
    editingFeedingId = null;
    qsid('btn-submit-feeding').innerHTML = '💾 Zapisz Karmienie';
    renderLocalHistory('feeding', hId);
    switchTab('tab-feeding');
  }

  function openTreatmentForHive(hId) {
    DOM.selTreatHive.value = hId;
    qsid('form-treatment-title').textContent = `💉 Leczenie: Ul № ${hId}`;
    DOM.dateTreat.value = getDatetimeLocal();
    editingTreatmentId = null;
    qsid('btn-submit-treatment').innerHTML = '💾 Zapisz Leczenie';
    renderLocalHistory('treatment', hId);
    switchTab('tab-treatment');
  }

  function openIzoForHive(hId) {
    DOM.selIzoHive.value = hId;
    qsid('form-izo-title').textContent = `🗃️ IZO: Ul № ${hId}`;
    DOM.dateIzo.value = getDatetimeLocal();
    editingIzoId = null;
    qsid('btn-submit-izo').innerHTML = '💾 Zapisz IZO';
    renderLocalHistory('izo', hId);
    switchTab('tab-izo');
  }

  function openInspectionForEdit(id) {
    const item = inspections.find(i => i.id === id);
    if (!item) return;
    openInspectionForHive(item.hiveNum);
    editingInspectionId = id;
    qsid('btn-submit-inspection').innerHTML = '💾 ZAKTUALIZUJ PRZEGLĄD';
    DOM.dateInsp.value = getDatetimeLocal(new Date(item.timestamp));
    
    qs(`input[name="matka"][value="${item.matka}"]`).checked = true;
    qs(`input[name="jaja"][value="${item.jaja}"]`).checked = true;
    qs(`input[name="pokarm"][value="${item.pokarm}"]`).checked = true;
    qs(`input[name="rodzina"][value="${item.rodzina}"]`).checked = true;
    qs(`input[name="polkorpus"][value="${item.polkorpus}"]`).checked = true;
    
    if(item.ramkiCzerwiu === 'NIE WIEM') { DOM.cbRamkiNw.checked = true; DOM.ramki.disabled = true; }
    else { DOM.cbRamkiNw.checked = false; DOM.ramki.disabled = false; DOM.ramki.value = item.ramkiCzerwiu; }
    
    DOM.dzialania.value = item.dzialania || '';
    DOM.przyszle.value = item.przyszleDzialania || '';
  }

  function openFeedingForEdit(id) {
    const item = feedings.find(i => i.id === id);
    if (!item) return;
    openFeedingForHive(item.hiveNum);
    editingFeedingId = id;
    qsid('btn-submit-feeding').innerHTML = '💾 ZAKTUALIZUJ KARMIENIE';
    DOM.dateFeed.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.kgFeed.value = item.kgCukru || 3;
    DOM.notesFeed.value = item.uwagi || '';
  }

  function openTreatmentForEdit(id) {
    const item = treatments.find(t => t.id === id);
    if (!item) return;
    openTreatmentForHive(item.hiveNum);
    editingTreatmentId = id;
    qsid('btn-submit-treatment').innerHTML = '💾 ZAKTUALIZUJ LECZENIE';
    DOM.dateTreat.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.prepTreat.value = item.preparat || '';
    DOM.notesTreat.value = item.uwagi || '';
  }

  function openIzoForEdit(id) {
    const item = izos.find(t => t.id === id);
    if (!item) return;
    openIzoForHive(item.hiveNum);
    editingIzoId = id;
    qsid('btn-submit-izo').innerHTML = '💾 ZAKTUALIZUJ IZO';
    DOM.dateIzo.value = getDatetimeLocal(new Date(item.timestamp));
    qs(`input[name="izoType"][value="${item.izoType}"]`).checked = true;
    DOM.izoRamka.value = item.ramka || 0;
  }

  function switchTab(tabId) {
    activeTab = tabId;
    DOM.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    DOM.contents.forEach(c => c.classList.toggle('active', c.id === tabId));
    if (tabId === 'tab-sheet') { renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); renderIzosTable(); }
    if (tabId === 'tab-todo') { renderTodos(); }
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

  function sendToGoogleSheets(record, type = 'inspection', isEdit = false) {
    const url = getWebhookUrl();
    if (!url) return;
    
    const reqBody = isEdit 
        ? { action: 'update', type: type, data: { ...record, timestamp: formatPL(record.timestamp) } } 
        : { type: type, ...record, timestamp: formatPL(record.timestamp) };
        
    const payloadStr = JSON.stringify(reqBody);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' }));
    } else {
      fetch(url, { method: 'POST', mode: 'no-cors', body: payloadStr }).catch(console.error);
    }
  }

  function deleteFromGoogleSheets(type, id) {
    const url = getWebhookUrl();
    if (!url) return;
    const payloadStr = JSON.stringify({ action: 'delete', type: type, id: id });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' }));
    } else {
      fetch(url, { method: 'POST', mode: 'no-cors', body: payloadStr }).catch(console.error);
    }
  }

  function fetchFromGoogleSheets() {
    const url = getWebhookUrl();
    if (!url) return Promise.reject();
    return fetch(url).then(r => r.json()).then(res => {
      let count = 0;
      const isValid = (row) => row && row.id && String(row.id).trim() !== '' && row.hiveNum && parseInt(row.hiveNum) > 0;

      if (res && typeof res === 'object') {
        if (Array.isArray(res.inspections)) {
          res.inspections.filter(isValid).forEach(rm => { if (!inspections.some(lc => lc.id === rm.id)) { inspections.push(rm); count++; } });
          Store.set(KEYS.INSPECTIONS, inspections);
        }
        if (Array.isArray(res.feedings)) {
          res.feedings.filter(isValid).forEach(rm => { if (!feedings.some(lc => lc.id === rm.id)) { feedings.push(rm); count++; } });
          Store.set(KEYS.FEEDINGS, feedings);
        }
        if (Array.isArray(res.treatments)) {
          res.treatments.filter(isValid).forEach(rm => { if (!treatments.some(lc => lc.id === rm.id)) { treatments.push(rm); count++; } });
          Store.set(KEYS.TREATMENTS, treatments);
        }
        if (Array.isArray(res.izos)) {
          res.izos.filter(isValid).forEach(rm => { if (!izos.some(lc => lc.id === rm.id)) { izos.push(rm); count++; } });
          Store.set(KEYS.IZOS, izos);
        }
        renderHivesGrid(); renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); renderIzosTable();
      }
      return count;
    });
  }

  function openHiveHistoryModal(hiveNum) {
    const nameOfHive = getHiveName(hiveNum);
    const hiveInsp = inspections.filter(item => item.hiveNum === hiveNum);
    const hiveFeed = feedings.filter(item => item.hiveNum === hiveNum);
    const hiveTreat = treatments.filter(item => item.hiveNum === hiveNum);
    const hiveIzo = izos.filter(item => item.hiveNum === hiveNum);
    
    let totalKg = hiveFeed.reduce((sum, f) => sum + (parseFloat(f.kgCukru) || 0), 0);
    qsid('modal-hive-title').textContent = `📜 Historia Ula: ${nameOfHive} (Syrop: ${totalKg.toFixed(1)} kg)`;

    let html = `<h4 style="color:#b45309; border-bottom:2px solid #fef3c7; padding-bottom:4px;">📋 Przeglądy (${hiveInsp.length})</h4>`;
    if (!hiveInsp.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else {
      hiveInsp.forEach(item => {
        html += `<div style="background:var(--bg-color); border:1px solid var(--border-color); padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — ${escapeHtml(item.dzialania)}</div>
        </div>`;
      });
    }

    html += `<h4 style="color:#d97706; border-bottom:2px solid #fef3c7; padding-bottom:4px; margin-top:12px;">🍯 Karmienie (${hiveFeed.length})</h4>`;
    if (!hiveFeed.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else {
      hiveFeed.forEach(item => {
        html += `<div style="background:#fffbf0; border:1px solid #fde68a; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#b45309;">${item.kgCukru} kg</strong> (${escapeHtml(item.uwagi)})</div>
        </div>`;
      });
    }

    html += `<h4 style="color:#991b1b; border-bottom:2px solid #fee2e2; padding-bottom:4px; margin-top:12px;">💉 Leczenie (${hiveTreat.length})</h4>`;
    if (!hiveTreat.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else {
      hiveTreat.forEach(item => {
        html += `<div style="background:#fef2f2; border:1px solid #fca5a5; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#991b1b;">${escapeHtml(item.preparat)}</strong> (${escapeHtml(item.uwagi)})</div>
        </div>`;
      });
    }

    html += `<h4 style="color:#3730a3; border-bottom:2px solid #e0e7ff; padding-bottom:4px; margin-top:12px;">🗃️ IZO (${hiveIzo.length})</h4>`;
    if (!hiveIzo.length) html += `<p style="color:#6b7280; font-size:0.9rem;">Brak wpisów.</p>`;
    else {
      hiveIzo.forEach(item => {
        html += `<div style="background:#eef2ff; border:1px solid #c7d2fe; padding:8px; border-radius:6px; margin-bottom:6px; font-size:0.85rem;">
          <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <strong style="color:#3730a3;">${escapeHtml(item.izoType)}</strong> (ramka: ${item.ramka})</div>
        </div>`;
      });
    }

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
      const transcript = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
      DOM.voiceText.textContent = `Słyszano: "${transcript}"`;
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
      if (isVoiceActive) { stopVoiceMaster(); }
      else { isVoiceActive = true; try { recognition.start(); } catch{} }
    });
  }
});
