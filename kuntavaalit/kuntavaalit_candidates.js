/**
 * municipal_elected_age.js — Kuntavaalit: valitut ikäluokittain (14uh)
 *
 */

(function () {
  const PXWEB_14UH_URL = 'https://pxdata.stat.fi/PxWeb/sq/87230709-adc0-4fb0-a11c-55d4bdd97092';

  let uhData = null;
  let wired  = false;

  const el = id => document.getElementById(id);

  // ## Dimension helpers ##########################################################################
  function getDims() {
    if (!uhData) return null;
    const d      = uhData.dimension || {};
    const ageKey = PxLib.discoverKey(uhData, [/ikä(?!.*vuosi)/i]) || 'Ikäryhmä';
    return {
      year:     d['Vuosi'],
      sex:      d['Ehdokkaan sukupuoli'],
      party:    d['Puolue'],
      age:      d[ageKey],
      ageKey,
      district: d['Vaalipiiri'],
      info:     d['Tiedot']
    };
  }

  // Gender code finders — delegate to PxLib.findCodeOrKey
  const totalSexCode  = () => PxLib.findCodeOrKey(uhData, 'Ehdokkaan sukupuoli', ['yhteensä', 'total', 'SSS']);
  const maleSexCode   = () => PxLib.findCodeOrKey(uhData, 'Ehdokkaan sukupuoli', ['mies', 'miehet', '1']);
  const femaleSexCode = () => PxLib.findCodeOrKey(uhData, 'Ehdokkaan sukupuoli', ['nainen', 'naiset', '2']);

  function ageSortKey(label) {
    const m = String(label).match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  }

  // ## Value lookup ##########################################################################
  function getValue(yearCode, districtCode, partyCode, sexCode, ageCode, infoCode) {
    const dims = getDims();
    if (!dims) return 0;
    return PxLib.get(uhData, {
      Vuosi:                 yearCode,
      'Ehdokkaan sukupuoli': sexCode,
      Puolue:                partyCode,
      [dims.ageKey]:         ageCode,
      Vaalipiiri:            districtCode,
      Tiedot:                infoCode
    }) ?? 0;
  }

  // ## Current selections ##########################################################################
  function selectedIds() {
    return {
      yearCode:     el('uhYearSelect')?.value    || '',
      districtCode: el('uhDistrictSelect')?.value || '',
      partyCode:    el('uhPartySelect')?.value    || '__ALL__',
      genderCode:   el('uhGenderSelect')?.value   || '__TOTAL__',
      infoCode:     el('uhInfoSelect')?.value     || ''
    };
  }

  // ## Series builders ##########################################################################
  function buildPartySeries() {
    const dims = getDims();
    const { yearCode, districtCode, infoCode } = selectedIds();
    const totalCode  = totalSexCode();
    const ageCodes   = PxLib.entries(uhData, dims.ageKey).map(x => x.code);
    const parties    = PxLib.entries(uhData, 'Puolue').filter(x => x.code !== 'SSS');

    return parties.map(({ code, label }) => {
      const value = ageCodes.reduce((s, a) =>
        s + getValue(yearCode, districtCode, code, totalCode, a, infoCode), 0);
      return { party: code, label, value };
    }).sort((a, b) => b.value - a.value);
  }

  function buildSexSeries() {
    const dims = getDims();
    const { yearCode, districtCode, infoCode } = selectedIds();
    const maleCode   = maleSexCode();
    const femaleCode = femaleSexCode();
    const ageCodes   = PxLib.entries(uhData, dims.ageKey).map(x => x.code);
    const parties    = PxLib.entries(uhData, 'Puolue').filter(x => x.code !== 'SSS');

    const combined = parties.map(({ code, label }) => {
      let male = 0, female = 0;
      for (const a of ageCodes) {
        male   += getValue(yearCode, districtCode, code, maleCode,   a, infoCode);
        female += getValue(yearCode, districtCode, code, femaleCode, a, infoCode);
      }
      return { party: code, label, male, female, total: male + female };
    }).sort((a, b) => b.total - a.total);

    return {
      male:   combined.map(x => ({ party: x.party, label: x.label, value: x.male })),
      female: combined.map(x => ({ party: x.party, label: x.label, value: x.female }))
    };
  }

  function buildAgeSeries() {
    const dims = getDims();
    const { yearCode, districtCode, partyCode, genderCode, infoCode } = selectedIds();
    const partyCodes = partyCode === '__ALL__'
      ? PxLib.entries(uhData, 'Puolue').filter(x => x.code !== 'SSS').map(x => x.code)
      : [partyCode];
    const sexCodes = genderCode === '__TOTAL__' ? [totalSexCode()] : [genderCode];

    const ages = PxLib.entries(uhData, dims.ageKey)
      .sort((a, b) => ageSortKey(a.label) - ageSortKey(b.label))
      .filter(e => !PxLib.normalise(e.label).includes('yhteensa')); //filtteroi "yhteensä" pois donitsist ettei näy turhaan

    return ages.map(({ code, label }) => {
      let total = 0;
      for (const p of partyCodes) for (const s of sexCodes) {
        total += getValue(yearCode, districtCode, p, s, code, infoCode);
      }
      return { age: code, label, value: total };
    }).filter(x => x.value > 0);
  }

  // ## Chart drawing ##########################################################################
  function drawPartyBar(series) {
    ChartLib.bar('partyBar', {
      labels:   series.map(s => s.label),
      datasets: [{
        label:           'Valitut',
        data:            series.map(s => s.value),
        backgroundColor: series.map(s => PxLib.PARTY_COLORS[s.party] || '#4aa3ff')
      }],
      options: { plugins: { legend: { display: false } } }
    });
  }

  function drawSexChart({ male, female }) {
    ChartLib.bar('sexBar', {
      labels:   male.map(s => s.label),
      datasets: [
        {
          label:           'Miehet',
          data:            male.map(s => s.value),
          backgroundColor: male.map(s => PxLib.PARTY_COLORS[s.party] || '#4aa3ff')
        },
        {
          label:           'Naiset',
          data:            female.map(s => s.value),
          backgroundColor: female.map(s => PxLib.PARTY_COLORS[s.party] || '#4aa3ff')
        }
      ],
      options: { scales: { x: { stacked: false }, y: { beginAtZero: true } } }
    });
  }

  function drawAgeDonut(series) {
    ChartLib.donut('muniElectedDonut', {
      labels:   series.map(s => s.label),
      datasets: [{
        label:           'Ikäluokat',
        data:            series.map(s => s.value),
        backgroundColor: series.map((_, i) =>
          `hsl(${Math.round((i * 360) / Math.max(1, series.length))}, 70%, 55%)`)
      }]
    });
  }

  // ## Refresh ##########################################################################
  function refreshCharts() {
    if (!uhData) return;

    const partySeries = buildPartySeries();
    const sexSeries   = buildSexSeries();
    const ageSeries   = buildAgeSeries();

    drawPartyBar(partySeries);
    drawSexChart(sexSeries);
    drawAgeDonut(ageSeries);

    const dims         = getDims();
    const totalElected = ageSeries.reduce((s, a) => s + (a.value || 0), 0);

    const countEl = el('kpiCount');
    const partyEl = el('kpiParties');
    const geoEl   = el('kpiGeos');
    if (countEl) countEl.textContent = totalElected.toLocaleString('fi-FI');
    if (partyEl) partyEl.textContent =
      Object.keys(dims.party.category.index).filter(c => c !== 'SSS').length;
    if (geoEl)   geoEl.textContent =
      Object.keys(dims.district.category.index).length;
  }

  // ## Dropdowns ##########################################################################
  function syncDistrictFromBaseGeo() {
    const geoSel = el('geoSelect');
    if (!geoSel) return;
    const baseLabel    = geoSel.options[geoSel.selectedIndex]?.textContent || '';
    const uhDistrict   = el('uhDistrictSelect');
    if (!baseLabel || !uhDistrict) return;
    const target = PxLib.normalise(baseLabel);
    const exact  = [...uhDistrict.options].find(o => PxLib.normalise(o.textContent) === target);
    if (exact)  { uhDistrict.value = exact.value; return; }
    const loose  = [...uhDistrict.options].find(o => {
      const txt = PxLib.normalise(o.textContent);
      return txt && (txt.includes(target) || target.includes(txt));
    });
    if (loose) uhDistrict.value = loose.value;
  }

  function populate14UHDropdowns() {
    const dims = getDims();
    if (!dims) return;

    // Year — default to latest
    PxLib.fillSelect('uhYearSelect', PxLib.entries(uhData, 'Vuosi'));
    const yearSel = el('uhYearSelect');
    if (yearSel && !yearSel.value) {
      yearSel.value = yearSel.options[yearSel.options.length - 1]?.value || '';
    }

    // District
    const prevDist = el('uhDistrictSelect')?.value;
    PxLib.fillSelect('uhDistrictSelect', PxLib.entries(uhData, 'Vaalipiiri'));
    if (!prevDist) syncDistrictFromBaseGeo();

    // Party
    PxLib.fillSelect('uhPartySelect',
      PxLib.entries(uhData, 'Puolue').filter(x => x.code !== 'SSS'),
      { allLabel: 'Kaikki puolueet', allValue: '__ALL__' });

    // Gender
    const genderEntries = PxLib.entries(uhData, 'Ehdokkaan sukupuoli')
      .filter(({ code, label }) =>
        !(PxLib.normalise(label).includes('yhteensa') || code === 'SSS'));
    PxLib.fillSelect('uhGenderSelect', genderEntries,
      { allLabel: 'Yhteensä', allValue: '__TOTAL__' });

    // Info/measure
    PxLib.fillSelect('uhInfoSelect', PxLib.entries(uhData, 'Tiedot'));
  }

  // ## View visibility ##########################################################################
  function updateCardVisibility(enabled) {
    const wrap = el('muniElectedWrap');
    const card = el('muniElectedCard');
    if (wrap) wrap.style.display = enabled ? '' : 'none';
    if (card) card.style.display = enabled ? '' : 'none';
  }

  function active() {
    return el('muniDatasetSelect')?.value === 'candidates';
  }

  async function enable14UHView() {
    if (!uhData) {
      PxLib.safeSetStatus('Ladataan valittuja koskeva aineisto…');
      uhData = await PxLib.load(PXWEB_14UH_URL);
      PxLib.safeClearStatus();
    }
    populate14UHDropdowns();
    updateCardVisibility(true);
    refreshCharts();
    if (typeof window.updateGeoLayer === 'function') {
      try { window.updateGeoLayer(); } catch (_) {}
    }
  }

  function disable14UHView() {
    updateCardVisibility(false);
    ChartLib.destroy('muniElectedDonut');
    ChartLib.destroy('partyBar');
    ChartLib.destroy('sexBar');
    if (typeof window.refreshMunicipalCharts === 'function') {
      try { window.refreshMunicipalCharts(); } catch (_) {}
    }
  }

  // ## Event wiring ##########################################################################
  function wireEvents() {
    if (wired) return;
    wired = true;

    for (const id of ['uhYearSelect', 'uhDistrictSelect', 'uhPartySelect', 'uhGenderSelect', 'uhInfoSelect']) {
      el(id)?.addEventListener('change', () => {
        if (!active()) return;
        refreshCharts();
        if (typeof window.updateGeoLayer === 'function') {
          try { window.updateGeoLayer(); } catch (_) {}
        }
      });
    }
  }

  // ## API ##########################################################################
  window.enableMunicipalElectedAge  = enable14UHView;
  window.disableMunicipalElectedAge = disable14UHView;

  document.addEventListener('DOMContentLoaded', () => {
    wireEvents();
  });
})();
