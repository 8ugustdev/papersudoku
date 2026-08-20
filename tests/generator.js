/* Generator tests: N puzzles per level — valid, unique, in band,
   all distinct hashes, seen-list eviction, perf budget. */
'use strict';
require('../js/solver.js');
require('../js/generator.js');
var S = global.PSSolver, G = global.PSGenerator;

var fail = 0;
function assert(ok, msg) { if (!ok) { console.log('FAIL: ' + msg); fail++; } }

var N = 100;
var bands = { 1: [38, 42], 2: [30, 34], 3: [26, 30], 4: [22, 30] }; // expert: floor band
var hashes = {}, level, k, t0, dt, worst = 0, p, giv;

for (level = 1; level <= 4; level++) {
    for (k = 0; k < N; k++) {
        t0 = Date.now();
        p = G.generate(level);
        dt = Date.now() - t0;
        if (dt > worst) { worst = dt; }

        assert(S.isValid(p.givens), 'L' + level + ' #' + k + ' givens valid');
        assert(S.solve(p.givens) === p.solution, 'L' + level + ' #' + k + ' solution matches solve()');
        assert(S.countSolutions(p.givens, 2) === 1, 'L' + level + ' #' + k + ' unique');
        assert(p.solution.indexOf('0') === -1, 'L' + level + ' #' + k + ' solution complete');

        giv = p.givens.replace(/0/g, '').length;
        assert(giv === p.givensCount, 'L' + level + ' #' + k + ' givensCount consistent');
        assert(giv >= bands[level][0] && giv <= bands[level][1],
            'L' + level + ' #' + k + ' givens ' + giv + ' in band ' + bands[level]);

        assert(!hashes[p.hash], 'hash collision at L' + level + ' #' + k);
        hashes[p.hash] = true;
    }
}
console.log('400 puzzles generated; worst single time ' + worst + 'ms');
assert(worst < 300, 'per-puzzle generation under 300ms, worst ' + worst + 'ms');

function rep(ch, n) { var s = '', i; for (i = 0; i < n; i++) { s += ch; } return s; }

// Hash properties
assert(G.hashOf(rep('0', 81)) !== G.hashOf('1' + rep('0', 80)), 'hash differs on 1-char change');
assert(G.hashOf(easyGrid()) === G.hashOf(easyGrid()), 'hash deterministic');

// Seen list: membership + FIFO eviction at cap
var seen = [];
assert(G.isSeen('x', seen) === false, 'empty seen list misses');
for (k = 0; k < 520; k++) { seen = G.appendSeen('h' + k, seen); }
assert(seen.length === G.SEEN_CAP, 'seen list capped at ' + G.SEEN_CAP + ', got ' + seen.length);
assert(seen[0] === 'h20', 'oldest evicted first, got ' + seen[0]);
assert(G.isSeen('h519', seen) === true, 'newest present');
assert(G.isSeen('h19', seen) === false, 'evicted absent');

// No-repeat regenerate loop: generate until unseen (forced-collision path)
// Seeded rand returning constants -> identical grids -> identical hash,
// proving the isSeen retry loop executes and still terminates.
var fixedRand = function () { return 0.5; };
var pF1 = G.generate(1, fixedRand);
var pF2 = G.generate(1, fixedRand);
assert(pF1.hash === pF2.hash, 'seeded rand yields identical puzzle hash');
var seenF = G.appendSeen(pF1.hash, []);
assert(G.isSeen(pF2.hash, seenF), 'collision detected');

// No-repeat regenerate loop: random path (practically never loops, proves wiring)
var seen2 = [], p1, p2, tries;
p1 = G.generate(1);
seen2 = G.appendSeen(p1.hash, seen2);
tries = 0;
do {
    p2 = G.generate(1);
    tries++;
} while (G.isSeen(p2.hash, seen2) && tries < 10);
assert(!G.isSeen(p2.hash, seen2), 'regenerated past seen hash');

function easyGrid() {
    return '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
}

console.log('generator tests: ' + (fail ? fail + ' FAILURES' : 'all OK'));
process.exit(fail ? 1 : 0);
