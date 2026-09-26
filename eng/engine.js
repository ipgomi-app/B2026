/* 엔지니어링 영업추진현황 주간 제출본 엔진 (템플릿 방식)
 *
 * 지난주 제출본(xlsx)을 템플릿으로 열고, 권역별 자료(경북/부산/경남)의
 * 수주풀 행을 원문 그대로(값+셀서식) 병합한 뒤 영업진행종합 시트의
 * 주차 열 수식과 하단 업체 목록을 갱신한다. 서식은 템플릿 셀 서식을 복제한다.
 *
 * 브라우저(window.EngEngine)와 Node(require) 양쪽에서 사용한다.
 * ExcelJS 인스턴스는 호출하는 쪽에서 넘겨준다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EngEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REGIONS = ['경북권역', '부산권역', '경남권역'];
  const KEY_STAGES = ['니즈확인', '견적', '계약'];
  const STAGE_RANK = { '계약': 5, '견적': 4, '니즈확인': 3, '방문/협의': 2, '정보조사': 1 };
  const WEEK_RE = /^(\d{1,2})월\s*(\d)주$/;

  // ---------- 유틸 ----------
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
  const trim = (s) => String(s == null ? '' : s).trim();
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const wk = (s) => { const m = WEEK_RE.exec(trim(s)); return m ? +m[1] + '월 ' + m[2] + '주' : trim(s); };
  const isWeek = (s) => WEEK_RE.test(trim(s));
  const monthOf = (s) => { const m = /^(\d{1,2})월/.exec(trim(s)); return m ? +m[1] + '월' : null; };
  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

  // 셀 값 → 비교/표시용 문자열
  function text(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((r) => r.text).join('');
      if (v.formula || v.sharedFormula) return v.result == null ? '' : text(v.result);
      if (v.text != null) return String(v.text);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (v.error) return '';
    }
    return String(v);
  }
  const num = (v) => { const t = text(v).replace(/,/g, '').trim(); const n = Number(t); return t !== '' && isFinite(n) ? n : 0; };

  function thursdays(year, month) {
    let n = 0; const d = new Date(year, month - 1, 1);
    while (d.getMonth() === month - 1) { if (d.getDay() === 4) n++; d.setDate(d.getDate() + 1); }
    return n;
  }
  function nextWeek(w, today) {
    const m = WEEK_RE.exec(trim(w)); if (!m) return w;
    const t = today || new Date();
    let y = t.getFullYear(); if (+m[1] > t.getMonth() + 3) y -= 1;
    return +m[2] < thursdays(y, +m[1]) ? +m[1] + '월 ' + (+m[2] + 1) + '주' : (+m[1] % 12 + 1) + '월 1주';
  }
  function weekOrder(w) { const m = WEEK_RE.exec(trim(w)); return m ? +m[1] * 10 + +m[2] : -1; }

  // 클립보드 TSV (따옴표 안 줄바꿈 허용)
  function parseTSV(str) {
    const rows = []; let row = [], cell = '', q = false;
    str = String(str || '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (q) {
        if (ch === '"') { if (str[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
        continue;
      }
      if (ch === '"' && cell === '') { q = true; continue; }
      if (ch === '\t') { row.push(cell); cell = ''; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // ---------- 시트 찾기 ----------
  function findSheets(wb) {
    const ws = wb.worksheets;
    const pool = ws.find((s) => s.name.includes('수주풀')) || null;
    const sum = ws.find((s) => s.name === '영남영업본부') || ws.find((s) => s.state === 'visible' && s !== pool && /영업/.test(s.name)) || null;
    return { pool, sum };
  }

  // ---------- 수주풀 읽기 ----------
  function poolLayout(ws) {
    let hdr = -1;
    for (let r = 1; r <= 12 && hdr < 0; r++) {
      const vals = []; ws.getRow(r).eachCell({ includeEmpty: false }, (c) => vals.push(norm(text(c.value))));
      if (vals.includes('업체명') && vals.includes('코드')) hdr = r;
    }
    if (hdr < 0) throw new Error('수주풀 시트에서 헤더(코드/업체명) 행을 찾지 못했습니다: ' + ws.name);
    const col = {}; let maxCol = 0;
    ws.getRow(hdr).eachCell({ includeEmpty: false }, (c, n) => {
      const k = norm(text(c.value)); if (k && !(k in col)) col[k] = n; maxCol = Math.max(maxCol, n);
    });
    const need = (k, alt) => { const v = col[k] || (alt && col[alt]); if (!v) throw new Error('수주풀 헤더에 "' + k + '" 열이 없습니다.'); return v; };
    const L = {
      hdr, maxCol: Math.min(Math.max(maxCol + 1, 39), 60),
      reg: need('팀/권역'), mgr: need('담당자'), grp: col['그룹/일반'], code: need('코드'), name: need('업체명'),
      task: col['추진과제/범위'], stage: need('진행단계'), amt: col['예상매출(억원)'], period: col['사업시기'],
      plan: col['방문계획'], newv: need('방문실적(신규)'), rev: need('방문실적(재방문)'), le: col['LE동행방문실적'],
      needs: col['주요이슈및고객사Needs'], month: col['월구분'], note: col['비고(매출등급등)'],
      flags: [],
    };
    const flagNames = ['자동상하차', '스태커크레인', '멀티셔틀시스템', '복합로봇자동화', 'AGVAMR', '무인지게차AGF', '로봇파렛타이져', '모노레일', '자동소터로봇소터', '기타설비'];
    flagNames.forEach((k) => { if (col[k]) L.flags.push(col[k]); });
    L.headers = col;
    return L;
  }

  function rowMergeMap(ws) {
    const byRow = {};
    Object.values(ws._merges || {}).forEach((rg) => {
      const m = rg.model || rg;
      if (m.top === m.bottom) (byRow[m.top] = byRow[m.top] || []).push([m.left, m.right]);
    });
    return byRow;
  }

  function snapRow(ws, r, maxCol, merges) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      const slave = cell.isMerged && cell.master && cell.master.address !== cell.address; // 병합 보조 칸은 대표 값을 되돌려주므로 비움
      const o = { v: slave || cell.value == null ? null : clone(cell.value), s: clone(cell.style || {}) };
      if (cell.type === 6 /* Formula */) o.f = cell.formula;
      if (cell.note) o.note = clone(cell.note);
      if (cell.dataValidation) o.dv = clone(cell.dataValidation);
      cells.push(o);
    }
    return { cells, height: row.height, hidden: !!row.hidden, outline: row.outlineLevel || 0, merges: clone((merges && merges[r]) || []) };
  }

  // 수주풀 → 행 스냅샷 목록
  function readPool(ws, L) {
    const merges = rowMergeMap(ws);
    const rows = [];
    let lastRow = L.hdr;
    for (let r = L.hdr + 1; r <= ws.rowCount; r++) {
      const name = trim(text(ws.getRow(r).getCell(L.name).value));
      if (!name) continue;
      lastRow = r;
      const sn = snapRow(ws, r, L.maxCol, merges);
      sn.srcRow = r;
      rows.push(decorate(sn, L));
    }
    return { rows, lastRow };
  }
  function decorate(sn, L) {
    const g = (c) => (c ? text(sn.cells[c - 1].v) : '');
    sn.region = trim(g(L.reg));
    sn.name = trim(g(L.name));
    sn.code = trim(g(L.code));
    sn.key = sn.code + '|' + sn.name;
    return sn;
  }
  // 스냅샷에서 필드 읽기
  function fields(sn, L) {
    const g = (c) => (c ? sn.cells[c - 1].v : null);
    return {
      region: sn.region, mgr: trim(text(g(L.mgr))), grp: trim(text(g(L.grp))), code: sn.code, codeRaw: g(L.code), name: sn.name,
      task: trim(text(g(L.task))), stage: trim(text(g(L.stage))), amt: g(L.amt) == null ? null : num(g(L.amt)), amtRaw: g(L.amt),
      period: trim(text(g(L.period))), plan: wk(text(g(L.plan))), newv: wk(text(g(L.newv))), rev: wk(text(g(L.rev))), le: wk(text(g(L.le))),
      month: trim(text(g(L.month))), needs: g(L.needs), needsText: text(g(L.needs)),
    };
  }
  const isOldRow = (f) => !/^\d{1,2}월$/.test(f.month);

  // ---------- 권역 자료 ----------
  // xlsx 워크북 → 수주풀 스냅샷 (서식 포함)
  function readRegionWorkbook(wb) {
    const { pool } = findSheets(wb);
    if (!pool) throw new Error('수주풀 시트를 찾지 못했습니다.');
    const L = poolLayout(pool);
    const { rows } = readPool(pool, L);
    return { L, rows, sheetName: pool.name, week: findSheets(wb).sum ? text(findSheets(wb).sum.getCell('X1').value) : '' };
  }

  // 붙여넣기(TSV) → 값만 있는 행 (서식은 템플릿에서)
  function readRegionPaste(str, region, TL) {
    const grid = parseTSV(str);
    let h = -1;
    for (let i = 0; i < Math.min(grid.length, 30); i++) { const ks = grid[i].map(norm); if (ks.includes('업체명') && ks.includes('코드')) { h = i; break; } }
    if (h < 0) throw new Error('붙여넣은 내용에서 헤더(코드/업체명) 행을 찾지 못했습니다. 헤더 행까지 함께 복사해 주세요.');
    const map = {}; // src idx -> template col
    grid[h].forEach((t, j) => { const k = norm(t); const c = TL.headers[k]; if (c && !Object.values(map).includes(c)) map[j] = c; });
    // 머리글이 비어 있는 열(보조 열 등)은 업체명 열 기준 같은 위치로
    const hn = grid[h].findIndex((t) => norm(t) === '업체명');
    const labeled = new Set(Object.values(TL.headers));
    grid[h].forEach((t, j) => {
      if (j in map || norm(t)) return;
      const c = j + 1 + (TL.name - 1 - hn);
      if (c >= 1 && c <= TL.maxCol && !labeled.has(c) && !Object.values(map).includes(c)) map[j] = c;
    });
    const nameIdx = Object.keys(map).find((j) => map[j] === TL.name);
    const rows = [];
    for (let i = h + 1; i < grid.length; i++) {
      const src = grid[i]; if (!trim(src[nameIdx])) continue;
      const vals = {};
      Object.keys(map).forEach((j) => {
        const c = map[j]; let v = src[j] == null ? '' : src[j];
        if (c === TL.amt) { const t = trim(v).replace(/,/g, ''); v = t === '' ? null : /^-+$/.test(t) ? 0 : (isFinite(Number(t)) ? Number(t) : v); } // 회계서식 '-' = 0
        else if (c === TL.code) { const t = trim(v); v = /^\d+$/.test(t) ? Number(t) : t; }
        else if (c !== TL.needs) v = trim(v) === '' ? null : trim(v);
        else v = v === '' ? null : v.replace(/\n+$/, '');
        vals[c] = v;
      });
      const reg = trim(vals[TL.reg]);
      if (!REGIONS.includes(reg)) vals[TL.reg] = region;
      rows.push({ vals, region: vals[TL.reg], name: trim(vals[TL.name]), code: trim(text(vals[TL.code])), get key() { return this.code + '|' + this.name; }, pasted: true });
    }
    return { rows };
  }

  // 올린 권역 파일이 어느 권역을 수정했는지 추정 (템플릿과 달라진 행 수)
  function guessRegion(tplRows, regRows) {
    const idx = {}; tplRows.forEach((r) => { (idx[r.key] = idx[r.key] || []).push(r); });
    const score = { '경북권역': 0, '부산권역': 0, '경남권역': 0 };
    const sig = (sn) => sn.cells.map((c) => (c.f ? '' : text(c.v))).join('\u0001');
    regRows.forEach((r) => {
      if (!(r.region in score)) return;
      const t = idx[r.key];
      if (!t) score[r.region] += 2;
      else if (!t.some((x) => sig(x) === sig(r))) score[r.region] += 1;
    });
    const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    return { region: score[best] > 0 ? best : null, score };
  }

  // ---------- 병합 ----------
  // tpl: 템플릿 행 스냅샷, inputs: {region: {rows, mode:'file'|'paste'}}
  function mergeRows(tplRows, inputs, TL, W) {
    let out = tplRows.slice();
    const log = [];
    REGIONS.forEach((region) => {
      const inp = inputs[region]; if (!inp) return;
      const L = inp.L || TL;
      const src = inp.rows;
      const mine = src.filter((r) => r.region === region);
      const res = { region, mode: inp.mode, source: mine.length, updated: [], added: [], removed: [], same: 0 };
      // 템플릿의 해당 권역 행과 키+순번으로 매칭
      const occ = {}; const tplIdx = {};
      out.forEach((r, i) => { if (r.region === region) { const n = (occ[r.key] = (occ[r.key] || 0) + 1); tplIdx[r.key + '#' + n] = i; } });
      const occ2 = {}; const matched = new Set();
      const replacement = {}; const newRows = [];
      mine.forEach((r) => {
        const n = (occ2[r.key] = (occ2[r.key] || 0) + 1);
        const i = tplIdx[r.key + '#' + n];
        if (i != null) { matched.add(i); replacement[i] = r; } else newRows.push(r);
      });
      // 갱신
      Object.keys(replacement).forEach((i) => {
        i = +i; const t = out[i], r = replacement[i];
        const merged = inp.mode === 'paste' ? applyPaste(t, r, TL) : adaptRow(r, L, TL);
        const changed = diffCols(t, merged, TL);
        if (changed.length) res.updated.push({ name: t.name, code: t.code, changed });
        else res.same++;
        out[i] = merged;
      });
      // 삭제 (파일 모드에서 권역 파일에 없는 템플릿 행)
      if (inp.mode === 'file') {
        const del = new Set();
        out.forEach((r, i) => { if (r.region === region && !matched.has(i)) { del.add(r); res.removed.push({ name: r.name, code: r.code }); } });
        if (del.size) out = out.filter((r) => !del.has(r));
      }
      // 신규 추가: 해당 권역의 마지막 행(권역 신규 블록 끝) 뒤에 원래 순서대로
      newRows.forEach((r) => {
        let row;
        if (inp.mode === 'paste') {
          const base = [...out].reverse().find((x) => x.region === region) || out[out.length - 1];
          row = applyPaste(base, r, TL, true);
        } else row = adaptRow(r, L, TL);
        let at = -1;
        out.forEach((x, i) => { if (x.region === region) at = i; });
        out.splice(at + 1, 0, row);
        res.added.push({ name: row.name, code: row.code });
      });
      log.push(res);
    });
    return { rows: out, log };
  }

  // 다른 레이아웃(열 위치)의 행을 템플릿 열 위치로 옮김 (보통 동일)
  function adaptRow(r, L, TL) {
    if (L === TL || sameLayout(L, TL)) return r;
    const cells = new Array(TL.maxCol).fill(null).map(() => ({ v: null, s: {} }));
    Object.keys(TL.headers).forEach((k) => { const a = L.headers[k], b = TL.headers[k]; if (a && b) cells[b - 1] = clone(r.cells[a - 1]); });
    const merges = (r.merges || []).map(([a, b]) => { const k = Object.keys(L.headers).find((h) => L.headers[h] === a); const nb = k && TL.headers[k]; return nb ? [nb, nb + (b - a)] : null; }).filter(Boolean);
    return decorate({ cells, height: r.height, merges }, TL);
  }
  function sameLayout(a, b) { return Object.keys(b.headers).every((k) => a.headers[k] === b.headers[k]); }

  function applyPaste(t, p, TL, isNew) {
    const sn = { cells: t.cells.map((c) => ({ v: isNew ? null : clone(c.v), s: clone(c.s), f: c.f })), height: t.height, merges: clone(t.merges) };
    Object.keys(p.vals).forEach((c) => {
      let v = p.vals[c];
      // 붙여넣기 금액은 화면 표시값(반올림)이므로, 반올림해서 같으면 원래 값 유지 (예: 11.87 ↔ 11.9)
      if (!isNew && +c === TL.amt && sameShown(sn.cells[c - 1].v, v)) v = sn.cells[c - 1].v;
      sn.cells[c - 1].v = v; delete sn.cells[c - 1].f;
    });
    return decorate(sn, TL);
  }

  function sameShown(orig, pasted) {
    const o = orig == null || text(orig).trim() === '' || /^-+$/.test(text(orig).trim()) ? 0 : num(orig);
    const p = pasted == null ? 0 : typeof pasted === 'number' ? pasted : num(pasted);
    const dec = (String(pasted).split('.')[1] || '').length;
    return Math.abs(o - p) <= 0.5 * Math.pow(10, -dec) + 1e-9;
  }

  function diffCols(a, b, L) {
    const names = {}; Object.keys(L.headers).forEach((k) => { names[L.headers[k]] = k; });
    const out = [];
    for (let c = 1; c <= L.maxCol; c++) {
      const x = a.cells[c - 1], y = b.cells[c - 1];
      if (!x || !y || x.f || y.f) continue;
      if (text(x.v) !== text(y.v)) out.push(names[c] || colLetter(c));
    }
    return out;
  }

  // ---------- 수주풀 쓰기 ----------
  // 템플릿 첫 데이터행의 수식 → 행번호 치환 패턴
  function formulaPatterns(tplRows, L) {
    const pats = {};
    const first = tplRows[0];
    if (!first) return pats;
    const r0 = first.srcRow;
    first.cells.forEach((c, i) => {
      if (!c.f) return;
      const re = new RegExp('(\\$?[A-Z]{1,3})(\\$?)' + r0 + '(?!\\d)', 'g');
      pats[i + 1] = c.f.replace(re, (m, col, d) => (d ? m : col + '{r}'));
    });
    return pats;
  }

  function writeRow(ws, r, sn, maxCol, pats) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      const o = sn ? sn.cells[c - 1] : null;
      if (sn && pats && pats[c]) cell.value = { formula: pats[c].replace(/\{r\}/g, r) };
      else if (o && o.f && !pats) cell.value = { formula: o.f };
      else if (o && o.f) cell.value = o.v && typeof o.v === 'object' && 'result' in o.v ? (o.v.result == null ? null : clone(o.v.result)) : null;
      else cell.value = o ? clone(o.v) : null;
      cell.style = o ? clone(o.s) : {};
      if (o && o.note) cell.note = clone(o.note); else if (cell.note) cell.note = undefined;
    }
    row.height = sn && sn.height ? sn.height : undefined;
    row.hidden = !!(sn && sn.hidden);
    row.outlineLevel = (sn && sn.outline) || 0;
  }

  function unmergeRows(ws, fromRow, toRow) {
    Object.values(ws._merges || {}).map((rg) => rg.model || rg).forEach((m) => {
      if (m.top >= fromRow && m.top <= toRow) ws.unMergeCells(m.top, m.left, m.bottom, m.right);
    });
  }

  function writePool(ws, L, rows, oldLast, pats) {
    const first = L.hdr + 1;
    const newLast = first + rows.length - 1;
    const end = Math.max(oldLast, newLast);
    // 데이터 아래 빈 서식행(있으면) 스타일 보존
    const blank = snapRow(ws, oldLast + 1, L.maxCol, {});
    unmergeRows(ws, first, end);
    rows.forEach((sn) => { sn.hidden = false; sn.outline = 0; });
    blank.hidden = false; blank.outline = 0;
    for (let c = 1; c <= L.maxCol + 5; c++) { const col = ws.getColumn(c); if (col.hidden) col.hidden = false; if (col.outlineLevel) col.outlineLevel = 0; }
    rows.forEach((sn, i) => writeRow(ws, first + i, sn, L.maxCol, pats));
    for (let r = newLast + 1; r <= end; r++) writeRow(ws, r, blank, L.maxCol, null);
    for (let r = first; r <= ws.rowCount; r++) { const row = ws.getRow(r); if (row.hidden) row.hidden = false; if (row.outlineLevel) row.outlineLevel = 0; }
    rows.forEach((sn, i) => (sn.merges || []).forEach(([a, b]) => { if (b > a) ws.mergeCells(first + i, a, first + i, b); }));
    if (ws.autoFilter) {
      const af = typeof ws.autoFilter === 'string' ? ws.autoFilter : null;
      if (af) ws.autoFilter = af.replace(/(\d+)$/, (m) => String(Math.max(+m, end)));
    }
    return { first, last: newLast };
  }

  // ---------- 영업진행종합(영남영업본부) ----------
  // 수식 안의 상대 열 참조를 +n 칸 이동
  function shiftFormulaCols(f, n) {
    let out = '', i = 0, inQ = false, inS = false;
    while (i < f.length) {
      const ch = f[i];
      if (ch === '"') { inQ = !inQ; out += ch; i++; continue; }
      if (!inQ && ch === "'") { inS = !inS; out += ch; i++; continue; }
      if (inQ || inS) { out += ch; i++; continue; }
      const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/.exec(f.slice(i));
      const prev = i ? f[i - 1] : '';
      if (m && !/[A-Za-z0-9_.]/.test(prev)) {
        const col = m[1] ? m[2] : colLetter(colNum(m[2]) + n);
        out += m[1] + col + m[3] + m[4]; i += m[0].length; continue;
      }
      out += ch; i++;
    }
    return out;
  }

  function findRowWith(ws, pred, from, to) {
    for (let r = from || 1; r <= (to || ws.rowCount); r++) {
      let hit = null;
      ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => { if (hit == null && pred(text(c.value), n)) hit = n; });
      if (hit != null) return { r, c: hit };
    }
    return null;
  }

  // 방문실적 표에서 W 주차 열 찾기 — 없으면 다음 달 주차 열을 옆에 추가
  function ensureWeekColumn(ws, W, warn) {
    const h = findRowWith(ws, (t) => norm(t) === '4월이전');
    if (!h) return null;
    const hr = h.r, c0 = h.c;
    const scan = () => { const w = []; for (let c = c0 + 1; c < c0 + 80; c++) { const t = text(ws.getCell(hr, c).value); if (isWeek(t)) w.push({ c, w: wk(t) }); else break; } return w; };
    let weeks = scan();
    let target = weeks.find((x) => x.w === W);
    for (let guard = 0; !target && guard < 3 && weeks.length; guard++) {
      const lastM = +monthOf(weeks[weeks.length - 1].w).replace('월', '');
      const nextM = lastM % 12 + 1;
      if (lastM !== 12 && weekOrder(W) < weekOrder(nextM + '월 1주')) break;
      addMonthColumns(ws, hr, weeks[weeks.length - 1].c, nextM + '월', monthWeeks(nextM), sumMaxCol(ws) + 6);
      weeks = scan();
      target = weeks.find((x) => x.w === W);
      if (warn) warn.push('방문실적 표에 ' + nextM + '월 주차 열을 ' + weeks.filter((x) => monthOf(x.w) !== nextM + '월').slice(-1)[0].w + ' 옆으로 추가했습니다 (합계/누계/당월은 오른쪽으로 이동).');
    }
    return { hr, c0, weeks, target };
  }

  function updateVisitTable(ws, W) {
    const warn = [];
    const e = ensureWeekColumn(ws, W, warn);
    if (!e) { warn.push('방문실적 표(4월 이전)를 찾지 못해 주차 열 갱신을 건너뜀'); return warn; }
    const { hr, c0, weeks, target } = e;
    if (!target) {
      warn.push('방문실적 표에 "' + W + '" 열을 만들 수 없어 주차 열 수식 갱신을 건너뜀');
      return warn;
    }
    const lastWeekCol = weeks[weeks.length - 1].c;
    // 데이터 행: 헤더 아래 B열이 채워진 행
    const rows = [];
    for (let r = hr + 1; r < hr + 40; r++) { if (!trim(text(ws.getCell(r, 2).value))) break; rows.push(r); }
    // 보고주차까지 비어있는 열에 이전 열 수식 복제
    rows.forEach((r) => {
      for (let c = c0 + 1; c <= target.c; c++) {
        const cur = ws.getCell(r, c), prev = ws.getCell(r, c - 1);
        if ((cur.value == null || cur.value === '') && prev.type === 6) cur.value = { formula: shiftFormulaCols(prev.formula, 1) };
      }
    });
    // 합계/누계/당월 열
    const M = monthOf(W);
    const mIdx = weeks.filter((x) => monthOf(x.w) === M);
    const firstM = mIdx.length ? mIdx[0].c : target.c;
    const lastM = mIdx.length ? mIdx[mIdx.length - 1].c : target.c;
    const prevEnd = firstM - 1;
    const prevMonth = monthOf(text(ws.getCell(hr, prevEnd).value)) || '';
    const labelRow = hr - 1;
    for (let c = lastWeekCol + 1; c <= lastWeekCol + 6; c++) {
      const cell = ws.getCell(labelRow, c);
      const t = text(cell.value); const k = norm(t);
      let kind = null;
      if (k.startsWith('합계')) { kind = 'sum'; cell.value = t.replace(/\(([^)]*?)\d{1,2}월\s*\d주([^)]*)\)/, (m, a, b) => '(' + a + W.replace(' ', '') + b + ')'); }
      else if (k.startsWith('누계')) { kind = 'cum'; if (prevMonth) cell.value = t.replace(/~\s*\d{1,2}월/, '~' + prevMonth); }
      else if (k.startsWith('당월')) kind = 'mon';
      if (!kind) continue;
      rows.forEach((r) => {
        const x = ws.getCell(r, c);
        if (x.type !== 6) return;
        const m = /^SUM\((\$?)([A-Z]{1,3})(\$?)(\d+):(\$?)([A-Z]{1,3})(\$?)(\d+)\)$/.exec(x.formula);
        if (!m) return;
        let a = m[2], b = m[6];
        if (kind === 'sum') b = colLetter(target.c);
        if (kind === 'cum') b = colLetter(prevEnd);
        if (kind === 'mon') { a = colLetter(firstM); b = colLetter(lastM); }
        x.value = { formula: 'SUM(' + m[1] + a + m[3] + m[4] + ':' + m[5] + b + m[7] + m[8] + ')' };
      });
    }
    return warn;
  }

  // ---------- 하단 목록 ----------
  const SECTION_KIND = [
    [/^▶LE동행방문대상/, 'leTarget'], [/^▶LE차주방문요청/, 'leNext'], [/^▶계약성사/, 'contract'],
    [/^▶금주주요업체/, 'main'], [/^▶전주LE동행방문/, 'le'], [/^▶전주재방문/, 'rev'],
    [/^◎금주주요업체/, 'bonbuWeek'], [/^◎본부니즈\/견적주요업체리스트/, 'bonbuList'],
  ];
  const FIELD_OF = {
    '구분': 'k', '주차': 'k', '팀/권역': 'region', '팀권역': 'region', '담당자': 'mgr', '그룹/일반': 'grp', '코드': 'code', '업체명': 'name',
    '추진과제/범위': 'task', '진행단계': 'stage', '예상매출(억원)': 'amt', '사업시기': 'period', '계약예상시기': 'period',
    '주요이슈및고객사Needs': 'text', '추가진행현황': 'text', '진행현황': 'text', '추가진행주차': 'addWeek', '지점': 'branch',
    '업종': 'biz', '지역': 'area', '업체연매출': 'sales', '사업구분': 'cat', '세부내용': 'text',
  };

  function readSections(ws, maxCol) {
    const t0 = findRowWith(ws, (t, n) => n === 2 && /^▶LE동행방문/.test(norm(t)));
    if (!t0) return null;
    const merges = rowMergeMap(ws);
    const last = ws.rowCount;
    const isTitle = (r) => { const t = norm(text(ws.getCell(r, 2).value)); return /^[▶◎]/.test(t) ? t : null; };
    const hasVal = (r) => { for (let c = 2; c <= maxCol; c++) if (trim(text(ws.getCell(r, c).value))) return true; return false; };
    const secs = [];
    let r = t0.r;
    while (r <= last) {
      const title = isTitle(r);
      if (!title) { r++; continue; }
      const sec = { title, kind: 'other', titleRow: snapRow(ws, r, maxCol, merges), header: null, data: [], tail: [], srcTitleRow: r };
      SECTION_KIND.forEach(([re, k]) => { if (re.test(title)) sec.kind = k; });
      let q = r + 1;
      if (q <= last && !isTitle(q) && hasVal(q)) {
        sec.header = snapRow(ws, q, maxCol, merges);
        sec.cols = {};
        sec.header.cells.forEach((c, i) => { const f = FIELD_OF[norm(text(c.v))]; if (f && !(f in sec.cols)) sec.cols[f] = i + 1; });
        const hk = sec.header.cells.map((c) => norm(text(c.v)));
        const wIdx = hk.indexOf('추가진행주차'); if (wIdx >= 0) { sec.cols.addWeek = wIdx + 1; const t2 = hk.indexOf('추가진행현황'); if (t2 >= 0) sec.cols.addText = t2 + 1; const t1 = hk.indexOf('주요이슈및고객사Needs'); if (t1 >= 0) sec.cols.text = t1 + 1; }
        q++;
        while (q <= last && !isTitle(q) && hasVal(q)) { sec.data.push(snapRow(ws, q, maxCol, merges)); q++; }
      }
      while (q <= last && !isTitle(q)) { sec.tail.push(snapRow(ws, q, maxCol, merges)); q++; }
      secs.push(sec);
      r = q;
    }
    return { start: t0.r, secs, end: last };
  }

  function setField(sn, cols, f, v) { const c = cols[f]; if (c) { sn.cells[c - 1].v = v; delete sn.cells[c - 1].f; } }
  function fieldVal(sn, cols, f) { const c = cols[f]; return c ? sn.cells[c - 1].v : null; }

  // 텍스트 행 높이 추정 (병합 폭 기준, 잘리지 않게 넉넉히)
  function estHeight(v, widthChars, fontSize, min) {
    const s = text(v);
    const units = (line) => { let u = 0; for (const ch of line) u += ch.charCodeAt(0) > 0x2E80 ? 2.0 : 1.05; return u; };
    const w = Math.max(8, widthChars * 0.95);
    const lines = s.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(units(line) / w)), 0);
    const lh = (fontSize || 10) * 1.45;
    return Math.min(409, Math.max(min || 18, Math.round((lines * lh + 10) * 4) / 4));
  }
  function spanWidth(ws, sn, col) {
    const m = (sn.merges || []).find(([a, b]) => a <= col && col <= b) || [col, col];
    let w = 0; for (let c = m[0]; c <= m[1]; c++) w += ws.getColumn(c).width || 9;
    return w;
  }

  // 1. / 2. / 3. 항목 사이에 빈 줄 한 칸
  function spaceSections(v) {
    const one = (t) => {
      const lines = String(t).split('\n'); const out = [];
      lines.forEach((ln, i) => {
        if (i > 0 && /^\d+\s*\.(?!\d)/.test(ln) && +/^\d+/.exec(ln)[0] >= 2 && out.length && out[out.length - 1].trim() !== '') out.push('');
        out.push(ln);
      });
      return out.join('\n');
    };
    if (typeof v === 'string') return one(v);
    if (v && v.richText) return { richText: v.richText.map((r, i) => Object.assign({}, r, { text: i === 0 ? one(r.text) : r.text.replace(/\n(\d+\s*\.(?!\d))/g, (m, x) => (+/^\d+/.exec(x)[0] >= 2 ? '\n\n' + x : m)) })) };
    return v;
  }

  function makeRow(style, cols, f, ws) {
    const sn = clone(style);
    sn.hidden = false; sn.outline = 0;
    sn.cells.forEach((c) => { c.v = null; delete c.f; delete c.note; });
    const put = (k, v) => setField(sn, cols, k, v === '' ? null : v);
    ['k', 'region', 'mgr', 'grp', 'code', 'name', 'task', 'stage', 'amt', 'period', 'text', 'addWeek', 'addText'].forEach((k) => { if (k in f) put(k, f[k]); });
    const tc = cols.text;
    if (tc && ws) {
      const fs = (sn.cells[tc - 1].s.font && sn.cells[tc - 1].s.font.size) || 10;
      let h = estHeight(f.text, spanWidth(ws, sn, tc), fs, 18);
      if (cols.addText && f.addText) h = Math.max(h, estHeight(f.addText, spanWidth(ws, sn, cols.addText), fs, 18));
      sn.height = h;
    }
    return sn;
  }

  function codeVal(f) { return f.codeRaw != null && f.codeRaw !== '' ? clone(f.codeRaw) : (/^\d+$/.test(f.code) ? Number(f.code) : f.code); }
  function amtVal(f) { return typeof f.amtRaw === 'number' ? f.amtRaw : (f.amt == null ? null : f.amt); }

  // 금주 방문 업체 후보. 기본 배치: 신규방문→금주 주요, 재방문→전주 재방문, LE 동행→전주 LE (화면에서 바꿀 수 있음)
  function weekCandidates(rows, L, W, bonbuKeys) {
    return rows.map((sn, i) => ({ sn, i, f: fields(sn, L) })).filter((x) => x.f.newv === W || x.f.rev === W || x.f.le === W).map((x) => {
      const key = x.sn.key;
      return {
        key, idx: x.i, region: x.f.region, name: x.f.name, code: x.f.code, mgr: x.f.mgr, stage: x.f.stage, amt: x.f.amt, task: x.f.task,
        isNew: x.f.newv === W, isRev: x.f.rev === W, isLE: x.f.le === W, visit: x.f.newv === W || x.f.rev === W,
        inBonbu: bonbuKeys.has(key), place: x.f.newv === W ? 'main' : x.f.rev === W ? 'rev' : 'none', // 기본: 신규방문→금주 주요, 재방문→전주 재방문
      };
    }).sort((a, b) => (STAGE_RANK[b.stage] || 0) - (STAGE_RANK[a.stage] || 0) || (b.amt || 0) - (a.amt || 0) || a.idx - b.idx);
  }

  const REGION_ORDER = { '경북권역': 0, '부산권역': 1, '경남권역': 2 };
  const listKey = (sn, cols) => trim(text(fieldVal(sn, cols, 'code'))) + '|' + trim(text(fieldVal(sn, cols, 'name')));

  // opts: { selection: {key: 'main'|'rev'|'none'}, bonbu: [key...], manual, addBonbu, fixText }
  function rebuildSections(ws, info, rows, L, W, opts) {
    const maxCol = info.maxCol;
    const byKey = {}; rows.forEach((sn) => { if (!byKey[sn.key]) byKey[sn.key] = sn; });
    const F = (sn) => fields(sn, L);
    // ◎ 금주 주요 업체(본부) 섹션은 없앤다 — 본부 반영은 리스트의 추가진행 주차/현황으로
    let secs = info.secs.filter((s) => s.kind !== 'bonbuWeek');
    secs.forEach((s) => { if (/^▶본부주요업체/.test(s.title)) s.tail = []; });
    const mainSec = secs.find((s) => s.kind === 'main');
    const log = { bonbuAdded: [], bonbuUpdated: [], sheetFixes: 0 };
    const choose = opts.selection || {};
    const bonbuSel = new Set(opts.bonbu || []);

    // 본부 니즈/견적 리스트
    const list = secs.find((s) => s.kind === 'bonbuList');
    if (list && list.cols) {
      // 화면에서 수정한 업체는 리스트 행도 같은 값으로, 삭제한 업체는 리스트에서도 뺀다
      const ed = opts._edit;
      if (ed) {
        list.data = list.data.filter((sn) => !ed.deleted.has(listKey(sn, list.cols)));
        list.data.forEach((sn) => {
          const k0 = listKey(sn, list.cols); const k = ed.renamed[k0] || k0;
          if (!ed.touched.has(k) || !byKey[k]) return;
          const f = F(byKey[k]);
          const vals = { region: f.region, mgr: f.mgr, grp: f.grp || null, code: codeVal(f), name: f.name, task: f.task, stage: f.stage, amt: amtVal(f), period: f.period };
          Object.keys(vals).forEach((x) => setField(sn, list.cols, x, vals[x]));
          if (text(fieldVal(sn, list.cols, 'addWeek')) === W) setField(sn, list.cols, 'addText', clone(f.needs)); else setField(sn, list.cols, 'text', clone(f.needs));
        });
      }
      const have = new Set(list.data.map((sn) => listKey(sn, list.cols)));
      // 화면에서 '본부'로 고른 업체 중 이미 리스트에 있는 업체 → 추가진행 주차/현황
      list.data.forEach((sn) => {
        const k = listKey(sn, list.cols); const p = byKey[k];
        if (!p || !bonbuSel.has(k)) return;
        const f = F(p);
        setField(sn, list.cols, 'addWeek', W);
        setField(sn, list.cols, 'addText', clone(f.needs));
        log.bonbuUpdated.push(f.name);
      });
      // 새로 추가: 니즈확인/견적/계약이 된 업체(자동) + 화면에서 '본부'로 고른 업체 → 맨 아래에 권역 순, 매출 상위 순
      const style = list.data[list.data.length - 1] || list.header;
      const adds = [];
      rows.forEach((sn) => {
        if (have.has(sn.key)) return;
        const f = F(sn);
        const auto = opts.addBonbu !== false && !isOldRow(f) && KEY_STAGES.includes(f.stage);
        if (!auto && !bonbuSel.has(sn.key)) return;
        have.add(sn.key);
        adds.push({ f, picked: bonbuSel.has(sn.key) });
      });
      adds.sort((a, b) => (REGION_ORDER[a.f.region] ?? 9) - (REGION_ORDER[b.f.region] ?? 9) || (b.f.amt || 0) - (a.f.amt || 0));
      adds.forEach(({ f, picked }) => {
        const nr = clone(style);
        nr.hidden = false; nr.outline = 0;
        nr.cells.forEach((c) => { c.v = null; delete c.f; delete c.note; });
        const vals = { region: f.region, mgr: f.mgr, grp: f.grp || null, code: codeVal(f), name: f.name, task: f.task, stage: f.stage, amt: amtVal(f), period: f.period, text: clone(f.needs) };
        if (picked) { vals.addWeek = W; }
        Object.keys(vals).forEach((k) => setField(nr, list.cols, k, vals[k]));
        list.data.push(nr);
        log.bonbuAdded.push(f.name);
      });
    }
    const bonbuKeys = new Set(list ? list.data.map((sn) => listKey(sn, list.cols)) : []);
    const cands = weekCandidates(rows, L, W, bonbuKeys);

    const coRow = (sec, f, k) => {
      const style = sec.data[0] || (mainSec && mainSec.data[0]) || sec.tail[0] || sec.header;
      const cols = sec.data[0] || !mainSec ? sec.cols : mainSec.cols;
      return makeRow(style, cols, { k, region: f.region, mgr: f.mgr, grp: f.grp, code: codeVal(f), name: f.name, task: f.task, stage: f.stage, amt: amtVal(f), period: f.period, text: spaceSections(clone(f.needs)) }, ws);
    };
    const pick = (place) => cands.filter((c) => c.visit && (choose[c.key] || c.place) === place).map((c) => F(rows[c.idx]));

    secs.forEach((sec) => {
      if (sec.kind === 'main') sec.data = pick('main').map((f) => coRow(sec, f, f.newv === W ? '신규' : '기존'));
      else if (sec.kind === 'rev') sec.data = pick('rev').map((f) => coRow(sec, f, '기존'));
      else if (sec.kind === 'le') sec.data = cands.filter((c) => c.isLE && choose['LE:' + c.key] !== 'none').map((c) => F(rows[c.idx])).map((f) => coRow(sec, f, f.newv === W ? '신규' : '기존'));
      else if (opts.manual && opts.manual[sec.kind]) {
        const style = sec.data[0] || sec.tail[0] || sec.header;
        sec.data = opts.manual[sec.kind].map((vals) => {
          const sn = clone(style); sn.cells.forEach((c) => { c.v = null; delete c.f; });
          const hdrCols = sec.header.cells.map((c, i) => (text(c.v) ? i + 1 : null)).filter(Boolean);
          vals.forEach((v, j) => { const c = hdrCols[j]; if (c) sn.cells[c - 1].v = v === '' ? null : v; });
          const tc = hdrCols[hdrCols.length - 1];
          sn.height = estHeight(vals[vals.length - 1], spanWidth(ws, sn, tc), (sn.cells[tc - 1].s.font && sn.cells[tc - 1].s.font.size) || 10, Math.min(sn.height || 18, 27));
          return sn;
        });
      }
      // 앞시트의 옮겨 온 서술도 수주풀과 같은 규칙으로 오탈자·띄어쓰기 수정
      if (opts.fixText !== false && ['leTarget', 'leNext', 'contract', 'bonbuList'].includes(sec.kind)) {
        sec.data.forEach((sn) => sn.cells.forEach((c) => {
          if (typeof c.v === 'string' && (c.v.length >= 15 || c.v.includes('\n')) || (c.v && c.v.richText)) {
            const lg = []; c.v = fixValue(c.v, lg); if (lg.length) log.sheetFixes++;
          }
        }));
      }
    });

    const pos = writeSections(ws, info.start, info.end, secs, maxCol);
    // 본부 리스트 제목: 업체 수를 수식으로 (행을 더 넣어도 자동 갱신)
    if (list && list.cols && pos.list) {
      const { title, first, last } = pos.list;
      const nameCol = colLetter(list.cols.name);
      const label = String(text(list.titleRow.cells[1].v)).replace(/\s*\d+\s*업체\s*$/, '');
      ws.getCell(title, 2).value = { formula: '"' + label.replace(/"/g, '""') + ' "&COUNTA(' + nameCol + first + ':' + nameCol + Math.max(first, last) + ')&"업체"', result: label + ' ' + list.data.length + '업체' };
    }
    return { cands, log };
  }

  // 섹션 목록을 start 행부터 차례로 쓰기 (기존 영역은 비우고 병합/유효성 재부착)
  function writeSections(ws, start, oldEnd, secs, maxCol) {
    const dvCells = [];
    const seq = [];
    const pos = {};
    secs.forEach((s) => {
      const t = start + seq.length;
      seq.push(s.titleRow); if (s.header) seq.push(s.header);
      const first = start + seq.length;
      s.data.forEach((d) => seq.push(d));
      if (s.kind === 'bonbuList') pos.list = { title: t, first, last: start + seq.length - 1 };
      s.tail.forEach((x) => seq.push(x));
    });
    const newEnd = start + seq.length - 1;
    const end = Math.max(oldEnd, newEnd);
    unmergeRows(ws, start, end);
    for (let r = start; r <= end; r++) for (let c = 1; c <= maxCol; c++) { const cell = ws.getCell(r, c); if (cell.dataValidation) cell.dataValidation = undefined; }
    seq.forEach((sn, i) => {
      writeRow(ws, start + i, sn, maxCol, null);
      sn.cells.forEach((c, j) => { if (c.dv) dvCells.push([start + i, j + 1, c.dv]); });
    });
    for (let r = newEnd + 1; r <= end; r++) writeRow(ws, r, null, maxCol, null);
    seq.forEach((sn, i) => (sn.merges || []).forEach(([a, b]) => { if (b > a) ws.mergeCells(start + i, a, start + i, b); }));
    dvCells.forEach(([r, c, dv]) => { ws.getCell(r, c).dataValidation = dv; });
    pos.end = newEnd;
    return pos;
  }

  // ---------- 붙여넣기로 지난주 제출본 복원 ----------
  // 서식만 있는 빈 틀(kit)에 엑셀에서 복사해 붙여넣은 지난주 시트 값을 채워 넣어 템플릿 워크북을 만든다.

  // 붙여넣은 셀 문자열 → 셀 값 (숫자처럼 보이면 숫자)
  function cellVal(s) {
    if (s == null) return null;
    const raw = String(s);
    const t = raw.trim();
    if (t === '') return null;
    if (/^-?[\d,]*\d(\.\d+)?$/.test(t) && !/^-?0\d/.test(t) && t.replace(/[^\d]/g, '').length < 15) return Number(t.replace(/,/g, ''));
    return raw.includes('\n') ? raw.replace(/\n+$/, '') : t;
  }
  function locate(grid, pred) {
    for (let r = 0; r < grid.length; r++) { const row = grid[r] || []; for (let c = 0; c < row.length; c++) if (pred(norm(row[c]))) return { r, c }; }
    return null;
  }
  const rowHasVal = (vals) => vals.some((v, i) => i >= 1 && trim(v) !== '');

  // 요약 시트 상단(집계표·방문실적 표): 수식이 아닌 입력 칸(방문계획 값, 4월 이전 실적, 주차, 라벨)만 붙여넣은 값으로
  function fillSummaryTop(ws, grid, topEnd, maxCol) {
    const a = locate(grid, (t) => t === '누계진행현황');
    const k = findRowWith(ws, (t) => norm(t) === '누계진행현황');
    if (!a || !k) throw new Error('영남영업본부 붙여넣기에서 "누계 진행현황" 표를 찾지 못했습니다. 영남영업본부 시트 전체(Ctrl+A)를 복사해 붙여넣어 주세요.');
    const dr = a.r - (k.r - 1), dc = a.c - (k.c - 1);
    const g = (r, c) => { const row = grid[r - 1 + dr]; return row ? row[c - 1 + dc] : undefined; };
    for (let r = 1; r <= topEnd; r++) {
      const isPlan = norm(text(ws.getCell(r, 3).value)) === '방문계획';
      for (let c = 1; c <= maxCol; c++) {
        const cell = ws.getCell(r, c);
        if (cell.type === 6) continue;
        const v = g(r, c); if (v === undefined) continue;
        const kitEmpty = cell.value == null || cell.value === '';
        if (kitEmpty && !isPlan) continue;
        const t = trim(v);
        if (typeof cell.value === 'string' && norm(cell.value) === norm(v)) continue; // 같은 라벨은 틀 그대로
        if (t === '') { if (isPlan || typeof cell.value === 'number') cell.value = null; continue; }
        cell.value = /^-+$/.test(t) && (isPlan || typeof cell.value === 'number') ? 0 : cellVal(v);
      }
    }
    return { dr, dc };
  }

  // 요약 시트 하단 목록: 붙여넣은 섹션 값을 틀의 섹션 서식으로
  function fillSummarySections(ws, grid, off, kitInfo, maxCol) {
    const g = (r0, c) => { const row = grid[r0]; return row ? row[c - 1 + off.dc] : undefined; };
    const rowVals = (r0) => { const v = []; for (let c = 1; c <= maxCol; c++) v.push(g(r0, c) == null ? '' : g(r0, c)); return v; };
    const titleOf = (r0) => { const t = norm(g(r0, 2)); return /^[▶◎]/.test(t) ? t : null; };
    let r0 = -1;
    for (let i = 0; i < grid.length; i++) if (/^▶LE동행방문/.test(norm(g(i, 2)))) { r0 = i; break; }
    if (r0 < 0) throw new Error('영남영업본부 붙여넣기에서 "▶ LE 동행방문 대상 리스트" 를 찾지 못했습니다.');
    const kitSecs = kitInfo.secs;
    const kitMain = kitSecs.find((s) => s.kind === 'main');
    const out = [];
    let r = r0;
    while (r < grid.length) {
      const title = titleOf(r);
      if (!title) { r++; continue; }
      let kind = 'other'; SECTION_KIND.forEach(([re, kk]) => { if (re.test(title)) kind = kk; });
      const ks = kitSecs.find((s) => s.kind === kind) || kitSecs.find((s) => s.title === title) || kitMain;
      const sec = { title, kind, titleRow: clone(ks.titleRow), header: null, data: [], tail: [] };
      sec.titleRow.cells[1].v = cellVal(g(r, 2));
      let q = r + 1;
      if (q < grid.length && !titleOf(q) && rowHasVal(rowVals(q))) {
        sec.header = clone(ks.header || kitMain.header);
        rowVals(q).forEach((v, i) => { if (trim(v) && !(sec.header.cells[i].f)) sec.header.cells[i].v = cellVal(v); });
        q++;
        const style = ks.data[0] || (kitMain && kitMain.data[0]) || ks.tail[0] || sec.header;
        while (q < grid.length && !titleOf(q) && rowHasVal(rowVals(q))) {
          const sn = clone(style);
          sn.cells.forEach((c, i) => { c.v = cellVal(rowVals(q)[i]); delete c.f; delete c.note; });
          if (kind !== 'bonbuList') {
            let tc = 0; sec.header.cells.forEach((c, i) => { if (trim(text(c.v))) tc = i + 1; });
            if (tc) sn.height = estHeight(sn.cells[tc - 1].v, spanWidth(ws, sn, tc), (sn.cells[tc - 1].s.font && sn.cells[tc - 1].s.font.size) || 10, Math.min(style.height || 18, 27));
          }
          sec.data.push(sn); q++;
        }
      }
      sec.tail = clone(ks.tail && ks.tail.length ? ks.tail : [{ cells: new Array(maxCol).fill(null).map(() => ({ v: null, s: {} })), height: 18, merges: [] }]);
      while (q < grid.length && !titleOf(q)) q++;
      out.push(sec);
      r = q;
    }
    writeSections(ws, kitInfo.start, kitInfo.end, out, maxCol);
  }

  // 수주풀: 붙여넣은 전체 행을 틀의 데이터행 서식으로
  function fillPool(ws, L, str) {
    const kit = readPool(ws, L);
    const base = kit.rows[0];
    if (!base) throw new Error('틀(kit) 수주풀에 서식 행이 없습니다.');
    const oldBase = kit.rows[1] || base; // 과거분(25 3Q, 2510 …) 행 서식
    const p = readRegionPaste(str, null, L);
    const rows = p.rows.map((r) => applyPaste(L.month && !/^\d{1,2}월$/.test(trim(text(r.vals[L.month]))) ? oldBase : base, r, L, true));
    if (!rows.length) throw new Error('수주풀 붙여넣기에서 업체 행을 찾지 못했습니다.');
    writePool(ws, L, rows, kit.lastRow, formulaPatterns(kit.rows, L));
    return rows.length;
  }

  // 3번째 시트(재영업 등): 붙여넣은 표를 틀의 헤더/데이터행 서식으로 (표가 여러 개면 두 번째 표 서식 사용)
  function fillThird(ws, grid) {
    const maxCol = 30;
    const merges = rowMergeMap(ws);
    const isHdr = (vals) => { const k = vals.map(norm); return k.includes('업체명') && k.includes('코드'); };
    const kitRows = []; for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) kitRows.push(snapRow(ws, r, maxCol, merges));
    const kh = kitRows.map((sn, i) => (isHdr(sn.cells.map((c) => text(c.v))) ? i : -1)).filter((i) => i >= 0);
    if (!kh.length) return 0;
    const H = kh.map((i) => kitRows[i]);
    const D = kh.map((i) => kitRows[i + 1]);
    const blank = { cells: new Array(maxCol).fill(null).map(() => ({ v: null, s: {} })), height: undefined, merges: [] };
    const seq = [blank];
    let dataRows = 0;
    if (grid && grid.length) {
      const a = locate(grid, (t) => t === '업체명');
      const hc = H[0].cells.findIndex((c) => norm(text(c.v)) === '업체명');
      if (!a || hc < 0) throw new Error('3번째 시트 붙여넣기에서 헤더(업체명) 행을 찾지 못했습니다.');
      const dc = a.c - hc;
      let t = -1, started = false;
      for (let r0 = a.r; r0 < grid.length; r0++) {
        const vals = []; for (let c = 1; c <= maxCol; c++) { const row = grid[r0] || []; vals.push(row[c - 1 + dc] == null ? '' : row[c - 1 + dc]); }
        if (isHdr(vals)) { t++; started = true; const sn = clone(H[Math.min(t, H.length - 1)]); vals.forEach((v, i) => { if (trim(v)) sn.cells[i].v = cellVal(v); }); seq.push(sn); continue; }
        if (!started) continue;
        if (!rowHasVal(vals)) { seq.push(clone(blank)); continue; }
        const sn = clone(D[Math.min(t, D.length - 1)]);
        sn.cells.forEach((c, i) => { c.v = cellVal(vals[i]); delete c.f; delete c.note; });
        seq.push(sn); dataRows++;
      }
      while (seq.length > 1 && !seq[seq.length - 1].cells.some((c) => c.v != null)) seq.pop();
    } else {
      seq.push(clone(H[0]));
    }
    const end = Math.max(ws.rowCount, seq.length);
    unmergeRows(ws, 1, end);
    seq.forEach((sn, i) => writeRow(ws, i + 1, sn, maxCol, null));
    for (let r = seq.length + 1; r <= end; r++) writeRow(ws, r, null, maxCol, null);
    seq.forEach((sn, i) => (sn.merges || []).forEach(([a, b]) => { if (b > a) ws.mergeCells(i + 1, a, i + 1, b); }));
    return dataRows;
  }

  // kitBytes: 서식 틀 xlsx, p: { summary, pool, third } 붙여넣기 문자열
  async function templateFromPaste(ExcelJS, JSZip, kitBytes, p) {
    if (!trim(p.summary)) throw new Error('지난주 영남영업본부 시트를 붙여넣어 주세요.');
    if (!trim(p.pool)) throw new Error('지난주 영남대상업체(수주풀) 시트를 붙여넣어 주세요.');
    const wb = await loadWorkbook(ExcelJS, JSZip, kitBytes);
    const { pool, sum } = findSheets(wb);
    const L = poolLayout(pool);
    const n = fillPool(pool, L, p.pool);
    const maxCol = sumMaxCol(sum);
    const kitInfo = readSections(sum, maxCol);
    const grid = parseTSV(p.summary);
    const hp = locate(grid, (t) => t === '4월이전');
    if (hp) {
      let lastLabel = null; const row = grid[hp.r];
      for (let c = hp.c + 1; c < row.length; c++) { if (isWeek(row[c])) lastLabel = wk(row[c]); else break; }
      if (lastLabel) ensureWeekColumn(sum, lastLabel, null);
    }
    const off = fillSummaryTop(sum, grid, kitInfo.start - 1, sumMaxCol(sum));
    fillSummarySections(sum, grid, off, kitInfo, maxCol);
    const third = wb.worksheets.find((s) => s.state === 'visible' && s !== pool && s !== sum);
    let thirdRows = 0;
    if (third) thirdRows = fillThird(third, trim(p.third) ? parseTSV(p.third) : null);
    return { wb, info: { poolRows: n, thirdRows, thirdName: third ? third.name : null, week: wk(text(sum.getCell('X1').value)) } };
  }


  // ---------- 오탈자·띄어쓰기 자동 수정 ----------
  // 확실한 오탈자만 사전으로 고치고, 띄어쓰기는 기계적으로 안전한 규칙만 적용한다. 수정 내역은 기록해 화면에 보여준다.
  const TYPO = [
    [/현항/g, '현황'], [/형황/g, '현황'], [/무인지제차/g, '무인지게차'], [/없슴/g, '없음'], [/학인/g, '확인'],
    [/효률/g, '효율'], [/셔틀렉/g, '셔틀랙'], [/(^|[^가-힣])렉(?=[가-힣\s,.)/(]|$)/gm, '$1랙'], [/(\d)단렉/g, '$1단랙'],
    [/이였/g, '이었'], [/인플플렌자/g, '인플루엔자'], [/복음밥/g, '볶음밥'], [/따루/g, '따로'], [/(^|[^가-힣])부관(?=\s)/gm, '$1보관'],
    [/주가 수요/g, '추가 수요'], [/대하 니즈/g, '대한 니즈'], [/증성/g, '증설'], [/(^|[^가-힣])청고(?=[\s,.)])/gm, '$1창고'],
    [/(^|[^가-힣])내동(?=육|제품|창고|보관|,|\s*창고)/gm, '$1냉동'], [/내장육/g, '냉장육'], [/본시 및/g, '본사 및'], [/청북 청주/g, '충북 청주'],
    [/로 인애/g, '로 인해'], [/지동상하차/g, '자동상하차'], [/예정이였/g, '예정이었'],
  ];
  const SPACE = [
    [/([^\s\n])[ \t]{2,}(?=\S)/g, '$1 ', '공백'],                 // 줄 중간 중복 공백
    [/[ \t]+$/gm, '', '~줄끝 공백'],
    [/([가-힣A-Za-z)])\s+,(?=\s|[가-힣])/g, '$1,', '쉼표 앞 공백'],
    [/([가-힣A-Za-z)]),(?=[가-힣A-Za-z(])/g, '$1, ', '쉼표 뒤 띄움'],
    [/\(\s+(?=\S)/g, '(', '괄호 공백'], [/(\S)\s+\)/g, '$1)', '괄호 공백'],
    [/\n{3,}/g, '\n\n', '~빈 줄'], [/^\n+/, '', '~앞 빈 줄'], [/\s+$/, '', '~끝 공백'],
  ];
  function fixText(t, log, noSpace) {
    if (t == null) return t;
    let s = String(t);
    TYPO.forEach(([re, to]) => {
      s = s.replace(re, (...m) => {
        const from = m[0];
        const res = from.replace(new RegExp(re.source, re.flags.replace('g', '')), to);
        if (res !== from) log.push(trim(from) + '→' + trim(res));
        return res;
      });
    });
    if (!noSpace) SPACE.forEach(([re, to, label]) => { const before = s; s = s.replace(re, to); if (s !== before && label[0] !== '~') log.push('#' + label); });
    return s;
  }
  function fixValue(v, log) {
    if (v == null) return v;
    if (typeof v === 'string') return fixText(v, log);
    if (v.richText) return { richText: v.richText.map((r) => Object.assign({}, r, { text: fixText(r.text, log, true) })) };
    return v;
  }
  const periodFix = (v, log) => { if (typeof v !== 'string') return v; const r = v.replace(/(\d{2})년\s*(\d)\s*Q/, '$1년 $2Q'); if (r !== v) log.push('#사업시기'); return r; };
  function summarizeFix(log) {
    const typos = [...new Set(log.filter((x) => x[0] !== '#'))];
    const sp = log.filter((x) => x[0] === '#').length;
    return (typos.length ? '오타 ' + typos.join(', ') : '') + (sp ? (typos.length ? ' · ' : '') + '띄어쓰기 ' + sp + '곳' : '');
  }
  // 수주풀 행 전체에 적용 (추진과제, Needs, 사업시기)
  function fixRows(rows, L) {
    const out = {};
    rows.forEach((sn) => {
      const log = [];
      [L.task, L.needs].forEach((c) => { if (c && !sn.cells[c - 1].f) sn.cells[c - 1].v = fixValue(sn.cells[c - 1].v, log); });
      if (L.period && !sn.cells[L.period - 1].f) sn.cells[L.period - 1].v = periodFix(sn.cells[L.period - 1].v, log);
      if (log.length) out[sn.key] = summarizeFix(log);
    });
    return out;
  }
  // 비고(AF)·월구분(AG)이 비어 있으면 채움: 비고 ← 그룹/일반(없으면 '신규'), 월구분 ← 첫 방문월
  function fillNoteMonth(rows, L, W) {
    rows.forEach((sn) => {
      const f = fields(sn, L);
      if (L.note && !trim(text(sn.cells[L.note - 1].v))) sn.cells[L.note - 1].v = f.grp || '신규';
      if (L.month && !trim(text(sn.cells[L.month - 1].v))) sn.cells[L.month - 1].v = monthOf(f.newv) || monthOf(f.rev) || monthOf(f.plan) || monthOf(W);
    });
  }

  // ---------- 사업구분 ↔ 추진과제 일치 점검 ----------
  const FLAG_KW = [
    ['스태커크레인', /스태커/], ['멀티셔틀시스템', /셔틀|4\s*way|2\s*way/i], ['자동상하차', /상하차/], ['복합로봇자동화', /복합\s*로봇/],
    ['AGVAMR', /AGV|AMR/i], ['무인지게차AGF', /무인\s*지게차|AGF/i], ['로봇파렛타이져', /파렛타이|팔레타이|파레타이/], ['모노레일', /모노레일/],
    ['자동소터로봇소터', /소터/], ['기타설비', /기타\s*설비/],
  ];
  const WAREHOUSE = /자동화?\s*창고|자동\s*창고|자동화\s*랙|ASRS/i; // 스태커 또는 멀티셔틀 중 하나
  const LABEL = { '스태커크레인': '스태커크레인', '멀티셔틀시스템': '멀티셔틀', '자동상하차': '자동상하차', '복합로봇자동화': '복합로봇', 'AGVAMR': 'AGV/AMR', '무인지게차AGF': '무인지게차', '로봇파렛타이져': '로봇파렛타이져', '모노레일': '모노레일', '자동소터로봇소터': '소터', '기타설비': '기타설비' };
  function checkRow(sn, L) {
    const task = trim(text(sn.cells[L.task - 1].v));
    const on = {}; let any = false;
    Object.keys(LABEL).forEach((k) => { const c = L.headers[k]; if (c && trim(text(sn.cells[c - 1].v)).toUpperCase() === 'O') { on[k] = true; any = true; } });
    const issues = [];
    if (!task) issues.push('추진과제 없음');
    if (!any) issues.push('사업구분 O 표시 없음');
    const need = [];
    FLAG_KW.forEach(([k, re]) => { if (re.test(task)) need.push(k); });
    need.forEach((k) => { if (!on[k]) issues.push('추진과제 「' + task + '」인데 ' + LABEL[k] + ' 표시 없음'); });
    if (WAREHOUSE.test(task) && !on['스태커크레인'] && !on['멀티셔틀시스템'] && !need.includes('스태커크레인') && !need.includes('멀티셔틀시스템'))
      issues.push('추진과제 「' + task + '」(자동화창고)인데 스태커/멀티셔틀 표시 없음');
    // 추진과제가 구체적 설비만 적혀 있는데 다른 구분에 표시된 경우
    const specific = need.length || WAREHOUSE.test(task);
    if (specific && !/설비|자동화$|엔지니어링|WMS|WCS|TMS|랙/.test(task.replace(/자동화\s*창고/g, ''))) {
      Object.keys(on).forEach((k) => {
        const ok = need.includes(k) || (WAREHOUSE.test(task) && (k === '스태커크레인' || k === '멀티셔틀시스템'));
        if (!ok) issues.push('확인: ' + LABEL[k] + ' 표시는 추진과제 「' + task + '」에 없음');
      });
    }
    return issues;
  }
  function checkRows(rows, L, keys) {
    const out = {};
    rows.forEach((sn) => { if (keys && !keys.has(sn.key)) return; const i = checkRow(sn, L); if (i.length) out[sn.key] = i; });
    return out;
  }

  // ---------- 월 전환: 방문실적 표에 새 달 주차 열 추가 ----------
  // 9월 4주 다음(옆 열)에 새 달 주차 열을 넣고, 오른쪽 합계/누계/당월과 숨김 보조 열(AD~)은 그만큼 오른쪽으로 옮긴다.
  function addMonthColumns(ws, hr, lastWeekCol, month, nWeeks, maxCol) {
    const n = nWeeks;
    const r0 = hr - 1, r1 = (() => { let r = hr + 1; while (trim(text(ws.getCell(r, 2).value))) r++; return r - 1; })();
    const inBand = (r) => r >= r0 && r <= r1;
    const hiddenStart = (() => { for (let c = lastWeekCol + 1; c <= maxCol + 10; c++) if (ws.getColumn(c).hidden) return c; return maxCol + 1; })();
    const moves = (r, c) => (inBand(r) ? c > lastWeekCol : c >= hiddenStart);
    // 1) 수식 참조 보정 (같은 시트 참조만)
    const shiftRefs = (f) => {
      let out = '', i = 0, inQ = false, inS = false;
      while (i < f.length) {
        const ch = f[i];
        if (ch === '"') { inQ = !inQ; out += ch; i++; continue; }
        if (!inQ && ch === "'") { inS = !inS; out += ch; i++; continue; }
        if (inQ || inS) { out += ch; i++; continue; }
        const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/.exec(f.slice(i));
        const prev = i ? f[i - 1] : '';
        if (m && !/[A-Za-z0-9_.!]/.test(prev)) {
          const c = colNum(m[2]), r = +m[4];
          out += m[1] + (moves(r, c) ? colLetter(c + n) : m[2]) + m[3] + m[4]; i += m[0].length; continue;
        }
        out += ch; i++;
      }
      return out;
    };
    const last = ws.rowCount;
    for (let r = 1; r <= last; r++) for (let c = 1; c <= maxCol + n + 4; c++) { const x = ws.getCell(r, c); if (x.type === 6 && !x.value.sharedFormula) { const nf = shiftRefs(x.formula); if (nf !== x.formula) x.value = { formula: nf }; } }
    // 2) 병합 목록 보관 후 해제
    const merges = Object.values(ws._merges || {}).map((rg) => Object.assign({}, rg.model || rg));
    merges.forEach((m) => ws.unMergeCells(m.top, m.left, m.bottom, m.right));
    // 3) 셀 이동 (오른쪽부터)
    for (let r = 1; r <= last; r++) {
      const cmax = maxCol + 4;
      for (let c = cmax; c >= 1; c--) {
        if (!moves(r, c)) continue;
        const src = ws.getCell(r, c), dst = ws.getCell(r, c + n);
        dst.value = src.type === 6 ? { formula: src.formula } : clone(src.value); dst.style = clone(src.style || {});
        if (src.note) dst.note = clone(src.note);
        src.value = null; src.style = {};
      }
    }
    // 4) 새 주차 열: 마지막 주 열 서식 복제
    for (let k = 1; k <= n; k++) {
      const c = lastWeekCol + k;
      for (let r = r0; r <= r1; r++) { const tpl = ws.getCell(r, lastWeekCol); const x = ws.getCell(r, c); x.style = clone(tpl.style || {}); x.value = r === hr ? month + ' ' + k + '주' : null; }
    }
    // 5) 병합 복원 (방문계획/방문실적 머리글은 확장)
    merges.forEach((m) => {
      let { top, left, bottom, right } = m;
      if (inBand(top) && left <= lastWeekCol && right === lastWeekCol) right += n;
      else if (moves(top, left)) { left += n; right += n; }
      ws.mergeCells(top, left, bottom, right);
    });
    // 6) 열 숨김/너비: 숨김 보조 열 묶음도 오른쪽으로
    const hid = []; for (let c = hiddenStart; c <= maxCol + 4; c++) if (ws.getColumn(c).hidden) hid.push([c, ws.getColumn(c).width, ws.getColumn(c).outlineLevel]);
    hid.forEach(([c]) => { ws.getColumn(c).hidden = false; ws.getColumn(c).outlineLevel = 0; });
    hid.forEach(([c, w, o]) => { const col = ws.getColumn(c + n); col.width = w; col.hidden = true; col.outlineLevel = o; });
    for (let k = 1; k <= n; k++) { const col = ws.getColumn(lastWeekCol + k); if (!col.width || col.width < 8.75) col.width = ws.getColumn(lastWeekCol).width; }
  }
  function monthWeeks(month, refWeek) {
    const t = new Date(); let y = t.getFullYear();
    if (month > t.getMonth() + 3) y -= 1;
    return thursdays(y, month);
  }


  // ---------- 화면에서 업체 수정·추가·삭제 ----------
  const FLAG_KEYS = ['자동상하차', '스태커크레인', '멀티셔틀시스템', '복합로봇자동화', 'AGVAMR', '무인지게차AGF', '로봇파렛타이져', '모노레일', '자동소터로봇소터', '기타설비'];
  const FLAG_LABEL = { '자동상하차': '자동상하차', '스태커크레인': '스태커크레인', '멀티셔틀시스템': '멀티셔틀시스템', '복합로봇자동화': '복합로봇자동화', 'AGVAMR': 'AGV/AMR', '무인지게차AGF': '무인지게차/AGF', '로봇파렛타이져': '로봇파렛타이져', '모노레일': '모노레일', '자동소터로봇소터': '자동소터/로봇소터', '기타설비': '기타설비' };
  const FORM_COLS = { grp: 'grp', region: 'reg', mgr: 'mgr', code: 'code', name: 'name', task: 'task', stage: 'stage', amt: 'amt', period: 'period', plan: 'plan', newv: 'newv', rev: 'rev', le: 'le', note: 'note', month: 'month', needs: 'needs' };
  // 수주풀 행 → 수정 폼 값
  function rowForm(sn, L) {
    const g = (c) => (c ? sn.cells[c - 1].v : null);
    const f = {};
    Object.keys(FORM_COLS).forEach((k) => { const v = g(L[FORM_COLS[k]]); f[k] = k === 'amt' ? (v == null || v === '' ? '' : num(v)) : text(v); });
    f.flags = FLAG_KEYS.filter((k) => L.headers[k] && trim(text(g(L.headers[k]))).toUpperCase() === 'O');
    return f;
  }
  function setForm(sn, L, f) {
    Object.keys(FORM_COLS).forEach((k) => {
      if (!(k in f)) return;
      const c = L[FORM_COLS[k]]; if (!c) return;
      const cell = sn.cells[c - 1];
      let v = f[k];
      if (k === 'needs' && cell.v && cell.v.richText && text(cell.v) === v) return; // 서식 있는 원문은 그대로
      if (k === 'amt') v = v === '' || v == null ? null : (isFinite(Number(String(v).replace(/,/g, ''))) ? Number(String(v).replace(/,/g, '')) : v);
      else if (k === 'code') v = /^\d+$/.test(trim(v)) ? Number(trim(v)) : trim(v);
      else if (['plan', 'newv', 'rev', 'le'].includes(k)) v = wk(v) || null;
      else if (k === 'needs') v = String(v).replace(/\r\n?/g, '\n').replace(/\s+$/, '') || null;
      else v = trim(v) || null;
      cell.v = v; delete cell.f;
    });
    if (f.flags) FLAG_KEYS.forEach((k) => { const c = L.headers[k]; if (c) { sn.cells[c - 1].v = f.flags.includes(k) ? 'O' : null; delete sn.cells[c - 1].f; } });
    return decorate(sn, L);
  }
  // edits: {원래key: 폼값}, adds: [폼값], deletes: [key]
  function applyEdits(rows, L, edits, adds, deletes) {
    const renamed = {}; const touched = new Set();
    Object.keys(edits || {}).forEach((k) => {
      const sn = rows.find((r) => r.key === k); if (!sn) return;
      setForm(sn, L, edits[k]);
      if (sn.key !== k) renamed[k] = sn.key;
      touched.add(sn.key);
    });
    const del = new Set(deletes || []);
    const kept = rows.filter((r) => !del.has(r.key));
    (adds || []).forEach((f) => {
      const region = REGIONS.includes(f.region) ? f.region : REGIONS[0];
      const base = [...kept].reverse().find((x) => x.region === region && !isOldRow(fields(x, L))) || kept[kept.length - 1];
      const sn = { cells: base.cells.map((c) => ({ v: null, s: clone(c.s) })), height: base.height, merges: clone(base.merges), hidden: false, outline: 0 };
      setForm(sn, L, Object.assign({ note: '신규', grp: '신규' }, f, { region }));
      let at = -1; kept.forEach((x, i) => { if (x.region === region) at = i; });
      kept.splice(at + 1, 0, sn);
      touched.add(sn.key);
    });
    return { rows: kept, renamed, touched, deleted: del };
  }
  // 앞시트 별도 목록(LE 대상 / 차주 방문요청 / 계약성사) 읽기 — 화면 편집용
  function readLists(ctx) {
    const info = readSections(ctx.sum, sumMaxCol(ctx.sum));
    const out = {};
    if (!info) return out;
    info.secs.forEach((sec) => {
      if (!['leTarget', 'leNext', 'contract'].includes(sec.kind) || !sec.header) return;
      const cols = sec.header.cells.map((c, i) => (trim(text(c.v)) ? i + 1 : null)).filter(Boolean);
      out[sec.kind] = { title: text(sec.titleRow.cells[1].v), headers: cols.map((c) => text(sec.header.cells[c - 1].v).replace(/\s+/g, ' ').trim()), rows: sec.data.map((sn) => cols.map((c) => text(sn.cells[c - 1].v))) };
    });
    const list = info.secs.find((s) => s.kind === 'bonbuList');
    out.bonbuKeys = list && list.cols ? list.data.map((sn) => listKey(sn, list.cols)) : [];
    return out;
  }

  // 과거 양식에서 넘어온 숨김 정의된 이름(수천 개, #REF! 등)을 제거하고 연다 — ExcelJS 로딩이 수십 초 → 1초 미만
  async function loadWorkbook(ExcelJS, JSZip, data) {
    const zip = await JSZip.loadAsync(data);
    const p = 'xl/workbook.xml';
    const f = zip.file(p);
    if (f) {
      let x = await f.async('string');
      x = x.replace(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g, (m, a) => (/name="_xlnm\./.test(a) || !/hidden="1"/.test(a) ? m : ''));
      x = x.replace(/<definedNames>\s*<\/definedNames>/, '');
      zip.file(p, x);
    }
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    return wb;
  }

  // ---------- 메인 ----------
  // opts: { week, inputs: {region: {type:'file', wb} | {type:'paste', text}}, selection, manual, addBonbu }
  function prepare(ExcelJS, tplWb, opts) {
    const { pool, sum } = findSheets(tplWb);
    if (!pool || !sum) throw new Error('템플릿에서 영남영업본부 / 수주풀 시트를 찾지 못했습니다.');
    const TL = poolLayout(pool);
    const tpl = readPool(pool, TL);
    const inputs = {};
    const detected = [];
    Object.keys(opts.inputs || {}).forEach((region) => {
      const inp = opts.inputs[region]; if (!inp) return;
      if (inp.type === 'file') { const r = readRegionWorkbook(inp.wb); inputs[region] = { mode: 'file', rows: r.rows, L: r.L }; }
      else if (inp.type === 'paste' && trim(inp.text)) { const r = readRegionPaste(inp.text, region, TL); inputs[region] = { mode: 'paste', rows: r.rows }; }
    });
    const merged = mergeRows(tpl.rows, inputs, TL);
    const log = merged.log;
    const fixes = opts.fixText === false ? {} : fixRows(merged.rows, TL);
    const ed = applyEdits(merged.rows, TL, opts.edits, opts.adds, opts.deletes);
    const rows = ed.rows;
    const checks = checkRows(rows, TL);
    const changedKeys = new Set(); log.forEach((l) => { l.updated.forEach((u) => changedKeys.add(ed.renamed[u.code + '|' + u.name] || u.code + '|' + u.name)); l.added.forEach((u) => changedKeys.add(ed.renamed[u.code + '|' + u.name] || u.code + '|' + u.name)); });
    // 보고주차 추정: 입력 권역 행의 최신 방문주차, 없으면 템플릿 X1 다음 주
    const tplWeek = wk(text(sum.getCell('X1').value));
    let latest = null;
    Object.keys(inputs).forEach((region) => rows.filter((sn) => sn.region === region).forEach((sn) => {
      const f = fields(sn, TL); [f.newv, f.rev, f.le].forEach((w) => { if (isWeek(w) && (!latest || weekOrder(w) > weekOrder(latest))) latest = w; });
    }));
    const suggested = latest && weekOrder(latest) > weekOrder(tplWeek) ? latest : nextWeek(tplWeek);
    return { pool, sum, TL, tpl, rows, log, tplWeek, suggestedWeek: suggested, detected, fixes, checks, changedKeys, inputRegions: Object.keys(inputs), edit: ed };
  }

  function preview(ctx, W) {
    const info = readSections(ctx.sum, sumMaxCol(ctx.sum));
    const list = info && info.secs.find((s) => s.kind === 'bonbuList');
    const keys = new Set();
    if (list && list.cols) list.data.forEach((sn) => keys.add(trim(text(fieldVal(sn, list.cols, 'code'))) + '|' + trim(text(fieldVal(sn, list.cols, 'name')))));
    return weekCandidates(ctx.rows, ctx.TL, W, keys);
  }

  function build(ExcelJS, tplWb, ctx, W, opts) {
    opts = opts || {};
    const { pool, sum, TL, tpl } = ctx;
    const warn = [];
    // 1) 수주풀
    const pats = formulaPatterns(tpl.rows, TL);
    fillNoteMonth(ctx.rows, TL, W);
    writePool(pool, TL, ctx.rows, tpl.lastRow, pats);
    // 2) 요약 시트 주차
    const x1 = sum.getCell('X1');
    if (isWeek(text(x1.value))) x1.value = W; else warn.push('영남영업본부!X1 에 주차가 없어 확인 필요');
    const x3 = sum.getCell('X3');
    if (/^\d{1,2}월$/.test(trim(text(x3.value)))) x3.value = monthOf(W);
    updateVisitTable(sum, W).forEach((w) => warn.push(w));
    // 3) 하단 목록
    const maxCol = sumMaxCol(sum);
    const info = readSections(sum, maxCol);
    let res = { cands: [], log: {} };
    if (info) { info.maxCol = maxCol; res = rebuildSections(sum, info, ctx.rows, TL, W, Object.assign({ _edit: ctx.edit }, opts)); }
    else warn.push('하단 업체 목록(▶ LE 동행방문 대상 리스트)을 찾지 못해 목록 갱신을 건너뜀');
    // 4) 열 때 재계산
    tplWb.calcProperties = Object.assign({}, tplWb.calcProperties, { fullCalcOnLoad: true });
    stripResults(sum); stripResults(pool);
    return { warn, cands: res.cands, bonbu: res.log };
  }

  function sumMaxCol(ws) { let m = 24; for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => { if (n <= 60) m = Math.max(m, n); }); return m; }

  // 오래된 캐시값 제거 → 엑셀이 열 때 새로 계산
  function stripResults(ws) {
    ws.eachRow((row) => row.eachCell((c) => {
      if (c.type === 6) {
        const v = c.value;
        if (v.sharedFormula) c.value = { formula: c.formula };
        else if ('result' in v && !/^"/.test(v.formula)) c.value = { formula: v.formula };
      }
    }));
  }

  return {
    REGIONS, loadWorkbook, parseTSV, findSheets, poolLayout, readPool, readRegionWorkbook, guessRegion, prepare, preview, build,
    templateFromPaste, rowForm, readLists, FLAG_KEYS, FLAG_LABEL, KEY_STAGES, checkRow, nextWeek, wk, isWeek, monthOf, text, shiftFormulaCols, fields,
    // 틀(kit) 생성 도구용
    _i: { readSections, snapRow, writeRow, unmergeRows, rowMergeMap, writePool, formulaPatterns, writeSections, sumMaxCol, stripResults },
  };
});
