// Reads the archive node's status file (docs/WEBSITE_PLAN.md section 8.2 in
// the node repository; written by infra/archive/spek-status.py) into every
// [data-status-url] block. Values are checked and written as text only. A file
// older than five minutes, or a failed fetch, is shown as stale; the last good
// copy is kept in this browser as the fallback. A fresh file whose tip is a
// run of null blocks (no block mined) of five minutes or more is shown as
// stalled: the chain still grows by one null block per slot when no miner is
// online, so height and tip age alone look healthy through an outage.
(function () {
  var STALE_SECS = 300;
  var STALLED_SLOTS = 10;
  var SLOT_SECS = 30;
  var CACHE_KEY = 'spek-status-last';
  var HEX64 = /^[0-9a-f]{64}$/;
  var VERSION = /^[0-9A-Za-z.+_-]{1,40}$/;

  function count(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
  function nullable(v, check) { return v === null || check(v); }
  function signed(v) { return typeof v === 'number' && Number.isSafeInteger(v); }

  function valid(s) {
    return s && s.format === 1 && typeof s.network === 'string' && /^[a-z]{1,16}$/.test(s.network) &&
      count(s.written_unix) && count(s.height) && typeof s.best_hash === 'string' && HEX64.test(s.best_hash) &&
      count(s.tip_age_secs) && count(s.null_streak) && typeof s.null_streak_capped === 'boolean' &&
      typeof s.initial_block_download === 'boolean' &&
      typeof s.node_version === 'string' && VERSION.test(s.node_version) &&
      s.time_sync && typeof s.time_sync.roughtime_synced === 'boolean' &&
      nullable(s.time_sync.last_sync_age_secs, count) && nullable(s.time_sync.last_drift_ms, signed);
  }

  function utc(unix) { return new Date(unix * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'); }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function render(block, s, fetchFailed) {
    var age = Math.max(0, Math.floor(Date.now() / 1000) - s.written_unix);
    var stale = fetchFailed || age > STALE_SECS;
    var stalled = !stale && s.null_streak >= STALLED_SLOTS;
    block.setAttribute('data-state', stale ? 'stale' : (stalled ? 'stalled' : 'fresh'));
    var set = function (name, text) {
      var el = block.querySelector('[data-field="' + name + '"]');
      if (el) el.textContent = text;
    };
    var since = (s.null_streak_capped ? 'more than ' : '') + group(s.null_streak) + ' slots';
    var minutes = Math.floor(s.null_streak * SLOT_SECS / 60);
    var asOf = (stale ? 'Stale: last written ' : 'Written ') + utc(s.written_unix) + (fetchFailed ? ' (status file unreachable, showing the last copy this browser saw)' : '');
    set('as-of', stalled ? 'No block mined in the last ' + since + ' (' + (s.null_streak_capped ? 'over ' : 'about ') + minutes + ' min): every slot closed as a null block. ' + asOf : asOf);
    set('height', group(s.height));
    set('tip-age', group(s.tip_age_secs) + ' s');
    set('last-mined', s.null_streak === 0 ? 'The tip' : since + ' ago');
    set('best-hash', s.best_hash);
    set('version', s.node_version);
    set('sync', s.initial_block_download ? 'Catching up' : 'Following the chain');
    var t = s.time_sync;
    set('roughtime', (t.roughtime_synced ? 'Synced' : 'Not synced') +
      (t.last_sync_age_secs === null ? '' : ', last answer ' + group(t.last_sync_age_secs) + ' s ago') +
      (t.last_drift_ms === null ? '' : ', drift ' + t.last_drift_ms + ' ms'));
    block.hidden = false;
  }

  function cached() {
    try { var s = JSON.parse(window.localStorage.getItem(CACHE_KEY)); return valid(s) ? s : null; } catch (e) { return null; }
  }

  function refresh(block) {
    var url = block.getAttribute('data-status-url');
    fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (s) {
        if (!valid(s)) throw new Error('malformed status file');
        try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
        render(block, s, false);
      })
      .catch(function () {
        var s = cached();
        if (s) render(block, s, true);
        else {
          block.setAttribute('data-state', 'stale');
          var el = block.querySelector('[data-field="as-of"]');
          if (el) el.textContent = 'The status file could not be read.';
          block.hidden = false;
        }
      });
  }

  document.querySelectorAll('[data-status-url]').forEach(function (block) {
    refresh(block);
    window.setInterval(function () { refresh(block); }, 60000);
  });
})();
