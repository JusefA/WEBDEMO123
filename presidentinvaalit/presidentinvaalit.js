/**
 * president.js — Presidentinvaalit (14da + 14dd)
 *
 * 14da: äänestystiedot sukupuolen mukaan — map, KPIs, gender trend
 * 14dd: ehdokkaiden kannatus vaalipiireittäin — candidate bar chart (SSS = koko maa)
 *
 * Changes:
 *  - Removed presDrawTurnoutTrendLine (presSexBar) entirely
 *  - presPartyBar now shows candidate vote totals for selected year (koko maa)
 *    using 14dd, mirroring kuntavaalit's party bar
 *  - Map coloured red: shade depends on äänestysprosentti (darker = lower, brighter = higher)
 */

const PRES_URL      = 'https://pxdata.stat.fi/PxWeb/sq/5e3bd658-55ac-4cc1-8f4b-c0c3d4dc318c';
const PRES_DD_URL   = 'https://pxdata.stat.fi/PxWeb/sq/2e3eea68-ad9d-4412-90e9-88cbdba5cd7e';
const PRES_AREA_DIM = 'Vaalipiiri ja kunta vaalivuonna';
const PRES_VP_DIM   = 'Vaalipiiri';
const PRES_CAND_DIM = 'Ehdokkaat';

// ── State ─────────────────────────────────────────────────────────────────────
let presData    = null;   // 14da
let presCanData = null;   // 14dd
let presTiedot  = [];
let presNatMap  = {};

if (window._presMapInstance) {
  try { window._presMapInstance.remove(); } catch (_) {}
  window._presMapInstance = null;
}
let presMuniLayer = null;
const _presSelRef = { current: null };

ChartLib.destroy('presPartyBar');
ChartLib.destroy('presVoterTrendLine');

// ── Entry point ───────────────────────────────────────────────────────────────
window.initPresident = async function initPresident() {
  presInitMap();
  setStatus('Ladataan presidentinvaaliaineisto…');

  try {
    // Load both datasets in parallel
    [presData, presCanData] = await Promise.all([
      PxLib.load(PRES_URL),
      PxLib.load(PRES_DD_URL),
    ]);

    presTiedot = PxLib.entries(presData, 'Tiedot');
    presNatMap = presBuildNatCodeMap(presData);
    clearStatus();

    presPopulateYearDropdown();
    presPopulateRoundDropdown();
    presPopulateGeoDropdown();
    presPopulateVoterDropdowns();
    presRefreshCharts();

    await presLoadGeoJSONLayers();
    presColorAllMunicipalities();

    document.getElementById('presYearSelect').onchange  = presOnYearChange;
    document.getElementById('presRoundSelect').onchange = presOnRoundChange;
    document.getElementById('presGeoSelect').onchange   = presOnGeoChange;

    document.getElementById('presVoterVarSelect')?.addEventListener('change', presRefreshVoterTrend);
  } catch (err) {
    console.error(err);
    setStatus('Presidentinvaaliaineiston lataus epäonnistui', true);
  }
};

// ── Change handlers ───────────────────────────────────────────────────────────
function presOnYearChange() {
  presRefreshCharts();
  presColorAllMunicipalities();
  _presSelRef.current = null;
}

function presOnRoundChange() {
  presRefreshCharts();
  presColorAllMunicipalities();
  _presSelRef.current = null;
}

function presOnGeoChange() {
  presRefreshCharts();
}

// ── Nat code map ──────────────────────────────────────────────────────────────
function presBuildNatCodeMap(data) {
  const map = {};
  for (const { code } of PxLib.entries(data, PRES_AREA_DIM)) {
    if (/^\d{6}$/.test(code) && !code.endsWith('000')) {
      map[code.slice(3)] = code;
    }
  }
  return map;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function presCleanAreaLabel(label) {
  return label.replace(/^\d+\s+/, '').trim();
}

function presFindTiedotCode(keywords, exclude = []) {
  return PxLib.findCode(presData, 'Tiedot', keywords, exclude);
}

// Candidate → party colour (matched by lowercase name fragment)
const CAND_COLORS = [
  { key: 'stubb',      color: '#0057B7' },
  { key: 'niinistö',   color: '#0057B7' },
  { key: 'haavisto',   color: '#33A532' },
  { key: 'halla-aho',  color: '#FFD200' },
  { key: 'li anders',  color: '#D40000' },
  { key: 'arhinmäki',  color: '#D40000' },
  { key: 'rehn',       color: '#01954B' },
  { key: 'väyrynen',   color: '#01954B' },
  { key: 'vanhanen',   color: '#01954B' },
  { key: 'essayah',    color: '#2B4C9A' },
  { key: 'kallis',     color: '#2B4C9A' },
  { key: 'harkimo',    color: '#CE0F69' },
  { key: 'aaltola',    color: '#888888' },
  { key: 'halonen',    color: '#E11931' },
  { key: 'lipponen',   color: '#E11931' },
  { key: 'paatero',    color: '#E11931' },
  { key: 'haatainen',  color: '#E11931' },
  { key: 'ahtisaari',  color: '#E11931' },
  { key: 'aho',        color: '#01954B' },
  { key: 'hautala',    color: '#33A532' },
  { key: 'soini',      color: '#FFD200' },
  { key: 'huhtasaari', color: '#FFD200' },
  { key: 'urpilainen', color: '#E11931' },
  { key: 'biaudet',    color: '#7FBBF0' },
  { key: 'kyllönen',   color: '#D40000' },
];

function getCandColor(label) {
  const norm = String(label || '').toLowerCase();
  for (const { key, color } of CAND_COLORS) {
    if (norm.includes(key)) return color;
  }
  return '#888888';
}

// ── Dropdowns ─────────────────────────────────────────────────────────────────
function presPopulateYearDropdown() {
  const years = PxLib.entries(presData, 'Vuosi')
    .sort((a, b) => Number(b.code) - Number(a.code));
  PxLib.fillSelect('presYearSelect', years, { keepValue: true, defaultFirst: true });
}

function presPopulateRoundDropdown() {
  PxLib.fillSelect('presRoundSelect', PxLib.entries(presData, 'Kierros'),
    { keepValue: true, defaultFirst: true });
}

function presPopulateGeoDropdown() {
  const entries = PxLib.entries(presData, PRES_AREA_DIM).map(({ code, label }) => ({
    code, label: presCleanAreaLabel(label),
  }));
  PxLib.fillSelect('presGeoSelect', entries, { keepValue: true, defaultFirst: true });
}

function presPopulateVoterDropdowns() {
  PxLib.fillSelect('presVoterVarSelect', presTiedot, { keepValue: true, defaultFirst: true });
  const pctCode = presFindTiedotCode(['äänestysprosentti'], ['ennakko']);
  if (pctCode) {
    const sel = document.getElementById('presVoterVarSelect');
    if (sel) sel.value = pctCode;
  }
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function presRefreshKpis() {
  if (!presData) return;
  const areaCode  = document.getElementById('presGeoSelect')?.value || 'SSS';
  const yearCode  = document.getElementById('presYearSelect')?.value;
  const roundCode = document.getElementById('presRoundSelect')?.value;

  const eligibleCode = presFindTiedotCode(['äänioikeutetut'], []);
  const votedCode    = presFindTiedotCode(['äänestäneet'], ['ennakolta', 'prosentti', '%']);
  const turnoutCode  = presFindTiedotCode(['äänestysprosentti'], ['ennakko']);

  const get = code => code ? (PxLib.get(presData, {
    Vuosi: yearCode, Sukupuoli: 'SSS',
    [PRES_AREA_DIM]: areaCode, Kierros: roundCode, Tiedot: code,
  }) ?? 0) : 0;

  const fmt    = v => v > 0 ? v.toLocaleString('fi-FI') : '–';
  const fmtPct = v => v > 0
    ? v.toLocaleString('fi-FI', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' : '–';

  const e = id => document.getElementById(id);
  if (e('presKpiEligible')) e('presKpiEligible').textContent = fmt(get(eligibleCode));
  if (e('presKpiVoted'))    e('presKpiVoted').textContent    = fmt(get(votedCode));
  if (e('presKpiTurnout'))  e('presKpiTurnout').textContent  = fmtPct(get(turnoutCode));
}

// ── Chart refresh ─────────────────────────────────────────────────────────────
function presRefreshCharts() {
  if (!presData) return;
  presRefreshKpis();
  presDrawCandidateBar();
  presRefreshVoterTrend();
}

// ── Candidate bar: vote totals koko maa for selected year + round (14dd) ─────
// Mirrors kuntavaalit's party bar — parties with zero votes hidden, sorted desc.
function presDrawCandidateBar() {
  if (!presCanData) return;

  const yearCode  = document.getElementById('presYearSelect')?.value;
  const roundCode = document.getElementById('presRoundSelect')?.value;

  const series = PxLib.entries(presCanData, PRES_CAND_DIM)
    .filter(c => !['98', '99'].includes(c.code)) // exclude totals/rejected rows
    .map(({ code, label }) => ({
      label,
      value: PxLib.get(presCanData, {
        Vuosi:           yearCode,
        [PRES_CAND_DIM]: code,
        [PRES_VP_DIM]:   'SSS',   // koko maa
        Kierros:         roundCode,
        Tiedot:          'pvaa_aanet',
      }) ?? 0,
    }))
    .filter(c => c.value > 0)
    .sort((a, b) => b.value - a.value);

  ChartLib.bar('presPartyBar', {
    labels:   series.map(s => s.label),
    datasets: [{
      label:           'Äänimäärä',
      data:            series.map(s => s.value),
      backgroundColor: series.map(s => getCandColor(s.label)),
    }],
    options: { plugins: { legend: { display: false } } },
  });
}

// ── Voter gender trend ────────────────────────────────────────────────────────
function presRefreshVoterTrend() {
  if (!presData) return;

  const areaCode  = document.getElementById('presGeoSelect')?.value || 'SSS';
  const roundCode = document.getElementById('presRoundSelect')?.value;
  const infoCode  = document.getElementById('presVoterVarSelect')?.value;

  const allYears = PxLib.entries(presData, 'Vuosi')
    .sort((a, b) => Number(a.code) - Number(b.code));

  const maleData   = allYears.map(y =>
    PxLib.get(presData, {
      Vuosi: y.code, Sukupuoli: '1',
      [PRES_AREA_DIM]: areaCode, Kierros: roundCode, Tiedot: infoCode,
    }) ?? null
  );
  const femaleData = allYears.map(y =>
    PxLib.get(presData, {
      Vuosi: y.code, Sukupuoli: '2',
      [PRES_AREA_DIM]: areaCode, Kierros: roundCode, Tiedot: infoCode,
    }) ?? null
  );

  ChartLib.line('presVoterTrendLine', {
    labels: allYears.map(y => y.label),
    datasets: [
      { label: 'Miehet', data: maleData,   borderColor: '#4aa3ff',
        backgroundColor: 'rgba(74,163,255,0.08)', tension: 0.3, pointRadius: 5, fill: false },
      { label: 'Naiset', data: femaleData, borderColor: '#ff7aa8',
        backgroundColor: 'rgba(255,122,168,0.08)', tension: 0.3, pointRadius: 5, fill: false },
    ],
  });
}

// ── Map ───────────────────────────────────────────────────────────────────────
function presInitMap() {
  window._presMapInstance = MapHelper.create('presMap');
}

async function presLoadGeoJSONLayers() {
  presMuniLayer = await MapHelper.loadGeoJSON(
    window._presMapInstance,
    'geo/municipalities.geojson',
    (feature, layer) => {
      const name    = feature.properties?.NAMEFIN || '';
      const natcode = String(feature.properties?.NATCODE || '').padStart(3, '0');

      layer.bindTooltip('', { sticky: true, className: 'mapTooltip' });

      layer.on('mouseover', () => {
        if (!presData) return;
        const areaCode  = presNatMap[natcode];
        if (!areaCode) return;
        const yearCode  = document.getElementById('presYearSelect')?.value;
        const roundCode = document.getElementById('presRoundSelect')?.value;
        const pctCode   = presFindTiedotCode(['äänestysprosentti'], ['ennakko']);
        const pct = pctCode ? (PxLib.get(presData, {
          Vuosi: yearCode, Sukupuoli: 'SSS',
          [PRES_AREA_DIM]: areaCode, Kierros: roundCode, Tiedot: pctCode,
        }) ?? null) : null;
        const pctStr = pct != null
          ? pct.toLocaleString('fi-FI', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
          : '–';
        layer.getTooltip()?.setContent(`<strong>${name}</strong><br>Äänestys%: ${pctStr}`);
      });

      layer.on('click', () => {
        const areaCode = presNatMap[natcode];
        if (!areaCode) return;
        const sel = document.getElementById('presGeoSelect');
        if (sel && [...sel.options].some(o => o.value === areaCode)) {
          sel.value = areaCode;
        }
        presOnGeoChange();
        try { window._presMapInstance.fitBounds(layer.getBounds(), { maxZoom: 9 }); } catch (_) {}
        MapHelper.selectLayer(_presSelRef, layer);
      });
    }
  );

  await MapHelper.loadGeoJSON(
    window._presMapInstance,
    'geo/provinces.geojson',
    (f, l) => l.bindPopup(f.properties?.NAMEFIN || ''),
    () => ({ color: '#666', weight: 1.5, fill: false, fillOpacity: 0 })
  );
}

//Color municipalities based on precentage of how many people voted per how many are elidible to do so
function presColorAllMunicipalities() {
  if (!presData || !presMuniLayer) return;
  const yearCode  = document.getElementById('presYearSelect')?.value;
  const roundCode = document.getElementById('presRoundSelect')?.value;
  const pctCode   = presFindTiedotCode(['äänestysprosentti'], ['ennakko']);

  MapHelper.colorLayer(presMuniLayer, feature => {
    if (!pctCode) return '#aaa';
    const natcode  = String(feature?.properties?.NATCODE || '').padStart(3, '0');
    const areaCode = presNatMap[natcode];
    if (!areaCode) return '#aaa';
    const pct = PxLib.get(presData, {
      Vuosi: yearCode, Sukupuoli: 'SSS',
      [PRES_AREA_DIM]: areaCode, Kierros: roundCode, Tiedot: pctCode,
    });
    if (pct == null) return '#aaa';

    if (pct >= 85) return '#000000';
    if (pct >= 80) return '#140000';
    if (pct >= 75) return '#3b0000';
    if (pct >= 70) return '#6e0000';
    if (pct >= 65) return '#a50000';
    if (pct >= 60) return '#dd0000';
    if (pct >= 55) return '#ff6666';
    return          '#ffbbbb';       // < 55% or less, light reddish pink
  }, _presSelRef);
}
