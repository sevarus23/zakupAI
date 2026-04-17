/**
 * Sample / demo mode.
 *
 * Clicking "Попробовать на примере" fetches a pre-computed snapshot
 * (samples/sample_result.json) and intercepts API calls for a virtual
 * purchase id. No network traffic hits the real backend for sample data —
 * the aha-moment is instant.
 *
 * Exposes:
 *   window.SAMPLE.isActive()            - bool
 *   window.SAMPLE.enter()               - async, enters sample mode
 *   window.SAMPLE.exit()                - leaves sample mode
 *   window.SAMPLE.fakePurchase()        - returns the synthetic purchase object
 *
 * Internally patches window.API.apiFetch so requests to /purchases/sample/*
 * and /regime/purchases/sample/* resolve from the cached snapshot.
 */
(function () {
  'use strict';

  var SAMPLE_ID = 'sample';
  var SNAPSHOT_URL = '/samples/sample_result.json';

  var state = {
    active: false,
    data: null,
  };

  function remapPurchase(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    var p = Object.assign({}, raw, { id: SAMPLE_ID, custom_name: raw.custom_name || 'Демо: Оргтехника, 4 лота' });
    return p;
  }

  function routeSample(path, method) {
    method = (method || 'GET').toUpperCase();
    var d = state.data;
    if (!d) return null;

    // Strip query string for matching
    var bare = path.split('?')[0];

    // /purchases/sample
    if (bare === '/purchases/' + SAMPLE_ID) {
      return remapPurchase(d.purchase);
    }
    // /purchases/sample/files
    if (bare === '/purchases/' + SAMPLE_ID + '/files') {
      return d.files || [];
    }
    // /purchases/sample/lots or /lots/diagnostics
    if (bare === '/purchases/' + SAMPLE_ID + '/lots') {
      return d.lots;
    }
    if (bare === '/purchases/' + SAMPLE_ID + '/lots/diagnostics') {
      return d.lots_diagnostics;
    }
    // suppliers
    if (bare === '/purchases/' + SAMPLE_ID + '/suppliers') {
      return d.suppliers || [];
    }
    if (bare === '/purchases/' + SAMPLE_ID + '/suppliers/search') {
      return d.suppliers_search || { status: 'idle' };
    }
    // bids
    if (bare === '/purchases/' + SAMPLE_ID + '/bids') {
      return d.bids || [];
    }
    // /purchases/sample/bids/<id>/comparison
    var mCmp = bare.match(new RegExp('^/purchases/' + SAMPLE_ID + '/bids/(\\d+)/comparison$'));
    if (mCmp) {
      var bidId = mCmp[1];
      return (d.comparisons && d.comparisons[bidId]) || { status: 'done', rows: [] };
    }
    if (bare === '/purchases/' + SAMPLE_ID + '/comparison/diagnostics') {
      return d.comparison_diagnostics;
    }
    // regime
    if (bare === '/regime/purchases/' + SAMPLE_ID + '/check') {
      return d.regime_check;
    }
    if (bare === '/regime/purchases/' + SAMPLE_ID + '/check/progress') {
      return d.regime_progress || { status: 'done', percent: 100 };
    }
    if (bare === '/regime/purchases/' + SAMPLE_ID + '/check/diagnostics') {
      return d.regime_diagnostics;
    }
    // dashboard — let through (real user's dashboard still works)
    // POSTs in sample mode are no-ops (return whatever GET would have)
    // (e.g. POST /bids/:id/comparison just triggers UI to re-read)
    return null;
  }

  function patchApi() {
    if (!window.API || window.API._samplePatched) return;
    var origFetch = window.API.apiFetch;
    window.API._samplePatched = true;
    window.API.apiFetch = function (path, options) {
      if (state.active && path && path.indexOf('/' + SAMPLE_ID) !== -1) {
        // Only intercept URLs that contain our sentinel
        var payload = routeSample(path, options && options.method);
        if (payload !== null) {
          return Promise.resolve(payload);
        }
      }
      return origFetch(path, options);
    };
  }

  async function loadSnapshot() {
    if (state.data) return state.data;
    var resp = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
    if (!resp.ok) {
      throw new Error('Не удалось загрузить демо-данные (' + resp.status + '). Сгенерируйте их: python -m scripts.generate_sample');
    }
    state.data = await resp.json();
    return state.data;
  }

  async function enter() {
    await loadSnapshot();
    patchApi();
    state.active = true;
    return remapPurchase(state.data.purchase);
  }

  function exit() {
    state.active = false;
  }

  function fakePurchase() {
    if (!state.data) return null;
    return remapPurchase(state.data.purchase);
  }

  function isActive() { return state.active; }

  window.SAMPLE = {
    enter: enter,
    exit: exit,
    isActive: isActive,
    fakePurchase: fakePurchase,
    SAMPLE_ID: SAMPLE_ID,
  };

  // Auto-patch as soon as API is ready (runs at script load after api.js)
  patchApi();
})();
