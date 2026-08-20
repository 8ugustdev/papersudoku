/* Solver sanity tests: known puzzles, uniqueness counting, validity, fill. */
'use strict';
require('../js/solver.js');
var S = global.PSSolver;

var fail = 0;
function assert(ok, msg) { if (!ok) { console.log('FAIL: ' + msg); fail++; } }

// 1. Solve a known easy puzzle
var easy = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
var easySol = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
var got = S.solve(easy);
assert(got === easySol, 'easy puzzle solves to known solution, got ' + got);

// 2. Solve a known hard puzzle (Arto Inkala style)
var hard = '800000000003600000070090200050007000000045700000100030001000068008500010090000400';
var hs = S.solve(hard);
assert(hs !== null, 'hard puzzle solves');
assert(hs && S.isValid(hs), 'hard solution is valid');
assert(hs && S.countSolutions(hard, 2) === 1, 'hard puzzle unique');

// 3. Unsolvable grid (two 1s in row 1) -> null, 0 solutions
var bad = '110000000000000000000000000000000000000000000000000000000000000000000000000000000';
assert(S.solve(bad) === null, 'conflicting grid returns null');
assert(S.countSolutions(bad, 2) === 0, 'conflicting grid counts 0 solutions');

// 4. Multiple solutions -> count caps at limit
var loose = '123456789000000000000000000000000000000000000000000000000000000000000000000000000';
assert(S.countSolutions(loose, 2) === 2, 'loose grid counts >= 2 (capped), got ' + S.countSolutions(loose, 2));

// 5. Full random fills: valid, complete
var i, f;
for (i = 0; i < 5; i++) {
    f = S.fillRandom();
    assert(f.length === 81 && f.indexOf('0') === -1, 'fill complete ' + i);
    assert(S.isValid(f), 'fill valid ' + i);
}

// 6. Deterministic solve speed on hard puzzle
var t0 = Date.now(), n;
for (n = 0; n < 20; n++) { S.solve(hard); }
var dt = Date.now() - t0;
assert(dt < 2000, '20 hard solves under 2s, took ' + dt + 'ms');

console.log('solver tests: ' + (fail ? fail + ' FAILURES' : 'all OK'));
process.exit(fail ? 1 : 0);
