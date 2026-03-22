/**
 * PxData library for processing the json-stat 2.0 format datasets fetched from PxData.fi
 *
 * This library covers:
 *  - fetch+url cache
 *  - dimension key search
 *  - sorting entries
 *  - Generic value lookup
 *  - code search label
 *  - party volor map
 */

(function (global) {
  'use strict';

  // ## Internal fetch cache ###################################################################
  const _cache = new Map();

  // ## API ###################################################################
  const PxLib = {};

  /**
   * Fetch a PxWeb JSON-stat URL.
   * cache each url so we dont have to redo it everytime
   *
   * @param {string} url
   * @returns {Promise<object>}
   */
  PxLib.load = function load(url) {
    if (_cache.has(url)) return _cache.get(url);

    const promise = fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    })
      .then(res => {
        if (!res.ok) throw new Error('PxLib.load HTTP ' + res.status + ' — ' + url);
        return res.json();
      })
      .catch(err => {
        _cache.delete(url); // retry if err
        return Promise.reject(err);
      });

    _cache.set(url, promise);
    return promise;
  };

  /**
   * Clear the fetch cache (e.g. to force a fresh load in dev).
   * @param {string} [url] — clear just one URL, or all if omitted
   */
  PxLib.clearCache = function clearCache(url) {
    if (url) _cache.delete(url);
    else _cache.clear();
  };

  // ## Dimension helpers ###################################################################

  /**
   * Return the id[] array of a JSON-stat object.
   * @param {object} data
   * @returns {string[]}
   */
  PxLib.ids = function ids(data) {
    return data?.id || [];
  };

  /**
   * Find a dimension key in data.id[] whose name matches one of the given
   * regex patterns.  Returns the first match, or null.
   *
   * @param {object} data
   * @param {(string|RegExp)[]} patterns  — tested in order against each id key
   * @returns {string|null}
   *
   * @example
   *   PxLib.discoverKey(data, [/alue|kunta/i, /municipality/i])
   */
  PxLib.discoverKey = function discoverKey(data, patterns) {
    const ids = PxLib.ids(data);
    for (const pat of patterns) {
      const re = pat instanceof RegExp ? pat : new RegExp(pat, 'i');
      const found = ids.find(k => re.test(k));
      if (found) return found;
    }
    return null;
  };

  /**
   * Return sorted [{code, label}] entries for a dimension category.
   * Sorting is by the category's own index[] ordering, not alphabetical.
   *
   * @param {object} data
   * @param {string} dimKey
   * @returns {{ code: string, label: string }[]}
   */
  PxLib.entries = function entries(data, dimKey) {
    const cat = data?.dimension?.[dimKey]?.category || {};
    const idx = cat.index || {};
    const lbl = cat.label || {};

    return Object.keys(idx)
      .sort((a, b) => idx[a] - idx[b])
      .map(code => ({ code, label: lbl[code] || code }));
  };

  /**
   * Look up a single value from a JSON-stat cube by coordinate.
   * Works for any number of dimensions and any axis ordering.
   *
   * @param {object} data   — full JSON-stat object
   * @param {object} coord  — { [dimKey]: categoryCode, … }
   *                          Every dimension in data.id[] must have an entry.
   * @returns {number|null}  null when the cell is missing or coord is invalid
   *
   * @example
   *   PxLib.get(data, { Vuosi: '2025', Puolue: '03', Tiedot: 'aanet_yht',
   *                      'Maakunta ja kunta': 'MA1', 'Ehdokkaan sukupuoli': 'SSS' })
   */
  PxLib.get = function get(data, coord) {
    const ids   = data.id    || [];
    const sizes = data.size  || [];
    const dims  = data.dimension || {};

    // Pre-compute row-major strides
    const strides = new Array(ids.length);
    let stride = 1;
    for (let k = ids.length - 1; k >= 0; k--) {
      strides[k] = stride;
      stride    *= sizes[k];
    }

    let flatIdx = 0;
    for (let k = 0; k < ids.length; k++) {
      const dimId = ids[k];
      const map   = dims[dimId]?.category?.index;
      const code  = coord[dimId];

      if (code == null) return null; // coord missing this dim

      let pos;
      if (Array.isArray(map)) pos = map.indexOf(String(code));
      else pos = map?.[code];

      if (pos == null || pos < 0) return null; // code not found
      flatIdx += pos * strides[k];
    }

    const raw = data.value?.[flatIdx];
    return raw != null ? Number(raw) : null;
  };

  /**
   * Search a dimension's category labels for a code matching all keywords in
   * `include` while matching none in `exclude`.
   *
   * @param {object}   data
   * @param {string}   dimKey
   * @param {string[]} include  — keywords that must all appear in the label (case-insensitive)
   * @param {string[]} [exclude=[]] — keywords that must NOT appear
   * @returns {string|null}
   *
   * @example
   *   PxLib.findCode(data, 'Tiedot', ['äänestäneet'], ['ennakolta', 'prosentti'])
   */
  PxLib.findCode = function findCode(data, dimKey, include, exclude = []) {
    const cat = data?.dimension?.[dimKey]?.category || {};
    const lbl = cat.label || {};

    for (const [code, label] of Object.entries(lbl)) {
      const t   = String(label).toLowerCase();
      const hit  = include.every(kw => t.includes(kw.toLowerCase()));
      const skip = exclude.some(kw => t.includes(kw.toLowerCase()));
      if (hit && !skip) return code;
    }
    return null;
  };

  /**
   * Like findCode but also tries matching against the code string itself.
   * Useful for gender/sex dimensions where codes are often '1', '2', 'SSS'.
   */
  PxLib.findCodeOrKey = function findCodeOrKey(data, dimKey, keywords, exclude = []) {
    // First try label match
    const byLabel = PxLib.findCode(data, dimKey, keywords, exclude);
    if (byLabel) return byLabel;

    // Fall back: check if any code string matches a keyword exactly
    const cat = data?.dimension?.[dimKey]?.category || {};
    const idx = cat.index || {};
    for (const kw of keywords) {
      if (idx[kw] !== undefined) return kw;
    }
    return null;
  };

  // ## Party colours ###################################################################
  PxLib.PARTY_COLORS = Object.freeze({
    '03': '#E11931', // SDP
    '01': '#0057B7', // KOK
    '02': '#FFD200', // PS
    '05': '#33A532', // VIHR
    '04': '#01954B', // KESK
    '06': '#D40000', // VAS
    '07': '#FFCC00', // RKP
    '08': '#2B4C9A', // KD
    '09': '#CE0F69', // LIIKE
    '16': '#6D6D6D', // LIBE
    '11': '#8B0000', // SKP
    '10': '#4B0082', // AP
    '13': '#444444', // VKK
    '12': '#555555', // KRIP
    '99': '#888888'  // Valitsijayhdistykset
  });

  // ## String utilities ###################################################################

  /**
   * Normalise a Finnish string for fuzzy matching:
   * lowercase → strip diacritics → remove non-alphanumeric.
   */
  PxLib.normalise = function normalise(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  };

  // ## UI helpers ###################################################################

  /**
   * Populate a <select> element from an array of {code, label} entries.
   * Unified replacement for the _fillSelect / fillSelect helpers that were
   * duplicated across app.js, voters.js, and municipal_elected_age.js.
   *
   * @param {string}   id
   * @param {{ code: string, label: string }[]} entries
   * @param {object}   [opts]
   * @param {boolean}  [opts.keepValue=true]      — restore previous value if still present
   * @param {boolean}  [opts.defaultFirst=false]  — select first option when keepValue fails
   * @param {string}   [opts.allLabel]            — prepend an "all" option with this label
   * @param {string}   [opts.allValue='__ALL__']  — value for the "all" option
   * @param {string[]} [opts.skipCodes=[]]        — codes to omit from the list
   */
  PxLib.fillSelect = function fillSelect(id, entries, opts = {}) {
    const { keepValue = true, defaultFirst = false, allLabel, allValue = '__ALL__', skipCodes = [] } = opts;
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    if (allLabel !== undefined) {
      const all = document.createElement('option');
      all.value = allValue; all.textContent = allLabel;
      sel.appendChild(all);
    }
    for (const { code, label } of entries) {
      if (skipCodes.includes(code)) continue;
      const op = document.createElement('option');
      op.value = code; op.textContent = label;
      sel.appendChild(op);
    }
    if (keepValue && prev && [...sel.options].some(o => o.value === prev)) {
      sel.value = prev;
    } else if (defaultFirst && sel.options.length) {
      sel.value = sel.options[0].value;
    }
  };

  /**
   * Safely call the global setStatus / clearStatus helpers defined in elections.js.
   * Falls back to direct DOM manipulation if the globals are not yet available.
   */
  PxLib.safeSetStatus = function safeSetStatus(msg, isError = false) {
    if (typeof setStatus === 'function') { setStatus(msg, isError); return; }
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'inline-block';
    el.style.borderColor = isError ? '#ff6b6b' : '#4aa3ff';
  };

  PxLib.safeClearStatus = function safeClearStatus() {
    if (typeof clearStatus === 'function') { clearStatus(); return; }
    const el = document.getElementById('status');
    if (el) el.style.display = 'none';
  };

  // ## Export ###################################################################
  global.PxLib = PxLib;

})(window);
