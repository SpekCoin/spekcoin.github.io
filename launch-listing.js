// Renders the open-launch listings on /launch/ (docs/WEBSITE_PLAN.md section
// 6). Each channel publishes listing-display.txt, one accepted entry per line:
// "<seq> <arrival UTC> <ticket hash or always-pass> <record hex>". Each
// channel section shows its own count; one table ranks the entries of both
// channels together, the way the seal does: lowest ticket hash first (the hash
// read as a 256-bit little-endian integer), one entry per stake program, ties
// by stake program, and the first `seats` entries hold a place for now.
// Without JavaScript the page links to the files themselves. Text is set
// through textContent, never as markup, because the files come from another
// origin. tools/launch.test.mjs runs the parser and the ranking under Node.
(function (root) {
  'use strict';

  var LINE = /^(\d+) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (always-pass|[0-9a-f]{64}) ([0-9a-f]{96})$/;
  // Most rows drawn at once; the search reaches the rest.
  var MAX_ROWS = 2000;
  // Largest part of a file read (a full listing of 2^20 entries is about 200
  // MB; the page shows the head and links to the file). The body is read as a
  // stream and cancelled at this size, so the rest is never downloaded.
  var MAX_BYTES = 4 * 1024 * 1024;

  // The first `maxBytes` of a response body, cut back to a whole line, and
  // whether the body went on past that.
  function readHead(response, maxBytes) {
    var reader = response.body.getReader();
    var chunks = [];
    var total = 0;
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return false;
        var room = maxBytes - total;
        if (result.value.length > room) {
          chunks.push(result.value.subarray(0, room));
          return reader.cancel().then(function () {
            return true;
          });
        }
        chunks.push(result.value);
        total += result.value.length;
        return pump();
      });
    }
    return pump().then(function (truncated) {
      var decoder = new TextDecoder('utf-8');
      var text = '';
      chunks.forEach(function (chunk) {
        text += decoder.decode(chunk, { stream: true });
      });
      text += decoder.decode();
      if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1);
      return { text: text, truncated: truncated };
    });
  }

  function parse(text) {
    var entries = [];
    var rejected = 0;
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === '') continue;
      var m = LINE.exec(lines[i]);
      if (!m || Number(m[1]) !== entries.length + 1) {
        rejected++;
        continue;
      }
      entries.push({ seq: Number(m[1]), arrived: m[2], hash: m[3], stakeProgram: m[4].slice(16, 80), record: m[4] });
    }
    return { entries: entries, rejected: rejected };
  }

  // The hash as a little-endian integer written most significant byte first,
  // so comparing the strings compares the integers.
  function rankKey(hash) {
    var out = '';
    for (var i = hash.length - 2; i >= 0; i -= 2) out += hash.slice(i, i + 2);
    return out;
  }

  // Ranks the entries of every channel together. Each result row is
  // { entry, channels, rank, standing }, where standing is 'seat' (inside the
  // first `seats`), 'out' (ranked below them), 'superseded' (a lower ticket
  // for the same stake program is listed) or 'unranked' (an always-pass test
  // network entry, whose hash the listing does not carry). The same record in
  // both channels is one row.
  function rank(channels, seats) {
    var byRecord = {};
    var rows = [];
    channels.forEach(function (channel) {
      channel.entries.forEach(function (entry) {
        var row = byRecord[entry.record];
        if (row) {
          if (row.channels.indexOf(channel.name) < 0) row.channels.push(channel.name);
          return;
        }
        row = { entry: entry, channels: [channel.name], rank: null, standing: 'unranked' };
        byRecord[entry.record] = row;
        rows.push(row);
      });
    });
    var hashed = rows.filter(function (row) {
      return row.entry.hash !== 'always-pass';
    });
    hashed.forEach(function (row) {
      row.key = rankKey(row.entry.hash);
    });
    hashed.sort(function (a, b) {
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      if (a.entry.stakeProgram !== b.entry.stakeProgram) return a.entry.stakeProgram < b.entry.stakeProgram ? -1 : 1;
      return 0;
    });
    var seen = {};
    var next = 1;
    hashed.forEach(function (row) {
      if (seen[row.entry.stakeProgram]) {
        row.standing = 'superseded';
        return;
      }
      seen[row.entry.stakeProgram] = true;
      row.rank = next++;
      row.standing = row.rank <= seats ? 'seat' : 'out';
    });
    var unranked = rows.filter(function (row) {
      return row.standing === 'unranked';
    });
    var superseded = hashed.filter(function (row) {
      return row.standing === 'superseded';
    });
    var ranked = hashed.filter(function (row) {
      return row.rank !== null;
    });
    return ranked.concat(superseded, unranked);
  }

  // Whether a row matches the search text: a number matches the entry number
  // or the arrival time; anything else is a case-insensitive part of the ticket
  // hash, the stake program, the record or the arrival time.
  function matches(row, query) {
    var q = query.trim().toLowerCase();
    if (q === '') return true;
    var e = row.entry;
    if (/^\d+$/.test(q) && (String(e.seq) === q || (row.rank !== null && String(row.rank) === q))) return true;
    return e.hash.indexOf(q) >= 0 || e.stakeProgram.indexOf(q) >= 0 || e.record.indexOf(q) >= 0 || e.arrived.toLowerCase().indexOf(q) >= 0;
  }

  var STANDING = {
    seat: 'In the first SEATS for now',
    out: 'Below the first SEATS',
    superseded: 'Superseded: this stake program has a lower ticket',
    unranked: 'Not ranked (test network, no hash listed)',
  };

  function cell(row, text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    row.appendChild(td);
  }

  function fetchChannel(section) {
    var url = section.getAttribute('data-listing-url');
    var status = section.querySelector('[data-listing-status]');
    return fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return readHead(response, MAX_BYTES);
      })
      .then(function (head) {
        var parsed = parse(head.text);
        status.textContent =
          parsed.entries.length + (parsed.entries.length === 1 ? ' entry' : ' entries') +
          (head.truncated ? ' read from the start of the file' : '') +
          (parsed.rejected ? '; ' + parsed.rejected + ' unreadable line(s) skipped' : '') + '.';
        return { name: section.getAttribute('data-listing-name'), entries: parsed.entries, truncated: head.truncated, ok: true };
      })
      .catch(function (error) {
        status.textContent = 'The listing could not be loaded here (' + error.message + '); open the file with the link above.';
        return { name: section.getAttribute('data-listing-name'), entries: [], truncated: false, ok: false };
      });
  }

  function renderRanking(target, channels) {
    var seats = Number(target.getAttribute('data-seats'));
    var status = target.querySelector('[data-ranking-status]');
    var search = target.querySelector('[data-ranking-search]');
    var order = target.querySelector('[data-ranking-order]');
    var rows = rank(channels, seats);
    var failed = channels.filter(function (c) {
      return !c.ok;
    });
    var truncated = channels.some(function (c) {
      return c.truncated;
    });
    var note =
      (failed.length ? ' Built without the ' + failed.map(function (c) { return c.name; }).join(' and ') + ' listing, which did not load.' : '') +
      (truncated ? ' A listing was too large to read in full, so entries past its first part are missing from this ranking.' : '');
    if (rows.length === 0) {
      status.textContent = 'No entries yet.' + note;
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    wrap.tabIndex = 0;
    var table = document.createElement('table');
    var head = table.createTHead().insertRow();
    ['Rank', 'Standing', 'Ticket hash', 'Stake program', 'Arrived (UTC)', 'Channel #'].forEach(function (label) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      head.appendChild(th);
    });
    var body = table.createTBody();
    wrap.appendChild(table);
    target.appendChild(wrap);
    var seatText = seats.toLocaleString('en-US');

    function draw() {
      var list = rows;
      if (order.value === 'arrival') {
        list = rows.slice().sort(function (a, b) {
          if (a.entry.arrived !== b.entry.arrived) return a.entry.arrived < b.entry.arrived ? -1 : 1;
          return a.entry.seq - b.entry.seq;
        });
      }
      var shown = list.filter(function (row) {
        return matches(row, search.value);
      });
      while (body.firstChild) body.removeChild(body.firstChild);
      shown.slice(0, MAX_ROWS).forEach(function (row) {
        var tr = body.insertRow();
        if (row.standing !== 'seat') tr.className = 'listing-' + row.standing;
        cell(tr, row.rank === null ? '–' : String(row.rank));
        cell(tr, STANDING[row.standing].replace('SEATS', seatText));
        cell(tr, row.entry.hash, 'data');
        cell(tr, row.entry.stakeProgram, 'data');
        cell(tr, row.entry.arrived.replace('T', ' ').replace('Z', ''));
        cell(tr, row.channels.join(', ') + ' ' + row.entry.seq);
      });
      var held = rows.filter(function (row) {
        return row.standing === 'seat';
      }).length;
      status.textContent =
        rows.length + (rows.length === 1 ? ' entry' : ' entries') + ' in both channels, ' + held + ' in the first ' + seatText + ' for now. ' +
        (search.value.trim() ? shown.length + (shown.length === 1 ? ' matches' : ' match') + ' the search. ' : '') +
        (shown.length > MAX_ROWS ? 'The first ' + MAX_ROWS.toLocaleString('en-US') + ' are shown; search to narrow the list. ' : '') +
        note;
    }
    search.disabled = false;
    order.disabled = false;
    search.addEventListener('input', draw);
    order.addEventListener('change', draw);
    draw();
  }

  root.SpekLaunchListing = { parse: parse, readHead: readHead, rank: rank, rankKey: rankKey, matches: matches };
  if (typeof document === 'undefined') return;
  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-listing-url]'));
  var ranking = document.querySelector('[data-ranking]');
  Promise.all(sections.map(fetchChannel)).then(function (channels) {
    if (ranking) renderRanking(ranking, channels);
  });
})(typeof window === 'undefined' ? this : window);
