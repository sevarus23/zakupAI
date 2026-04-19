(function () {
  'use strict';

  /**
   * Core fetch wrapper with auth and error handling.
   *
   * @param {string}  path              - API path (e.g. "/users/me"), appended to CONFIG.API_URL
   * @param {Object}  [options]
   * @param {string}  [options.method]  - HTTP method (default GET)
   * @param {*}       [options.body]    - Will be JSON-stringified unless it is FormData
   * @param {string}  [options.token]   - Override token (otherwise pulled from localStorage)
   * @returns {Promise<any>}
   */
  async function apiFetch(path, options) {
    var opts = options || {};
    var method = opts.method || 'GET';
    var token = opts.token || localStorage.getItem(CONFIG.TOKEN_KEY);

    var headers = {};
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    var fetchOptions = {
      method: method,
      headers: headers,
    };

    if (opts.body !== undefined) {
      if (opts.body instanceof FormData) {
        fetchOptions.body = opts.body;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(opts.body);
      }
    }

    var response = await fetch(CONFIG.API_URL + path, fetchOptions);

    if (response.status === 401) {
      localStorage.removeItem(CONFIG.TOKEN_KEY);
      localStorage.removeItem(CONFIG.USER_KEY);
      window.location.href = '/login.html';
      return;
    }

    if (!response.ok) {
      var errorBody;
      try {
        errorBody = await response.json();
      } catch (_) {
        errorBody = { detail: response.statusText };
      }
      var err = new Error(errorBody.detail || 'API error ' + response.status);
      err.status = response.status;
      err.body = errorBody;
      throw err;
    }

    // 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * Upload files via multipart/form-data.
   *
   * @param {string}   path      - API path
   * @param {FormData} formData  - FormData with file(s)
   * @param {string}   [token]   - Override token
   * @returns {Promise<any>}
   */
  async function apiUpload(path, formData, token) {
    return apiFetch(path, {
      method: 'POST',
      body: formData,
      token: token,
    });
  }

  /**
   * Convert a tech-task document (docx/pdf) to markdown.
   *
   * When ``purchaseId`` is provided, the upload is routed through the
   * backend (`POST /api/purchases/{id}/files/upload`), which persists the
   * original file to disk and then proxies the bytes to doc-to-md. Without
   * a purchase context the call falls back to direct doc-to-md conversion
   * (used by the admin sandbox tab, which has no ownership).
   */
  async function convertTechTaskFile(file, purchaseId, fileType) {
    var formData = new FormData();
    formData.append('file', file);

    var token = localStorage.getItem(CONFIG.TOKEN_KEY);
    var headers = {};
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    var url;
    if (purchaseId) {
      formData.append('file_type', fileType || 'tz');
      url = CONFIG.API_URL + '/purchases/' + encodeURIComponent(purchaseId) + '/files/upload';
    } else {
      url = CONFIG.DOC_TO_MD_URL + '/convert';
    }

    var response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: formData,
    });

    if (response.status === 401) {
      localStorage.removeItem(CONFIG.TOKEN_KEY);
      localStorage.removeItem(CONFIG.USER_KEY);
      window.location.href = '/login.html';
      return;
    }

    if (!response.ok) {
      var errorBody;
      try {
        errorBody = await response.json();
      } catch (_) {
        errorBody = { detail: response.statusText };
      }
      var err = new Error(errorBody.detail || 'Conversion error ' + response.status);
      err.status = response.status;
      err.body = errorBody;
      throw err;
    }

    var data = await response.json();

    // Track Mistral OCR usage when we went direct to doc-to-md. The backend
    // upload endpoint records usage server-side itself (single source of truth).
    if (!purchaseId && data && data.usage) {
      var trackBody = { usage: data.usage };
      apiFetch('/admin/track-conversion', {
        method: 'POST',
        body: trackBody,
      }).catch(function () { /* ignore tracking errors */ });
    }

    return data;
  }

  window.API = {
    apiFetch: apiFetch,
    apiUpload: apiUpload,
    convertTechTaskFile: convertTechTaskFile,
  };
})();
