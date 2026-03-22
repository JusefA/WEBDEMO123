/**
 * eduskunta.js — Eduskuntavaalit: puolueiden kannatus (13sw)
 *
 * Mirror of app.js adapted for parliamentary elections.
 *
 * Key differences vs app.js / 14z7:
 *  - Area dim key: 'Vaalipiiri ja kunta vaalivuonna'
 *  - Area codes: 6-digit, last 3 = NATCODE (e.g. '020049' → '049' Espoo)
 *  - Sukupuoli dim is always SSS in this URL (total only)
 *  - Map instance stored on window._edMapInstance so it survives script reloads
 */

const ED_URL_PARTIES = 'https://pxdata.stat.fi/PxWeb/sq/1b72a5a8-9a35-40a2-83fb-97b50b094840';
const ED_AREA_DIM    = 'Vaalipiiri ja kunta vaalivuonna';

// ── Module-level state ────────────────────────────────────────────────────────
let edMuniLayer  = null;
let edGlobalData = null;
let edTiedotCode = null;
let edNatCodeMap = {};

const _edSelectedRef = { current: null };

// ── Cleanup on module reload ──────────────────────────────────────────────────
// Use window._edMapInstance so the reference survives across dynamic reloads.
if (window._edMapInstance) {
  try { window._edMapInstance.remove(); } catch (_) {}
  window._edMapInstance = null;
}
ChartLib.destroy('edPartyBar');
ChartLib.destroy('edSexBar');

// ── Main entry point ──────────────────────────────────────────────────────────
window.initEduskunta = async function initEduskunta() {
  edInitMap();
  setStatus('Ladataan eduskuntavaaliaineisto…');

  try {
    edGlobalData = await PxLib.load(ED_URL_PARTIES);
    edTiedotCode = PxLib.entries(edGlobalData, 'Tiedot')[0]?.code || 'aanet_yht';
    edNatCodeMap = edBuildNatCodeMap(edGlobalData);
    clearStatus();

    edPopulateYearDropdown(edGlobalData);
    edPopulateGeoDropdown(edGlobalData);
    edRefreshCharts();

    await edLoadGeoJSONLayers();
    edColorAllMunicipalities();

    document.getElementById('edYearSelect').onchange = edOnYearChange;
    document.getElementById('edGeoSelect').onchange  = edOnGeoChange;

    // Load the gender trend data straight away so it's ready when the view opens
    if (typeof window.enableEdVoterView === 'function') {
      window.enableEdVoterView();
    }
  } catch (err) {
    console.error(err);
    setStatus('Eduskuntavaaliaineiston lataus epäonnistui', true);
  }
};

window.refreshEduskuntaCharts = function () { edRefreshCharts(); };

// ── Change handlers ───────────────────────────────────────────────────────────
function edOnYearChange() {
  edRefreshCharts();
  edColorAllMunicipalities();
  _edSelectedRef.current = null;
  edSyncVoterControls();
}

function edOnGeoChange() {
  edRefreshCharts();
  edUpdateGeoLayer();
  edSyncVoterControls();
}

function edSyncVoterControls() {
  if (typeof window.edVoterRefresh === 'function') {
    try { window.edVoterRefresh(); } catch (_) {}
  }
}

// ── Data helpers ──────────────────────────────────────────────────────────────
function edBuildNatCodeMap(data) {
  const map = {};
  for (const { code } of PxLib.entries(data, ED_AREA_DIM)) {
    if (code.length === 6 && !code.endsWith('000')) {
      map[code.slice(3)] = code;
    }
  }
  return map;
}

// ── Dropdowns ─────────────────────────────────────────────────────────────────
function edPopulateYearDropdown(data) {
  const years = PxLib.entries(data, 'Vuosi')
    .sort((a, b) => Number(b.code) - Number(a.code));
  PxLib.fillSelect('edYearSelect', years, { keepValue: true, defaultFirst: true });
}

function edPopulateGeoDropdown(data) {
  const entries = PxLib.entries(data, ED_AREA_DIM).map(({ code, label }) => ({
    code,
    label: edCleanAreaLabel(label),
  }));
  PxLib.fillSelect('edGeoSelect', entries, { keepValue: true, defaultFirst: true });
}

function edCleanAreaLabel(label) {
  return label.replace(/^\d+\s+/, '').trim();
}

function edCleanPartyLabel(label) {
  return label.split(',')[0].split('(')[0].trim();
}

// ── Chart refresh ─────────────────────────────────────────────────────────────
function edRefreshCharts() {
  if (!edGlobalData) return;

  const yearCode    = document.getElementById('edYearSelect').value;
  const geoCode     = document.getElementById('edGeoSelect').value;
  const partySeries = edBuildPartyData(yearCode, geoCode);

  edDrawPartyBar(partySeries);
  edDrawPartyTrendChart(geoCode);

  const total = partySeries.reduce((s, p) => s + (p.value || 0), 0);
  document.getElementById('edKpiCount').textContent   = total.toLocaleString('fi-FI');
  document.getElementById('edKpiParties').textContent = partySeries.length;
  document.getElementById('edKpiGeos').textContent    =
    Object.keys(edGlobalData.dimension[ED_AREA_DIM].category.index).length;
}

// ── Series builders ───────────────────────────────────────────────────────────
function edBuildPartyData(yearCode, geoCode) {
  return PxLib.entries(edGlobalData, 'Puolue')
    .filter(p => p.code !== 'SSS')
    .map(({ code, label }) => ({
      party: code,
      label: edCleanPartyLabel(label),
      value: PxLib.get(edGlobalData, {
        Vuosi:       yearCode,
        Sukupuoli:   'SSS',
        Puolue:      code,
        [ED_AREA_DIM]: geoCode,
        Tiedot:      edTiedotCode,
      }) ?? 0,
    }))
    .filter(p => p.value > 0)
    .sort((a, b) => b.value - a.value);
}

function edBuildPartyTrendData(geoCode) {
  const yearCode = document.getElementById('edYearSelect')?.value;

  const allYears = PxLib.entries(edGlobalData, 'Vuosi')
    .sort((a, b) => Number(a.code) - Number(b.code));

  const ranked = PxLib.entries(edGlobalData, 'Puolue')
    .filter(p => p.code !== 'SSS')
    .map(({ code, label }) => ({
      code,
      label:        edCleanPartyLabel(label),
      currentVotes: PxLib.get(edGlobalData, {
        Vuosi: yearCode, Sukupuoli: 'SSS', Puolue: code,
        [ED_AREA_DIM]: geoCode, Tiedot: edTiedotCode,
      }) ?? 0,
    }))
    .filter(p => p.currentVotes > 0)
    .sort((a, b) => b.currentVotes - a.currentVotes)
    .slice(0, 8);

  const series = ranked.map(({ code, label }) => ({
    label,
    color: PxLib.PARTY_COLORS[code] || '#4aa3ff',
    data: allYears.map(y => {
      const v = PxLib.get(edGlobalData, {
        Vuosi: y.code, Sukupuoli: 'SSS', Puolue: code,
        [ED_AREA_DIM]: geoCode, Tiedot: edTiedotCode,
      });
      return v != null && v > 0 ? v : null;
    }),
  }));

  return { years: allYears.map(y => y.label), series };
}

// ── Chart drawing ─────────────────────────────────────────────────────────────
function edDrawPartyBar(series) {
  ChartLib.bar('edPartyBar', {
    labels:   series.map(s => s.label),
    datasets: [{
      label:           'Äänimäärä',
      data:            series.map(s => s.value),
      backgroundColor: series.map(s => PxLib.PARTY_COLORS[s.party] || '#4aa3ff'),
    }],
    options: { plugins: { legend: { display: false } } },
  });
}

function edDrawPartyTrendChart(geoCode) {
  const { years, series } = edBuildPartyTrendData(geoCode);
  ChartLib.line('edSexBar', {
    labels: years,
    datasets: series.map(s => ({
      label:           s.label,
      data:            s.data,
      borderColor:     s.color,
      backgroundColor: s.color + '22',
      tension:         0.3,
      pointRadius:     4,
      fill:            false,
      spanGaps:        false,
    })),
    options: {
      plugins: { legend: { display: true, position: 'top' } },
      scales:  { y: { beginAtZero: true } },
    },
  });
}

// ── Map ───────────────────────────────────────────────────────────────────────
function edInitMap() {
  window._edMapInstance = MapHelper.create('edMap');
}

async function edLoadGeoJSONLayers() {
  edMuniLayer = await MapHelper.loadGeoJSON(
    window._edMapInstance,
    'geo/municipalities.geojson',
    (feature, layer) => {
      const name    = feature.properties?.NAMEFIN || '';
      const natcode = String(feature.properties?.NATCODE || '').padStart(3, '0');

      layer.bindTooltip('', { sticky: true, className: 'mapTooltip' });

      layer.on('mouseover', () => {
        if (!edGlobalData) return;
        const areaCode = edNatCodeMap[natcode];
        if (!areaCode) return;
        const yearCode   = document.getElementById('edYearSelect')?.value;
        const leading    = edGetLeadingParty(yearCode, areaCode);
        const rawLabel   = leading
          ? (edGlobalData.dimension.Puolue.category.label[leading.party] || leading.party)
          : null;
        const partyLabel = rawLabel ? edCleanPartyLabel(rawLabel) : '–';
        layer.getTooltip()?.setContent(`<strong>${name}</strong><br>${partyLabel}`);
      });

      layer.on('click', () => {
        const areaCode = edNatCodeMap[natcode];
        if (!areaCode) return;
        const sel = document.getElementById('edGeoSelect');
        if (sel && [...sel.options].some(o => o.value === areaCode)) {
          sel.value = areaCode;
        }
        edOnGeoChange();
        try { window._edMapInstance.fitBounds(layer.getBounds(), { maxZoom: 9 }); } catch (_) {}
        MapHelper.selectLayer(_edSelectedRef, layer);
      });
    }
  );

  await MapHelper.loadGeoJSON(
    window._edMapInstance,
    'geo/provinces.geojson',
    (f, l) => l.bindPopup(f.properties?.NAMEFIN || ''),
    () => ({ color: '#666', weight: 1.5, fill: false, fillOpacity: 0 })
  );
}

function edColorAllMunicipalities() {
  if (!edGlobalData || !edMuniLayer) return;
  const yearCode = document.getElementById('edYearSelect')?.value;
  MapHelper.colorLayer(edMuniLayer, feature => {
    const natcode  = String(feature?.properties?.NATCODE || '').padStart(3, '0');
    const areaCode = edNatCodeMap[natcode];
    if (!areaCode) return '#555';
    const leading = edGetLeadingParty(yearCode, areaCode);
    return leading ? (PxLib.PARTY_COLORS[leading.party] || '#555') : '#555';
  }, _edSelectedRef);
}

function edUpdateGeoLayer() {
  if (!edGlobalData || !window._edMapInstance || !edMuniLayer) return;
  edColorAllMunicipalities();
  _edSelectedRef.current = null;
}

function edGetLeadingParty(yearCode, areaCode) {
  let best = null;
  for (const { code } of PxLib.entries(edGlobalData, 'Puolue').filter(p => p.code !== 'SSS')) {
    const v = PxLib.get(edGlobalData, {
      Vuosi: yearCode, Sukupuoli: 'SSS', Puolue: code,
      [ED_AREA_DIM]: areaCode, Tiedot: edTiedotCode,
    }) ?? 0;
    if (!best || v > best.value) best = { party: code, value: v };
  }
  return best?.value > 0 ? best : null;
}

