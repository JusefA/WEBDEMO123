/**
 * app.js — Kuntavaalit: puolueiden kannatus (14z7, single-URL revision)
 *
 * Uses one saved-query URL that contains all election years 1976-2025
 * and a single Tiedot measure (äänimäärä yhteensä).
 *
 * Changes in this revision:
 *  - Single PXWEB_URL replaces the multi-URL year-routing map
 *  - Year dropdown populated directly from the dataset dimension
 *  - Year / geo changes are synchronous (no re-fetch needed)
 *  - Year and area changes also sync the voterYearSelect / voterAreaSelect
 *    dropdowns and call window.voterRefresh() so the Trendi card stays in step
 *  - Parties with zero votes for the selected year+area are hidden from charts
 *  - Second chart: party-support trend lines (all years) for selected area
 */

const PXWEB_URL = 'https://pxdata.stat.fi/PxWeb/sq/10673710-d2ef-4bc5-9779-98293ae345da';

// ── Module-level state ────────────────────────────────────────────────────────
let mapInstance = null;
let muniLayer   = null;
let globalData  = null;   // single JSON-stat object (all years)
let tiedotCode  = null;   // the one available Tiedot code (e.g. 'aanet_yht')
let natCodeMap  = {};     // '092' (NATCODE) → '021092' (Alue code)

const _selectedRef = { current: null };

// ── Cleanup on module reload ──────────────────────────────────────────────────
if (mapInstance) { mapInstance.remove(); mapInstance = null; }
ChartLib.destroy('partyBar');
ChartLib.destroy('sexBar');

// ── Main entry point ──────────────────────────────────────────────────────────
window.initMunicipal = async function initMunicipal() {
  initMap();
  setStatus('Loading data…');

  try {
    globalData = await PxLib.load(PXWEB_URL);
    tiedotCode = PxLib.entries(globalData, 'Tiedot')[0]?.code || 'aanet_yht';
    natCodeMap = buildNatCodeMap(globalData);
    clearStatus();

    populateYearDropdown(globalData);
    populateGeoDropdown(globalData);
    refreshCharts();

    await loadGeoJSONLayers();
    colorAllMunicipalities();

    document.getElementById('yearSelect').onchange = onYearChange;
    document.getElementById('geoSelect').onchange  = onGeoChange;
  } catch (err) {
    console.error(err);
    setStatus('Failed to load data', true);
  }
};

window.refreshMunicipalCharts = function () { refreshCharts(); };

// ── Change handlers ───────────────────────────────────────────────────────────

function onYearChange() {
  refreshCharts();
  colorAllMunicipalities();
  _selectedRef.current = null;
  syncVoterControls();
}

function onGeoChange() {
  refreshCharts();
  updateGeoLayer();
  syncVoterControls();
}

/**
 * Keep the voters.js Trendi card in sync with the current year + area.
 * Quietly no-ops if voter data hasn't been loaded yet.
 */
function syncVoterControls() {
  if (typeof window.voterRefresh === 'function') {
    try { window.voterRefresh(); } catch (_) {}
  }
}

// ── Data helpers ──────────────────────────────────────────────────────────────

/**
 * Build NATCODE → Alue-code lookup from the dataset.
 * 14z7 codes are 6 chars: first 3 = vaalipiiri prefix, last 3 = NATCODE.
 * Codes ending in '000' are vaalipiiri / Manner-Suomi aggregates → excluded.
 */
function buildNatCodeMap(data) {
  const map = {};
  for (const { code } of PxLib.entries(data, 'Alue')) {
    if (code.length === 6 && !code.endsWith('000')) {
      map[code.slice(3)] = code; // last 3 chars = NATCODE
    }
  }
  return map;
}

// ── Dropdowns ─────────────────────────────────────────────────────────────────

function populateYearDropdown(data) {
  const years = PxLib.entries(data, 'Vuosi')
    .sort((a, b) => Number(b.code) - Number(a.code)); // newest first
  PxLib.fillSelect('yearSelect', years, { keepValue: true, defaultFirst: true });
}

function populateGeoDropdown(data) {
  const entries = PxLib.entries(data, 'Alue').map(({ code, label }) => ({
    code,
    label: cleanAreaLabel(label),
  }));
  PxLib.fillSelect('geoSelect', entries, { keepValue: true, defaultFirst: true });
}

/**
 * "049 Espoo" → "Espoo"   |   "02 Uudenmaan vaalipiiri" → "Uudenmaan vaalipiiri"
 * "Manner-Suomi"          → "Manner-Suomi"  (unchanged)
 */
function cleanAreaLabel(label) {
  return label.replace(/^\d+\s+/, '').trim();
}

/**
 * "KESK, (**LKP-84)" → "KESK"   |   "VAS, (+DEVA-88)" → "VAS"
 */
function cleanPartyLabel(label) {
  return label.split(',')[0].split('(')[0].trim();
}

// ── Chart refresh ─────────────────────────────────────────────────────────────
function refreshCharts() {
  if (!globalData) return;
  if (document.getElementById('muniDatasetSelect')?.value === 'candidates') return;

  const yearCode = document.getElementById('yearSelect').value;
  const geoCode  = document.getElementById('geoSelect').value;

  const partySeries = buildPartyData(yearCode, geoCode);
  drawPartyBar(partySeries);
  drawPartyTrendChart(geoCode);

  const total = partySeries.reduce((s, p) => s + (p.value || 0), 0);
  document.getElementById('kpiCount').textContent   = total.toLocaleString('fi-FI');
  document.getElementById('kpiParties').textContent = partySeries.length; // only parties with votes
  document.getElementById('kpiGeos').textContent    =
    Object.keys(globalData.dimension.Alue.category.index).length;
}

// ── Series builders ───────────────────────────────────────────────────────────

/**
 * Vote totals for each party in the selected year + area.
 * Parties with zero (or missing) votes are excluded entirely.
 */
function buildPartyData(yearCode, geoCode) {
  return PxLib.entries(globalData, 'Puolue')
    .filter(p => p.code !== 'SSS')
    .map(({ code, label }) => ({
      party: code,
      label: cleanPartyLabel(label),
      value: PxLib.get(globalData, {
        Vuosi:  yearCode,
        Alue:   geoCode,
        Puolue: code,
        Tiedot: tiedotCode,
      }) ?? 0,
    }))
    .filter(p => p.value > 0)           // ← hide parties with no votes
    .sort((a, b) => b.value - a.value);
}

/**
 * For the trend chart: build time-series data for the top N parties
 * (ranked by votes in the currently selected year), across all years.
 * Uses null for years where a party had no data, so Chart.js draws a gap.
 */
function buildPartyTrendData(geoCode) {
  const yearCode = document.getElementById('yearSelect')?.value;

  const allYears = PxLib.entries(globalData, 'Vuosi')
    .sort((a, b) => Number(a.code) - Number(b.code));

  // Rank parties by current-year votes to pick which lines to draw
  const ranked = PxLib.entries(globalData, 'Puolue')
    .filter(p => p.code !== 'SSS')
    .map(({ code, label }) => ({
      code,
      label:        cleanPartyLabel(label),
      currentVotes: PxLib.get(globalData, {
        Vuosi: yearCode, Alue: geoCode, Puolue: code, Tiedot: tiedotCode,
      }) ?? 0,
    }))
    .filter(p => p.currentVotes > 0)
    .sort((a, b) => b.currentVotes - a.currentVotes)
    .slice(0, 8); // top 8 parties for readability

  const series = ranked.map(({ code, label }) => ({
    label,
    color: PxLib.PARTY_COLORS[code] || '#4aa3ff',
    data: allYears.map(y => {
      const v = PxLib.get(globalData, {
        Vuosi: y.code, Alue: geoCode, Puolue: code, Tiedot: tiedotCode,
      });
      return v != null && v > 0 ? v : null; // null = gap (party didn't exist yet)
    }),
  }));

  return { years: allYears.map(y => y.label), series };
}

// ── Chart drawing ─────────────────────────────────────────────────────────────
function drawPartyBar(series) {
  ChartLib.bar('partyBar', {
    labels:   series.map(s => s.label),
    datasets: [{
      label:           'Äänimäärä',
      data:            series.map(s => s.value),
      backgroundColor: series.map(s => PxLib.PARTY_COLORS[s.party] || '#4aa3ff'),
    }],
    options: { plugins: { legend: { display: false } } },
  });
}

/**
 * Line chart: vote totals per party over all available years for the
 * selected area.  Replaces the old sex-breakdown chart — 14z7 has no
 * sex dimension.  Canvas is reused ('sexBar') so no HTML changes needed.
 */
function drawPartyTrendChart(geoCode) {
  const titleEl = document.getElementById('sexBarTitle');
  if (titleEl) titleEl.textContent = 'Puolueiden äänimäärät 1976–2025';

  const { years, series } = buildPartyTrendData(geoCode);

  ChartLib.line('sexBar', {
    labels: years,
    datasets: series.map(s => ({
      label:           s.label,
      data:            s.data,
      borderColor:     s.color,
      backgroundColor: s.color + '22',
      tension:         0.3,
      pointRadius:     4,
      fill:            false,
      spanGaps:        false, // keep gaps where a party had no data
    })),
    options: {
      plugins: { legend: { display: true, position: 'top' } },
      scales:  { y: { beginAtZero: true } },
    },
  });
}

// ── Map ───────────────────────────────────────────────────────────────────────
function initMap() {
  mapInstance = MapHelper.create('map');
}

async function loadGeoJSONLayers() {
  muniLayer = await MapHelper.loadGeoJSON(
    mapInstance,
    'geo/municipalities.geojson',
    (feature, layer) => {
      const name    = feature.properties?.NAMEFIN || '';
      const natcode = String(feature.properties?.NATCODE || '').padStart(3, '0');

      layer.bindTooltip('', { sticky: true, className: 'mapTooltip' });

      layer.on('mouseover', () => {
        if (!globalData) return;
        const areaCode = natCodeMap[natcode];
        if (!areaCode) return;
        const yearCode   = document.getElementById('yearSelect')?.value;
        const leading    = getLeadingParty(yearCode, areaCode);
        const rawLabel   = leading
          ? (globalData.dimension.Puolue.category.label[leading.party] || leading.party)
          : null;
        const partyLabel = rawLabel ? cleanPartyLabel(rawLabel) : '–';
        layer.getTooltip()?.setContent(`<strong>${name}</strong><br>${partyLabel}`);
      });

      layer.on('click', () => {
        const areaCode = natCodeMap[natcode];
        if (!areaCode) return;
        const sel = document.getElementById('geoSelect');
        if (sel && [...sel.options].some(o => o.value === areaCode)) {
          sel.value = areaCode;
        }
        onGeoChange(); // single call handles charts + voter sync
        try { mapInstance.fitBounds(layer.getBounds(), { maxZoom: 9 }); } catch (_) {}
        MapHelper.selectLayer(_selectedRef, layer);
      });
    }
  );

  await MapHelper.loadGeoJSON(
    mapInstance,
    'geo/provinces.geojson',
    (f, l) => l.bindPopup(f.properties?.NAMEFIN || ''),
    () => ({ color: '#666', weight: 1.5, fill: false, fillOpacity: 0 })
  );
}

function colorAllMunicipalities() {
  if (!globalData || !muniLayer) return;
  const yearCode = document.getElementById('yearSelect')?.value;
  MapHelper.colorLayer(muniLayer, feature => {
    const natcode  = String(feature?.properties?.NATCODE || '').padStart(3, '0');
    const areaCode = natCodeMap[natcode];
    if (!areaCode) return '#555';
    const leading = getLeadingParty(yearCode, areaCode);
    return leading ? (PxLib.PARTY_COLORS[leading.party] || '#555') : '#555';
  }, _selectedRef);
}

function updateGeoLayer() {
  if (!globalData || !mapInstance || !muniLayer) return;
  colorAllMunicipalities();
  _selectedRef.current = null;
}

/**
 * Find the party with the most votes in a given area/year.
 * Returns null if no votes are recorded (historical/merged municipality).
 */
function getLeadingParty(yearCode, areaCode) {
  let best = null;
  for (const { code } of PxLib.entries(globalData, 'Puolue').filter(p => p.code !== 'SSS')) {
    const v = PxLib.get(globalData, {
      Vuosi: yearCode, Alue: areaCode, Puolue: code, Tiedot: tiedotCode,
    }) ?? 0;
    if (!best || v > best.value) best = { party: code, value: v };
  }
  return best?.value > 0 ? best : null;
}

window.updateGeoLayer = updateGeoLayer;
