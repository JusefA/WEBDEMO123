/**
 * eduskunta_voters.js — Eduskuntavaalit: äänestäjät sukupuolittain (13sv)
 *
 * Mirror of voters.js adapted for parliamentary elections.
 * Uses 13sv which has Sukupuoli (SSS/Miehet/Naiset) but only SSS for Puolue.
 *
 * All HTML element IDs are prefixed 'ed' to avoid conflicts with the
 * municipal voters section.
 *
 * Depends on: PxLib (pxlib.js), ChartLib (chartlib.js)
 */

(function () {
  const ED_URL_VOTERS = 'https://pxdata.stat.fi/PxWeb/sq/548e99e9-e43c-477d-a2d7-0c1f0596612d';
  const ED_AREA_DIM   = 'Vaalipiiri ja kunta vaalivuonna';

  let voterData = null;
  let wired     = false;

  const el = id => document.getElementById(id);

  // ── Dimension key discovery ────────────────────────────────────────────────
  function getDimKeys() {
    if (!voterData) return null;
    return {
      area:   ED_AREA_DIM,
      year:   PxLib.discoverKey(voterData, [/vuosi|year/i]),
      gender: PxLib.discoverKey(voterData, [/sukupuoli/i]),
      info:   PxLib.discoverKey(voterData, [/tiedot/i]),
    };
  }

  // ── Gender code helpers ────────────────────────────────────────────────────
  function genderCodes() {
    const { gender } = getDimKeys();
    return {
      total:  PxLib.findCodeOrKey(voterData, gender, ['yhteensä', 'SSS', 'total']),
      male:   PxLib.findCodeOrKey(voterData, gender, ['miehet', 'mies', '1']),
      female: PxLib.findCodeOrKey(voterData, gender, ['naiset', 'nainen', '2']),
    };
  }

  // ── Current selections ────────────────────────────────────────────────────
  function selectedIds() {
    return {
      areaCode: el('edGeoSelect')?.value || '',
      yearCode: el('edYearSelect')?.value || '',
      infoCode: el('edVoterVarSelect')?.value  || '',
    };
  }

  // ── Value getter ──────────────────────────────────────────────────────────
  function getValue(areaCode, yearCode, gCode, infoCode) {
    const d = getDimKeys();
    if (!d) return 0;
    return PxLib.get(voterData, {
      [d.area]:   areaCode,
      [d.year]:   yearCode,
      [d.gender]: gCode,
      [d.info]:   infoCode,
    }) ?? 0;
  }

  // ── Series builders ───────────────────────────────────────────────────────
  function buildTrendSeries() {
    const d = getDimKeys();
    const { areaCode, infoCode } = selectedIds();
    const { total, male, female } = genderCodes();

    const years = PxLib.entries(voterData, d.year)
      .sort((a, b) => Number(a.code) - Number(b.code));

    return {
      years:  years.map(y => y.label),
      male:   years.map(y => getValue(areaCode, y.code, male,   infoCode)),
      female: years.map(y => getValue(areaCode, y.code, female, infoCode)),
    };
  }

  // ── KPI updater ───────────────────────────────────────────────────────────
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

    const eligibleEl = el('edVoterKpiEligible');
    const votedEl    = el('edVoterKpiVoted');
    const turnoutEl  = el('edVoterKpiTurnout');

    if (eligibleEl) eligibleEl.textContent = eligibleCode
      ? fmt(getValue(areaCode, yearCode, total, eligibleCode)) : '–';
    if (votedEl)    votedEl.textContent    = votedCode
      ? fmt(getValue(areaCode, yearCode, total, votedCode))    : '–';
    if (turnoutEl)  turnoutEl.textContent  = turnoutCode
      ? fmtPct(getValue(areaCode, yearCode, total, turnoutCode)) : '–';
  }

  // ── Chart drawing ─────────────────────────────────────────────────────────
  function drawTrendLine(series) {
    ChartLib.line('edVoterTrendLine', {
      labels:   series.years,
      datasets: [
        { label: 'Miehet', data: series.male,   borderColor: '#4aa3ff',
          backgroundColor: 'rgba(74,163,255,0.08)', tension: 0.3, pointRadius: 5, fill: false },
        { label: 'Naiset', data: series.female, borderColor: '#ff7aa8',
          backgroundColor: 'rgba(255,122,168,0.08)', tension: 0.3, pointRadius: 5, fill: false },
      ],
    });
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  function refreshVoterCharts() {
    if (!voterData) return;
    updateKPIs();
    drawTrendLine(buildTrendSeries());
  }

  // ── Dropdowns ─────────────────────────────────────────────────────────────
  function populateDropdowns() {
    const d = getDimKeys();
    if (!d) return;

    // Variable
    const varEntries = PxLib.entries(voterData, d.info);
    PxLib.fillSelect('edVoterVarSelect', varEntries);
    const votedCode = PxLib.findCode(voterData, d.info, ['äänestäneet'], ['ennakolta', 'prosentti']);
    if (votedCode) el('edVoterVarSelect').value = votedCode;
  }

  // ── View enable / disable ─────────────────────────────────────────────────
  async function enableEdVoterView() {
    try {
      if (!voterData) {
        PxLib.safeSetStatus('Ladataan äänestäjäaineisto (eduskuntavaalit)…');
        voterData = await PxLib.load(ED_URL_VOTERS);
        PxLib.safeClearStatus();
      }
      populateDropdowns();
      refreshVoterCharts();
    } catch (err) {
      console.error('[edVoters]', err);
      PxLib.safeSetStatus('Äänestäjäaineiston lataus epäonnistui', true);
    }
  }


  // ── Event wiring ──────────────────────────────────────────────────────────
  function wireEvents() {
    if (wired) return;
    wired = true;
    for (const id of ['edVoterVarSelect']) {
      el(id)?.addEventListener('change', () => refreshVoterCharts());
    }
  }

  // ── API ───────────────────────────────────────────────────────────────────
  window.enableEdVoterView = enableEdVoterView;

  window.edVoterRefresh = function edVoterRefresh() {
    if (voterData) refreshVoterCharts();
  };

  document.addEventListener('DOMContentLoaded', () => { wireEvents(); });
})();
