// Controller
// manages all election type toggles and dataset switches

function setStatus(msg, error = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'inline-block';
  el.style.borderColor = error ? '#ff6b6b' : '#4aa3ff';
}
function clearStatus() {
  const el = document.getElementById('status');
  if (el) el.style.display = 'none';
}

// ## Election type toggle ######################################################
function toggleElectionView(type) {
  const municipal  = document.getElementById('municipalSection');
  const pres       = document.getElementById('presidentialSection');
  const eduskunta  = document.getElementById('eduskuntaSection');
  const dsetWrap   = document.getElementById('muniDatasetWrap');

  // Hide all
  if (municipal)  municipal.style.display  = 'none';
  if (pres)       pres.style.display       = 'none';
  if (eduskunta)  eduskunta.style.display  = 'none';
  if (dsetWrap)   dsetWrap.style.display   = 'none';

  if (type === 'municipal') {
    if (municipal) municipal.style.display = 'grid';
    if (dsetWrap)  dsetWrap.style.display  = '';
  } else if (type === 'presidential') {
    if (pres) pres.style.display = 'grid';
  } else if (type === 'eduskunta') {
    if (eduskunta) eduskunta.style.display = 'grid';
  }
}

function removeExistingElectionScripts() {
  document.querySelectorAll('script[data-election-module]').forEach(s => s.remove());
}

function loadElectionModule(type) {
  const modules = {
    municipal:    'kuntavaalit/kuntavaalit.js',
    presidential: 'presidentinvaalit/presidentinvaalit.js',
    eduskunta:    'eduskuntavaalit/eduskuntavaalit.js',
  };
  const scriptSrc = modules[type];
  if (!scriptSrc) return Promise.resolve();

  removeExistingElectionScripts();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.dataset.electionModule = 'true';
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error('Failed to load ' + scriptSrc));
    document.body.appendChild(script);
  });
}

// ## Municipal dataset switching (Äänestäjät ↔ Ehdokkaat) #####################
function applyMuniDataset(dataset) {
  const isVoters = dataset === 'voters';

  _show('voterFilters',     isVoters);
  _show('candidateFilters', !isVoters);
  _show('voterKpiRow',      isVoters);
  _show('candidateKpiRow',  !isVoters);
  _show('muniElectedCard',  !isVoters);

  const partyTitle = document.getElementById('partyBarTitle');
  const sexTitle   = document.getElementById('sexBarTitle');
  if (isVoters) {
    if (partyTitle) partyTitle.textContent = 'Puoluejärjestys valitulla alueella';
    if (sexTitle)   sexTitle.textContent   = 'Äänet sukupuolen ja puolueen mukaan';
  } else {
    if (partyTitle) partyTitle.textContent = 'Valitut puolueen mukaan';
    if (sexTitle)   sexTitle.textContent   = 'Valitut sukupuolen mukaan';
  }

  if (isVoters) {
    if (typeof window.refreshMunicipalCharts === 'function') {
      try { window.refreshMunicipalCharts(); } catch (_) {}
    }
    if (typeof window.enableVoterView === 'function') {
      window.enableVoterView();
    }
  } else {
    if (typeof window.enableMunicipalElectedAge === 'function') {
      window.enableMunicipalElectedAge();
    }
  }
}

function _show(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function boot() {
  const electionSel = document.getElementById('electionType');
  const datasetSel  = document.getElementById('muniDatasetSelect');
  if (!electionSel) return;

  toggleElectionView('municipal');

  try {
    await loadElectionModule('municipal');
    if (window.initMunicipal) window.initMunicipal();
    applyMuniDataset('voters');
  } catch (e) {
    console.error(e);
    setStatus('Failed to load municipal module: ' + e.message, true);
  }

  electionSel.addEventListener('change', async e => {
    const type = e.target.value;

    // Clear stale init handles
    window.initMunicipal = null;
    window.initPresident = null;
    window.initEduskunta = null;

    toggleElectionView(type);

    try {
      setStatus('Vaihdetaan näkymää…', false);
      await loadElectionModule(type);

      if (type === 'municipal'    && window.initMunicipal)  window.initMunicipal();
      if (type === 'presidential' && window.initPresident)  window.initPresident();
      if (type === 'eduskunta'    && window.initEduskunta)  window.initEduskunta();

      clearStatus();
    } catch (err) {
      console.error(err);
      setStatus('Failed to switch: ' + err.message, true);
    }
  });

  if (datasetSel) {
    datasetSel.addEventListener('change', e => {
      applyMuniDataset(e.target.value);
    });
  }
})();
