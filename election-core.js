// Slot-election arithmetic for the sandbox on /how-it-works/slot-election/
// (docs/WEBSITE_PLAN.md section 14, S4). No DOM and no network: the page script
// election-sandbox.js draws what this file computes, and tools/election.test.mjs
// runs it under Node against vectors produced by the reference blake3 crate.
//
// The score, the beacon and the election-seed step use the exact preimages of
// the node (spek-core election.rs and blockheader.rs): ASCII domain tag, then
// 32-byte hashes, heights and epochs as 8-byte little-endian integers, public
// keys as 83 bytes and slot secrets as 32 bytes. The score is the middle-out
// distance of the hash read as a big-endian 256-bit integer, in BigInt.
//
// Three things are stand-ins, because the sandbox has no SQIsign and no
// 8.4-year horizon: the 83-byte public key, the per-height slot secret, and
// the history before the sandbox starts. Each is derived from the slot seed
// under a "spek-sandbox/" tag so it can never be mistaken for a protocol value.
(function (root) {
  'use strict';

  // ---- BLAKE3, one chunk -------------------------------------------------
  // The inputs here are at most 168 bytes, so only the single-chunk path of
  // BLAKE3 is needed: every block of the chunk is compressed in order, and the
  // last block carries the ROOT flag. Longer input is refused, not hashed wrong.
  var IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
  var CHUNK_START = 1;
  var CHUNK_END = 2;
  var ROOT = 8;
  var CHUNK_BYTES = 1024;
  var BLOCK_BYTES = 64;

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function mix(v, a, b, c, d, x, y) {
    v[a] = v[a] + v[b] + x;
    v[d] = rotr(v[d] ^ v[a], 16);
    v[c] = v[c] + v[d];
    v[b] = rotr(v[b] ^ v[c], 12);
    v[a] = v[a] + v[b] + y;
    v[d] = rotr(v[d] ^ v[a], 8);
    v[c] = v[c] + v[d];
    v[b] = rotr(v[b] ^ v[c], 7);
  }

  // One block through the compression function, starting from the running
  // chaining value (the IV for the first block of the chunk).
  function compress(value, words, blockLen, flags) {
    var v = new Uint32Array(16);
    var m = words;
    var i;
    for (i = 0; i < 8; i += 1) v[i] = value[i];
    for (i = 0; i < 4; i += 1) v[8 + i] = IV[i];
    v[14] = blockLen;
    v[15] = flags;
    for (var round = 0; round < 7; round += 1) {
      mix(v, 0, 4, 8, 12, m[0], m[1]);
      mix(v, 1, 5, 9, 13, m[2], m[3]);
      mix(v, 2, 6, 10, 14, m[4], m[5]);
      mix(v, 3, 7, 11, 15, m[6], m[7]);
      mix(v, 0, 5, 10, 15, m[8], m[9]);
      mix(v, 1, 6, 11, 12, m[10], m[11]);
      mix(v, 2, 7, 8, 13, m[12], m[13]);
      mix(v, 3, 4, 9, 14, m[14], m[15]);
      if (round < 6) {
        var next = new Uint32Array(16);
        for (i = 0; i < 16; i += 1) next[i] = m[PERMUTATION[i]];
        m = next;
      }
    }
    for (i = 0; i < 8; i += 1) v[i] ^= v[i + 8];
    return v;
  }

  function blake3(input) {
    if (input.length > CHUNK_BYTES) throw new Error('single-chunk BLAKE3: input over ' + CHUNK_BYTES + ' bytes');
    var blocks = Math.max(1, Math.ceil(input.length / BLOCK_BYTES));
    var value = new Uint32Array(IV);
    for (var b = 0; b < blocks; b += 1) {
      var start = b * BLOCK_BYTES;
      var length = Math.min(BLOCK_BYTES, input.length - start);
      var words = new Uint32Array(16);
      for (var i = 0; i < length; i += 1) words[i >> 2] |= input[start + i] << (8 * (i & 3));
      var flags = (b === 0 ? CHUNK_START : 0) | (b === blocks - 1 ? CHUNK_END | ROOT : 0);
      value = compress(value, words, length, flags);
    }
    var out = new Uint8Array(32);
    for (var w = 0; w < 8; w += 1) {
      out[4 * w] = value[w] & 255;
      out[4 * w + 1] = (value[w] >>> 8) & 255;
      out[4 * w + 2] = (value[w] >>> 16) & 255;
      out[4 * w + 3] = value[w] >>> 24;
    }
    return out;
  }

  // ---- Byte helpers ------------------------------------------------------
  function ascii(text) {
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
    return out;
  }

  function concat(parts) {
    var total = 0;
    var i;
    for (i = 0; i < parts.length; i += 1) total += parts[i].length;
    var out = new Uint8Array(total);
    var at = 0;
    for (i = 0; i < parts.length; i += 1) {
      out.set(parts[i], at);
      at += parts[i].length;
    }
    return out;
  }

  // An 8-byte little-endian integer, as the node writes heights and epochs.
  function u64le(n) {
    var out = new Uint8Array(8);
    var rest = n;
    for (var i = 0; i < 8; i += 1) {
      out[i] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    return out;
  }

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 1) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  function fromHex(text) {
    var out = new Uint8Array(text.length / 2);
    for (var i = 0; i < out.length; i += 1) out[i] = parseInt(text.substr(2 * i, 2), 16);
    return out;
  }

  function hashOf(parts) {
    return blake3(concat(parts));
  }

  function compareBytes(a, b) {
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }

  // ---- The score ---------------------------------------------------------
  var CENTER = BigInt(1) << BigInt(255);
  var ONE = BigInt(1);

  function bigOf(hash) {
    return BigInt('0x' + toHex(hash));
  }

  // The distance of the hash from the centre of the 256-bit space, in [1, 2^255].
  // 0x00..00 and 0xFF..FF score 2^255; 0x7F..FF and 0x80..00 score 1.
  function middleOut(hash) {
    var x = bigOf(hash);
    return x >= CENTER ? x - CENTER + ONE : CENTER - x;
  }

  var SCORE_TAG = ascii('spek/score/v2');
  var BEACON_TAG = ascii('spek/beacon/v1');
  var SEED_TAG = ascii('spek/election-seed/v2');
  var NULL_PUBLIC_KEY = new Uint8Array(83);
  var NULL_REVEAL = new Uint8Array(32);

  function scoreHash(beacon, height, publicKey, reveal) {
    return hashOf([SCORE_TAG, beacon, u64le(height), publicKey, reveal]);
  }

  function score(beacon, height, publicKey, reveal) {
    return middleOut(scoreHash(beacon, height, publicKey, reveal));
  }

  function beaconFrom(epoch, input) {
    return hashOf([BEACON_TAG, u64le(epoch), input]);
  }

  function electionSeedStep(parentSeed, publicKey, reveal) {
    return hashOf([SEED_TAG, parentSeed, publicKey, reveal]);
  }

  // ---- Epoch schedule (spek-core ElectionSchedule) -----------------------
  function schedule(epochSlots) {
    return {
      epochSlots: epochSlots,
      epochOf: function (height) {
        return Math.floor(height / epochSlots);
      },
      // The slot whose election seed feeds the beacon of epoch e: (e - 1) * L - 1.
      beaconHeight: function (epoch) {
        return epoch < 2 ? 0 : (epoch - 1) * epochSlots - 1;
      },
      // An output counts at height h only if created strictly below this, or at genesis.
      stakeCutoff: function (height) {
        return Math.max(0, this.beaconHeight(this.epochOf(height)) - epochSlots);
      },
      // The first height at which an output created at `created` counts.
      firstCounting: function (created) {
        return created === 0 ? 0 : (Math.floor((created + 1) / epochSlots) + 3) * epochSlots;
      },
    };
  }

  // ---- Sandbox stand-ins -------------------------------------------------
  function sandboxPublicKey(slotSeed) {
    var tag = 'spek-sandbox/public-key/';
    return concat([
      hashOf([ascii(tag + '0'), slotSeed]),
      hashOf([ascii(tag + '1'), slotSeed]),
      hashOf([ascii(tag + '2'), slotSeed]),
    ]).subarray(0, 83);
  }

  function sandboxSlotSecret(slotSeed, height) {
    return hashOf([ascii('spek-sandbox/slot-secret'), slotSeed, u64le(height)]);
  }

  function sandboxHistorySeed(height) {
    return hashOf([ascii('spek-sandbox/history'), u64le(height)]);
  }

  // ---- The world ---------------------------------------------------------
  // It starts at the first slot of epoch 3, the earliest slot whose beacon is
  // read from a seed (epochs 0 and 1 read the genesis merkle root) and whose
  // stake cutoff is not 0. Seeds before it are the stand-in history. Outputs
  // present at the start were created "at genesis" and always count.
  function createWorld(options) {
    var epochSlots = options.epochSlots;
    var sched = schedule(epochSlots);
    var start = 3 * epochSlots;
    return {
      sched: sched,
      random: options.randomBytes,
      start: start,
      height: start,
      seeds: new Map(),
      blocks: [],
      outputs: [],
      nextId: 1,
      wins: new Map(),
      nulls: 0,
      slots: 0,
      genesisRoot: hashOf([ascii('spek-sandbox/genesis-merkle-root')]),
    };
  }

  function seedAt(world, height) {
    if (height < world.start) return sandboxHistorySeed(height);
    var seed = world.seeds.get(height);
    if (!seed) throw new Error('no election seed at height ' + height + ': that slot is not produced yet');
    return seed;
  }

  // The beacon of epoch e, or null while the seed it reads does not exist yet.
  function beaconFor(world, epoch) {
    if (epoch < 2) return beaconFrom(epoch, world.genesisRoot);
    var at = world.sched.beaconHeight(epoch);
    if (at >= world.height) return null;
    return beaconFrom(epoch, seedAt(world, at));
  }

  // A new stake output. With no seed given it draws a fresh 32-byte slot seed.
  function addOutput(world, owner, atGenesis, existingSeed) {
    var slotSeed = existingSeed || world.random(32);
    var output = {
      id: world.nextId,
      owner: owner,
      slotSeed: slotSeed,
      publicKey: sandboxPublicKey(slotSeed),
      created: atGenesis ? 0 : world.height,
      spent: false,
    };
    world.nextId += 1;
    world.outputs.push(output);
    return output;
  }

  function counts(world, output, height) {
    return !output.spent && (output.created === 0 || output.created < world.sched.stakeCutoff(height));
  }

  // Every output's draw for the slot at world.height, nothing committed. The
  // entries that count are ranked best first (highest score, then lowest key).
  function sealSlot(world) {
    var height = world.height;
    var epoch = world.sched.epochOf(height);
    var beacon = beaconFor(world, epoch);
    var ranked = [];
    var waiting = [];
    for (var i = 0; i < world.outputs.length; i += 1) {
      var output = world.outputs[i];
      if (output.spent) continue;
      if (!counts(world, output, height)) {
        waiting.push({ output: output, countsFrom: world.sched.firstCounting(output.created) });
        continue;
      }
      var reveal = sandboxSlotSecret(output.slotSeed, height);
      var hash = scoreHash(beacon, height, output.publicKey, reveal);
      ranked.push({ output: output, reveal: reveal, hash: hash, score: middleOut(hash) });
    }
    ranked.sort(function (a, b) {
      if (a.score !== b.score) return a.score > b.score ? -1 : 1;
      return compareBytes(a.output.publicKey, b.output.publicKey);
    });
    return { height: height, epoch: epoch, beacon: beacon, ranked: ranked, waiting: waiting };
  }

  // Settles a sealed slot: the best ranked entry becomes the block, or the
  // canonical null block (score 0, null key, zero reveal) when none counts.
  function commitSlot(world, sealed) {
    if (sealed.height !== world.height) throw new Error('sealed slot is stale');
    var parent = seedAt(world, sealed.height - 1);
    var winner = sealed.ranked.length > 0 ? sealed.ranked[0] : null;
    var seed = winner
      ? electionSeedStep(parent, winner.output.publicKey, winner.reveal)
      : electionSeedStep(parent, NULL_PUBLIC_KEY, NULL_REVEAL);
    var block = {
      height: sealed.height,
      epoch: sealed.epoch,
      winner: winner,
      score: winner ? winner.score : BigInt(0),
      electionSeed: seed,
      entrants: sealed.ranked.length,
    };
    world.seeds.set(sealed.height, seed);
    world.blocks.push(block);
    world.height += 1;
    world.slots += 1;
    if (winner) world.wins.set(winner.output.owner, (world.wins.get(winner.output.owner) || 0) + 1);
    else world.nulls += 1;
    return block;
  }

  function runSlots(world, count) {
    for (var i = 0; i < count; i += 1) commitSlot(world, sealSlot(world));
  }

  // A miner who learns the beacon tries `attempts` fresh keys against it for
  // the slot being mined. The keys would have to be funded no earlier than this
  // slot, so the stake rule decides whether any of them is a draw.
  function grind(world, attempts, keep) {
    var height = world.height;
    var epoch = world.sched.epochOf(height);
    var beacon = beaconFor(world, epoch);
    var best = [];
    for (var i = 0; i < attempts; i += 1) {
      var slotSeed = world.random(32);
      var publicKey = sandboxPublicKey(slotSeed);
      var value = score(beacon, height, publicKey, sandboxSlotSecret(slotSeed, height));
      if (best.length < keep || value > best[best.length - 1].score) {
        best.push({ slotSeed: slotSeed, publicKey: publicKey, score: value });
        best.sort(function (a, b) {
          return a.score > b.score ? -1 : a.score < b.score ? 1 : 0;
        });
        if (best.length > keep) best.pop();
      }
    }
    var sealed = sealSlot(world);
    var countsFrom = world.sched.firstCounting(height);
    var firstEpoch = world.sched.epochOf(countsFrom);
    var beaconSlot = world.sched.beaconHeight(firstEpoch);
    return {
      height: height,
      epoch: epoch,
      beacon: beacon,
      best: best,
      honestBest: sealed.ranked.length > 0 ? sealed.ranked[0].score : BigInt(0),
      created: height,
      cutoff: world.sched.stakeCutoff(height),
      counts: world.sched.stakeCutoff(height) > height,
      countsFrom: countsFrom,
      firstEpoch: firstEpoch,
      beaconSlot: beaconSlot,
      slotsUntilBeaconSeed: beaconSlot - height + 1,
    };
  }

  // Whole-number display helpers: no floating point touches a score.
  // percentOfMax(score) is score / 2^255 as a string with two decimals.
  function percentOfMax(value) {
    var hundredths = Number((value * BigInt(10000)) / CENTER);
    var whole = Math.floor(hundredths / 100);
    var fraction = hundredths % 100;
    return whole + '.' + (fraction < 10 ? '0' : '') + fraction;
  }

  root.SpekElection = {
    blake3: blake3,
    ascii: ascii,
    concat: concat,
    u64le: u64le,
    toHex: toHex,
    fromHex: fromHex,
    hashOf: hashOf,
    middleOut: middleOut,
    scoreHash: scoreHash,
    score: score,
    beaconFrom: beaconFrom,
    electionSeedStep: electionSeedStep,
    schedule: schedule,
    sandboxPublicKey: sandboxPublicKey,
    sandboxSlotSecret: sandboxSlotSecret,
    createWorld: createWorld,
    addOutput: addOutput,
    seedAt: seedAt,
    beaconFor: beaconFor,
    counts: counts,
    sealSlot: sealSlot,
    commitSlot: commitSlot,
    runSlots: runSlots,
    grind: grind,
    percentOfMax: percentOfMax,
    CENTER: CENTER,
    NULL_PUBLIC_KEY: NULL_PUBLIC_KEY,
    NULL_REVEAL: NULL_REVEAL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
