/**
 * ====================================================================
 * PAPERSUDOKU SOLVER — bitmask backtracking, ES5, zero dependencies.
 * Grid = string (or array) of 81 chars '0'..'9', '0' = empty.
 * Rows/cols/boxes kept as 9-bit candidate masks; bit (d-1) = digit d used.
 * ====================================================================
 */
(function (env) { 'use strict';

    var POP = (function () {
        var t = [], i, j, n;
        for (i = 0; i < 512; i++) {
            n = 0;
            for (j = 0; j < 9; j++) { n += (i >> j) & 1; }
            t[i] = n;
        }
        return t;
    })();

    function boxOf(i) { return (((i / 9) | 0) / 3 | 0) * 3 + (((i % 9) / 3) | 0); }

    /** Build row/col/box masks from a flat 81-int array. */
    function masks(cells) {
        var rows = [], cols = [], boxes = [], i, v;
        var r, c;
        for (r = 0; r < 9; r++) { rows[r] = 0; }
        for (c = 0; c < 9; c++) { cols[c] = 0; }
        for (i = 0; i < 9; i++) { boxes[i] = 0; }
        for (i = 0; i < 81; i++) {
            v = cells[i];
            if (v) {
                var b = 1 << (v - 1);
                rows[(i / 9) | 0] |= b;
                cols[i % 9] |= b;
                boxes[boxOf(i)] |= b;
            }
        }
        return { rows: rows, cols: cols, boxes: boxes };
    }

    function parseGrid(g) {
        var cells = [], i;
        for (i = 0; i < 81; i++) {
            cells[i] = g.charAt(i) === '.' ? 0 : +g.charAt(i);
        }
        return cells;
    }

    /**
     * Find the empty cell with the fewest candidates (MRV).
     * Returns {i, cand} or null when grid is full.
     * Returns {i: -1} when a cell has zero candidates (dead end).
     */
    function bestCell(cells, m) {
        var i, best = null, bestN = 10, cand, n;
        for (i = 0; i < 81; i++) {
            if (cells[i]) continue;
            cand = ~(m.rows[(i / 9) | 0] | m.cols[i % 9] | m.boxes[boxOf(i)]) & 511;
            if (!cand) return { i: -1, cand: 0 };
            n = POP[cand];
            if (n < bestN) {
                bestN = n;
                best = { i: i, cand: cand };
                if (n === 1) break;
            }
        }
        return best;
    }

    /**
     * Backtracking core. order: function(cand) -> array of digit bit-masks.
     * visit: function(cells) -> truthy to stop (first solution found).
     * Returns cells array (solved/stopped) or null (exhausted).
     */
    function search(cells, m, order, visit) {
        var b = bestCell(cells, m);
        if (b === null) return visit(cells) ? cells : null;
        if (b.i === -1) return null;

        var i = b.i, r = (i / 9) | 0, c = i % 9, bx = boxOf(i);
        var bits = order(b.cand), k, bit, v, res;
        for (k = 0; k < bits.length; k++) {
            bit = bits[k];
            v = digitOf(bit);
            cells[i] = v;
            m.rows[r] |= bit; m.cols[c] |= bit; m.boxes[bx] |= bit;
            res = search(cells, m, order, visit);
            if (res) return res;
            m.rows[r] &= ~bit; m.cols[c] &= ~bit; m.boxes[bx] &= ~bit;
            cells[i] = 0;
        }
        return undefined;
    }

    /** digit value from a single set bit mask */
    function digitOf(bit) {
        var d = 1;
        while (bit > 1) { bit >>= 1; d++; }
        return d;
    }

    function ascOrder(cand) {
        var out = [], bit = 1;
        while (bit <= 256) {
            if (cand & bit) out.push(bit);
            bit <<= 1;
        }
        return out;
    }

    /** True when any unit has a repeated digit (input conflict).
     *  Such grids are locally consistent but make backtracking explode;
     *  detect upfront and refuse. */
    function hasConflict(cells) {
        var u, j, v, bit, seen, i;
        for (u = 0; u < 9; u++) {
            // row u
            seen = 0;
            for (j = 0; j < 9; j++) {
                v = cells[u * 9 + j];
                if (!v) continue;
                bit = 1 << (v - 1);
                if (seen & bit) return true;
                seen |= bit;
            }
            // col u
            seen = 0;
            for (j = 0; j < 9; j++) {
                v = cells[j * 9 + u];
                if (!v) continue;
                bit = 1 << (v - 1);
                if (seen & bit) return true;
                seen |= bit;
            }
            // box u
            seen = 0;
            var br = ((u / 3) | 0) * 3, bc = (u % 3) * 3;
            for (j = 0; j < 9; j++) {
                v = cells[(br + ((j / 3) | 0)) * 9 + bc + (j % 3)];
                if (!v) continue;
                bit = 1 << (v - 1);
                if (seen & bit) return true;
                seen |= bit;
            }
        }
        return 0 === 1;
    }

    // ---- public API ----

    /** Solve g; return 81-char solution string or null. */
    function solve(g) {
        var cells = parseGrid(g);
        if (hasConflict(cells)) return null;
        var m = masks(cells);
        var res = search(cells, m, ascOrder, function () { return true; });
        if (!res) return null;
        return res.join('');
    }

    /** Count solutions of g, stopping at limit. Returns count (capped at limit). */
    function countSolutions(g, limit) {
        var cells = parseGrid(g);
        if (hasConflict(cells)) return 0;
        var m = masks(cells);
        var count = 0;
        search(cells, m, ascOrder, function () {
            count++;
            return count >= limit;
        });
        return count;
    }

    /** True when g has no rule violations among filled cells. */
    function isValid(g) {
        var cells = parseGrid(g);
        var m = masks(cells), i, v, bit;
        for (i = 0; i < 81; i++) {
            v = cells[i];
            if (!v) continue;
            bit = 1 << (v - 1);
            var r = (i / 9) | 0, c = i % 9, bx = boxOf(i);
            m.rows[r] &= ~bit; m.cols[c] &= ~bit; m.boxes[bx] &= ~bit;
            var ok = (m.rows[r] & bit) === 0 && (m.cols[c] & bit) === 0 && (m.boxes[bx] & bit) === 0;
            m.rows[r] |= bit; m.cols[c] |= bit; m.boxes[bx] |= bit;
            if (!ok) return false;
        }
        return 1 === 1;
    }

    /** Candidates bitmask for cell i of grid g (0 when filled/invalid). */
    function candidatesAt(g, i) {
        var cells = parseGrid(g);
        if (cells[i]) return 0;
        var m = masks(cells);
        return ~(m.rows[(i / 9) | 0] | m.cols[i % 9] | m.boxes[boxOf(i)]) & 511;
    }

    /** Randomized full-grid fill; returns 81-char complete string. */
    function fillRandom(rand) {
        rand = rand || Math.random;
        var cells = [], m = masks(cells), i;
        for (i = 0; i < 81; i++) cells[i] = 0;
        var res = search(cells, m, function (cand) {
            var out = ascOrder(cand), j, k, t;
            for (j = out.length - 1; j > 0; j--) {
                k = Math.floor(rand() * (j + 1));
                t = out[j]; out[j] = out[k]; out[k] = t;
            }
            return out;
        }, function () { return true; });
        return res.join('');
    }

    var api = {
        solve: solve,
        countSolutions: countSolutions,
        isValid: isValid,
        candidatesAt: candidatesAt,
        fillRandom: fillRandom,
        _masks: masks,
        _parse: parseGrid,
        _search: search,
        _digitOf: digitOf,
        _ascOrder: ascOrder
    };

    env.PSSolver = api;
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }

})(typeof window === 'object' ? window : global);
