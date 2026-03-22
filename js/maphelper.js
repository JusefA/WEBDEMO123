/**
 * MapHelper — shared Leaflet map utilities
 *
 * Extracts the map initialisation, GeoJSON loading, layer colouring,
 * selection/highlight, and geo-lookup logic that was previously duplicated
 * between app.js (municipal elections) and president.js (presidential elections).
 *
 * Depends on: Leaflet (L), PxLib (pxlib.js)
 */

(function (global) {
  'use strict';

  const MapHelper = {};

  // Finland bounding box used by both municipal and presidential maps
  const FI_BOUNDS = L.latLngBounds([59.5, 19.0], [70.2, 31.6]);

  /**
   * Create a Leaflet map inside containerId, add the OSM tile layer,
   * and fit to Finland.  Returns null if the container does not exist.
   *
   * @param {string} containerId
   * @returns {L.Map|null}
   */
  MapHelper.create = function create(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return null;
    const map = L.map(containerId);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12, minZoom: 3
    }).addTo(map);
    map.fitBounds(FI_BOUNDS);
    return map;
  };

  /**
   * Fetch a GeoJSON URL, build a Leaflet GeoJSON layer, and add it to the map.
   *
   * @param {L.Map}     map
   * @param {string}    url
   * @param {Function}  [onEachFeature]  — passed directly to L.geoJSON
   * @param {Function}  [styleFunc]      — optional initial style; defaults to dark placeholder
   * @returns {Promise<L.GeoJSON>}
   */
  MapHelper.loadGeoJSON = async function loadGeoJSON(map, url, onEachFeature, styleFunc) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('GeoJSON load failed: ' + url);
    const geo   = await resp.json();
    const layer = L.geoJSON(geo, {
      style:         styleFunc || (() => ({ color: '#333', weight: 0.6, fillColor: '#222', fillOpacity: 0.5 })),
      onEachFeature: onEachFeature || undefined
    });
    layer.addTo(map);
    return layer;
  };

  /**
   * Paint every feature in a GeoJSON layer using getColor(feature) → CSS color.
   * Accepts an optional selectedRef so the white-border highlight on the
   * currently selected layer is re-applied after the full repaint.
   *
   * @param {L.GeoJSON}                    layer
   * @param {Function}                     getColor     — (feature) => CSS color string
   * @param {{ current: L.Layer|null }}    [selectedRef]
   */
  MapHelper.colorLayer = function colorLayer(layer, getColor, selectedRef) {
    if (!layer) return;
    layer.eachLayer(l => {
      const color = getColor(l.feature) || '#333';
      l.setStyle({ color: '#111', weight: 0.6, fillColor: color, fillOpacity: 0.78 });
    });
    // Re-apply highlight border if a layer was already selected
    if (selectedRef?.current) {
      selectedRef.current.setStyle({ color: '#ffffff', weight: 2.5, fillOpacity: 1 });
      try { selectedRef.current.bringToFront(); } catch (_) {}
    }
  };

  /**
   * Highlight a clicked layer with a white border, restoring the previous
   * selection to its choropleth fill color.  The fill color is taken from
   * layer.options.fillColor, which colorLayer always keeps current.
   *
   * @param {{ current: L.Layer|null }} prevRef  — mutable object holding the last selection
   * @param {L.Layer}                  layer     — the newly selected layer
   */
  MapHelper.selectLayer = function selectLayer(prevRef, layer) {
    if (!layer) return;
    // Restore the previously selected layer to its choropleth colour
    if (prevRef.current && prevRef.current !== layer) {
      const storedColor = prevRef.current.options?.fillColor || '#333';
      prevRef.current.setStyle({ color: '#111', weight: 0.6, fillColor: storedColor, fillOpacity: 0.78 });
    }
    prevRef.current = layer;
    const fillColor = layer.options?.fillColor || '#4aa3ff';
    layer.setStyle({ color: '#ffffff', weight: 2.5, fillColor, fillOpacity: 1 });
    try { if (layer.bringToFront) layer.bringToFront(); } catch (_) {}
  };

  /**
   * Build normalised label→code and code→label lookup maps from a PxLib
   * JSON-stat dimension.  Used to match GeoJSON feature names to dataset codes.
   *
   * @param {object} data    — JSON-stat data object
   * @param {string} dimKey  — dimension key (e.g. 'Alue')
   * @returns {{ labelToCode: object, codeToLabel: object }}
   */
  MapHelper.buildGeoLookups = function buildGeoLookups(data, dimKey) {
    const geoDim     = data.dimension?.[dimKey]?.category?.label || {};
    const labelToCode = {};
    const codeToLabel = {};
    for (const [code, label] of Object.entries(geoDim)) {
      codeToLabel[code]                   = label;
      labelToCode[PxLib.normalise(label)] = code;
    }
    return { labelToCode, codeToLabel };
  };

  /**
   * Resolve a GeoJSON feature to its dataset geo code using name-based
   * lookups first, then direct code-property fallbacks.
   *
   * @param {object} feature        — GeoJSON feature
   * @param {object} labelToCode    — normalised label → code
   * @param {object} [codeToLabel]  — code → label (for validation fallback)
   * @returns {string|null}
   */
  MapHelper.findGeoCode = function findGeoCode(feature, labelToCode, codeToLabel) {
    if (!labelToCode) return null;
    const candidates = [
      feature.properties?.NAMEFIN,
      feature.properties?.NAME,
      feature.properties?.name
    ].filter(Boolean);
    for (const n of candidates) {
      const code = labelToCode[PxLib.normalise(n)];
      if (code) return code;
    }
    for (const f of ['KUNTANRO', 'KUNTA', 'code', 'ID', 'id']) {
      const v = feature.properties?.[f];
      if (v && codeToLabel?.[String(v)]) return String(v);
    }
    return null;
  };

  /**
   * Pan and zoom the map to the layer whose name matches the selected code.
   * Returns the matched Leaflet layer (or null) so the caller can highlight it.
   *
   * @param {L.Map}     map
   * @param {L.GeoJSON} layer
   * @param {string}    selCode
   * @param {object}    codeToLabel
   * @returns {L.Layer|null}
   */
  MapHelper.syncToSelection = function syncToSelection(map, layer, selCode, codeToLabel) {
    if (!layer || !codeToLabel) return null;
    const label = codeToLabel[selCode];
    if (!label) return null;
    const target = PxLib.normalise(label);
    let found = null;
    layer.eachLayer(l => {
      const name = l.feature?.properties?.NAMEFIN
        || l.feature?.properties?.NAME
        || l.feature?.properties?.name || '';
      if (PxLib.normalise(name) === target) found = l;
    });
    if (found) {
      try { map.fitBounds(found.getBounds(), { maxZoom: 9 }); } catch (_) {}
    }
    return found;
  };

  // ── Export ───────────────────────────────────────────────────────────────────
  global.MapHelper = MapHelper;

})(window);
