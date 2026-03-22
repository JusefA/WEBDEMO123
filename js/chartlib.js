/**
 * ChartLib is a chart rendering library so we don't have to repeat the same cyccle of bruteforcing
 * each chart and making the code unnessesarily long n hard to read
 *
 * What does it handle?
 * - Desotry-before-create to avoid redestroying existing chart
 * - FI-fi locale number formatting
 * - Default options for each chart type
 *
 * Chartlib usage:
 *   ChartLib.bar(id, cfg)            vertical bar
 *   ChartLib.horizontalBar(id, cfg)  horizontal bar  (indexAxis: 'y')
 *   ChartLib.line(id, cfg)           line / area
 *   ChartLib.donut(id, cfg)          doughnut % tooltip
 *   ChartLib.mixed(id, cfg)          mixed bar+line
 *   ChartLib.destroy(id)             destroy one chart by canvas id
 *   ChartLib.destroyAll()            the big atomic bomb
 *
 */

(function (global) {
  'use strict';

  // ## Internal registry ##########################################################################
  const _reg = new Map(); // Canvas id is chart instance

  // ## Utilities ##########################################################################

  /** Destroy instances to avoind redestroying existing chart */
  function destroy(id) {
    const inst = _reg.get(id);
    if (inst) {
      try { inst.destroy(); } catch (_) {}
      _reg.delete(id);
    }
  }

  /** warn if missing.*/
  function ctx(id) {
    const el = document.getElementById(id);
    if (!el) { console.warn('[ChartLib] canvas not found:', id); return null; }
    return el.getContext('2d');
  }

  /**
   * merge plain objects.
   * overrides always on top
   */
  function merge(base, overrides) {
    if (!overrides || typeof overrides !== 'object') return base;
    const out = Object.assign({}, base);
    for (const [k, v] of Object.entries(overrides)) {
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = merge(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** Finnish locale num. formatter*/
  function fmtFI(val) {
    const n = Number(val);
    return isNaN(n) ? String(val) : n.toLocaleString('fi-FI');
  }

  // ## def. options ##########################################################################

  /** nrormal options which are shared by every chart*/
  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label || ''}: ${fmtFI(ctx.parsed.y ?? ctx.parsed)}`
          }
        }
      }
    };
  }

  /** Extra def. for bar charts*/
  function barDefaults() {
    return merge(baseOptions(), {
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: fmtFI }
        }
      }
    });
  }

  /** Extra def. for horizontal charts */
  function hBarDefaults() {
    return merge(baseOptions(), {
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: fmtFI }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label || ''}: ${fmtFI(c.parsed.x ?? c.parsed)}`
          }
        }
      }
    });
  }

  /** Line chart def. */
  function lineDefaults() {
    return merge(baseOptions(), {
      scales: {
        y: {
          beginAtZero: false,
          ticks: { callback: fmtFI }
        }
      }
    });
  }

  /**
   * Donut def.
   * Pass options._totalOverride in order to fix denominator for % calc.
   */
  function donutDefaults() {
    return merge(baseOptions(), {
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: function (c) {
              // dataset summed for %
              const data  = c.dataset.data || [];
              const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
              const v     = Number(c.parsed || 0);
              const pct   = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
              return `${c.label}: ${fmtFI(v)} (${pct} %)`;
            }
          }
        }
      }
    });
  }

  // ## Chart construction ##########################################################################

  /**
   * Destroy older version, create, register then return new
   */
  function _make(id, type, defaults, cfg) {
    destroy(id);
    const c = ctx(id);
    if (!c) return null;

    const { labels = [], datasets = [], options = {} } = cfg || {};
    const mergedOptions = merge(defaults, options);

    const instance = new Chart(c, {
      type,
      data: { labels, datasets },
      options: mergedOptions
    });

    _reg.set(id, instance);
    return instance;
  }

  // ## API ##########################################################################
  const ChartLib = {};

  /**
   * z axis bar chart
   * @param {string} id       canvas element id
   * @param {object} cfg      { labels, datasets, options }
   * @returns {Chart|null}
   */
  ChartLib.bar = function bar(id, cfg) {
    return _make(id, 'bar', barDefaults(), cfg);
  };

  /**
   * y axis bar chart
   */
  ChartLib.horizontalBar = function horizontalBar(id, cfg) {
    return _make(id, 'bar', hBarDefaults(), cfg);
  };

  /**
   * Line (trend) chart.
   */
  ChartLib.line = function line(id, cfg) {
    return _make(id, 'line', lineDefaults(), cfg);
  };

  /**
   * donut chart with %
   */
  ChartLib.donut = function donut(id, cfg) {
    return _make(id, 'doughnut', donutDefaults(), cfg);
  };

  /**
   * Mixed chart — primarily a bar but datasets can override `type` individually
   * (e.g. a line overlay on top of stacked bars).
   * Uses bar scales as the default base.
   */
  ChartLib.mixed = function mixed(id, cfg) {
    return _make(id, 'bar', barDefaults(), cfg);
  };

  /**
   * Destroy chart
   */
  ChartLib.destroy = function destroyOne(id) {
    destroy(id);
  };

  /**
   * Destroy all registered charts (e.g. when switching election type).
   */
  ChartLib.destroyAll = function destroyAll() {
    _reg.forEach((_, id) => destroy(id));
  };

  // ## Export ##########################################################################
  global.ChartLib = ChartLib;

})(window);
