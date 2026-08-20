/**
 * ====================================================================
 * PAPERSUDOKU GENERATOR — random full grid, 180°-symmetric digging
 * with per-pair uniqueness gate, difficulty targets, djb2 puzzle
 * identity hash + seen-list helpers (no-repeat). ES5, zero deps.
 * ====================================================================
 */
(function (env) { 'use strict';

    var S = env.PSSolver || (typeof require !== 'undefined' ? require('./solver.js') : null);
    var LEVELS = {
        1: { name: 'Easy',   givens: 40 },
        2: { name: 'Medium', givens: 32 },
        3: { name: 'Hard',   givens: 28 },
        4: { name: 'Expert', givens: 25 }
    };
    var BAND = 2;          // accepted givens deviation
    var SEEN_CAP = 500;    // ring buffer of played puzzle hashes
    var MAX_REROLLS = 5;   // whole-grid retries before accepting nearest

    function parse(s) {
        var a = [], i;
        for (i = 0; i < 81; i++) { a[i] = +s.charAt(i); }
        return a;
    }

    function shuffle(a, rand) {
        rand = rand || Math.random;
        var j, k, t;
        for (j = a.length - 1; j > 0; j--) {
            k = Math.floor(rand() * (j + 1));
            t = a[j]; a[j] = a[k]; a[k] = t;
        }
        return a;
    }

    /**
     * Dig symmetric pairs out of a full grid, keeping uniqueness.
     * stopAt: stop when givens count <= stopAt (0 = dig while removable).
     * Returns { cells, givens } with cells as int array (0 = hole).
     */
    function dig(solutionCells, stopAt, rand) {
        var cells = solutionCells.slice();
        var order = [], i;
        for (i = 0; i < 40; i++) { order.push(i); }   // pairs (i, 80-i); center 40 stays
        shuffle(order, rand);

        var givens = 81, k, a, b, va, vb, probe;
        for (k = 0; k < order.length; k++) {
            if (stopAt > 0 && givens <= stopAt) break;
            a = order[k];
            b = 80 - a;
            va = cells[a]; vb = cells[b];
            cells[a] = 0; cells[b] = 0;
            probe = cells.join('');
            if (S.countSolutions(probe, 2) === 1) {
                givens -= 2;
            } else {
                cells[a] = va; cells[b] = vb;
            }
        }
        return { cells: cells, givens: givens };
    }

    /**
     * Generate a puzzle for level 1..4.
     * Returns { givens: '81 chars', solution: '81 chars', hash: base36,
     *           level, givensCount }.
     */
    function generate(level, rand) {
        var cfg = LEVELS[level] || LEVELS[1];
        var stopAt = level === 4 ? 0 : cfg.givens;   // expert digs to floor
        var best = null, attempt, sol, dug, out;

        for (attempt = 0; attempt <= MAX_REROLLS; attempt++) {
            sol = S.fillRandom(rand);
            dug = dig(parse(sol), stopAt, rand);
            if (!best || Math.abs(dug.givens - cfg.givens) < Math.abs(best.givens - cfg.givens)) {
                best = dug;
            }
            if (Math.abs(dug.givens - cfg.givens) <= BAND) break;
        }
        // expert floor: accept anything we managed
        out = best.cells.join('');
        return {
            givens: out,
            solution: sol,
            hash: hashOf(out),
            level: level,
            givensCount: best.givens
        };
    }

    /** djb2 over the givens string, 31-bit, base-36. */
    function hashOf(givens) {
        var h = 5381, i;
        for (i = 0; i < 81; i++) {
            h = (((h << 5) + h) + givens.charCodeAt(i)) & 0x7FFFFFFF;
        }
        return h.toString(36);
    }

    /** True when hash already in seenArray. */
    function isSeen(hash, seenArray) {
        var i;
        if (!seenArray) return false;
        for (i = 0; i < seenArray.length; i++) {
            if (seenArray[i] === hash) return true;
        }
        return 0 === 1;
    }

    /** Append hash, evicting oldest past cap. Mutates and returns array. */
    function appendSeen(hash, seenArray) {
        var a = seenArray || [];
        a.push(hash);
        while (a.length > SEEN_CAP) { a.shift(); }
        return a;
    }

    var api = {
        LEVELS: LEVELS,
        SEEN_CAP: SEEN_CAP,
        BAND: BAND,
        generate: generate,
        hashOf: hashOf,
        isSeen: isSeen,
        appendSeen: appendSeen
    };

    env.PSGenerator = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window === 'object' ? window : global);
