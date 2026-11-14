// The slot-election sandbox (docs/WEBSITE_PLAN.md section 14, S4). Draws what
// election-core.js computes: miners with stake outputs, one slot at a time with
// every score hidden until its header is published, the epoch and beacon view,
// and a miner who grinds keys after the beacon is known. No network request;
// the page keeps the static note shown when this script does not run.
(function () {
  'use strict';

  var E = window.SpekElection;
  var host = document.querySelector('[data-election-sandbox]');
  if (!E || !host || typeof BigInt === 'undefined' || !window.crypto || !window.crypto.getRandomValues) return;

  var EPOCH_SLOTS = Number(host.getAttribute('data-epoch-slots')) || 8;
  var MAX_OWNERS = 8;
  var MAX_OUTPUTS = 16;
  var RECENT_BLOCKS = 12;
  var GRIND_ATTEMPTS = 1000;
  var NAMES = 'ABCDEFGH';
  var SVG = 'http://www.w3.org/2000/svg';

  var world;
  var sealed;
  var settled;
  var grindOn = false;
  var grindResult;
  var view = 'slots';
  var target = 1;

  function randomBytes(n) {
    var out = new Uint8Array(n);
    window.crypto.getRandomValues(out);
    return out;
  }

  // ---- DOM helpers (text only: nothing here is ever parsed as markup) -----
  function put(el, children) {
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) put(el, child);
      else el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function make(ns, tag, attrs, children) {
    var el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (var key in attrs || {}) el.setAttribute(key, attrs[key]);
    return put(el, children || []);
  }

  function h(tag, attrs) {
    return make(null, tag, attrs, Array.prototype.slice.call(arguments, 2));
  }

  function s(tag, attrs) {
    return make(SVG, tag, attrs, Array.prototype.slice.call(arguments, 2));
  }

  function replace(el, children) {
    while (el.firstChild) el.removeChild(el.firstChild);
    put(el, children);
  }

  function button(label, onClick, disabled) {
    var el = h('button', { type: 'button', class: 'sb-button' }, label);
    el.disabled = Boolean(disabled);
    el.addEventListener('click', onClick);
    return el;
  }

  function short(bytes) {
    var hex = E.toHex(bytes);
    return h('code', { title: hex }, hex.slice(0, 8) + '…');
  }

  function percent(score) {
    return E.percentOfMax(score) + '% of the maximum';
  }

  function bar(score) {
    var fill = h('span', { class: 'sb-bar-fill' });
    fill.style.inlineSize = Number((score * BigInt(1000)) / E.CENTER) / 10 + '%';
    return h('span', { class: 'sb-bar', role: 'img', 'aria-label': percent(score) }, fill);
  }

  function count(n, noun) {
    return n + ' ' + noun + (n === 1 ? '' : 's');
  }

  function ownerNames() {
    var seen = [];
    world.outputs.forEach(function (output) {
      if (seen.indexOf(output.owner) === -1) seen.push(output.owner);
    });
    return seen;
  }

  function liveOutputs() {
    return world.outputs.filter(function (output) {
      return !output.spent;
    });
  }

  function epochOfNext() {
    return world.sched.epochOf(world.height);
  }

  // ---- Actions -------------------------------------------------------------
  function reset() {
    world = E.createWorld({ epochSlots: EPOCH_SLOTS, randomBytes: randomBytes });
    for (var i = 0; i < 3; i += 1) E.addOutput(world, NAMES[i], true);
    sealed = null;
    settled = null;
    grindResult = null;
    announce('Started again at slot ' + world.height + ' with three miners.');
    render();
  }

  function announce(text) {
    live.textContent = text;
  }

  function advance() {
    sealed = E.sealSlot(world);
    settled = null;
    announce('Slot ' + sealed.height + ': ' + sealed.ranked.length + ' header(s) drawn. Scores are hidden until the headers are published.');
    render();
  }

  function publish() {
    var round = sealed;
    var block = E.commitSlot(world, round);
    settled = { height: round.height, ranked: round.ranked, waiting: round.waiting, block: block };
    sealed = null;
    announce(
      block.winner
        ? 'Slot ' + block.height + ' settled: miner ' + block.winner.output.owner + ' won.'
        : 'Slot ' + block.height + ' settled: nobody could draw, so the null block was built.',
    );
    render();
  }

  function run(count) {
    E.runSlots(world, count);
    var block = world.blocks[world.blocks.length - 1];
    settled = { height: block.height, ranked: null, waiting: [], block: block };
    announce(count + ' slots settled. The next slot is ' + world.height + '.');
    render();
  }

  function addMiner() {
    var owners = ownerNames();
    if (owners.length >= MAX_OWNERS || liveOutputs().length >= MAX_OUTPUTS) return;
    var name = NAMES.split('').filter(function (n) {
      return owners.indexOf(n) === -1;
    })[0];
    E.addOutput(world, name, false);
    announce('Miner ' + name + ' funded a stake output at slot ' + world.height + '. It counts from slot ' + world.sched.firstCounting(world.height) + '.');
    render();
  }

  function addOutput(owner) {
    if (liveOutputs().length >= MAX_OUTPUTS) return;
    E.addOutput(world, owner, false);
    render();
  }

  function spend(output) {
    output.spent = true;
    announce('Stake output ' + output.id + ' was spent: it stops drawing from the next slot.');
    render();
  }

  function grindNow() {
    grindResult = E.grind(world, GRIND_ATTEMPTS, 3);
    announce('Tried ' + GRIND_ATTEMPTS + ' keys against the beacon for slot ' + grindResult.height + '.');
    render();
  }

  function fundGround(candidate) {
    E.addOutput(world, 'G', false, candidate.slotSeed);
    grindResult = null;
    announce('The best ground key was funded at slot ' + world.height + '. Advance slots to see when it first draws.');
    render();
  }

  // ---- Sections ------------------------------------------------------------
  function outputsTable() {
    var busy = Boolean(sealed);
    var rows = world.outputs.map(function (output) {
      var counting = E.counts(world, output, world.height);
      var state = output.spent ? 'spent' : counting ? 'draws' : 'waits';
      var note = output.spent
        ? 'spent'
        : counting
          ? 'draws every slot'
          : 'counts from slot ' + world.sched.firstCounting(output.created);
      return h(
        'tr',
        null,
        h('td', null, output.owner),
        h('td', null, short(output.slotSeed)),
        h('td', null, output.created === 0 ? 'before the demo started' : 'slot ' + output.created),
        h('td', { class: state === 'draws' ? 'sb-ok' : state === 'waits' ? 'sb-wait' : '' }, note),
        h('td', null, output.spent ? '' : button('Spend', function () { spend(output); }, busy)),
      );
    });
    var owners = ownerNames();
    var full = liveOutputs().length >= MAX_OUTPUTS;
    var addRow = owners.map(function (name) {
      return button('Add output to ' + name, function () { addOutput(name); }, busy || full);
    });
    return [
      h('h3', null, 'Stake outputs'),
      h('p', { class: 'sb-hint' }, 'Each stake output has a slot seed: a random 32-byte secret the miner keeps, from which that miner\u2019s slot secrets are derived. One output is one draw per slot.'),
      h(
        'div',
        { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Stake outputs' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Miner'), h('th', null, 'Slot seed'), h('th', null, 'Created'), h('th', null, 'Draws'), h('th', null, ''))),
          h('tbody', null, rows),
        ),
      ),
      h('div', { class: 'sb-actions' }, button('Add miner', addMiner, busy || owners.length >= MAX_OWNERS || full), addRow),
    ];
  }

  function slotPanel() {
    if (sealed) {
      var counted = world.outputs.filter(function (o) {
        return !o.spent && E.counts(world, o, sealed.height);
      });
      return [
        h('h3', null, 'Slot ' + sealed.height + ': headers drawn'),
        sealed.ranked.length === 0
          ? h('p', null, 'No stake output counts in this slot. Every node will build the same null block.')
          : h(
              'ul',
              { class: 'sb-list' },
              counted.map(function (o) {
                return h('li', null, 'Output ' + o.id + ' (miner ' + o.owner + '): score computed, hidden until its header is published.');
              }),
            ),
        sealed.waiting.length > 0
          ? h('p', { class: 'sb-hint' }, count(sealed.waiting.length, 'output') + ' ha' + (sealed.waiting.length === 1 ? 's' : 've') + ' no draw yet: created too recently to count.')
          : null,
      ];
    }
    if (!settled) return [h('h3', null, 'Slot ' + world.height), h('p', null, 'Press Advance slot to draw every counting output against the beacon.')];
    var block = settled.block;
    var title = h('h3', null, 'Slot ' + settled.height + ' settled');
    if (!block.winner) {
      return [title, h('p', { class: 'sb-null' }, 'Null block: nobody could draw. Score 0, no transactions; the election seed still moves on.')];
    }
    if (!settled.ranked) {
      return [title, h('p', null, 'Miner ' + block.winner.output.owner + ' won with ' + percent(block.score) + '.')];
    }
    var rows = settled.ranked.map(function (entry, index) {
      return h(
        'tr',
        null,
        h('td', null, String(index + 1)),
        h('td', null, 'Output ' + entry.output.id + ' (miner ' + entry.output.owner + ')'),
        h('td', null, bar(entry.score), ' ', percent(entry.score)),
        h('td', { title: E.toHex(entry.hash) }, h('code', null, E.toHex(entry.hash).slice(0, 10) + '…')),
        h('td', { class: index === 0 ? 'sb-ok' : '' }, index === 0 ? 'wins' : ''),
      );
    });
    return [
      title,
      h(
        'div',
        { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Ranked headers' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Rank'), h('th', null, 'Draw'), h('th', null, 'Score'), h('th', null, 'Hash'), h('th', null, ''))),
          h('tbody', null, rows),
        ),
      ),
      settled.waiting.length > 0
        ? h('p', { class: 'sb-hint' }, count(settled.waiting.length, 'output') + ' had no draw: created too recently to count.')
        : null,
    ];
  }

  function chainStrip() {
    var recent = world.blocks.slice(-RECENT_BLOCKS);
    return [
      h('h3', null, 'Chain'),
      recent.length === 0
        ? h('p', { class: 'sb-hint' }, 'No slot has settled yet.')
        : h(
            'ol',
            { class: 'sb-chain' },
            recent.map(function (block) {
              return h(
                'li',
                { class: block.winner ? 'sb-block' : 'sb-block sb-block-null' },
                h('strong', null, 'slot ' + block.height),
                h('span', null, block.winner ? 'miner ' + block.winner.output.owner : 'null block'),
                h('span', null, block.winner ? E.percentOfMax(block.score) + '%' : 'score 0'),
              );
            }),
          ),
    ];
  }

  function shareTable() {
    var counting = liveOutputs().filter(function (o) {
      return E.counts(world, o, world.height);
    });
    var rows = ownerNames().map(function (name) {
      var mine = counting.filter(function (o) {
        return o.owner === name;
      }).length;
      var wins = world.wins.get(name) || 0;
      return h(
        'tr',
        null,
        h('td', null, name),
        h('td', null, mine + ' of ' + counting.length),
        h('td', null, wins + ' of ' + world.slots),
      );
    });
    return [
      h('h3', null, 'Win share'),
      h('p', { class: 'sb-hint' }, 'Over many slots, a miner holding N of the M counting outputs wins close to N of every M slots. Press Run 100 slots a few times.'),
      h(
        'div',
        { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Win share' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Miner'), h('th', null, 'Counting outputs'), h('th', null, 'Slots won'))),
          h('tbody', null, rows),
        ),
      ),
      world.nulls > 0 ? h('p', { class: 'sb-hint' }, world.nulls + ' of ' + world.slots + ' slots were null blocks.') : null,
    ];
  }

  // The epoch view: the static figure of the plan, drawn from the live chain.
  function timeline() {
    var L = EPOCH_SLOTS;
    var et = epochOfNext() + target;
    var first = (et - 3) * L;
    var cell = 320 / (4 * L);
    var sched = world.sched;
    var cutoffSlot = (et - 2) * L - 1;
    var beaconSlot = sched.beaconHeight(et);
    var svg = s('svg', { class: 'fig-svg', viewBox: '0 0 360 130', role: 'img', 'aria-labelledby': 'sb-tl-t sb-tl-d' });
    svg.appendChild(s('title', { id: 'sb-tl-t' }, 'Epoch ' + et + ' on the live chain'));
    svg.appendChild(
      s(
        'desc',
        { id: 'sb-tl-d' },
        'Four epochs of ' + L + ' slots. Slots already produced are filled, the next slot is marked, later slots are empty. The stake cutoff for epoch ' + et +
          ' is slot ' + cutoffSlot + ', the beacon height is slot ' + beaconSlot + ', and epoch ' + et + ' starts at slot ' + et * L + '.',
      ),
    );
    for (var i = 0; i < 4 * L; i += 1) {
      var slot = first + i;
      var cls = 'fig-box fig-cell';
      if (slot < world.start) cls = 'fig-history fig-cell';
      else if (slot < world.height) cls = world.blocks[slot - world.start].winner ? 'fig-real fig-cell' : 'fig-null fig-cell';
      else if (slot === world.height) cls = 'fig-now fig-cell';
      svg.appendChild(s('rect', { class: cls, x: 20 + i * cell, y: 44, width: cell, height: 22 }));
    }
    for (var k = 0; k < 4; k += 1) {
      svg.appendChild(s('text', { class: 'fig-text fig-muted', x: 20 + (k * L + L / 2) * cell, y: 82, 'text-anchor': 'middle' }, 'epoch ' + (et - 3 + k)));
    }
    function marker(slotBoundary, label, above, anchor, x) {
      var at = 20 + (slotBoundary - first) * cell;
      var y1 = above ? 36 : 66;
      var y2 = above ? 44 : 98;
      svg.appendChild(s('line', { class: 'fig-line fig-dash', x1: at, y1: y1, x2: at, y2: y2 }));
      svg.appendChild(s('text', { class: 'fig-text', x: x === undefined ? at : x, y: above ? 30 : 112, 'text-anchor': anchor }, label));
    }
    marker(cutoffSlot + 1, 'cutoff: slot ' + cutoffSlot, true, 'start', 24);
    marker(beaconSlot + 1, 'beacon height: slot ' + beaconSlot, false, 'middle');
    marker(et * L, 'B' + et + ' used from slot ' + et * L, true, 'end', 340);
    return svg;
  }

  function epochView() {
    var et = epochOfNext() + target;
    var sched = world.sched;
    var beaconSlot = sched.beaconHeight(et);
    var known = E.beaconFor(world, et);
    var cutoff = (et - 2) * EPOCH_SLOTS - 1;
    var chooser = ['next epoch', 'the epoch after'].map(function (label, index) {
      var el = h('button', { type: 'button', class: 'sb-button', 'aria-pressed': String(target === index + 1) }, label);
      el.addEventListener('click', function () {
        target = index + 1;
        render();
      });
      return el;
    });
    return [
      h('h3', null, 'Where the beacon for an epoch comes from'),
      h('div', { class: 'sb-actions', role: 'group', 'aria-label': 'Epoch to show' }, 'Show ', chooser),
      timeline(),
      h(
        'p',
        null,
        known
          ? 'The beacon for epoch ' + et + ' is already fixed: it is read from the election seed at slot ' + beaconSlot + ', which is produced. B' + et + ' = '
          : 'The beacon for epoch ' + et + ' does not exist yet: it is read from the election seed at slot ' + beaconSlot + ', which is produced in ' + count(beaconSlot - world.height + 1, 'slot') + '.',
        known ? short(known) : null,
      ),
      h('p', null, 'Stake counts for epoch ' + et + ' only if it was created below slot ' + cutoff + ': the stake set froze one full epoch before the beacon height.'),
      grindPanel(),
    ];
  }

  function grindPanel() {
    var toggle = h('input', { type: 'checkbox', id: 'sb-grind' });
    toggle.checked = grindOn;
    toggle.addEventListener('change', function () {
      grindOn = toggle.checked;
      if (!grindOn) grindResult = null;
      render();
    });
    var out = [h('h3', null, 'Try to grind'), h('p', { class: 'sb-hint' }, 'A miner who learns a beacon can try as many keys as it likes against it. This lets one do that.'), h('p', null, toggle, ' ', h('label', { for: 'sb-grind' }, 'Let one miner grind after the beacon is known'))];
    if (!grindOn) return out;
    out.push(h('div', { class: 'sb-actions' }, button('Grind ' + GRIND_ATTEMPTS.toLocaleString('en-US') + ' keys against this slot', grindNow, false)));
    if (!grindResult) return out;
    var g = grindResult;
    var best = g.best[0];
    out.push(
      h('p', null, 'Slot ' + g.height + ', beacon B' + g.epoch + ' = ', short(g.beacon), ' and the best of ' + GRIND_ATTEMPTS.toLocaleString('en-US') + ' fresh keys:'),
      h(
        'ul',
        { class: 'sb-list' },
        g.best.map(function (candidate) {
          return h('li', null, bar(candidate.score), ' ', percent(candidate.score), ' ', short(candidate.publicKey));
        }),
      ),
      h('p', null, 'Best honest draw this slot: ', bar(g.honestBest), ' ', g.honestBest === BigInt(0) ? 'none counts' : percent(g.honestBest), '.'),
      h(
        'p',
        null,
        best.score > g.honestBest ? 'If these keys counted, the best would beat every honest draw. They do not count. ' : 'These keys would not even have won. ',
        'A key funded now (slot ' + g.created + ') is above the cutoff, slot ' + g.cutoff + ', so it has no draw in this epoch. It first counts at slot ' + g.countsFrom +
          ', in epoch ' + g.firstEpoch + ', drawn against B' + g.firstEpoch + ', which is read from the seed at slot ' + g.beaconSlot + ', ' + count(g.slotsUntilBeaconSeed, 'slot') +
          ' from now. The scores above were computed against B' + g.epoch + ' and say nothing about B' + g.firstEpoch + '.',
      ),
      h('div', { class: 'sb-actions' }, button('Fund the best key and watch it wait', function () { fundGround(best); }, liveOutputs().length >= MAX_OUTPUTS || Boolean(sealed))),
    );
    return out;
  }

  // ---- Page ----------------------------------------------------------------
  var live = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  var statusEl = h('p', { class: 'sb-status' });
  var controls = h('div', { class: 'sb-actions' });
  var tabs = h('div', { class: 'sb-actions', role: 'group', 'aria-label': 'Demo view' });
  var slotsView = h('div', { class: 'sb-view' });
  var epochsView = h('div', { class: 'sb-view' });
  var notes = h(
    'details',
    { class: 'sb-notes' },
    h('summary', null, 'What is real here'),
    h(
      'p',
      null,
      'Each score is computed in your browser with the node’s own formula: BLAKE3 of the tag ',
      h('code', null, 'spek/score/v2'),
      ', the beacon, the height as 8 bytes little-endian, an 83-byte key and a 32-byte slot secret, read as a 256-bit integer and measured from the centre of the hash space with BigInt. The election seed and the beacons use the node’s own preimages as well. The script is a one-chunk BLAKE3, checked against the reference implementation.',
    ),
    h(
      'p',
      null,
      'Three things are stand-ins: the 83-byte key (no SQIsign here), the per-height slot secret (a hash of the seed and the height, instead of the committed hash chain), and the history before the demo starts. Epochs are ' + EPOCH_SLOTS + ' slots long instead of 1,440 so that several pass in a minute. The demo starts at the first slot of epoch 3, where beacons are read from seeds.',
    ),
  );

  function render() {
    var e = epochOfNext();
    var beacon = E.beaconFor(world, e);
    replace(statusEl, ['Next slot to elect: ', h('strong', null, String(world.height)), ' (epoch ' + e + '). Beacon B' + e + ': ', short(beacon)]);
    replace(controls, [
      button('Advance slot', advance, Boolean(sealed)),
      button('Publish headers', publish, !sealed),
      button('Run 100 slots', function () { run(100); }, Boolean(sealed)),
      button('Start again', reset, false),
    ]);
    replace(tabs, [
      ['slots', 'Miners and slots'],
      ['epochs', 'Epochs and the beacon'],
    ].map(function (entry) {
      var el = h('button', { type: 'button', class: 'sb-button', 'aria-pressed': String(view === entry[0]) }, entry[1]);
      el.addEventListener('click', function () {
        view = entry[0];
        render();
      });
      return el;
    }));
    slotsView.hidden = view !== 'slots';
    epochsView.hidden = view !== 'epochs';
    replace(slotsView, [slotPanel(), outputsTable(), chainStrip(), shareTable()]);
    replace(epochsView, [epochView()]);
  }

  var fallback = host.querySelector('[data-sandbox-fallback]');
  if (fallback) fallback.remove();
  host.appendChild(h('div', { class: 'sb' }, statusEl, controls, tabs, slotsView, epochsView, notes, live));
  reset();
})();
