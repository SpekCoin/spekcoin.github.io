// Slot clock (docs/WEBSITE_PLAN.md section 7.3). Pure arithmetic on the
// published genesis timestamp and this device's clock; no network request.
// Without JavaScript the component shows the static text the build wrote.
(function (root) {
  var SLOT_MS = 30000;
  var HEADERS_PHASE_SECS = 6;

  // nowMs: milliseconds since the Unix epoch. genesisSecs: integer Unix
  // seconds, or null when genesis is not announced.
  function clockState(nowMs, genesisSecs) {
    if (genesisSecs === null) return { mode: 'unannounced' };
    var elapsedMs = Math.floor(nowMs) - genesisSecs * 1000;
    if (elapsedMs < 0) {
      return { mode: 'countdown', secondsToGenesis: Math.ceil(-elapsedMs / 1000) };
    }
    var slot = Math.floor(elapsedMs / SLOT_MS);
    var secondInSlot = Math.floor((elapsedMs % SLOT_MS) / 1000);
    return {
      mode: 'live',
      slot: slot,
      secondInSlot: secondInSlot,
      secondsRemaining: 30 - secondInSlot,
      phase: secondInSlot < HEADERS_PHASE_SECS ? 'headers' : 'blocks',
    };
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function countdownText(total) {
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    var clock = pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
    return days > 0 ? days + 'd ' + clock : clock;
  }

  root.SpekSlotClock = { clockState: clockState, countdownText: countdownText };

  if (typeof document === 'undefined') return;

  function start(widget) {
    var raw = widget.getAttribute('data-genesis');
    if (raw === null || raw === '' || !/^\d+$/.test(raw)) return;
    var genesis = Number(raw);
    var label = widget.querySelector('[data-clock="label"]');
    var value = widget.querySelector('[data-clock="value"]');
    var detail = widget.querySelector('[data-clock="detail"]');
    var segments = widget.querySelectorAll('[data-segment]');
    var genesisText = widget.getAttribute('data-genesis-text') || '';

    function render() {
      var state = clockState(Date.now(), genesis);
      var lit = -1;
      if (state.mode === 'countdown') {
        widget.setAttribute('data-mode', 'countdown');
        label.textContent = 'Genesis in';
        value.textContent = countdownText(state.secondsToGenesis);
        detail.textContent = 'Genesis at ' + genesisText + '. Computed from this device’s clock.';
      } else {
        widget.setAttribute('data-mode', 'live');
        widget.setAttribute('data-phase', state.phase);
        label.textContent = 'Slot';
        value.textContent = state.slot.toLocaleString('en-US');
        detail.textContent = state.secondsRemaining + ' s left · ' + state.phase + ' phase. Computed from this device’s clock.';
        lit = state.secondInSlot;
      }
      for (var i = 0; i < segments.length; i += 1) {
        if (i <= lit) segments[i].setAttribute('data-on', '');
        else segments[i].removeAttribute('data-on');
      }
      window.setTimeout(render, 1000 - (Date.now() % 1000) + 5);
    }
    render();
  }

  function init() {
    var widgets = document.querySelectorAll('[data-slot-clock]');
    for (var i = 0; i < widgets.length; i += 1) start(widgets[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
