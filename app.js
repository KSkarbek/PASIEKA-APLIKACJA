/**
 * ZOPTYMALIZOWANA LOGIKA APLIKACJI ASYSTENT PASIEKA WLKP - 18 ULI (APLIK PASIEKA)
 * Kompletny moduł z obsługą kart: Przeglądy, Karmienie, Leczenie, natywną wysyłką mobilną (sendBeacon),
 * stałą synchronizacją oraz usuwaniem rekordów bezpośrednio z Google Sheets.
 */

document.addEventListener('DOMContentLoaded', () => {
  const TOTAL_HIVES = 18;
  
  // STAŁA WARTOŚĆ DOMYŚLNA WEBHOOKA (Zabezpieczenie przed czyszczeniem localStorage)
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

  // Bezpieczne pobieranie URL Webhooka
  function getWebhookUrl() {
    return localStorage.getItem(KEYS.WEBHOOK) || DEFAULT_WEBHOOK;
  }

  // === INTERFEJS I/O (STORAGE) ===
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
  let isVoiceActive = false;
  let recognition = null;
  let isDictatingField = false; 
  let editingInspectionId = null;
  let editingFeedingId = null;
  let editingTreatmentId = null;

  // === POMOCNICZE PURE FUNCTIONS ===
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

  // === SELEKTORY DOM ===
  const qs = s => document.querySelector(s);
  const qsa = s => document.querySelectorAll(s);
  const qsid = id => document.getElementById(id);

  const DOM = {
    btnTheme: qsid('btn-theme-toggle'), btnVoice: qsid('btn-voice-master'),
    voiceStatus: qsid('voice-status-bar'), voiceText: qsid('voice-status-text'),
    btnStopVoice: qsid('btn-stop-voice'), tabs: qsa('.tab-btn'), contents: qsa('.tab-content'),
    grids: { dom: qsid('hives-grid-dom'), zbior: qsid('hives-grid-zbior'), las: qsid('hives-grid-las') },
    
    // Formularz Przeglądu
    inspForm: qsid('inspection-form'), selHive: qsid('select-hive'), dateInsp: qsid('input-date'),
    ramki: qsid('ramki-czerwiu'), cbRamkiNw: qsid('cb-ramki-niewiem'), ramkiWrap: qsid('ramki-stepper-wrap'),
    dzialania: qsid('input-dzialania'), przyszle: qsid('input-przyszle-dzialania'),
    
    // Formularz Karmienia
    feedForm: qsid('feeding-form'), selFeedHive: qsid('select-feeding-hive'), dateFeed: qsid('input-feeding-date'),
    kgFeed: qsid('input-feeding-kg'), notesFeed: qsid('input-feeding-notes'),
    
    // Formularz Leczenia
    treatForm: qsid('treatment-form'), selTreatHive: qsid('select-treatment-hive'), dateTreat: qsid('input-treatment-date'),
    prepTreat: qsid('input-treatment-preparat'), notesTreat: qsid('input-treatment-notes'),

    // Modal, Tabele, Filtry
    modal: qsid('hive-history-modal'), modalContent: qsid('modal-history-content'),
    sheetTbody: qsid('sheet-tbody'), feedTbody: qsid('tab-feeding-tbody'), mainFeedTbody: qsid('feedings-tbody'),
    treatTbody: qsid('tab-treatment-tbody'), mainTreatTbody: qsid('treatments-tbody'),
    filterHive: qsid('filter-hive-select'), filterFeed: qsid('filter-tab-feeding-select'),
    
    // Webhook i Synchronizacja
    webhook: qsid('input-gsheet-webhook'),
    btnSaveWebhook: qsid('btn-save-webhook'),
    btnShowGsheetScript: qsid('btn-show-gsheet-script'),
    gsheetScriptDetails: qsid('gsheet-script-details'),
    btnSyncNow: qsid('btn-sync-now'),
    
    // Wrappery Tabel
    wrapInsp: qsid('wrapper-inspections-table'), wrapFeed: qsid('wrapper-feedings-table'), wrapTreat: qsid('wrapper-treatments-table'),
    btnVInsp: qsid('btn-view-inspections'), btnVFeed: qsid('btn-view-feedings'), btnVTreat: qsid('btn-view-treatments')
  };

  // === INICJALIZACJA ===
  initTheme();
  if (DOM.dateInsp) DOM.dateInsp.value = getDatetimeLocal();
  if (DOM.dateFeed) DOM.dateFeed.value = getDatetimeLocal();
  if (DOM.dateTreat) DOM.dateTreat.value = getDatetimeLocal();
  
  renderHivesGrid();
  renderSheetTable();
  initVoiceRecognition();

  if (DOM.webhook) {
    DOM.webhook.value = getWebhookUrl();
  }

  // Zwijanie instrukcji Google Sheets
  if (DOM.btnShowGsheetScript && DOM.gsheetScriptDetails) {
    DOM.btnShowGsheetScript.addEventListener('click', (e) => {
      e.preventDefault();
      DOM.gsheetScriptDetails.classList.toggle('hidden');
    });
  }

  // Zapis linku Webhooka
  if (DOM.btnSaveWebhook && DOM.webhook) {
    DOM.btnSaveWebhook.addEventListener('click', (e) => {
      e.preventDefault();
      const url = DOM.webhook.value.trim();

      if (url.startsWith('https://script.google.com/macros/s/')) {
        localStorage.setItem(KEYS.WEBHOOK, url);
        alert('✅ Zapisano link webhooka Google Sheets!');
        speakText('Zapisano połączenie z Google Sheets.');
        fetchFromGoogleSheets().catch(() => {});
      } else if (url === '') {
        localStorage.removeItem(KEYS.WEBHOOK);
        DOM.webhook.value = DEFAULT_WEBHOOK;
        alert('🔄 Przywrócono domyślny link synchronizacji.');
      } else {
        alert('⚠️ Niepoprawny format! Link musi rozpoczynać się od: https://script.google.com/macros/s/');
      }
    });
  }

  // Przycisk ręcznej synchronizacji
  if (DOM.btnSyncNow) {
    DOM.btnSyncNow.addEventListener('click', () => {
      const url = getWebhookUrl();
      if (!url) {
        alert('Brak skonfigurowanego adresu URL.');
        return;
      }

      DOM.btnSyncNow.disabled = true;
      DOM.btnSyncNow.textContent = '⏳ Synchronizacja...';

      // Wysyłka niezsynchronizowanych wpisów
      inspections.filter(r => !r._synced).forEach(rec => sendToGoogleSheets(rec, 'inspection'));
      feedings.filter(r => !r._synced).forEach(rec => sendToGoogleSheets(rec, 'feeding'));
      treatments.filter(r => !r._synced).forEach(rec => sendToGoogleSheets(rec, 'treatment'));

      fetchFromGoogleSheets()
        .then(addedCount => {
          alert(`Synchronizacja dwukierunkowa zakończona sukcesem!\n• Pobrano nowych wpisów z arkusza: ${addedCount}`);
          speakText('Pomyślnie zsynchronizowano dane z Google Sheets.');
        })
        .catch(err => {
          console.error(err);
          alert('Wystąpił błąd podczas pobierania danych z Google Sheets.');
        })
        .finally(() => {
          DOM.btnSyncNow.disabled = false;
          DOM.btnSyncNow.textContent = '🔄 Synchronizuj z Google Sheets';
        });
    });
  }

  setTimeout(() => fetchFromGoogleSheets().catch(() => {}), 1500);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);

  // === EVENT LISTENERS ===
  DOM.tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  if (DOM.cbRamkiNw) {
    DOM.cbRamkiNw.addEventListener('change', e => {
      const s = e.target.checked;
      DOM.ramki.disabled = qsid('btn-ramki-minus').disabled = qsid('btn-ramki-plus').disabled = s;
      DOM.ramkiWrap.style.opacity = s ? '0.4' : '1';
    });
  }

  document.addEventListener('click', e => {
    // Steppery
    if(e.target.id === 'btn-ramki-minus' && !DOM.cbRamkiNw.checked) DOM.ramki.value = Math.max(0, (parseInt(DOM.ramki.value)||0)-1);
    if(e.target.id === 'btn-ramki-plus' && !DOM.cbRamkiNw.checked) DOM.ramki.value = Math.min(30, (parseInt(DOM.ramki.value)||0)+1);
    if(e.target.id === 'btn-kg-minus') DOM.kgFeed.value = Math.max(0.5, (parseFloat(DOM.kgFeed.value)||0)-0.5).toFixed(1);
    if(e.target.id === 'btn-kg-plus') DOM.kgFeed.value = Math.min(50, (parseFloat(DOM.kgFeed.value)||0)+0.5).toFixed(1);

    // Akcje w Kafelkach Uli
    const cardBtn = e.target.closest('button[data-hive]');
    if (cardBtn) {
      const hId = parseInt(cardBtn.dataset.hive);
      if (cardBtn.classList.contains('btn-add-inspection')) openInspectionForHive(hId);
      if (cardBtn.classList.contains('btn-add-feeding')) openFeedingForHive(hId);
      if (cardBtn.classList.contains('btn-open-modal-history')) openHiveHistoryModal(hId);
      if (cardBtn.classList.contains('btn-speak-hive')) readHiveStatus(hId);
      if (cardBtn.classList.contains('btn-rename-hive')) promptRenameHive(hId);
      if (cardBtn.classList.contains('btn-edit-queen')) promptEditQueen(hId);
      return;
    }

    // Modal
    if (e.target === DOM.modal || e.target.id === 'btn-close-modal') DOM.modal.classList.add('hidden');
    
    // Tabele edycja/usuwanie
    const actionBtn = e.target.closest('button[data-id]');
    if (actionBtn) {
      const id = actionBtn.dataset.id;
      if (actionBtn.classList.contains('btn-delete-row') || actionBtn.classList.contains('btn-delete-inspection')) {
        if (confirm('Usunąć wpis przeglądu?')) deleteRecord('inspections', id);
      }
      if (actionBtn.classList.contains('btn-delete-tab-feeding') || actionBtn.classList.contains('btn-delete-feeding-row')) {
        if (confirm('Usunąć wpis karmienia?')) deleteRecord('feedings', id);
      }
      if (actionBtn.classList.contains('btn-delete-treatment-row')) {
        if (confirm('Usunąć wpis leczenia?')) deleteRecord('treatments', id);
      }
      if (actionBtn.classList.contains('btn-edit-inspection')) { DOM.modal.classList.add('hidden'); openInspectionForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-tab-feeding') || actionBtn.classList.contains('btn-edit-feeding-row')) { DOM.modal.classList.add('hidden'); openFeedingForEdit(id); }
      if (actionBtn.classList.contains('btn-edit-treatment-row')) { DOM.modal.classList.add('hidden'); openTreatmentForEdit(id); }
    }
  });

  // Selecty
  if (DOM.selHive) DOM.selHive.addEventListener('change', e => qsid('form-hive-title').textContent = `Przegląd: ${getHiveName(e.target.value)}`);
  if (DOM.selFeedHive) DOM.selFeedHive.addEventListener('change', e => qsid('form-feeding-title').textContent = `🍯 Karmienie: ${getHiveName(e.target.value)}`);
  if (DOM.selTreatHive) DOM.selTreatHive.addEventListener('change', e => qsid('form-treatment-title').textContent = `💉 Leczenie: ${getHiveName(e.target.value)}`);
  
  if (DOM.filterHive) DOM.filterHive.addEventListener('change', () => { renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); });
  if (DOM.filterFeed) DOM.filterFeed.addEventListener('change', renderTabFeedingTable);

  if (DOM.btnVInsp && DOM.btnVFeed && DOM.btnVTreat) {
    DOM.btnVInsp.addEventListener('click', () => toggleTableViews('insp'));
    DOM.btnVFeed.addEventListener('click', () => toggleTableViews('feed'));
    DOM.btnVTreat.addEventListener('click', () => toggleTableViews('treat'));
  }

  function toggleTableViews(view) {
    DOM.btnVInsp.classList.toggle('active', view === 'insp');
    DOM.btnVFeed.classList.toggle('active', view === 'feed');
    DOM.btnVTreat.classList.toggle('active', view === 'treat');

    if (DOM.wrapInsp) DOM.wrapInsp.classList.toggle('hidden', view !== 'insp');
    if (DOM.wrapFeed) DOM.wrapFeed.classList.toggle('hidden', view !== 'feed');
    if (DOM.wrapTreat) DOM.wrapTreat.classList.toggle('hidden', view !== 'treat');

    if (view === 'insp') renderSheetTable();
    if (view === 'feed') renderFeedingsTable();
    if (view === 'treat') renderTreatmentsTable();
  }

  // === SUBMIT FORMULARZY ===
  // 1. Przegląd
  if (DOM.inspForm) {
    DOM.inspForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selHive.value);
      
      const payload = {
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
        przyszleDzialania: DOM.przyszle.value.trim() || 'Brak planów',
        _synced: false
      };

      if (editingInspectionId) {
        const idx = inspections.findIndex(i => i.id === editingInspectionId);
        if (idx > -1) {
          inspections[idx] = { ...inspections[idx], ...payload, timestamp: DOM.dateInsp.value ? payload.timestamp : inspections[idx].timestamp };
          speakText(`Zaktualizowano: ${payload.hiveName}.`);
        }
        editingInspectionId = null;
      } else {
        payload.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        inspections.unshift(payload);
        speakText(`Zapisano przegląd: ${payload.hiveName}.`);
      }

      Store.set(KEYS.INSPECTIONS, inspections);
      sendToGoogleSheets(payload, 'inspection');
      
      DOM.inspForm.reset();
      if (DOM.cbRamkiNw) DOM.cbRamkiNw.dispatchEvent(new Event('change'));
      renderHivesGrid();
      renderSheetTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  // 2. Karmienie
  if (DOM.feedForm) {
    DOM.feedForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selFeedHive.value);
      
      const payload = {
        hiveNum: hId,
        hiveName: getHiveName(hId),
        timestamp: DOM.dateFeed.value ? new Date(DOM.dateFeed.value).toISOString() : new Date().toISOString(),
        kgCukru: parseFloat(DOM.kgFeed.value) || 0,
        uwagi: DOM.notesFeed.value.trim() || 'Syrop 3:2',
        _synced: false
      };

      if (editingFeedingId) {
        const idx = feedings.findIndex(f => f.id === editingFeedingId);
        if (idx > -1) feedings[idx] = { ...feedings[idx], ...payload, timestamp: DOM.dateFeed.value ? payload.timestamp : feedings[idx].timestamp };
        editingFeedingId = null;
      } else {
        payload.id = Date.now().toString(36) + "_f_" + Math.random().toString(36).substr(2);
        feedings.unshift(payload);
      }

      Store.set(KEYS.FEEDINGS, feedings);
      sendToGoogleSheets(payload, 'feeding');
      speakText(`Zapisano karmienie: ${payload.kgCukru} kg.`);
      
      DOM.notesFeed.value = '';
      renderHivesGrid();
      renderFeedingsTable();
      renderTabFeedingTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  // 3. Leczenie
  if (DOM.treatForm) {
    DOM.treatForm.addEventListener('submit', e => {
      e.preventDefault();
      const hId = parseInt(DOM.selTreatHive.value);

      const payload = {
        hiveNum: hId,
        hiveName: getHiveName(hId),
        timestamp: DOM.dateTreat.value ? new Date(DOM.dateTreat.value).toISOString() : new Date().toISOString(),
        preparat: DOM.prepTreat.value.trim(),
        uwagi: DOM.notesTreat.value.trim() || 'Brak uwag',
        _synced: false
      };

      if (editingTreatmentId) {
        const idx = treatments.findIndex(t => t.id === editingTreatmentId);
        if (idx > -1) treatments[idx] = { ...treatments[idx], ...payload, timestamp: DOM.dateTreat.value ? payload.timestamp : treatments[idx].timestamp };
        editingTreatmentId = null;
      } else {
        payload.id = Date.now().toString(36) + "_t_" + Math.random().toString(36).substr(2);
        treatments.unshift(payload);
      }

      Store.set(KEYS.TREATMENTS, treatments);
      sendToGoogleSheets(payload, 'treatment');
      speakText(`Zapisano leczenie dla ula ${payload.hiveName}`);

      DOM.prepTreat.value = '';
      DOM.notesTreat.value = '';
      renderHivesGrid();
      renderTreatmentsTable();
      renderTabTreatmentTable();
      switchTab(`tab-${getHiveCategory(hId)}`);
    });
  }

  // === RENDERING ===
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
        <div class="hive-card-footer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px;">
          <button class="btn-card-action primary btn-add-inspection" data-hive="${i}">📝 Przegląd</button>
          <button class="btn-card-action btn-add-feeding" data-hive="${i}" style="background: #d97706; color: white;">🍯 Karmienie</button>
          <button class="btn-card-action btn-open-modal-history" data-hive="${i}" style="background: #4b5563; color: white;">📜 Historia (${inspList.length})</button>
          <button class="btn-card-action btn-speak-hive" data-hive="${i}">🔊 Czytaj</button>
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
      <td>${i.matka === 'TAK' ? '👑 TAK' : '❌ NIE'}</td>
      <td>${escapeHtml(i.matkaInfo)}</td>
      <td>${i.jaja === 'TAK' ? '🥚 TAK' : '❌ NIE'}</td>
      <td>${i.ramkiCzerwiu === 'NIE WIEM' ? 'NIE WIEM' : i.ramkiCzerwiu + 'r'}</td>
      <td>${i.pokarm === 'OK' ? '🍯 OK' : '⚠️ BRAK'}</td>
      <td><strong>${i.polkorpus || 0} nadst.</strong></td>
      <td>${escapeHtml(i.dzialania)}</td>
      <td><em style="color:#b45309;">${escapeHtml(i.przyszleDzialania)}</em></td>
      <td><button class="btn-delete-row" data-id="${i.id}">🗑️</button></td>
    `, 13);
  }

  function renderFeedingsTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? feedings : feedings.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.mainFeedTbody, i => feedRowHtml(i, 'btn-edit-feeding-row', 'btn-delete-feeding-row'), 6);
  }

  function renderTabFeedingTable() {
    const filter = DOM.filterFeed ? DOM.filterFeed.value : 'ALL';
    const list = filter === 'ALL' ? feedings : feedings.filter(i => i.hiveNum === parseInt(filter));
    
    if (qsid('feeding-summary-text')) {
      const sum = list.reduce((acc, curr) => acc + (parseFloat(curr.kgCukru) || 0), 0);
      qsid('feeding-summary-text').textContent = `${filter === 'ALL' ? 'Wszystkie ule' : 'Ul № '+filter} — Łącznie podano: ${sum.toFixed(1)} kg (${list.length} karmień)`;
    }
    renderTable(list, DOM.feedTbody, i => feedRowHtml(i, 'btn-edit-tab-feeding', 'btn-delete-tab-feeding'), 6);
  }

  function renderTreatmentsTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? treatments : treatments.filter(i => i.hiveNum === parseInt(filter));
    renderTable(list, DOM.mainTreatTbody, i => treatRowHtml(i, 'btn-edit-treatment-row', 'btn-delete-treatment-row'), 6);
  }

  function renderTabTreatmentTable() {
    renderTable(treatments, DOM.treatTbody, i => treatRowHtml(i, 'btn-edit-treatment-row', 'btn-delete-treatment-row'), 6);
  }

  const feedRowHtml = (i, editCls, delCls) => `
    <td><strong>${formatPL(i.timestamp)}</strong></td>
    <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
    <td><strong>${escapeHtml(i.hiveName)}</strong></td>
    <td><strong style="color:#b45309;">${i.kgCukru} kg</strong></td>
    <td>${escapeHtml(i.uwagi)}</td>
    <td>
      <button class="btn-edit-row ${editCls}" data-id="${i.id}">✏️</button>
      <button class="btn-delete-row ${delCls}" data-id="${i.id}">🗑️</button>
    </td>
  `;

  const treatRowHtml = (i, editCls, delCls) => `
    <td><strong>${formatPL(i.timestamp)}</strong></td>
    <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
    <td><strong>${escapeHtml(i.hiveName)}</strong></td>
    <td><strong style="color:#991b1b;">${escapeHtml(i.preparat)}</strong></td>
    <td>${escapeHtml(i.uwagi)}</td>
    <td>
      <button class="btn-edit-row ${editCls}" data-id="${i.id}">✏️</button>
      <button class="btn-delete-row ${delCls}" data-id="${i.id}">🗑️</button>
    </td>
  `;

  // === OBSŁUGA USUWANIA Z GOOGLE SHEETS I LOKALNEJ PAMIĘCI ===
  function deleteFromGoogleSheets(type, id) {
    const url = getWebhookUrl();
    if (!url) return;

    const payloadStr = JSON.stringify({
      action: 'delete',
      type: type,
      id: id
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        cache: 'no-cache',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: payloadStr
      }).catch(console.error);
    }
  }

  function deleteRecord(type, id) {
    deleteFromGoogleSheets(type, id);

    if (type === 'inspections') { 
      inspections = inspections.filter(x => x.id !== id); 
      Store.set(KEYS.INSPECTIONS, inspections); 
      renderSheetTable(); 
    }
    if (type === 'feedings') { 
      feedings = feedings.filter(x => x.id !== id); 
      Store.set(KEYS.FEEDINGS, feedings); 
      renderTabFeedingTable(); 
      renderFeedingsTable(); 
    }
    if (type === 'treatments') { 
      treatments = treatments.filter(x => x.id !== id); 
      Store.set(KEYS.TREATMENTS, treatments); 
      renderTabTreatmentTable(); 
      renderTreatmentsTable(); 
    }
    renderHivesGrid();
  }

  function openInspectionForHive(hId) {
    DOM.selHive.value = hId;
    qsid('form-hive-title').textContent = `Przegląd: ${getHiveName(hId)}`;
    DOM.dateInsp.value = getDatetimeLocal();
    
    const last = inspections.find(i => i.hiveNum === hId);
    if (last) {
      qsid(last.matka === 'TAK' ? 'matka-tak' : 'matka-nie').checked = true;
      qsid(last.jaja === 'TAK' ? 'jaja-tak' : 'jaja-nie').checked = true;
      if (last.ramkiCzerwiu === 'NIE WIEM') {
        DOM.cbRamkiNw.checked = true;
      } else {
        DOM.cbRamkiNw.checked = false;
        DOM.ramki.value = last.ramkiCzerwiu ?? 4;
      }
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
    switchTab('tab-feeding');
  }

  function openFeedingForEdit(id) {
    const item = feedings.find(i => i.id === id);
    if (!item) return;
    editingFeedingId = id;
    DOM.selFeedHive.value = item.hiveNum;
    DOM.dateFeed.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.kgFeed.value = item.kgCukru || 3;
    DOM.notesFeed.value = item.uwagi || '';
    qsid('form-feeding-title').textContent = `✏️ Edycja Karmienia (Data: ${new Date(item.timestamp).toLocaleDateString('pl-PL')})`;
    switchTab('tab-feeding');
  }

  function openTreatmentForEdit(id) {
    const item = treatments.find(t => t.id === id);
    if (!item) return;
    editingTreatmentId = id;
    DOM.selTreatHive.value = item.hiveNum;
    DOM.dateTreat.value = getDatetimeLocal(new Date(item.timestamp));
    DOM.prepTreat.value = item.preparat || '';
    DOM.notesTreat.value = item.uwagi || '';
    qsid('form-treatment-title').textContent = `✏️ Edycja Leczenia (Data: ${new Date(item.timestamp).toLocaleDateString('pl-PL')})`;
    switchTab('tab-treatment');
  }

  function switchTab(tabId) {
    activeTab = tabId;
    DOM.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    DOM.contents.forEach(c => c.classList.toggle('active', c.id === tabId));
    if (tabId === 'tab-sheet') renderSheetTable();
    if (tabId === 'tab-feeding') renderTabFeedingTable();
    if (tabId === 'tab-treatment') renderTabTreatmentTable();
    if (['tab-dom', 'tab-zbior', 'tab-las'].includes(tabId)) renderHivesGrid();
  }

  function updateHiveSelects() {
    const opts = Array.from({length: TOTAL_HIVES}, (_, i) => `<option value="${i+1}">${getHiveName(i+1)} (Ul № ${i+1})</option>`).join('');
    if (DOM.selHive) DOM.selHive.innerHTML = opts;
    if (DOM.selFeedHive) DOM.selFeedHive.innerHTML = opts;
    if (DOM.selTreatHive) DOM.selTreatHive.innerHTML = opts;
    if (DOM.filterHive) DOM.filterHive.innerHTML = '<option value="ALL">Wszystkie Ule (1-18)</option>' + opts;
    if (DOM.filterFeed) DOM.filterFeed.innerHTML = '<option value="ALL">Wszystkie Ule (1-18)</option>' + opts;
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
    const n = prompt(`Wpisz opis/oznaczenie matki dla Ula № ${id}:`, hiveQueens[id] || '');
    if (n !== null) { hiveQueens[id] = n.trim(); Store.set(KEYS.QUEENS, hiveQueens); renderHivesGrid(); renderSheetTable(); }
  }

  // === INTEGRACJA GOOGLE SHEETS ===
  function saveLocalRecordState(type) {
    if (type === 'inspection') Store.set(KEYS.INSPECTIONS, inspections);
    if (type === 'feeding') Store.set(KEYS.FEEDINGS, feedings);
    if (type === 'treatment') Store.set(KEYS.TREATMENTS, treatments);
  }

  function sendToGoogleSheets(record, type = 'inspection') {
    const url = getWebhookUrl();
    if (!url || record._synced) return;

    const payloadObj = {
      ...record,
      type: type,
      timestamp: formatPL(record.timestamp)
    };
    const payloadStr = JSON.stringify(payloadObj);

    if (navigator.sendBeacon) {
      const blob = new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' });
      const sent = navigator.sendBeacon(url, blob);
      if (sent) {
        record._synced = true;
        saveLocalRecordState(type);
        return;
      }
    }

    fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-cache',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: payloadStr
    })
    .then(() => {
      record._synced = true;
      saveLocalRecordState(type);
    })
    .catch(console.error);
  }

  function fetchFromGoogleSheets() {
    const url = getWebhookUrl();
    if (!url) return Promise.reject();
    return fetch(url).then(r => r.json()).then(remote => {
      let added = 0;
      if (Array.isArray(remote)) {
        remote.forEach(rm => {
          if (!inspections.some(lc => lc.hiveNum === rm.hiveNum && new Date(lc.timestamp).getTime() === new Date(rm.timestamp).getTime())) {
            inspections.push(rm); added++;
          }
        });
        if (added > 0) {
          inspections.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          Store.set(KEYS.INSPECTIONS, inspections); renderSheetTable(); renderHivesGrid();
        }
      }
      return added;
    });
  }

  // === SYNTEZA I ROZPOZNAWANIE MOWY ===
  function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'pl-PL';
    window.speechSynthesis.speak(u);
  }

  function readHiveStatus(hId) {
    const last = inspections.find(i => i.hiveNum === hId);
    if (!last) return speakText(`${getHiveName(hId)} nie posiada wpisów.`);
    const czerw = last.ramkiCzerwiu === 'NIE WIEM' ? 'ilość czerwiu nieznana' : `${last.ramkiCzerwiu} ramek`;
    speakText(`${getHiveName(hId)}. Rodzina ${last.rodzina||'silna'}. Matka ${last.matka==='TAK'?'jest':'brak'}. Jaja ${last.jaja==='TAK'?'obecne':'brak'}. ${czerw}. Pokarm ${last.pokarm==='OK'?'w normie':'brak'}. Wykonano: ${last.dzialania}.`);
  }

  function openHiveHistoryModal(hiveNum) {
    const nameOfHive = getHiveName(hiveNum);
    const hiveInspections = inspections.filter(item => item.hiveNum === hiveNum);
    const hiveFeedings = feedings.filter(item => item.hiveNum === hiveNum);
    const hiveTreatments = treatments.filter(item => item.hiveNum === hiveNum);
    
    let totalKg = hiveFeedings.reduce((sum, f) => sum + (parseFloat(f.kgCukru) || 0), 0);

    qsid('modal-hive-title').textContent = `📜 Historia Ula: ${nameOfHive} (Syrop: ${totalKg.toFixed(1)} kg)`;

    let html = `<h4 style="margin-bottom: 8px; color: #b45309; border-bottom: 2px solid #fef3c7; padding-bottom: 4px;">📋 Historia Przeglądów (${hiveInspections.length})</h4>`;
    if (hiveInspections.length === 0) {
      html += `<p style="color: #6b7280; font-size: 0.9rem;">Brak przeglądów.</p>`;
    } else {
      html += `<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">`;
      hiveInspections.forEach(item => {
        html += `
          <div style="background: var(--bg-color); border: 1px solid var(--border-color); padding: 10px 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="font-size: 0.85rem; line-height: 1.5;">
              <div><strong>📅 ${formatPL(item.timestamp)}</strong> | <span class="badge-count" style="font-size:0.75rem;">${escapeHtml(item.rodzina)}</span></div>
              <div style="margin-top: 4px;">
                <strong>Matka:</strong> ${item.matka === 'TAK' ? '👑 TAK' : '❌ NIE'} | 
                <strong>Jaja:</strong> ${item.jaja === 'TAK' ? '🥚 TAK' : '❌ NIE'} | 
                <strong>Czerw:</strong> ${item.ramkiCzerwiu === 'NIE WIEM' ? 'NIE WIEM 🤷' : `${item.ramkiCzerwiu} ramek`} | 
                <strong>Pokarm:</strong> ${item.pokarm === 'OK' ? '🍯 OK' : '⚠️ BRAK'}
              </div>
              <div style="margin-top: 4px;"><strong>Wykonano:</strong> ${escapeHtml(item.dzialania)}</div>
            </div>
            <button class="btn-small btn-edit-inspection" data-id="${item.id}">✏️</button>
          </div>
        `;
      });
      html += `</div>`;
    }

    html += `<h4 style="margin-bottom: 8px; color: #d97706; border-bottom: 2px solid #fef3c7; padding-bottom: 4px;">🍯 Historia Karmienia (${hiveFeedings.length})</h4>`;
    if (hiveFeedings.length === 0) {
      html += `<p style="color: #6b7280; font-size: 0.9rem;">Brak karmień.</p>`;
    } else {
      html += `<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">`;
      hiveFeedings.forEach(item => {
        html += `
          <div style="background: #fffbf0; border: 1px solid #fde68a; padding: 10px 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 0.85rem;">
              <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <span style="font-weight: 700; color: #b45309;">${item.kgCukru} kg</span></div>
              <div style="color: #92400e;"><strong>Uwagi:</strong> ${escapeHtml(item.uwagi)}</div>
            </div>
            <button class="btn-small btn-edit-tab-feeding" data-id="${item.id}">✏️</button>
          </div>
        `;
      });
      html += `</div>`;
    }

    html += `<h4 style="margin-bottom: 8px; color: #991b1b; border-bottom: 2px solid #fee2e2; padding-bottom: 4px;">💉 Historia Leczenia (${hiveTreatments.length})</h4>`;
    if (hiveTreatments.length === 0) {
      html += `<p style="color: #6b7280; font-size: 0.9rem;">Brak leczeń.</p>`;
    } else {
      html += `<div style="display: flex; flex-direction: column; gap: 8px;">`;
      hiveTreatments.forEach(item => {
        html += `
          <div style="background: #fef2f2; border: 1px solid #fca5a5; padding: 10px 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 0.85rem;">
              <div><strong>📅 ${formatPL(item.timestamp)}</strong> — <span style="font-weight: 700; color: #991b1b;">${escapeHtml(item.preparat)}</span></div>
              <div style="color: #7f1d1d;"><strong>Uwagi:</strong> ${escapeHtml(item.uwagi)}</div>
            </div>
            <button class="btn-small btn-edit-treatment-row" data-id="${item.id}">✏️</button>
          </div>
        `;
      });
      html += `</div>`;
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
      if (isDictatingField) {
        const target = isDictatingField === 'przyszle' ? DOM.przyszle : (isDictatingField === 'feeding' ? DOM.notesFeed : DOM.dzialania);
        if (target) target.value += (target.value ? ' ' : '') + transcript;
        speakText('Dopisano.'); isDictatingField = false;
      } else parseVoiceCommand(transcript);
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
      if (isVoiceActive) { stopVoiceMaster(); speakText('Wyłączono głos.'); }
      else { isVoiceActive = true; try { recognition.start(); speakText('Słucham komend.'); } catch{} }
    });
  }

  qsid('btn-dictate-dzialania')?.addEventListener('click', () => { isDictatingField = 'dzialania'; if(!isVoiceActive && DOM.btnVoice) DOM.btnVoice.click(); speakText('Mów opis.'); });
  
  function parseVoiceCommand(cmd) {
    const tabsMap = {'dom': 'tab-dom', 'zbiór': 'tab-zbior', 'zbior': 'tab-zbior', 'las': 'tab-las', 'karmienie': 'tab-feeding', 'leczenie': 'tab-treatment'};
    for (let k in tabsMap) if (cmd.includes(k)) { switchTab(tabsMap[k]); return speakText(`Przełączono na ${k.toUpperCase()}`); }
    
    const uiChecksMap = {
      'bardzo silna': () => qsid('rodzina-bs').checked = true,
      'silna': () => qsid('rodzina-s').checked = true,
      'słaba': () => qsid('rodzina-sl').checked = true,
      'średnia': () => qsid('rodzina-sr').checked = true,
      'matka tak': () => qsid('matka-tak').checked = true,
      'matka nie': () => qsid('matka-nie').checked = true,
      'jaja tak': () => qsid('jaja-tak').checked = true,
      'jaja nie': () => qsid('jaja-nie').checked = true,
      'pokarm ok': () => qsid('pokarm-ok').checked = true,
      'pokarm brak': () => qsid('pokarm-brak').checked = true,
      'czerw nie wiem': () => { if(DOM.cbRamkiNw) { DOM.cbRamkiNw.checked = true; DOM.cbRamkiNw.dispatchEvent(new Event('change')); } }
    };
    for (let k in uiChecksMap) if (cmd.includes(k)) { uiChecksMap[k](); return speakText(k); }

    const matchRamki = cmd.match(/(\d+)\s*(ramek|czerwiu)|czerw\s*(\d+)/i);
    if (matchRamki) {
      const val = parseInt(matchRamki[1] || matchRamki[3]);
      if (val >= 0 && val <= 30) { 
        if(DOM.cbRamkiNw) { DOM.cbRamkiNw.checked = false; DOM.cbRamkiNw.dispatchEvent(new Event('change')); }
        DOM.ramki.value = val; return speakText(`Czerw: ${val}r.`); 
      }
    }
  }
});
