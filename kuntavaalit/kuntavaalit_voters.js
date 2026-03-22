/**
 * voters.js — Kuntavaalit: äänestäjät (14yv)
 *
 * Depends on: PxLib (pxlib.js), ChartLib (chartlib.js)
 */

(function () {
  const PXWEB_14YV_URL =
    'https://pxdata.stat.fi/PxWeb/sq/eb06fb56-a67e-40c5-ac6a-adbfcba0d256';

  let voterData = null;
  let wired     = false;

  const el = id => document.getElementById(id);

  // ## Dimension key discovery ###################################################################
  function getDimKeys() {
    if (!voterData) return null;
    return {
      area:   PxLib.discoverKey(voterData, [/alue|kunta|municipality/i]),
      year:   PxLib.discoverKey(voterData, [/vuosi|year/i]),
      gender: PxLib.discoverKey(voterData, [/sukupuoli|kön|sex|gender/i]),
      info:   PxLib.discoverKey(voterData, [/tiedot|uppgift/i])
    };
  }

  // ## Gender code helpers ###################################################################
  function genderCodes() {
    const { gender } = getDimKeys();
    return {
      total:  PxLib.findCodeOrKey(voterData, gender, ['yhteensä', 'SSS', 'total']),
      male:   PxLib.findCodeOrKey(voterData, gender, ['miehet', 'mies', '1']),
      female: PxLib.findCodeOrKey(voterData, gender, ['naiset', 'nainen', '2'])
    };
  }

  // ## Current selections ###################################################################
  function selectedIds() {
    const d = getDimKeys();

    // Resolve area: try the geoSelect code directly in voterData's area index.
    // If it doesn't exist, fall back to the FIRST code in voterData's area
    // dimension (usually the national aggregate, whatever code it uses).
    const rawArea = el('geoSelect')?.value || '';
    const areaIdx = d?.area ? (voterData?.dimension?.[d.area]?.category?.index || {}) : {};
    const areaKeys = Object.keys(areaIdx).sort((a, b) => areaIdx[a] - areaIdx[b]);
    const areaCode = (rawArea && areaIdx[rawArea] != null)
      ? rawArea
      : (areaKeys[0] || '');

    // Year: used only in KPIs (trend iterates voterData's own years).
    // Try geoSelect's year; if not in voterData fall back to most recent year.
    const rawYear = el('yearSelect')?.value || '';
    const yearIdx = d?.year ? (voterData?.dimension?.[d.year]?.category?.index || {}) : {};
    const yearKeys = Object.keys(yearIdx).sort((a, b) => Number(b) - Number(a));
    const yearCode = (rawYear && yearIdx[rawYear] != null)
      ? rawYear
      : (yearKeys[0] || '');

    return {
      areaCode,
      yearCode,
      infoCode: el('voterVarSelect')?.value || ''
    };
  }

  // ## Value getter ###################################################################
  function getValue(areaCode, yearCode, gCode, infoCode) {
    const d = getDimKeys();
    if (!d) return 0;
    return PxLib.get(voterData, {
      [d.area]:   areaCode,
      [d.year]:   yearCode,
      [d.gender]: gCode,
      [d.info]:   infoCode
    }) ?? 0;
  }

  // ## Series builders ###################################################################
  function buildTrendSeries() {
    const d = getDimKeys();
    const { areaCode, infoCode } = selectedIds();
    const { total, male, female } = genderCodes();

    const years = PxLib.entries(voterData, d.year)
      .sort((a, b) => Number(a.code) - Number(b.code));

    return {
      years:  years.map(y => y.label),
      male:   years.map(y => getValue(areaCode, y.code, male,   infoCode)),
      female: years.map(y => getValue(areaCode, y.code, female, infoCode))
    };
  }

  // ## KPI updater ###################################################################
  function updateKPIs() {
    const d = getDimKeys();
    const { areaCode, yearCode } = selectedIds();
    const { total } = genderCodes();

    const eligibleCode = PxLib.findCode(voterData, d.info, ['äänioikeutetut'], []);
    const votedCode    = PxLib.findCode(voterData, d.info, ['äänestäneet'],    ['ennakolta', 'prosentti']);
    const turnoutCode  = PxLib.findCode(voterData, d.info, ['äänestysprosentti'], ['ennakko']);

    const fmt    = v => v > 0 ? v.toLocaleString('fi-FI') : '–';
    const fmtPct = v => v > 0
      ? v.toLocaleString('fi-FI', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
      : '–';

    const eligibleEl = el('voterKpiEligible');
    const votedEl    = el('voterKpiVoted');
    const turnoutEl  = el('voterKpiTurnout');

    if (eligibleEl) eligibleEl.textContent = eligibleCode
      ? fmt(getValue(areaCode, yearCode, total, eligibleCode)) : '–';
    if (votedEl)    votedEl.textContent    = votedCode
      ? fmt(getValue(areaCode, yearCode, total, votedCode))    : '–';
    if (turnoutEl)  turnoutEl.textContent  = turnoutCode
      ? fmtPct(getValue(areaCode, yearCode, total, turnoutCode)) : '–';
  }



  function drawTrendLine(series) {
    ChartLib.line('voterTrendLine', {
      labels:   series.years,
      datasets: [
        { label: 'Miehet',   data: series.male,   borderColor: '#4aa3ff',
          backgroundColor: 'rgba(74,163,255,0.08)', tension: 0.3, pointRadius: 5, fill: false },
        { label: 'Naiset',   data: series.female, borderColor: '#ff7aa8',
          backgroundColor: 'rgba(255,122,168,0.08)',tension: 0.3, pointRadius: 5, fill: false }
      ]
    });
  }

  // ## Refresh ###################################################################
  function refreshVoterCharts() {
    if (!voterData) return;
    updateKPIs();
    drawTrendLine(buildTrendSeries());
  }

  // ## Dropdowns ###################################################################
  function populateDropdowns() {
    const d = getDimKeys();
    if (!d) return;

    // Variable
    const varEntries = PxLib.entries(voterData, d.info);
    PxLib.fillSelect('voterVarSelect', varEntries);
    // Default to äänestäneet if available
    const votedCode = PxLib.findCode(voterData, d.info, ['äänestäneet'], ['ennakolta', 'prosentti']);
    if (votedCode) el('voterVarSelect').value = votedCode;
  }

  // ## View enable / disable ###################################################################
  async function enableVoterView() {
    try {
      if (!voterData) {
        PxLib.safeSetStatus('Ladataan äänestäjäaineisto…');
        voterData = await PxLib.load(PXWEB_14YV_URL);
        PxLib.safeClearStatus();
      }
      populateDropdowns();
      refreshVoterCharts();
    } catch (err) {
      console.error('[voters]', err);
      PxLib.safeSetStatus('Äänestäjäaineiston lataus epäonnistui', true);
    }
  }


  // ## Event wiring ###################################################################
  function wireEvents() {
    if (wired) return;
    wired = true;
    for (const id of ['voterVarSelect']) {
      el(id)?.addEventListener('change', () => refreshVoterCharts());
    }
  }

  // ## API ###################################################################
  window.enableVoterView = enableVoterView;

  /**
   * Called by app.js whenever yearSelect or geoSelect changes.
   * Silently no-ops if voter data hasn't been loaded yet.
   */
  window.voterRefresh = function voterRefresh() {
    if (voterData) refreshVoterCharts();
  };

  document.addEventListener('DOMContentLoaded', () => { wireEvents(); });
})();
