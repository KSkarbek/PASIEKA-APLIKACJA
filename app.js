/**
 * ZOPTYMALIZOWANA LOGIKA APLIKACJI ASYSTENT PASIEKA WLKP - 18 ULI (APLIK PASIEKA)
 * Wersja końcowa z zabezpieczeniami przed pustymi/nieprawidłowymi wpisami z Arkusza Google.
 */

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
  let hiveNames = Store.get(KEYS.NAMES, {});
  let hiveQueens = Store.get(KEYS.QUEENS, {});

  let activeTab = 'tab-dom';
  let isVoiceActive = false;
  let recognition = null;
  let isDictatingField = false; 
  let editingInspectionId = null;
  let editingFeedingId = null;
  let editingTreatmentId = null;

  const escapeHtml = str => String(str || '').replace(/[&<>"']/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[m]));
  const formatPL = dStr => {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return 'Brak daty';
    return `${d.toLocaleDateString('pl-PL')} ${d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'})}`;
  };
  const getDatetimeLocal = (d = new Date()) => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const getHiveName = id => hiveNames[id] || `Ul № ${id}`;
  const getHiveCategory = id => id <= 6 ? 'dom' : (id <= 12 ? 'zbior' : 'las');

  const qsid = id => document.getElementById(id);
  const qsa = s => document.querySelectorAll(s);
  const qs = s => document.querySelector(s);

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

    modal: qsid('hive-history-modal'), modalContent: qsid('modal-history-content'),
    sheetTbody: qsid('sheet-tbody'), feedTbody: qsid('tab-feeding-tbody'), mainFeedTbody: qsid('feedings-tbody'),
    treatTbody: qsid('tab-treatment-tbody'), mainTreatTbody: qsid('treatments-tbody'),
    filterHive: qsid('filter-hive-select'), filterFeed: qsid('filter-tab-feeding-select'),
    
    webhook: qsid('input-gsheet-webhook'),
    btnSaveWebhook: qsid('btn-save-webhook'),
    btnShowGsheetScript: qsid('btn-show-gsheet-script'),
    gsheetScriptDetails: qsid('gsheet-script-details'),
    btnSyncNow: qsid('btn-sync-now'),
    
    wrapInsp: qsid('wrapper-inspections-table'), wrapFeed: qsid('wrapper-feedings-table'), wrapTreat: qsid('wrapper-treatments-table'),
    btnVInsp: qsid('btn-view-inspections'), btnVFeed: qsid('btn-view-feedings'), btnVTreat: qsid('btn-view-treatments')
  };

  initTheme();
  if (DOM.dateInsp) DOM.dateInsp.value = getDatetimeLocal();
  if (DOM.dateFeed) DOM.dateFeed.value = getDatetimeLocal();
  if (DOM.dateTreat) DOM.dateTreat.value = getDatetimeLocal();
  
  renderHivesGrid();
  renderSheetTable();

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
        localStorage.removeItem(KEYS.WEBHOOK);
        DOM.webhook.value = DEFAULT_WEBHOOK;
        alert('🔄 Przywrócono domyślny link synchronizacji.');
      }
    });
  }

  if (DOM.btnSyncNow) {
    DOM.btnSyncNow.addEventListener('click', () => {
      DOM.btnSyncNow.disabled = true;
      DOM.btnSyncNow.textContent = '⏳ Synchronizacja...';

      fetchFromGoogleSheets()
        .then(addedCount => {
          alert(`Synchronizacja zakończona sukcesem!\n• Pobrano nowych wpisów: ${addedCount}`);
        })
        .catch(() => {
          alert('Wystąpił błąd podczas pobierania danych.');
        })
        .finally(() => {
          DOM.btnSyncNow.disabled = false;
          DOM.btnSyncNow.textContent = '🔄 Synchronizuj z Google Sheets';
        });
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
      const hId = parseInt(cardBtn.dataset.hive);
      if (cardBtn.classList.contains('btn-add-inspection')) openInspectionForHive(hId);
      if (cardBtn.classList.contains('btn-add-feeding')) openFeedingForHive(hId);
      if (cardBtn.classList.contains('btn-open-modal-history')) openHiveHistoryModal(hId);
      if (cardBtn.classList.contains('btn-rename-hive')) promptRenameHive(hId);
      if (cardBtn.classList.contains('btn-edit-queen')) promptEditQueen(hId);
      return;
    }

    if (e.target === DOM.modal || e.target.id === 'btn-close-modal') DOM.modal.classList.add('hidden');
    
    const actionBtn = e.target.closest('button[data-id]');
    if (actionBtn) {
      const id = actionBtn.dataset.id;
      if (actionBtn.classList.contains('btn-delete-row')) {
        if (confirm('Usunąć wpis?')) deleteRecord('inspections', id);
      }
      if (actionBtn.classList.contains('btn-edit-inspection')) { DOM.modal.classList.add('hidden'); openInspectionForEdit(id); }
    }
  });

  if (DOM.selHive) DOM.selHive.addEventListener('change', e => qsid('form-hive-title').textContent = `Przegląd: ${getHiveName(e.target.value)}`);
  if (DOM.filterHive) DOM.filterHive.addEventListener('change', () => { renderSheetTable(); renderFeedingsTable(); renderTreatmentsTable(); });

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
        if (idx > -1) inspections[idx] = { ...inspections[idx], ...payload };
        editingInspectionId = null;
      } else {
        payload.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        inspections.unshift(payload);
      }

      Store.set(KEYS.INSPECTIONS, inspections);
      sendToGoogleSheets(payload, 'inspection');
      
      DOM.inspForm.reset();
      renderHivesGrid();
      renderSheetTable();
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
      card.innerHTML = `
        <div class="hive-card-header">
          <div>
            <span class="hive-num">🐝 ${escapeHtml(hName)}</span>
            <div style="font-size: 0.85rem; color: var(--primary-hover);">👑 Matka: ${escapeHtml(hiveQueens[i] || (last ? last.matkaInfo : 'Nieokreślona'))}</div>
          </div>
          <span class="last-date">${last ? formatPL(last.timestamp) : 'Brak przeglądu'}</span>
        </div>
        <div class="hive-card-footer" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px;">
          <button class="btn-card-action primary btn-add-inspection" data-hive="${i}">📝 Przegląd</button>
          <button class="btn-card-action btn-open-modal-history" data-hive="${i}" style="background: #4b5563; color: white;">📜 Historia (${inspList.length})</button>
        </div>
      `;
      frags[getHiveCategory(i)].appendChild(card);
    }
    if(DOM.grids.dom) DOM.grids.dom.appendChild(frags.dom);
    if(DOM.grids.zbior) DOM.grids.zbior.appendChild(frags.zbior);
    if(DOM.grids.las) DOM.grids.las.appendChild(frags.las);
  }

  function renderSheetTable() {
    const filter = DOM.filterHive ? DOM.filterHive.value : 'ALL';
    const list = filter === 'ALL' ? inspections : inspections.filter(i => i.hiveNum === parseInt(filter));
    
    if (!DOM.sheetTbody) return;
    DOM.sheetTbody.innerHTML = '';
    if (!list.length) {
      DOM.sheetTbody.innerHTML = `<tr><td colspan="13" style="text-align:center;">Brak wpisów.</td></tr>`;
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(i => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${formatPL(i.timestamp)}</strong></td>
        <td><span class="badge-count">Ul № ${i.hiveNum}</span></td>
        <td><strong>${escapeHtml(i.hiveName)}</strong></td>
        <td>${escapeHtml(i.rodzina)}</td>
        <td>${i.matka === 'TAK' ? '👑 TAK' : '❌ NIE'}</td>
        <td>${escapeHtml(i.matkaInfo)}</td>
        <td>${i.jaja === 'TAK' ? '🥚 TAK' : '❌ NIE'}</td>
        <td>${escapeHtml(i.ramkiCzerwiu)}r</td>
        <td>${escapeHtml(i.pokarm)}</td>
        <td>${i.polkorpus || 0}</td>
        <td>${escapeHtml(i.dzialania)}</td>
        <td>${escapeHtml(i.przyszleDzialania)}</td>
        <td><button class="btn-delete-row" data-id="${i.id}">🗑️</button></td>
      `;
      frag.appendChild(tr);
    });
    DOM.sheetTbody.appendChild(frag);
  }

  function renderFeedingsTable() {}
  function renderTreatmentsTable() {}

  function deleteRecord(type, id) {
    inspections = inspections.filter(x => x.id !== id);
    Store.set(KEYS.INSPECTIONS, inspections);
    renderSheetTable();
    renderHivesGrid();
  }

  function openInspectionForHive(hId) {
    DOM.selHive.value = hId;
    qsid('form-hive-title').textContent = `Przegląd: ${getHiveName(hId)}`;
    switchTab('tab-inspection');
  }

  function openInspectionForEdit(id) {
    const item = inspections.find(i => i.id === id);
    if (!item) return;
    editingInspectionId = id;
    openInspectionForHive(item.hiveNum);
  }

  function switchTab(tabId) {
    activeTab = tabId;
    DOM.tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    DOM.contents.forEach(c => c.classList.toggle('active', c.id === tabId));
    if (tabId === 'tab-sheet') renderSheetTable();
  }

  function updateHiveSelects() {
    const opts = Array.from({length: TOTAL_HIVES}, (_, i) => `<option value="${i+1}">${getHiveName(i+1)} (Ul № ${i+1})</option>`).join('');
    if (DOM.selHive) DOM.selHive.innerHTML = opts;
    if (DOM.filterHive) DOM.filterHive.innerHTML = '<option value="ALL">Wszystkie Ule (1-18)</option>' + opts;
  }

  function initTheme() {
    const isDark = Store.get(KEYS.THEME, 'light') === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    if (DOM.btnTheme) {
      DOM.btnTheme.addEventListener('click', () => {
        const d = document.body.classList.toggle('dark-mode');
        Store.set(KEYS.THEME, d ? 'dark' : 'light');
      });
    }
  }

  function promptRenameHive(id) {
    const n = prompt(`Podaj nazwę dla Ula № ${id}:`, getHiveName(id));
    if (n && n.trim()) { hiveNames[id] = n.trim(); Store.set(KEYS.NAMES, hiveNames); renderHivesGrid(); renderSheetTable(); }
  }

  function promptEditQueen(id) {
    const n = prompt(`Wpisz matkę dla Ula № ${id}:`, hiveQueens[id] || '');
    if (n !== null) { hiveQueens[id] = n.trim(); Store.set(KEYS.QUEENS, hiveQueens); renderHivesGrid(); renderSheetTable(); }
  }

  function sendToGoogleSheets(record, type = 'inspection') {
    const url = getWebhookUrl();
    if (!url || record._synced) return;
    const payloadStr = JSON.stringify({ ...record, type, timestamp: formatPL(record.timestamp) });
    
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payloadStr], { type: 'text/plain;charset=UTF-8' }));
      record._synced = true;
      Store.set(KEYS.INSPECTIONS, inspections);
    } else {
      fetch(url, { method: 'POST', mode: 'no-cors', body: payloadStr }).catch(() => {});
    }
  }

  /**
   * Kluczowa funkcja z walidacją – odrzuca śmieciowe i puste wiersze z Arkusza Google
   */
  function fetchFromGoogleSheets() {
    const url = getWebhookUrl();
    if (!url) return Promise.reject();
    return fetch(url).then(r => r.json()).then(remote => {
      let added = 0;
      if (Array.isArray(remote)) {
        remote.forEach(rm => {
          const hNum = parseInt(rm.hiveNum, 10);
          // WALIDACJA: Odrzucamy wiersze nieposiadające numeru ula, ID lub z błędną datą
          if (isNaN(hNum) || hNum < 1 || hNum > TOTAL_HIVES || !rm.id || !rm.timestamp || String(rm.timestamp).includes('Invalid')) {
            return;
          }
          rm.hiveNum = hNum;

          if (!inspections.some(lc => lc.id === rm.id || (lc.hiveNum === rm.hiveNum && new Date(lc.timestamp).getTime() === new Date(rm.timestamp).getTime()))) {
            inspections.push(rm); 
            added++;
          }
        });
        if (added > 0) {
          inspections.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          Store.set(KEYS.INSPECTIONS, inspections); 
          renderSheetTable(); 
          renderHivesGrid();
        }
      }
      return added;
    });
  }

  function openHiveHistoryModal(hiveNum) {
    const hiveInspections = inspections.filter(item => item.hiveNum === hiveNum);
    qsid('modal-hive-title').textContent = `📜 Historia Ula: ${getHiveName(hiveNum)}`;
    let html = `<div style="display: flex; flex-direction: column; gap: 8px;">`;
    hiveInspections.forEach(item => {
      html += `<div style="background: var(--bg-color); border: 1px solid var(--border-color); padding: 10px; border-radius: 8px;">
        <strong>📅 ${formatPL(item.timestamp)}</strong> — Czerw: ${item.ramkiCzerwiu}r | Wykonano: ${escapeHtml(item.dzialania)}
      </div>`;
    });
    html += `</div>`;
    DOM.modalContent.innerHTML = html;
    DOM.modal.classList.remove('hidden');
  }
});
