/**
 * Lightweight 4-step onboarding tour.
 *
 * Highlights each sidebar tab, shows a tooltip. No dependencies.
 * Exposes:
 *   window.TOUR.start()   - start from step 1
 *   window.TOUR.stop()    - cleanup
 *
 * A debug button in the header (#btn-start-tour) calls start().
 */
(function () {
  'use strict';

  var STEPS = [
    {
      tab: 'dashboard',
      title: 'Мои закупки',
      body: 'Здесь все ваши активные проверки. Начните с загрузки ТЗ или <a href="#" id="tour-try-sample">попробуйте на примере</a>.',
    },
    {
      tab: 'search',
      title: 'Поиск',
      body: 'Ищите новых поставщиков на все лоты.',
    },
    {
      tab: 'comparison',
      title: 'Сравнение',
      body: 'Загружайте КП поставщиков — сервис сравнит их с ТЗ и покажет соответствие.',
    },
    {
      tab: 'regime',
      title: 'Нацрежим',
      body: 'Проверка соответствия по ПП‑719, ПП‑1875.',
    },
  ];

  var STYLE_ID = 'tour-style';
  var TOUR_CSS = [
    '.tour-backdrop{position:fixed;inset:0;z-index:9998;pointer-events:auto;',
    '  background:rgba(10,14,22,.55);backdrop-filter:blur(2px);',
    '  -webkit-backdrop-filter:blur(2px);animation:tour-fade .18s ease-out}',
    '@keyframes tour-fade{from{opacity:0}to{opacity:1}}',
    '.tour-highlight{position:fixed;z-index:9999;pointer-events:none;',
    '  border-radius:12px;box-shadow:0 0 0 9999px rgba(10,14,22,.55),',
    '  0 0 0 2px rgba(99,179,255,.9),0 0 0 6px rgba(99,179,255,.25);',
    '  transition:top .25s ease, left .25s ease, width .25s ease, height .25s ease}',
    '.tour-tooltip{position:fixed;z-index:10000;max-width:320px;',
    '  background:#fff;color:#0a0e16;padding:16px 18px;border-radius:14px;',
    '  box-shadow:0 12px 40px rgba(0,0,0,.25);font-family:Inter,system-ui,sans-serif;',
    '  animation:tour-pop .2s ease-out}',
    '@keyframes tour-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '.tour-tooltip h4{margin:0 0 6px;font-size:15px;font-weight:700;letter-spacing:-.01em}',
    '.tour-tooltip p{margin:0 0 14px;font-size:13px;line-height:1.5;color:#2a3342}',
    '.tour-tooltip p a{color:#2563eb;text-decoration:underline;cursor:pointer}',
    '.tour-footer{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.tour-progress{font-size:11px;color:#6b7280;letter-spacing:.04em;text-transform:uppercase}',
    '.tour-buttons{display:flex;gap:6px}',
    '.tour-btn{border:0;border-radius:8px;padding:7px 14px;font-size:13px;',
    '  font-weight:600;cursor:pointer;font-family:inherit;transition:filter .15s}',
    '.tour-btn:hover{filter:brightness(1.05)}',
    '.tour-btn-ghost{background:transparent;color:#6b7280}',
    '.tour-btn-primary{background:#2563eb;color:#fff}',
    '.tour-close{position:absolute;top:8px;right:10px;background:transparent;border:0;',
    '  font-size:18px;line-height:1;color:#9ca3af;cursor:pointer;padding:4px}',
    '.tour-close:hover{color:#0a0e16}',
  ].join('');

  var stepIdx = 0;
  var active = false;
  var nodes = {};

  function $(id) { return document.getElementById(id); }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = TOUR_CSS;
    document.head.appendChild(el);
  }

  function getTabElement(tabName) {
    return document.querySelector('.sidebar .tab[data-tab="' + tabName + '"]');
  }

  function switchTab(tabName) {
    var tab = getTabElement(tabName);
    if (tab) tab.click();
  }

  function render() {
    var step = STEPS[stepIdx];
    var target = getTabElement(step.tab);
    if (!target) { stop(); return; }

    switchTab(step.tab);

    var rect = target.getBoundingClientRect();
    nodes.highlight.style.top = (rect.top - 4) + 'px';
    nodes.highlight.style.left = (rect.left - 4) + 'px';
    nodes.highlight.style.width = (rect.width + 8) + 'px';
    nodes.highlight.style.height = (rect.height + 8) + 'px';

    nodes.tooltip.innerHTML =
      '<button class="tour-close" aria-label="Закрыть">&times;</button>' +
      '<h4>' + step.title + '</h4>' +
      '<p>' + step.body + '</p>' +
      '<div class="tour-footer">' +
        '<span class="tour-progress">' + (stepIdx + 1) + ' из ' + STEPS.length + '</span>' +
        '<div class="tour-buttons">' +
          (stepIdx > 0 ? '<button class="tour-btn tour-btn-ghost" data-tour-act="prev">Назад</button>' : '') +
          '<button class="tour-btn tour-btn-primary" data-tour-act="next">' +
            (stepIdx === STEPS.length - 1 ? 'Готово' : 'Далее') +
          '</button>' +
        '</div>' +
      '</div>';

    var tipLeft = rect.right + 16;
    var tipTop = rect.top;
    nodes.tooltip.style.visibility = 'hidden';
    nodes.tooltip.style.left = tipLeft + 'px';
    nodes.tooltip.style.top = tipTop + 'px';
    requestAnimationFrame(function () {
      var tipRect = nodes.tooltip.getBoundingClientRect();
      var maxLeft = window.innerWidth - tipRect.width - 12;
      if (tipLeft > maxLeft) {
        tipLeft = Math.max(12, rect.left);
        tipTop = rect.bottom + 12;
        nodes.tooltip.style.left = tipLeft + 'px';
        nodes.tooltip.style.top = tipTop + 'px';
      }
      var maxTop = window.innerHeight - tipRect.height - 12;
      if (tipTop > maxTop) nodes.tooltip.style.top = maxTop + 'px';
      nodes.tooltip.style.visibility = 'visible';
    });

    nodes.tooltip.querySelector('.tour-close').addEventListener('click', stop);
    var nextBtn = nodes.tooltip.querySelector('[data-tour-act="next"]');
    if (nextBtn) nextBtn.addEventListener('click', next);
    var prevBtn = nodes.tooltip.querySelector('[data-tour-act="prev"]');
    if (prevBtn) prevBtn.addEventListener('click', prev);
    var trySample = nodes.tooltip.querySelector('#tour-try-sample');
    if (trySample) {
      trySample.addEventListener('click', function (e) {
        e.preventDefault();
        stop();
        if (typeof window._tryExampleTender === 'function') window._tryExampleTender();
      });
    }
  }

  function next() {
    if (stepIdx < STEPS.length - 1) {
      stepIdx++;
      render();
    } else {
      stop();
    }
  }

  function prev() {
    if (stepIdx > 0) { stepIdx--; render(); }
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  }

  function onResize() { if (active) render(); }

  function start() {
    if (active) return;
    ensureStyle();
    stepIdx = 0;
    active = true;

    nodes.backdrop = document.createElement('div');
    nodes.backdrop.className = 'tour-backdrop';
    nodes.backdrop.addEventListener('click', stop);

    nodes.highlight = document.createElement('div');
    nodes.highlight.className = 'tour-highlight';

    nodes.tooltip = document.createElement('div');
    nodes.tooltip.className = 'tour-tooltip';

    document.body.appendChild(nodes.backdrop);
    document.body.appendChild(nodes.highlight);
    document.body.appendChild(nodes.tooltip);

    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    render();
  }

  function stop() {
    if (!active) return;
    active = false;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize, true);
    for (var k in nodes) {
      if (nodes[k] && nodes[k].parentNode) nodes[k].parentNode.removeChild(nodes[k]);
    }
    nodes = {};
  }

  window.TOUR = { start: start, stop: stop };

  // Wire debug button once DOM is ready
  function wireButton() {
    var btn = document.getElementById('btn-start-tour');
    if (btn && !btn._tourWired) {
      btn._tourWired = true;
      btn.addEventListener('click', start);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButton);
  } else {
    wireButton();
  }
})();
