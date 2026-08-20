/**
 * ====================================================================
 * PAPERSUDOKU APP — UI + game flow, ES5, zero dependencies.
 * Two screens: start (setup) and play. Two-tap input, partial
 * cell repaints, lazy clock, guarded localStorage autosave.
 * ====================================================================
 */
(function (env) { 'use strict';

    var S = env.PSSolver, G = env.PSGenerator;
    var LEVEL_NAME = { 1: 'EASY', 2: 'MEDIUM', 3: 'HARD', 4: 'EXPERT' };
    var UNDO_CAP = 200;

    // ---------- storage (guarded) ----------
    var store = {
        get: function (k, d) {
            try {
                var v = localStorage.getItem(k);
                return v === null ? d : JSON.parse(v);
            } catch (e) { return d; }
        },
        set: function (k, v) {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
        },
        del: function (k) {
            try { localStorage.removeItem(k); } catch (e) {}
        }
    };

    // ---------- state ----------
    var level = store.get('ps_level', 1);
    var givens = '';      // 81 chars, '0' = empty
    var solution = '';    // 81 chars
    var vals = [];        // user values, int 0..9 (givens live here too)
    var errFlags = [];    // per-cell bool (CHECK markers)
    var hintCells = [];   // per-cell bool (hint-revealed)
    var sel = -1;
    var sticky = 0;       // persistent pad digit (0 = none)
    var hintsUsed = 0;
    var HINT_BUDGET = { 1: 3, 2: 2, 3: 1, 4: 0 };   // per-level allowed hints
    var undoStack = [];
    var startTs = 0;      // Date.now() at game start
    var elapsedBase = 0;  // accumulated ms (for resume)
    var gameOver = false;
    var digitDone = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // count placed per digit

    // ---------- dom ----------
    var $ = function (id) { return document.getElementById(id); };
    var boardEl, cellEls = [];
    var cellPx = 40;

    // ---------- screens ----------
    function showStart() {
        $('screen-start').className = 'screen';
        $('screen-play').className = 'screen hidden';
        var rows = $('lvl-list').children, i;
        for (i = 0; i < rows.length; i++) {
            rows[i].className = 'lvl-row' +
                (parseInt(rows[i].getAttribute('data-v'), 10) === level ? ' on' : '');
        }
        $('btn-resume').style.display = store.get('ps_save', null) ? 'block' : 'none';
        renderStartStats();
    }

    function showPlay() {
        $('screen-start').className = 'screen hidden';
        $('screen-play').className = 'screen';
        updateModeLabel();
        sizeBoard();
        renderClock();
    }

    /** Header cue: show armed digit so sticky mode is always visible. */
    function updateModeLabel() {
        $('lvl-label').innerHTML = LEVEL_NAME[level] +
            (sticky ? ' &middot; FILL ' + sticky : '');
    }

    function renderStartStats() {
        var out = [], l, st, i;
        for (l = 1; l <= 4; l++) {
            st = store.get('ps_stat_' + l, null);
            if (st && st.solved > 0) {
                out.push(LEVEL_NAME[l].charAt(0) + LEVEL_NAME[l].slice(1).toLowerCase() +
                    ' ' + st.solved + '/' + st.played + ' best ' + fmtTime(st.best));
            }
        }
        $('start-stats').innerHTML = out.length ? out.join(' &middot; ') : '&nbsp;';
    }

    // ---------- board build ----------
    function buildBoard() {
        boardEl = $('board');
        var frag = document.createDocumentFragment();
        var r, c, tr, td, i;

        for (r = 0; r < 9; r++) {
            tr = document.createElement('tr');
            for (c = 0; c < 9; c++) {
                i = r * 9 + c;
                td = document.createElement('td');
                if (c === 2 || c === 5) { td.className += ' b-r'; }
                if (r === 2 || r === 5) { td.className += ' b-b'; }
                cellEls[i] = td;
                bindTap(td, i);
                tr.appendChild(td);
            }
            frag.appendChild(tr);
        }
        boardEl.innerHTML = '';
        boardEl.appendChild(frag);
        for (i = 0; i < 81; i++) { paintCell(i); }
        sizeBoard();
    }

    function bindTap(td, i) {
        td.onclick = function () { onCell(i); };
    }

    // ---------- sizing ----------
    function sizeBoard() {
        var vw = window.innerWidth || 480;
        // width-first sizing (screen caps at 560px): e-ink viewports
        // are tall enough that height never binds
        var avail = Math.min(vw, 560) - 24;
        var size = Math.floor(avail / 9);
        if (size < 24) size = 24;
        if (size > 62) size = 62;
        cellPx = size;
        var i, td;
        for (i = 0; i < 81; i++) {
            td = cellEls[i];
            if (!td) continue;
            td.style.width = cellPx + 'px';
            td.style.height = cellPx + 'px';
            td.style.fontSize = Math.floor(cellPx * 0.58) + 'px';
        }
    }

    // ---------- rendering (partial) ----------
    function cellHTML(i) {
        var v = vals[i], n, j, html;
        if (v) {
            return '<span class="d">' + v + '</span>';
        }
        return '&nbsp;';
    }

    function paintCell(i) {
        var td = cellEls[i];
        if (!td) return;
        var cls = '';
        if (i % 9 === 2 || i % 9 === 5) { cls += ' b-r'; }
        if ((i / 9 | 0) === 2 || (i / 9 | 0) === 5) { cls += ' b-b'; }
        if (givens.charAt(i) !== '0') { cls += ' given'; }
        else if (vals[i]) { cls += ' user'; }
        if (hintCells[i]) { cls += ' hintc'; }
        if (errFlags[i]) { cls += ' err'; }
        if (i === sel) { cls += ' sel'; }
        else if (vals[i] && (vals[i] === sticky || (sel >= 0 && vals[i] === vals[sel]))) { cls += ' same'; }
        td.className = cls;
        td.innerHTML = cellHTML(i);
    }

    function paintAll() {
        var i;
        for (i = 0; i < 81; i++) { paintCell(i); }
        paintPad();
    }

    /** Repaint cells whose visual state depends on selection/value. */
    function repaintAround(prevSel) {
        var i, v = sel >= 0 ? vals[sel] : 0;
        for (i = 0; i < 81; i++) {
            if (i === sel || i === prevSel) { paintCell(i); continue; }
            if (vals[i] && (vals[i] === v || (prevSel >= 0 && vals[i] === vals[prevSel]))) {
                paintCell(i);
            }
        }
        paintPad();
    }

    function paintPad() {
        var btns = $('pad').children, i, mask = 511;
        if (sel >= 0 && level !== 4) {          // Expert: never dim (no assists)
            mask = S.candidatesAt(vals.join(''), sel);
        }
        for (i = 0; i < btns.length; i++) {
            var d = i + 1;
            btns[i].className = 'pad-btn' +
                (d === sticky ? ' active' : '') +
                (digitDone[d] >= 9 ? ' done' : '') +
                ((mask & (1 << (d - 1))) ? '' : ' dim');
        }
        var hb = $('btn-hint');
        var left = hintsLeft();
        hb.disabled = left <= 0;
        hb.innerHTML = 'HINT' + (HINT_BUDGET[level] > 0 ? ' ' + left : '');
    }

    /** Repaint all cells whose emphasis depends on sticky/sel values. */
    function repaintValueEmphasis(prevDigit) {
        var i;
        for (i = 0; i < 81; i++) {
            if (vals[i] && (vals[i] === sticky || vals[i] === prevDigit)) { paintCell(i); }
        }
        paintPad();
    }

    // ---------- clock (lazy: repaints on interaction only) ----------
    function elapsedMs() {
        return gameOver ? elapsedBase : (elapsedBase + (startTs ? (Date.now() - startTs) : 0));
    }

    function fmtTime(ms) {
        var s = Math.floor(ms / 1000);
        var m = Math.floor(s / 60);
        s -= m * 60;
        var h = Math.floor(m / 60);
        m -= h * 60;
        if (h > 0) { return h + ':' + pad2(m) + ':' + pad2(s); }
        return m + ':' + pad2(s);
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function renderClock() {
        $('clock').innerHTML = fmtTime(elapsedMs());
    }

    // ---------- game lifecycle ----------
    function newGame() {
        var p, tries = 0;
        var seen = store.get('ps_seen', []);
        do {
            p = G.generate(level);
            tries++;
        } while (G.isSeen(p.hash, seen) && tries < 10);
        seen = G.appendSeen(p.hash, seen);
        store.set('ps_seen', seen);

        givens = p.givens;
        solution = p.solution;
        resetUserState();
        startTs = Date.now();
        elapsedBase = 0;
        gameOver = false;
        sel = -1;
        var st = store.get('ps_stat_' + level, { played: 0, solved: 0, best: 0 });
        st.played++;
        store.set('ps_stat_' + level, st);
        showPlay();
        buildBoard();
        paintAll();
        renderClock();
        saveGame();
    }

    function resetUserState() {
        var i;
        vals = [];
        errFlags = [];
        hintCells = [];
        undoStack = [];
        digitDone = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        hintsUsed = 0;
        sticky = 0;
        for (i = 0; i < 81; i++) {
            vals[i] = +givens.charAt(i);
            errFlags[i] = false;
            hintCells[i] = false;
            if (vals[i]) { digitDone[vals[i]]++; }
        }
    }

    function saveGame() {
        if (gameOver) { store.del('ps_save'); return; }
        store.set('ps_save', {
            level: level,
            givens: givens,
            solution: solution,
            vals: vals.join(''),
            errFlags: errFlags,
            hintCells: hintCells,
            hintsUsed: hintsUsed,
            elapsed: elapsedMs(),
            undo: undoStack
        });
    }

    function resumeGame() {
        var s = store.get('ps_save', null);
        if (!s) { newGame(); return; }
        level = s.level;
        givens = s.givens;
        solution = s.solution;
        resetUserState();
        var i;
        for (i = 0; i < 81; i++) {
            vals[i] = +s.vals.charAt(i);
        }
        errFlags = s.errFlags || [];
        hintCells = s.hintCells || [];
        hintsUsed = s.hintsUsed || 0;
        undoStack = s.undo || [];
        elapsedBase = s.elapsed || 0;
        startTs = Date.now();
        gameOver = false;
        sel = -1;
        recountDigits();
        showPlay();
        buildBoard();
        paintAll();
        renderClock();
    }

    function recountDigits() {
        var i;
        digitDone = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (i = 0; i < 81; i++) {
            if (vals[i]) { digitDone[vals[i]]++; }
        }
    }

    // ---------- input ----------
    function isEditable(i) {
        return i >= 0 && givens.charAt(i) === '0' && !hintCells[i];
    }

    function onCell(i) {
        if (gameOver) return;
        // sticky digit: write into tapped cells, keep digit selected
        if (sticky && isEditable(i)) {
            var prev = sel;
            sel = i;
            applyDigit(i, sticky, true);
            if (prev >= 0 && prev !== i) { paintCell(prev); }
            return;
        }
        var prev2 = sel;
        sel = (sel === i) ? -1 : i;
        if (prev2 >= 0) { paintCell(prev2); }
        if (sel >= 0) { paintCell(sel); }
        repaintAround(prev2);
        renderClock();
    }

    function pushUndo(entry) {
        undoStack.push(entry);
        while (undoStack.length > UNDO_CAP) { undoStack.shift(); }
    }

    /** Write digit v into cell i (value, erase-toggle, or note).
     *  auto: true for sticky arm-fills; consecutive auto edits to the
     *  same cell coalesce into one undo entry. */
    function applyDigit(i, v, auto) {
        var prevVal = vals[i];
        var top = undoStack.length ? undoStack[undoStack.length - 1] : null;
        if (top && top.i === i && top.auto) {
            undoStack.pop();                 // replace arm-fill: keep original base
            prevVal = top.val;
        }

        if (vals[i] === v) {
            vals[i] = 0;
            digitDone[v]--;
            pushUndo({ i: i, val: prevVal, auto: !!auto });
            paintCell(i);
            repaintAround(i);
        } else {
            if (prevVal) { digitDone[prevVal]--; }
            vals[i] = v;
            errFlags[i] = false;
            digitDone[v]++;
            pushUndo({ i: i, val: prevVal, auto: !!auto });
            paintCell(i);
            repaintAround(i);
        }
        saveGame();
        renderClock();
        checkWin();
    }

    /** Pad tap: set/clear sticky digit; also fill selected cell (cell-first flow). */
    function onPad(v) {
        if (gameOver) { renderClock(); return; }
        var prevSticky = sticky;
        if (sticky === v) {
            sticky = 0;                      // re-tap: deselect digit AND cell, no write
            var prevSel = sel;
            sel = -1;
            if (prevSel >= 0) { paintCell(prevSel); }
        } else {
            sticky = v;
            if (sel >= 0 && isEditable(sel)) {
                applyDigit(sel, v);          // cell-first: switch writes immediately
            }
        }
        repaintValueEmphasis(prevSticky);
        updateModeLabel();
        renderClock();
    }

    function onErase() {
        if (gameOver) { renderClock(); return; }
        if (sel < 0 || !isEditable(sel)) {
            if (sticky) {                    // no cell: pad re-tap clears sticky
                var pv = sticky;
                sticky = 0;
                repaintValueEmphasis(pv);
            }
            renderClock();
            return;
        }
        var i = sel;
        if (!vals[i]) return;
        var prevVal = vals[i];
        if (prevVal) { digitDone[prevVal]--; }
        vals[i] = 0;
        errFlags[i] = false;
        pushUndo({ i: i, val: prevVal });
        paintCell(i);
        repaintAround(i);
        saveGame();
        renderClock();
    }

    // ---------- undo ----------
    function onUndo() {
        if (gameOver || !undoStack.length) { renderClock(); return; }
        var e = undoStack.pop();
        var i = e.i;
        if (e.hint) { hintsUsed--; }
        if (vals[i]) { digitDone[vals[i]]--; }
        vals[i] = e.val;
        errFlags[i] = false;
        if (e.hint) { hintCells[i] = false; }
        if (vals[i]) { digitDone[vals[i]]++; }
        var prevSel = sel;
        sel = i;
        if (prevSel >= 0 && prevSel !== i) { paintCell(prevSel); }
        paintCell(i);
        repaintAround(prevSel);
        saveGame();
        renderClock();
    }

    // ---------- hint ----------
    function hintTarget() {
        if (sel >= 0 && !vals[sel]) { return sel; }
        // naked single first: cell with exactly one candidate
        var g = vals.join(''), i, cand;
        for (i = 0; i < 81; i++) {
            if (vals[i]) continue;
            cand = S.candidatesAt(g, i);
            if (cand && (cand & (cand - 1)) === 0) { return i; } // single bit
        }
        for (i = 0; i < 81; i++) {
            if (!vals[i]) return i;
        }
        return -1;
    }

    function hintsLeft() {
        return HINT_BUDGET[level] - hintsUsed;
    }

    function onHint() {
        if (gameOver) { renderClock(); return; }
        if (hintsLeft() <= 0) { renderClock(); return; }
        var i = hintTarget();
        if (i < 0) { renderClock(); return; }
        var v = +solution.charAt(i);
        pushUndo({ i: i, val: vals[i], hint: true });
        vals[i] = v;
        errFlags[i] = false;
        hintCells[i] = true;
        hintsUsed++;
        digitDone[v]++;
        var prev = sel;
        sel = i;
        if (prev >= 0 && prev !== i) { paintCell(prev); }
        paintCell(i);
        repaintAround(prev);
        saveGame();
        renderClock();
        checkWin();
    }

    // ---------- win ----------
    function gridFull() {
        var i;
        for (i = 0; i < 81; i++) { if (!vals[i]) { return false; } }
        return 1 === 1;
    }

    function checkWin() {
        if (gameOver || !gridFull()) return;
        var i;
        for (i = 0; i < 81; i++) {
            if (vals[i] !== +solution.charAt(i)) return;
        }
        finishGame();
    }

    function finishGame() {
        gameOver = true;
        elapsedBase += startTs ? (Date.now() - startTs) : 0;
        startTs = 0;

        var st = store.get('ps_stat_' + level, { played: 0, solved: 0, best: 0 });
        st.solved++;
        if (!st.best || elapsedBase < st.best) { st.best = elapsedBase; }
        store.set('ps_stat_' + level, st);

        store.del('ps_save');

        $('win-body').innerHTML =
            LEVEL_NAME[level] + ' &middot; ' + fmtTime(elapsedBase) +
            (HINT_BUDGET[level] > 0 ? '<br>hints used: ' + hintsUsed + '/' + HINT_BUDGET[level] : '');
        $('win-pop').className = 'board-pop show';
    }

    // ---------- menu actions ----------
    function onCheck() {
        $('menu-modal').className = 'overlay hidden';
        var i, changed = false;
        for (i = 0; i < 81; i++) {
            var bad = vals[i] && vals[i] !== +solution.charAt(i);
            if (errFlags[i] !== bad) {
                errFlags[i] = bad;
                if (bad || vals[i]) { paintCell(i); }
                changed = true;
            }
        }
        saveGame();
        renderClock();
    }

    function clearErrors(i) {
        if (errFlags[i]) {
            errFlags[i] = false;
            paintCell(i);
        }
    }

    // ---------- menu ----------
    function openMenu() {
        $('menu-modal').className = 'overlay';
        renderClock();
    }

    function closeMenu() {
        $('menu-modal').className = 'overlay hidden';
    }

    // ---------- init ----------
    function init() {
        var rows = $('lvl-list').children, i;
        for (i = 0; i < rows.length; i++) {
            (function (row) {
                row.onclick = function () {
                    level = parseInt(row.getAttribute('data-v'), 10);
                    store.set('ps_level', level);
                    var k;
                    for (k = 0; k < rows.length; k++) {
                        rows[k].className = 'lvl-row' + (rows[k] === row ? ' on' : '');
                    }
                };
            })(rows[i]);
        }

        $('btn-start').onclick = function () { newGame(); };
        $('btn-resume').onclick = function () { resumeGame(); };
        $('btn-erase').onclick = function () { onErase(); };
        $('btn-undo').onclick = function () { onUndo(); };
        $('btn-hint').onclick = function () { onHint(); };
        $('btn-menu').onclick = function () { openMenu(); };
        $('btn-close-menu').onclick = function () { closeMenu(); };
        $('btn-check').onclick = function () { onCheck(); };
        $('btn-new').onclick = function () {
            closeMenu();
            newGame();
        };
        $('btn-exit').onclick = function () {
            closeMenu();
            showStart();
        };
        $('btn-again').onclick = function () {
            $('win-pop').className = 'board-pop';
            newGame();
        };
        $('btn-close-win').onclick = function () {
            $('win-pop').className = 'board-pop';
        };

        var btns = $('pad').children;
        for (i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.onclick = function () {
                    onPad(parseInt(btn.getAttribute('data-v'), 10));
                };
            })(btns[i]);
        }

        window.onresize = function () { sizeBoard(); };
        showStart();
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'complete') { init(); }
        else { env.onload = init; }
    }

})(typeof window === 'object' ? window : global);
