(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  var purchases = [];
  var currentPurchase = null;
  var currentLots = [];
  var currentSuppliers = [];
  var currentBids = [];
  var selectedBidId = null;
  var lotsPollingTimer = null;
  var searchPollingTimer = null;
  var comparisonPollingTimer = null;

  // ── DOM cache ──────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var purchaseList = $('purchase-list');
  var purchaseTitle = $('purchase-title');
  var purchaseStatus = $('purchase-status');
  var purchaseStatusText = $('purchase-status-text');
  var lotsContainer = $('lots-container');
  var suppliersContainer = $('suppliers-container');
  var searchStatus = $('search-status');
  var bidsContainer = $('bids-container');
  var comparisonBidSelector = $('comparison-bid-selector');
  var comparisonResults = $('comparison-results');
  var emailDraft = $('email-draft');

  // ── Utilities ──────────────────────────────────────────────────────

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showMessage('Скопировано в буфер обмена');
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showMessage('Скопировано в буфер обмена'); }
      catch (_) { showError('Не удалось скопировать'); }
      document.body.removeChild(ta);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ── Toasts ─────────────────────────────────────────────────────────

  function showError(msg) {
    var toast = $('error-toast');
    var text = $('error-toast-text');
    text.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toast.classList.add('hidden'); }, 5000);
  }

  function showMessage(msg) {
    var toast = $('message-toast');
    var text = $('message-toast-text');
    text.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toast.classList.add('hidden'); }, 3000);
  }

  // ── Modals ─────────────────────────────────────────────────────────

  function openModal(id) {
    var modal = $(id);
    if (modal) modal.style.display = 'flex';
  }

  function closeModal(id) {
    var modal = $(id);
    if (modal) modal.style.display = 'none';
  }

  function closeAllModals() {
    var overlays = document.querySelectorAll('.modal-overlay');
    for (var i = 0; i < overlays.length; i++) {
      overlays[i].style.display = 'none';
    }
  }

  function initModals() {
    // Close buttons
    var closeBtns = document.querySelectorAll('[data-modal-close]');
    for (var i = 0; i < closeBtns.length; i++) {
      closeBtns[i].addEventListener('click', function () {
        var overlay = this.closest('.modal-overlay');
        if (overlay) overlay.style.display = 'none';
      });
    }
    // Click overlay to close (not modal body)
    var overlays = document.querySelectorAll('.modal-overlay');
    for (var j = 0; j < overlays.length; j++) {
      overlays[j].addEventListener('click', function (e) {
        if (e.target === this) this.style.display = 'none';
      });
    }
  }

  // ── Tabs ───────────────────────────────────────────────────────────

  function initTabs() {
    var btns = document.querySelectorAll('.tab-btn[data-tab]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var tab = this.getAttribute('data-tab');
        // Toggle button active
        var all = document.querySelectorAll('.tab-btn[data-tab]');
        for (var j = 0; j < all.length; j++) {
          all[j].classList.remove('active');
          all[j].setAttribute('aria-selected', 'false');
        }
        this.classList.add('active');
        this.setAttribute('aria-selected', 'true');
        // Toggle panels
        var panels = document.querySelectorAll('.tab-content');
        for (var k = 0; k < panels.length; k++) {
          panels[k].classList.remove('active');
        }
        var panel = $('tab-' + tab);
        if (panel) panel.classList.add('active');
      });
    }
  }

  // ── Sidebar ────────────────────────────────────────────────────────

  function initSidebar() {
    var user = Auth.getUser();
    if (user) {
      $('user-name').textContent = user.full_name || user.email || '';
      $('user-role').textContent = user.is_admin ? 'Администратор' : 'Пользователь';
      $('user-avatar').textContent = (user.full_name || user.email || '?').charAt(0).toUpperCase();
    }
    $('btn-logout').addEventListener('click', function () { Auth.logout(); });
    $('sidebar-toggle').addEventListener('click', function () {
      var sidebar = document.querySelector('.sidebar');
      sidebar.classList.toggle('open');
    });
  }

  // ── Purchase list ──────────────────────────────────────────────────

  async function loadPurchases() {
    try {
      purchases = await API.apiFetch('/purchases');
      renderPurchaseList();
      if (purchases.length > 0 && !currentPurchase) {
        selectPurchase(purchases[0]);
      }
    } catch (e) {
      showError('Не удалось загрузить список закупок: ' + e.message);
    }
  }

  function renderPurchaseList() {
    if (!purchases.length) {
      purchaseList.innerHTML = '<div class="empty-state" style="padding:var(--space-4)"><p class="empty-state-text">Нет закупок</p></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < purchases.length; i++) {
      var p = purchases[i];
      var active = currentPurchase && currentPurchase.id === p.id ? ' active' : '';
      html += '<button type="button" class="sidebar-nav-btn' + active + '" data-purchase-id="' + p.id + '">' +
        '<span class="sidebar-nav-btn-text">' + escapeHtml(p.custom_name || 'Закупка #' + p.id) + '</span>' +
        '<span class="sidebar-nav-btn-date">' + formatDate(p.created_at) + '</span>' +
        '</button>';
    }
    purchaseList.innerHTML = html;
    // Bind clicks
    var btns = purchaseList.querySelectorAll('[data-purchase-id]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-purchase-id'), 10);
        var p = purchases.find(function (x) { return x.id === id; });
        if (p) selectPurchase(p);
      });
    }
  }

  async function selectPurchase(purchase) {
    currentPurchase = purchase;
    clearPolling();
    renderPurchaseList();
    // Update context bar
    purchaseTitle.textContent = purchase.custom_name || 'Закупка #' + purchase.id;
    updateStatusBadge(purchase.status);
    // Load all data
    loadLots();
    loadSuppliers();
    loadBids();
    // Reset comparison
    selectedBidId = null;
    comparisonResults.innerHTML = '';
    $('btn-compare').disabled = true;
  }

  function updateStatusBadge(status) {
    var map = {
      draft: { text: 'Черновик', cls: 'badge-inactive' },
      active: { text: 'Активна', cls: 'badge-active' },
      completed: { text: 'Завершена', cls: 'badge-success' },
    };
    var info = map[status] || { text: status || '--', cls: 'badge-inactive' };
    purchaseStatusText.textContent = info.text;
    purchaseStatus.className = 'badge ' + info.cls;
  }

  // ── Create purchase ────────────────────────────────────────────────

  function initCreatePurchase() {
    $('btn-new-purchase').addEventListener('click', function () {
      openModal('modal-new-purchase');
    });

    $('form-new-purchase').addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = $('inp-purchase-name').value.trim();
      var termsText = $('inp-terms-text').value.trim();
      var fileInput = $('inp-tz-file');
      var file = fileInput.files[0];

      if (!name) { showError('Введите название закупки'); return; }

      try {
        // Convert file if uploaded
        if (file) {
          showMessage('Конвертация документа...');
          var converted = await API.convertTechTaskFile(file);
          if (converted && converted.markdown) {
            termsText = termsText ? termsText + '\n\n' + converted.markdown : converted.markdown;
          }
        }

        var body = { custom_name: name };
        if (termsText) body.terms_text = termsText;
        var newPurchase = await API.apiFetch('/purchases', { method: 'POST', body: body });
        showMessage('Закупка создана');
        closeModal('modal-new-purchase');
        this.reset();
        purchases.unshift(newPurchase);
        selectPurchase(newPurchase);
      } catch (e) {
        showError('Ошибка создания закупки: ' + e.message);
      }
    });
  }

  // ── Lots ───────────────────────────────────────────────────────────

  async function loadLots() {
    if (!currentPurchase) return;
    try {
      var resp = await API.apiFetch('/purchases/' + currentPurchase.id + '/lots');
      var status = resp.status;
      currentLots = resp.lots || [];
      renderLots();
      // Poll if processing
      if (status === 'queued' || status === 'in_progress') {
        lotsPollingTimer = setTimeout(loadLots, 3000);
      }
    } catch (e) {
      showError('Ошибка загрузки лотов: ' + e.message);
    }
  }

  function renderLots() {
    if (!currentLots.length) {
      lotsContainer.innerHTML = '<div class="empty-state"><p class="empty-state-text">Загрузите ТЗ или добавьте лоты вручную</p></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < currentLots.length; i++) {
      var lot = currentLots[i];
      var paramCount = lot.parameters ? lot.parameters.length : 0;
      html += '<div class="lot-card" data-lot-index="' + i + '" style="padding:var(--space-3);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:var(--space-2);cursor:pointer;transition:background .15s">' +
        '<div style="font-weight:500">' + escapeHtml(lot.name) + '</div>' +
        '<div style="font-size:var(--font-size-sm);color:var(--text-muted)">' + paramCount + ' параметр' + pluralParams(paramCount) + '</div>' +
        '</div>';
    }
    lotsContainer.innerHTML = html;
    // Click to show detail
    var cards = lotsContainer.querySelectorAll('.lot-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-lot-index'), 10);
        showLotDetail(currentLots[idx]);
      });
    }
  }

  function pluralParams(n) {
    if (n % 10 === 1 && n % 100 !== 11) return '';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'а';
    return 'ов';
  }

  function showLotDetail(lot) {
    $('lot-detail-name').textContent = lot.name;
    var tbody = $('lot-detail-params-body');
    if (!lot.parameters || !lot.parameters.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Нет параметров</td></tr>';
    } else {
      var html = '';
      for (var i = 0; i < lot.parameters.length; i++) {
        var p = lot.parameters[i];
        html += '<tr><td>' + escapeHtml(p.name) + '</td><td>' + escapeHtml(p.value) + '</td><td>' + escapeHtml(p.units || '') + '</td></tr>';
      }
      tbody.innerHTML = html;
    }
    openModal('modal-lot-detail');
  }

  function initAddLot() {
    $('btn-add-lot').addEventListener('click', function () {
      $('form-add-lot').reset();
      $('lot-params-list').innerHTML = '';
      addLotParamRow();
      openModal('modal-add-lot');
    });

    $('btn-add-lot-param').addEventListener('click', addLotParamRow);

    $('form-add-lot').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!currentPurchase) return;
      var name = $('inp-lot-name').value.trim();
      if (!name) { showError('Введите название лота'); return; }

      var params = [];
      var rows = $('lot-params-list').querySelectorAll('.lot-param-row');
      for (var i = 0; i < rows.length; i++) {
        var inputs = rows[i].querySelectorAll('input');
        var pName = inputs[0].value.trim();
        var pValue = inputs[1].value.trim();
        var pUnits = inputs[2].value.trim();
        if (pName) params.push({ name: pName, value: pValue, units: pUnits });
      }

      try {
        await API.apiFetch('/purchases/' + currentPurchase.id + '/lots', {
          method: 'POST',
          body: { name: name, parameters: params },
        });
        showMessage('Лот добавлен');
        closeModal('modal-add-lot');
        loadLots();
      } catch (e) {
        showError('Ошибка добавления лота: ' + e.message);
      }
    });
  }

  function addLotParamRow() {
    var list = $('lot-params-list');
    var row = document.createElement('div');
    row.className = 'lot-param-row';
    row.style.cssText = 'display:grid;grid-template-columns:2fr 2fr 1fr auto;gap:var(--space-2);margin-bottom:var(--space-2);align-items:center';
    row.innerHTML = '<input type="text" class="form-input" placeholder="Название">' +
      '<input type="text" class="form-input" placeholder="Значение">' +
      '<input type="text" class="form-input" placeholder="Ед. изм.">' +
      '<button type="button" class="btn btn-sm btn-outline" style="color:var(--danger)" title="Удалить">&times;</button>';
    row.querySelector('button').addEventListener('click', function () { row.remove(); });
    list.appendChild(row);
  }

  // ── Supplier search ────────────────────────────────────────────────

  async function loadSuppliers() {
    if (!currentPurchase) return;
    try {
      currentSuppliers = await API.apiFetch('/purchases/' + currentPurchase.id + '/suppliers');
      renderSuppliers();
      // Also check search state
      checkSearchStatus();
    } catch (e) {
      showError('Ошибка загрузки поставщиков: ' + e.message);
    }
  }

  async function checkSearchStatus() {
    if (!currentPurchase) return;
    try {
      var state = await API.apiFetch('/purchases/' + currentPurchase.id + '/suppliers/search');
      if (state && state.status) {
        renderSearchStatus(state);
        if (state.status === 'queued' || state.status === 'in_progress') {
          searchPollingTimer = setTimeout(function () {
            checkSearchStatus();
            loadSuppliers();
          }, 3000);
        }
      }
    } catch (_) {
      // No active search — that's fine
      searchStatus.classList.add('hidden');
    }
  }

  function renderSearchStatus(state) {
    var statusEl = searchStatus;
    statusEl.classList.remove('hidden');
    var statusMap = {
      queued: 'В очереди...',
      in_progress: 'Поиск идёт...',
      done: 'Поиск завершён',
      failed: 'Ошибка поиска',
    };
    var text = statusMap[state.status] || state.status;
    var cls = state.status === 'done' ? 'alert alert-success' :
              state.status === 'failed' ? 'alert alert-danger' :
              'alert alert-info';
    statusEl.className = cls + ' mb-4';
    var extra = '';
    if (state.queries && state.queries.length) {
      extra = '<div style="margin-top:var(--space-2);font-size:var(--font-size-sm)">Запросы: ' +
        state.queries.map(function (q) { return escapeHtml(q); }).join(', ') + '</div>';
    }
    statusEl.innerHTML = '<strong>' + text + '</strong>' + extra;
  }

  function renderSuppliers() {
    var exportBtn = $('btn-export');
    if (!currentSuppliers.length) {
      suppliersContainer.innerHTML = '<div class="empty-state"><p class="empty-state-text">Нажмите «Найти поставщиков» для начала поиска</p></div>';
      exportBtn.classList.add('hidden');
      return;
    }
    exportBtn.classList.remove('hidden');

    var html = '<div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Компания</th><th>Сайт</th><th>Причина</th><th>Контакты</th></tr></thead><tbody>';
    for (var i = 0; i < currentSuppliers.length; i++) {
      var s = currentSuppliers[i];
      var website = s.website_url ? '<a href="' + escapeHtml(s.website_url) + '" target="_blank" rel="noopener">' + escapeHtml(s.website_url) + '</a>' : '—';
      html += '<tr data-supplier-id="' + s.id + '">' +
        '<td style="font-weight:500">' + escapeHtml(s.company_name) + '</td>' +
        '<td>' + website + '</td>' +
        '<td>' + escapeHtml(s.reason || '') + '</td>' +
        '<td class="supplier-contacts" id="contacts-' + s.id + '"><button type="button" class="btn btn-sm btn-outline btn-load-contacts" data-sid="' + s.id + '">Показать</button></td>' +
        '</tr>';
    }
    html += '</tbody></table></div>';
    html += '<div style="margin-top:var(--space-3)"><button type="button" id="btn-add-supplier-open" class="btn btn-sm btn-outline">+ Добавить вручную</button></div>';
    suppliersContainer.innerHTML = html;

    // Bind contact loaders
    var contactBtns = suppliersContainer.querySelectorAll('.btn-load-contacts');
    for (var j = 0; j < contactBtns.length; j++) {
      contactBtns[j].addEventListener('click', function () {
        var sid = this.getAttribute('data-sid');
        loadContacts(sid);
      });
    }

    // Add supplier button
    var addBtn = $('btn-add-supplier-open');
    if (addBtn) addBtn.addEventListener('click', function () { openModal('modal-add-supplier'); });
  }

  async function loadContacts(supplierId) {
    try {
      var contacts = await API.apiFetch('/suppliers/' + supplierId + '/contacts');
      var cell = $('contacts-' + supplierId);
      if (!contacts || !contacts.length) {
        cell.textContent = 'Нет контактов';
        return;
      }
      var html = '';
      for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i];
        html += '<div style="font-size:var(--font-size-sm)">' +
          '<a href="mailto:' + escapeHtml(c.email) + '">' + escapeHtml(c.email) + '</a>' +
          (c.source ? ' <span style="color:var(--text-muted)">(' + escapeHtml(c.source) + ')</span>' : '') +
          '</div>';
      }
      cell.innerHTML = html;
    } catch (e) {
      showError('Ошибка загрузки контактов: ' + e.message);
    }
  }

  function initSupplierSearch() {
    $('btn-search-suppliers').addEventListener('click', async function () {
      if (!currentPurchase) { showError('Выберите закупку'); return; }
      try {
        this.disabled = true;
        var result = await API.apiFetch('/purchases/' + currentPurchase.id + '/suppliers/search', {
          method: 'POST',
          body: { terms_text: currentPurchase.terms_text || '', hints: [] },
        });
        renderSearchStatus(result);
        if (result.status === 'queued' || result.status === 'in_progress') {
          searchPollingTimer = setTimeout(function () {
            checkSearchStatus();
            loadSuppliers();
          }, 3000);
        }
      } catch (e) {
        showError('Ошибка запуска поиска: ' + e.message);
      } finally {
        this.disabled = false;
      }
    });

    $('btn-export').addEventListener('click', async function () {
      if (!currentPurchase) return;
      try {
        var token = Auth.getToken();
        var resp = await fetch(CONFIG.API_URL + '/purchases/' + currentPurchase.id + '/suppliers/export', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!resp.ok) throw new Error('Ошибка экспорта');
        var blob = await resp.blob();
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'suppliers_' + currentPurchase.id + '.xlsx';
        a.click();
        URL.revokeObjectURL(url);
        showMessage('Файл скачан');
      } catch (e) {
        showError('Ошибка экспорта: ' + e.message);
      }
    });
  }

  // ── Add supplier manually ──────────────────────────────────────────

  function initAddSupplier() {
    $('form-add-supplier').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!currentPurchase) return;
      var company = $('inp-supplier-company').value.trim();
      if (!company) { showError('Введите название компании'); return; }

      try {
        var supplier = await API.apiFetch('/purchases/' + currentPurchase.id + '/suppliers', {
          method: 'POST',
          body: {
            company_name: company,
            website_url: $('inp-supplier-website').value.trim() || null,
            reason: $('inp-supplier-reason').value.trim() || null,
          },
        });

        // Add contacts if provided
        var emails = [];
        var e1 = $('inp-supplier-email').value.trim();
        var e2 = $('inp-supplier-email-2').value.trim();
        if (e1) emails.push(e1);
        if (e2) emails.push(e2);
        for (var i = 0; i < emails.length; i++) {
          await API.apiFetch('/suppliers/' + supplier.id + '/contacts', {
            method: 'POST',
            body: { email: emails[i], source: 'manual' },
          });
        }

        showMessage('Поставщик добавлен');
        closeModal('modal-add-supplier');
        this.reset();
        loadSuppliers();
      } catch (e) {
        showError('Ошибка добавления поставщика: ' + e.message);
      }
    });
  }

  // ── Email draft ────────────────────────────────────────────────────

  function initEmailDraft() {
    $('btn-generate-email').addEventListener('click', async function () {
      if (!currentPurchase) { showError('Выберите закупку'); return; }
      try {
        this.disabled = true;
        emailDraft.innerHTML = '<div class="empty-state"><p class="empty-state-text">Генерация письма...</p></div>';
        var result = await API.apiFetch('/purchases/' + currentPurchase.id + '/email-draft', {
          method: 'POST',
        });
        var html = '<div style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--space-4)">' +
          '<div style="margin-bottom:var(--space-3)"><strong>Тема:</strong> ' + escapeHtml(result.subject) + '</div>' +
          '<div style="white-space:pre-wrap;line-height:1.6">' + escapeHtml(result.body) + '</div>' +
          '<div style="margin-top:var(--space-3);display:flex;gap:var(--space-2)">' +
          '<button type="button" class="btn btn-sm btn-outline" id="btn-copy-subject">Копировать тему</button>' +
          '<button type="button" class="btn btn-sm btn-outline" id="btn-copy-body">Копировать текст</button>' +
          '</div></div>';
        emailDraft.innerHTML = html;
        $('btn-copy-subject').addEventListener('click', function () { copyText(result.subject); });
        $('btn-copy-body').addEventListener('click', function () { copyText(result.body); });
      } catch (e) {
        showError('Ошибка генерации письма: ' + e.message);
        emailDraft.innerHTML = '<div class="empty-state"><p class="empty-state-text">Не удалось сгенерировать письмо</p></div>';
      } finally {
        this.disabled = false;
      }
    });
  }

  // ── Bids ───────────────────────────────────────────────────────────

  async function loadBids() {
    if (!currentPurchase) return;
    try {
      currentBids = await API.apiFetch('/purchases/' + currentPurchase.id + '/bids');
      renderBids();
      renderBidSelector();
      populateBidSupplierDropdown();
    } catch (e) {
      showError('Ошибка загрузки КП: ' + e.message);
    }
  }

  function renderBids() {
    if (!currentBids.length) {
      bidsContainer.innerHTML = '<div class="empty-state"><p class="empty-state-text">Коммерческие предложения пока не загружены</p></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < currentBids.length; i++) {
      var bid = currentBids[i];
      var lotCount = bid.lots ? bid.lots.length : 0;
      html += '<div class="card mb-3" style="border:1px solid var(--border)">' +
        '<div class="card-header"><h4 class="card-title" style="font-size:var(--font-size-base)">' +
        escapeHtml(bid.supplier_name || 'Поставщик') + '</h4>' +
        '<span class="tag tag-default">' + lotCount + ' лот' + pluralParams(lotCount) + '</span></div>' +
        '<div class="card-body">';
      if (bid.supplier_contact) {
        html += '<div style="font-size:var(--font-size-sm);color:var(--text-muted);margin-bottom:var(--space-2)">Контакт: ' + escapeHtml(bid.supplier_contact) + '</div>';
      }
      if (bid.lots && bid.lots.length) {
        html += '<div class="table-wrap"><table class="table table-compact"><thead><tr><th>Позиция</th><th>Цена</th></tr></thead><tbody>';
        for (var j = 0; j < bid.lots.length; j++) {
          var bl = bid.lots[j];
          html += '<tr><td>' + escapeHtml(bl.name) + '</td><td>' + (bl.price != null ? bl.price.toLocaleString('ru-RU') : '—') + '</td></tr>';
        }
        html += '</tbody></table></div>';
      }
      html += '</div></div>';
    }
    bidsContainer.innerHTML = html;
  }

  function renderBidSelector() {
    if (!currentBids.length) {
      comparisonBidSelector.innerHTML = '<div class="empty-state"><p class="empty-state-text">Сначала загрузите коммерческие предложения во вкладке «Письма и КП»</p></div>';
      $('btn-compare').disabled = true;
      return;
    }
    var html = '<div style="display:flex;flex-wrap:wrap;gap:var(--space-3)">';
    for (var i = 0; i < currentBids.length; i++) {
      var bid = currentBids[i];
      var selected = selectedBidId === bid.id ? ' border-color:var(--primary);background:var(--primary-light,rgba(37,99,235,0.05))' : '';
      html += '<div class="bid-select-card" data-bid-id="' + bid.id + '" style="padding:var(--space-3);border:2px solid var(--border);border-radius:var(--radius);cursor:pointer;min-width:180px;transition:all .15s;' + selected + '">' +
        '<div style="font-weight:500">' + escapeHtml(bid.supplier_name || 'Поставщик') + '</div>' +
        '<div style="font-size:var(--font-size-sm);color:var(--text-muted)">' + (bid.lots ? bid.lots.length : 0) + ' позиций</div>' +
        '</div>';
    }
    html += '</div>';
    comparisonBidSelector.innerHTML = html;

    var cards = comparisonBidSelector.querySelectorAll('.bid-select-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function () {
        selectedBidId = parseInt(this.getAttribute('data-bid-id'), 10);
        $('btn-compare').disabled = false;
        renderBidSelector();
      });
    }
  }

  function populateBidSupplierDropdown() {
    var select = $('inp-bid-supplier-select');
    var options = '<option value="">-- Выберите поставщика --</option>';
    for (var i = 0; i < currentSuppliers.length; i++) {
      var s = currentSuppliers[i];
      options += '<option value="' + s.id + '">' + escapeHtml(s.company_name) + '</option>';
    }
    select.innerHTML = options;
  }

  function initAddBid() {
    $('btn-add-bid').addEventListener('click', function () {
      $('form-add-bid').reset();
      populateBidSupplierDropdown();
      openModal('modal-add-bid');
    });

    $('form-add-bid').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!currentPurchase) return;

      var supplierSelect = $('inp-bid-supplier-select');
      var supplierId = supplierSelect.value ? parseInt(supplierSelect.value, 10) : null;
      var supplierName = $('inp-bid-supplier-name').value.trim();
      var supplierContact = $('inp-bid-supplier-contact').value.trim();
      var bidText = $('inp-bid-text').value.trim();
      var fileInput = $('inp-bid-file');
      var file = fileInput.files[0];

      if (!supplierName && !supplierId) {
        showError('Выберите или введите поставщика');
        return;
      }

      // If supplier selected from dropdown, get name
      if (supplierId && !supplierName) {
        var found = currentSuppliers.find(function (s) { return s.id === supplierId; });
        if (found) supplierName = found.company_name;
      }

      try {
        // Convert file if uploaded
        if (file) {
          showMessage('Конвертация документа...');
          var converted = await API.convertTechTaskFile(file);
          if (converted && converted.markdown) {
            bidText = bidText ? bidText + '\n\n' + converted.markdown : converted.markdown;
          }
        }

        if (!bidText) { showError('Введите текст КП или загрузите файл'); return; }

        var body = {
          bid_text: bidText,
          supplier_name: supplierName,
          supplier_contact: supplierContact || null,
        };
        if (supplierId) body.supplier_id = supplierId;

        await API.apiFetch('/purchases/' + currentPurchase.id + '/bids', {
          method: 'POST',
          body: body,
        });
        showMessage('КП загружено');
        closeModal('modal-add-bid');
        this.reset();
        loadBids();
      } catch (e) {
        showError('Ошибка загрузки КП: ' + e.message);
      }
    });
  }

  // ── Comparison ─────────────────────────────────────────────────────

  function initComparison() {
    $('btn-compare').addEventListener('click', async function () {
      if (!currentPurchase || !selectedBidId) return;
      try {
        this.disabled = true;
        comparisonResults.innerHTML = '<div class="empty-state"><p class="empty-state-text">Сравнение запущено...</p></div>';
        await API.apiFetch('/purchases/' + currentPurchase.id + '/bids/' + selectedBidId + '/comparison', {
          method: 'POST',
        });
        pollComparison();
      } catch (e) {
        showError('Ошибка запуска сравнения: ' + e.message);
        this.disabled = false;
      }
    });
  }

  async function pollComparison() {
    if (!currentPurchase || !selectedBidId) return;
    try {
      var result = await API.apiFetch('/purchases/' + currentPurchase.id + '/bids/' + selectedBidId + '/comparison');
      if (result.status === 'queued' || result.status === 'in_progress') {
        comparisonResults.innerHTML = '<div class="empty-state"><p class="empty-state-text">Сравнение в процессе...</p></div>';
        comparisonPollingTimer = setTimeout(pollComparison, 3000);
      } else if (result.status === 'done') {
        renderComparison(result.rows || []);
        $('btn-compare').disabled = false;
      } else {
        comparisonResults.innerHTML = '<div class="alert alert-danger">Ошибка сравнения</div>';
        $('btn-compare').disabled = false;
      }
    } catch (e) {
      showError('Ошибка получения результатов сравнения: ' + e.message);
      $('btn-compare').disabled = false;
    }
  }

  function renderComparison(rows) {
    if (!rows.length) {
      comparisonResults.innerHTML = '<div class="empty-state"><p class="empty-state-text">Нет данных для сравнения</p></div>';
      return;
    }

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var confPercent = row.confidence != null ? Math.round(row.confidence * 100) : null;
      var confBadge = confPercent != null ? '<span class="tag tag-default">' + confPercent + '%</span>' : '';

      html += '<div class="card mb-4" style="border:1px solid var(--border)">' +
        '<div class="card-header">' +
        '<div><strong>ТЗ:</strong> ' + escapeHtml(row.lot_name) + ' &mdash; <strong>КП:</strong> ' + escapeHtml(row.bid_lot_name || '—') + '</div>' +
        confBadge +
        '</div>';

      if (row.characteristic_rows && row.characteristic_rows.length) {
        html += '<div class="card-body" style="padding:0"><div class="table-wrap"><table class="table table-compact">' +
          '<thead><tr><th style="width:45%">Требование ТЗ</th><th style="width:45%">Предложение КП</th><th style="width:10%">Статус</th></tr></thead><tbody>';
        for (var j = 0; j < row.characteristic_rows.length; j++) {
          var cr = row.characteristic_rows[j];
          var colorMap = {
            matched: 'background:var(--success-light, rgba(34,197,94,0.1))',
            unmatched_tz: 'background:var(--danger-light, rgba(239,68,68,0.1))',
            unmatched_kp: 'background:var(--gray-light, rgba(156,163,175,0.1))',
          };
          var statusLabel = {
            matched: 'Совпадает',
            unmatched_tz: 'Нет в КП',
            unmatched_kp: 'Нет в ТЗ',
          };
          var style = colorMap[cr.status] || '';
          html += '<tr style="' + style + '">' +
            '<td>' + escapeHtml(cr.left_text || '') + '</td>' +
            '<td>' + escapeHtml(cr.right_text || '') + '</td>' +
            '<td><span class="tag ' + (cr.status === 'matched' ? 'tag-success' : cr.status === 'unmatched_tz' ? 'tag-danger' : 'tag-default') + '">' +
            (statusLabel[cr.status] || cr.status) + '</span></td></tr>';
        }
        html += '</tbody></table></div></div>';
      }

      if (row.reason) {
        html += '<div class="card-body" style="border-top:1px solid var(--border);font-size:var(--font-size-sm);color:var(--text-muted)">' + escapeHtml(row.reason) + '</div>';
      }
      html += '</div>';
    }
    comparisonResults.innerHTML = html;
  }

  // ── Polling cleanup ────────────────────────────────────────────────

  function clearPolling() {
    if (lotsPollingTimer) { clearTimeout(lotsPollingTimer); lotsPollingTimer = null; }
    if (searchPollingTimer) { clearTimeout(searchPollingTimer); searchPollingTimer = null; }
    if (comparisonPollingTimer) { clearTimeout(comparisonPollingTimer); comparisonPollingTimer = null; }
  }

  // ── Init ───────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    initModals();
    initTabs();
    initSidebar();
    initCreatePurchase();
    initAddLot();
    initSupplierSearch();
    initAddSupplier();
    initEmailDraft();
    initAddBid();
    initComparison();
    loadPurchases();
  });

})();
