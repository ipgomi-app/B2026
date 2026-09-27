/* 영남영업본부 월간 영업회의자료 엔진
 *
 * 매달 받는 영남영업본부 양식(붙여넣기)과 사업별 계약·견적 데이터, 손익개선, 타겟업체, 농산업종
 * 붙여넣기로 영남영업본부 시트의 보고 부분(전월 실적·당월 계획·타겟·농산)을 만든다.
 * 서식은 완성본에서 데이터를 지운 틀(kit.js)의 행 서식을 복제한다.
 *
 * 브라우저(window.MonthlyEngine)와 Node(require) 양쪽에서 쓴다. ExcelJS·JSZip은 호출하는 쪽에서 넘긴다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MonthlyEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHEET = '영남영업본부';
  const SHEET2 = '(영남)하반기 신규추진계획', SHEET3 = '(영남)하반기 신규추진(세부)';
  const KEEP_SHEETS = ['영남영업본부', '(영남)하반기 신규추진계획', '(영남)하반기 신규추진(세부)'];
  const REGIONS = ['경북권역', '부산권역', '경남권역'];
  const BRANCH = {
    '부산지점': '부산권역', '양산지점': '부산권역', '울산지점': '부산권역', '포항지점': '부산권역',
    '김해지점': '경남권역', '창원지점': '경남권역', '진주지점': '경남권역', '제주지점': '경남권역',
    '구미지점': '경북권역', '대구지점': '경북권역', '영천지점': '경북권역', '안동지점': '경북권역',
  };
  const MAXCOL = 24; // A~X

  // ---------- 유틸 ----------
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
  const trim = (s) => String(s == null ? '' : s).trim();
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

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
  // 붙여넣은 칸 → 숫자 (" 1,234 ", "-1,234", " - ", "12.5%") 숫자가 아니면 null
  function toNum(s) {
    const t = trim(s).replace(/,/g, '');
    if (t === '') return null;
    if (t === '-') return 0;
    const pm = /^(-?[\d.]+)%$/.exec(t);
    if (pm) return +pm[1] / 100;
    if (/^-?\d+(\.\d+)?$/.test(t)) return +t;
    return null;
  }
  const numOr0 = (s) => { const n = toNum(s); return n == null ? 0 : n; };

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

  // 억 표기: 1억 이상 소수 1자리, 미만 2자리(반올림), 끝 0 제거 (천원 입력)
  function fmtEok(k) {
    const e = (k || 0) / 100000;
    let s = Math.abs(e) >= 1 ? e.toFixed(1) : e.toFixed(2);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  const fmtK = (k) => Math.round(k).toLocaleString('en-US');

  // ---------- 행 스냅샷 / 쓰기 ----------
  function allMerges(ws) { return Object.values(ws._merges || {}).map((rg) => clone(rg.model || rg)); }

  function snapRow(ws, r, maxCol) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      const slave = cell.isMerged && cell.master && cell.master.address !== cell.address;
      const o = { v: slave || cell.value == null ? null : clone(cell.value), s: clone(cell.style || {}) };
      if (cell.type === 6 /* Formula */) { o.f = cell.formula; o.v = o.v && typeof o.v === 'object' ? (o.v.result == null ? null : o.v.result) : null; }
      cells.push(o);
    }
    return { cells, height: row.height, hidden: !!row.hidden, src: r };
  }

  function writeRow(ws, r, sn, maxCol) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      const o = sn ? sn.cells[c - 1] : null;
      if (o && o.f) cell.value = { formula: o.f };
      else cell.value = o ? clone(o.v) : null;
      cell.style = o ? clone(o.s) : {};
    }
    row.height = sn && sn.height ? sn.height : undefined;
    row.hidden = !!(sn && sn.hidden);
  }

  function unmergeAll(ws) { allMerges(ws).forEach((m) => ws.unMergeCells(m.top, m.left, m.bottom, m.right)); }

  // 같은 시트 A1 참조의 행 옮기기: 행 >= from 인 참조만 delta 만큼. 다른 시트 참조('시트'!A1)는 그대로.
  function shiftRows(f, from, delta) {
    if (!delta) return f;
    let out = '', i = 0, inQ = false;
    while (i < f.length) {
      const ch = f[i];
      if (ch === '"') { inQ = !inQ; out += ch; i++; continue; }
      if (inQ) { out += ch; i++; continue; }
      if (ch === "'") { // 시트 이름 → 뒤 참조는 건너뜀
        const j = f.indexOf("'", i + 1); const k = j < 0 ? f.length : j + 1;
        out += f.slice(i, k); i = k;
        if (f[i] === '!') { const m = /^!\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?/.exec(f.slice(i)); if (m) { out += m[0]; i += m[0].length; } }
        continue;
      }
      const prev = i ? f[i - 1] : '';
      if (/[A-Z$]/.test(ch) && !/[A-Za-z0-9_.!가-힣]/.test(prev)) {
        const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_!])/.exec(f.slice(i));
        if (m) {
          // 뒤에 '!'가 오면 시트 이름(예: Sheet1!A1) → 건드리지 않음
          const r = +m[4];
          out += m[1] + m[2] + m[3] + (r >= from ? r + delta : r);
          i += m[0].length; continue;
        }
        const w = /^[A-Za-z_][A-Za-z0-9_.]*!/.exec(f.slice(i)); // 따옴표 없는 시트 이름
        if (w) { const m2 = /^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?/.exec(f.slice(i + w[0].length)); out += w[0] + (m2 ? m2[0] : ''); i += w[0].length + (m2 ? m2[0].length : 0); continue; }
      }
      out += ch; i++;
    }
    return out;
  }
  const isCrossSheet = (f) => /!/.test(String(f).replace(/"[^"]*"/g, ''));

  // ---------- 통합문서 열기/저장 ----------
  async function loadWorkbook(ExcelJS, JSZip, data) {
    const zip = await JSZip.loadAsync(data);
    const f = zip.file('xl/workbook.xml');
    if (f) {
      let x = await f.async('string');
      x = x.replace(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g, (m, a) => (/name="_xlnm\./.test(a) ? m : ''));
      x = x.replace(/<definedNames>\s*<\/definedNames>/, '');
      zip.file('xl/workbook.xml', x);
    }
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    return wb;
  }
  async function saveWorkbook(JSZip, wb) {
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
  // 오래된 계산값 제거 → 엑셀이 열 때 새로 계산
  function stripResults(ws) {
    ws.eachRow((row) => row.eachCell((c) => {
      if (c.type === 6) { const v = c.value; if (v.sharedFormula || 'result' in v) c.value = { formula: c.formula }; }
    }));
  }

  // ---------- 오탈자·띄어쓰기·금액 표기 ----------
  const TYPO = [
    [/현항/g, '현황'], [/형황/g, '현황'], [/없슴/g, '없음'], [/학인/g, '확인'], [/효률/g, '효율'],
    [/이였/g, '이었'], [/몰동량/g, '물동량'], [/에상매출/g, '예상매출'], [/예상 매출/g, '예상매출'],
    [/스트래치/g, '스트레치'], [/스트렛치/g, '스트레치'], [/게약/g, '계약'], [/견적서제출/g, '견적서 제출'],
    [/로 인애/g, '로 인해'], [/예정이였/g, '예정이었'], [/(\d)\s*만매\s*\/\s*년/g, '$1만매/년'],
  ];
  const SPACE = [
    [/([^\s\n])[ \t]{2,}(?=\S)/g, '$1 ', '공백'],
    [/[ \t]+$/gm, '', '~줄끝 공백'],
    [/([가-힣A-Za-z0-9)%])\s+,(?=\s|[가-힣A-Za-z0-9])/g, '$1,', '쉼표 앞 공백'],
    [/([가-힣A-Za-z)]),(?=[가-힣A-Za-z(])/g, '$1, ', '쉼표 뒤 띄움'],
    [/(\d[가-힣A-Za-z/)]*),(?=[가-힣A-Za-z(])/g, '$1, ', '쉼표 뒤 띄움'],
    [/\(\s+(?=\S)/g, '(', '괄호 공백'], [/(\S)\s+\)/g, '$1)', '괄호 공백'],
    [/\s*,\s*$/g, '', '~끝 쉼표'], [/^\s+|\s+$/g, '', '~앞뒤 공백'],
  ];
  function fixText(t, log) {
    if (t == null) return '';
    let s = String(t).replace(/\r?\n/g, ' ');
    TYPO.forEach(([re, to]) => { s = s.replace(re, (...m) => { const res = m[0].replace(new RegExp(re.source, re.flags.replace('g', '')), to); if (res !== m[0]) log.push(res.replace(/\s/g, '') === m[0].replace(/\s/g, '') ? '#띄어쓰기' : trim(m[0]) + '→' + trim(res)); return res; }); });
    SPACE.forEach(([re, to, label]) => { const b = s; s = s.replace(re, to); if (s !== b && label[0] !== '~') log.push('#' + label); });
    return s;
  }
  // 서술 금액 표기: 1,000천원(100만원) 이하 → N,NNN천원, 초과 → 억(fmtEok3)
  // 손익개선(old=true)은 예전 규칙: 5,000천원 이하 천원, 초과 억
  // 1억 이상 소수 1자리, 1천만원 이상 2자리(10,800 → 0.11), 그 아래 3자리(1,500 → 0.015). 끝 0 없음.
  const fmtEok3 = (k) => (k >= 100000 ? fmtEok(k) : String(+(k / 100000).toFixed(k >= 10000 ? 2 : 3)));
  const fmtAmt = (k, old) => (old ? (k <= 5000 ? fmtK(k) + '천원' : fmtEok(k) + '억') : k <= 1000 ? fmtK(k) + '천원' : fmtEok3(k) + '억');
  const AMT_RE = /(연\s*)?(예상\s*매출(?:액)?|효과\s*금액)\s*[:：]?\s*(?:약\s*)?(\d[\d,]*(?:\.\d+)?)\s*(억\s*원?|천\s*원|백\s*만\s*원|만\s*원|원)?\s*(\(년\)|\/\s*년|\/\s*건|\/\s*월|\.\s*년|원\/년)?/g;
  function amtToK(n, unit) {
    const u = norm(unit || '');
    if (/^억/.test(u)) return n * 100000;
    if (u === '천원') return n;
    if (u === '백만원') return n * 1000;
    if (u === '만원') return n * 10;
    if (u === '원') return n / 1000;
    return n < 100 ? n * 100000 : n; // 단위 없음: 작은 수는 억, 큰 수는 천원
  }
  // 서술의 금액 표기 바꾸기. 반환: { text, amounts: [{label, k}] }
  function fixAmounts(s, log, old) {
    const amounts = [];
    const out = s.replace(AMT_RE, (m, yr, label, num, unit, per) => {
      const k = amtToK(+num.replace(/,/g, ''), unit);
      const lab = /효과/.test(label) ? '효과금액' : '예상매출';
      amounts.push({ label: lab, k });
      const p = per && /건/.test(per) ? '/건' : per && /월/.test(per) ? '/월' : '/년';
      const res = lab + ' ' + fmtAmt(k, old) + p;
      if (norm(res) !== norm(m)) log.push('금액표기');
      return res;
    });
    return { text: out, amounts };
  }
  // log: '#…' 띄어쓰기, '금액표기', 그 밖은 오타. major=true면 작은 수정(띄어쓰기·금액표기)은 뺀다.
  function summarizeFix(log, major) {
    const typos = [...new Set(log.filter((x) => x[0] !== '#' && x !== '금액표기'))];
    const sp = log.filter((x) => x[0] === '#').length, am = log.filter((x) => x === '금액표기').length;
    return [typos.length ? '오타 ' + typos.join(', ') : '', !major && sp ? '띄어쓰기 ' + sp + '곳' : '', !major && am ? '금액표기 ' + am + '곳' : ''].filter(Boolean).join(' · ');
  }

  // ---------- 영남영업본부 양식 붙여넣기 ----------
  const nl = (s) => norm(s).replace(/[()（）]/g, (c) => c);
  const BIZ5 = [['PPS', 'PPS'], ['물류기기', '물류기기'], ['SCM', 'SCM'], ['산업자재', '산업자재유통'], ['RRPP&ULS', 'RRPP&ULS']];
  const REG4 = [['경북', 0], ['부산', 5], ['경남', 10], ['영남', 15]];

  function parseForm(str) {
    const g = parseTSV(str);
    if (!g.length || !/영업현황\s*보고/.test(g[0][0] || '')) throw new Error('양식 첫 줄에 "[2026년 N월 영업현황 보고 - 영남영업본부]" 제목이 없습니다. 영남영업본부 시트 B열부터 전체를 복사해 붙여넣어 주세요.');
    let month = null;
    for (let c = 10; c < g[0].length; c++) { const n = toNum(g[0][c]); if (n && n >= 1 && n <= 12 && Number.isInteger(n)) { month = n; break; } }
    if (!month) { const m = /(\d{1,2})월/.exec(g[0][0]); if (m) month = +m[1]; }
    if (!month) throw new Error('양식에서 기준월(T1)을 찾지 못했습니다.');
    const cell = (r, c) => (g[r] && g[r][c] != null ? g[r][c] : '');
    const secs = []; g.forEach((row, r) => { if (/^※/.test(trim(row[0]))) secs.push({ r, name: norm(row[0]) }); });
    const secRange = (re) => { const i = secs.findIndex((s) => re.test(s.name)); if (i < 0) return null; return [secs[i].r, i + 1 < secs.length ? secs[i + 1].r : g.length]; };
    const findRow = (pred, rg) => { const [a, b] = rg || [0, g.length]; for (let r = a; r < b; r++) if (pred(g[r] || [], r)) return r; return -1; };
    const mcol = (m) => 3 + m - 1;
    const val = (r, m) => (r < 0 ? 0 : numOr0(cell(r, mcol(m))));
    // 사업별 월 매출 (5사업 × 4권역)
    const biz = {};
    BIZ5.forEach(([key, label]) => {
      const r0 = findRow((row) => norm(row[0]) === norm(label) && norm(row[2]) === '매출목표');
      if (r0 < 0) throw new Error('양식에서 ' + label + ' 사업부문 표를 찾지 못했습니다.');
      biz[key] = {};
      REG4.forEach(([reg, off]) => { biz[key][reg] = { tgt: r0 + off, act: r0 + off + 1, dif: r0 + off + 2 }; });
    });
    // 전월 머리글 건수·금액
    const hdr = {};
    const qc = (rg, m) => {
      const r = findRow((row) => (norm(row[0]) === '본부계' || norm(row[1]) === '본부계') && norm(row[2]) === '견적(건수)', rg);
      return r < 0 ? null : { q: [val(r, m), val(r + 1, m)], c: [val(r + 2, m), val(r + 3, m)] };
    };
    const pair = (rg, m) => {
      if (!rg) return null;
      let q = [0, 0], c = [0, 0], found = false;
      for (let r = rg[0]; r < rg[1]; r++) {
        const row = g[r] || [];
        if (norm(row[1]) === '견적' && norm(row[2]) === '건수') { q = [q[0] + val(r, m), q[1] + val(r + 1, m)]; found = true; }
        if (norm(row[1]) === '계약' && norm(row[2]) === '건수') { c = [c[0] + val(r, m), c[1] + val(r + 1, m)]; found = true; }
      }
      return found ? { q, c } : null;
    };
    const rPPS = secRange(/^※PPS/), rSCM = secRange(/^※SCM/), rMRO = secRange(/^※산업자재/), rGLB = secRange(/^※RRPP/);
    hdr.PPS = qc(rPPS, month); hdr.SCM = pair(rSCM, month); hdr.MRO = pair(rMRO, month); hdr.GLB = qc(rGLB, month);
    // 손익개선 당월 실적 (영남영업본부 행: 업체수, 효과금액)
    let sonik = null;
    const rs = findRow((row) => /손익개선\(단가인상\)/.test(norm(row[0])), rPPS);
    if (rs >= 0) { const r = findRow((row) => norm(row[0]) === '영남영업본부', [rs, rs + 12]); if (r >= 0) sonik = { n: numOr0(cell(r, 1)), k: numOr0(cell(r, 2)) }; }
    // 맨 위 권역 합계표(매출 목표·실적, 월별 + 1~기준월 누계 열)
    const top = {};
    const TOP_REG = { 경북권역: '경북', 부산권역: '부산', 경남권역: '경남', 영남영업본부: '영남' };
    for (let r = 0; r < Math.min(g.length, 40); r++) { const reg = TOP_REG[norm(cell(r, 1))]; if (reg && norm(cell(r, 2)) === '매출목표' && !top[reg]) top[reg] = { tgt: r, act: r + 1, dif: r + 2 }; }
    const cumCol = mcol(12) + 2; // 년도계 다음 열 = 1~기준월 누계
    return { grid: g, month, biz, hdr, sonik, val, top: Object.keys(top).length === 4 ? top : null, cumOf: (r) => numOr0(cell(r, cumCol)) };
  }
  // 실적 표 합계와 맨 위 권역 합계표 대조: 합계 칸은 상단표 값을 쓰므로, 5사업 합과 차이가 크면 알리기만 한다.
  function checkPerf(P, m, checks, title) {
    const big = [];
    REG4.forEach(([reg]) => {
      const p = P[reg]; if (!p.tot) return;
      [['tgt', '목표'], ['act', '실적'], ['ctgt', '누계 목표'], ['cact', '누계 실적']].forEach(([f, lab]) => {
        const sum = p[f].reduce((x, y) => x + y, 0), want = p.tot[f];
        if (Math.abs(want - sum) > Math.max(1000, Math.abs(want) * 0.001)) big.push(reg + ' ' + lab + ': 사업 합 ' + fmtK(sum) + ' / 상단표 ' + fmtK(want));
      });
    });
    big.forEach((x) => checks.push({ kind: '실적표 ↔ 상단표', text: title + ' 차이 큼 ' + x }));
  }
  // 전월/당월 실적 표 값: 양식에 보이는 숫자 그대로. 5사업 × 권역 × (목표, 실적, 차이) 당월·누계.
  // 누계는 양식의 1~기준월 누계 열(당월 계획은 거기에 기준월+1 값을 더함). 합계 칸은 맨 위 권역 합계표 값.
  function perfValues(form, m) {
    const out = {};
    const cum = (r) => form.cumOf(r) + (m === form.month ? 0 : form.val(r, m));
    REG4.forEach(([reg]) => {
      const o = out[reg] = { tgt: [], act: [], dif: [], ctgt: [], cact: [], cdif: [] };
      BIZ5.forEach(([key]) => {
        const rr = form.biz[key][reg];
        o.tgt.push(form.val(rr.tgt, m)); o.act.push(form.val(rr.act, m)); o.dif.push(form.val(rr.dif, m));
        o.ctgt.push(cum(rr.tgt)); o.cact.push(cum(rr.act)); o.cdif.push(cum(rr.dif));
      });
      const t = form.top && form.top[reg];
      if (t) o.tot = { tgt: form.val(t.tgt, m), act: form.val(t.act, m), dif: form.val(t.dif, m), ctgt: cum(t.tgt), cact: cum(t.act), cdif: cum(t.dif) };
    });
    return out;
  }

  // ---------- 사업·타겟·농산·손익개선 데이터 붙여넣기 ----------
  const NAME_KEYS = ['업체명', '계약처명', '계약업체(도착지)', 'KPP거래처명'];
  const CTYPE_RE = /^\d{2}-(PALLET|SCM|산업자재유통|글로벌비즈|RRPP|ULS)/;
  const BIZ_OF_CTYPE = { PALLET: 'PPS', SCM: 'SCM', 산업자재유통: 'MRO', 글로벌비즈: 'GLB', RRPP: 'GLB', ULS: 'GLB' };
  const BIZ_NAME = { PPS: 'PPS', SCM: 'SCM', MRO: '산업자재유통', GLB: '글로벌비즈', MHE: '지게차' };
  const isCode = (s) => /^\d{6}$/.test(trim(s));
  const STATUS_RE = /^(결재완료|반려|결재반려|반려됨|결재중|결재진행|결재진행중|상신|상신중|임시저장|회수|기안|기안중|결재대기|취소)$/;
  const monthOfCell = (s) => {
    const t = trim(s); if (!t) return null;
    let m = /^(\d{4})[-.](\d{1,2})[-.]\d{1,2}/.exec(t); if (m) return +m[2];
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(t); if (m) return +m[2];
    m = /^(\d{2})(\d{2})$/.exec(t); if (m && +m[2] >= 1 && +m[2] <= 12) return +m[2];
    m = /^(\d{1,2})월/.exec(t); if (m) return +m[1];
    m = /^(\d{1,2})$/.exec(t); if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1];
    return null;
  };
  const HDR_WORDS = /^(업체명|계약처명|계약업체\(도착지\)|KPP거래처명|코드|부서|팀\/권역|진행단계|진행여부|적용월|경쟁사매출|업체운영여부|방문|견적|계약|예상매출|실적반영월|계획월)$/;
  function isSubHeader(row) {
    const cells = row.map(trim).filter(Boolean);
    if (cells.length < 2) return false;
    if (cells.some((c) => isCode(c) || REGIONS.includes(c) || BRANCH[c] || toNum(c) != null)) return false;
    return cells.some((c) => HDR_WORDS.test(norm(c)) || /年|\(천원\)|여부|월$/.test(c));
  }
  function readTable(str) {
    const g = parseTSV(str).filter((row) => row.some((c) => trim(c)));
    let h = -1;
    for (let r = 0; r < Math.min(g.length, 6) && h < 0; r++) if (g[r].some((c) => NAME_KEYS.includes(norm(c)))) h = r;
    const names = [];
    let start = 0;
    if (h >= 0) {
      const sub = g[h + 1] && isSubHeader(g[h + 1]) ? g[h + 1] : null;
      const w = Math.max(g[h].length, sub ? sub.length : 0);
      for (let c = 0; c < w; c++) names.push(norm((sub && trim(sub[c])) || g[h][c] || ''));
      start = h + (sub ? 2 : 1);
    }
    return { rows: g.slice(start), names, hasHeader: h >= 0 };
  }
  function scoreDesc(t) {
    if (!t || t.length < 8) return -99;
    let s = 0;
    if (/예상\s*매출|효과\s*금액/.test(t)) s += 3;
    if (/물동량/.test(t)) s += 2;
    if (/,/.test(t)) s += 1;
    const first = trim(t.split(/[,，]/)[0]);
    if (first.length <= 8 && /[가-힣]/.test(first)) s += 2;
    if (/보증|미수|채권|법조치|담보|신용등급|입금|납부|발주 중단|공급 중단/.test(t)) s -= 6;
    if (/^\[/.test(t) && /견적(요청|서)$/.test(t)) s -= 6;
    return s;
  }
  function bestDesc(row, prefIdx) {
    let best = -1, bs = -99;
    row.forEach((c, i) => { const s = scoreDesc(trim(c)) + (i === prefIdx ? 1 : 0); if (s > bs) { bs = s; best = i; } });
    if (prefIdx >= 0 && trim(row[prefIdx]) && scoreDesc(trim(row[prefIdx])) + 1 >= bs - 1) best = prefIdx;
    return { text: best >= 0 && bs > -5 ? trim(row[best]) : '', from: best, moved: best !== prefIdx && prefIdx >= 0 };
  }
  const stripNo = (s) => trim(s).replace(/^\d{2}-/, '');
  const MRO_ITEMS = [[/스트레치|스트래치|필름|랩핑/, '필름'], [/골판지|박스|지함|상자/, '골판지'], [/파렛트|팔레트/, '파렛트'], [/EPS|아이스박스|스티로폼|스치로폴/, 'EPS'], [/파우치|비닐|봉투/, '비닐포장재'], [/용기|보냉|아이스팩/, '용기']];
  const SCM_ITEMS = [[/풀필먼트|3PL/, '풀필먼트'], [/창고|보관/, '창고'], [/라토스|운송|수송|배송/, '운송']];
  const itemOf = (t, list, dflt) => { for (const [re, v] of list) if (re.test(t)) return v; return dflt; };

  // rec: { src, biz, stage, month, region, dept, code, name, amount(천원), gubun, desc, units, flags[] }
  function parseRecords(str, src) {
    const { rows, names, hasHeader } = readTable(str);
    const idx = (keys) => { for (const k of keys) { const i = names.indexOf(norm(k)); if (i >= 0) return i; } return -1; };
    const recs = [], dropped = [];
    rows.forEach((row) => {
      const at = (i) => (i >= 0 && row[i] != null ? trim(row[i]) : '');
      const get = (keys) => at(idx(keys));
      const r = { src: src.id, flags: [] };
      // 코드·업체명
      let ci = idx(['코드']); if (ci < 0 || !isCode(at(ci))) ci = row.findIndex(isCode);
      r.code = ci >= 0 ? at(ci) : get(['코드']);
      r.name = get(NAME_KEYS) || (ci >= 0 ? at(ci + 1) : '');
      if (!r.name) return;
      r.mgr = get(['담당자', '(실적)담당자', '담당', '담당프로', '영업담당']);
      // 결재상태: 결재완료가 아니면(반려·결재중 등) 표시해 두고 기본은 뺀다(상태 칸이 없으면 그대로 둠)
      if (src.kind === 'biz') {
        const hs = get(['결재상태', '결재']);
        const st = STATUS_RE.test(hs) ? hs : row.map(trim).find((c) => STATUS_RE.test(c));
        if (st && st !== '결재완료') r.status = st;
      }
      // 부서·권역
      r.dept = get(['부서', '팀/지점', '(실적)팀/지점', '소속']);
      let region = get(['팀/권역', '(실적)팀/권역', '권역']);
      const hq = get(['본부']);
      if (!BRANCH[r.dept]) { const b = row.map(trim).find((c) => BRANCH[c]); if (b) r.dept = b; }
      if (!REGIONS.includes(region)) region = REGIONS.includes(r.dept) ? r.dept : BRANCH[r.dept] || row.map(trim).find((c) => REGIONS.includes(c)) || '';
      if (hq && hq !== '영남영업본부') region = '';
      r.region = region;
      // 월
      let m = null;
      for (const k of ['월', '월별', '시행일', '적용월', '최종방문일']) { const i = idx([k]); if (i >= 0) { m = monthOfCell(at(i)); if (m) break; } }
      if (!m) for (const c of row) { if (/^\d{4}-\d{2}-\d{2}/.test(trim(c))) { m = monthOfCell(c); break; } }
      r.month = m;
      if (src.kind === 'biz') {
        const ct = get(['계약형태']) || row.map(trim).find((c) => CTYPE_RE.test(c)) || '';
        const cm = CTYPE_RE.exec(ct);
        r.biz = src.biz === 'MHE' ? 'MHE' : cm ? BIZ_OF_CTYPE[cm[1]] : src.biz;
        if (r.biz !== src.biz) r.flags.push('사업 옮김(' + BIZ_NAME[src.biz] + '→' + BIZ_NAME[r.biz] + ')');
        r.stage = src.stage;
        if (r.biz === 'MHE') {
          const mon = toNum(get(src.stage === '계약' ? ['확정금액'] : ['견적금액']));
          r.amount = mon == null ? 0 : Math.round(mon * 12 / 1000 / 100) * 100; // 연 금액, 백 단위 반올림(7,777 → 7,800)
          r.units = toNum(get(src.stage === '계약' ? ['계약대수'] : ['견적대수'])) || 0;
          r.gubun = '지게차';
          const place = (r.dept || '').replace(/지점$/, '');
          const eq = get(['장비2']) || get(['장비']);
          r.rawDesc = [place, (eq ? eq + ' ' : '') + (r.units ? r.units + '대' : ''), get(['비고'])].filter((x) => trim(x)).join(', ');
        } else {
          // 금액: 계약은 계약구분 칸 다음 숫자(예상, 효과), 견적은 '01-연간' 다음 숫자. 없으면 머리글.
          let exp = null, eff = null;
          const kIdx = row.findIndex((c) => /^\d{2}-.*계약$/.test(trim(c)));
          const yIdx = row.findIndex((c) => /^\d{2}-(연간|월간|건별)/.test(trim(c)));
          const numsAfter = (i) => { const a = []; for (let j = i + 1; j < row.length && a.length < 2; j++) { const n = toNum(row[j]); if (n != null && n >= 100) a.push(n); else if (trim(row[j]) && n == null) break; } return a; };
          if (src.stage === '계약' && kIdx >= 0) { const a = numsAfter(kIdx); exp = a[0]; eff = a[1]; }
          else if (yIdx >= 0) { exp = numsAfter(yIdx)[0]; }
          if (exp == null) exp = toNum(get(['예상매출액', '예상매출액(년)']));
          if (eff == null) eff = toNum(get(['효과금액(년)']));
          r.exp = exp == null ? 0 : exp / 1000; r.eff = eff == null ? null : eff / 1000;
          const usesEff = r.biz === 'PPS' && src.stage === '계약' && r.eff != null;
          r.amount = usesEff ? r.eff : r.exp;
          // 구분
          // 구분: 계약구분/영업구분(0N-신규…) 칸 바로 앞의 분류 칸(소분류, 그 앞 중분류)
          const ctI = row.findIndex((c) => CTYPE_RE.test(trim(c)));
          const kI = row.findIndex((c, i) => i > ctI && /^\d{2}-(신규|재계약|갱신|추가|증차|변경)/.test(trim(c)));
          const prevs = [];
          if (kI > 0) for (let i = kI - 1; i > ctI && prevs.length < 3; i--) { const t = trim(row[i]); if (t && !/^\d{2}-해당없음$/.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t)) prevs.push(t); }
          if (r.biz === 'PPS') {
            const comp = [get(['경쟁사구분']), get(['점유율확대']), ...row.map(trim).filter((c) => /^\d{2}-(재전환|점유율)/.test(c))].join(' ');
            if (/재전환/.test(comp)) r.gubun = '재전환';
            else if (/점유율/.test(comp)) r.gubun = '점유율확대';
            else { const k = kI >= 0 ? row[kI] : get(['계약구분', '게약구분', '영업구분']) || '01-신규'; r.gubun = stripNo(k).replace(/계약$/, '') || '신규'; }
          } else if (r.biz === 'MRO') {
            r.gubun = stripNo(prevs[0] || get(['소분류']) || '').split('/')[0];
          } else if (r.biz === 'GLB') {
            r.gubun = /RRPP/.test(ct) ? 'RRPP' : /ULS/.test(ct) ? 'ULS' : stripNo(prevs.find((t) => /포워딩/.test(t)) || prevs[prevs.length - 1] || '포워딩');
          } else {
            r.gubun = stripNo(prevs[1] || prevs[0] || get(['중분류']) || '');
          }
          const pref = idx(['재고차이사유및계약내용', '계약특이사항', '세부내용', '비고']);
          const d = bestDesc(row, pref);
          r.rawDesc = d.text; if (d.moved && trim(at(pref)) === '') r.flags.push('서술을 다른 열에서 찾음'); else if (d.moved) r.flags.push('서술 열 바꿈');
        }
      } else if (src.kind === 'target') {
        const bz = get(['사업구분']);
        r.biz = /PPS/.test(bz) ? 'PPS' : /SCM/.test(bz) ? 'SCM' : /산업자재/.test(bz) ? 'MRO' : /지게차/.test(bz) ? 'MHE' : '';
        r.stage = get(['진행단계']).replace('계약완료', '계약');
        r.amount = numOr0(get(['효과금액(年)', '효과금액(년)']));
        r.exp = numOr0(get(['예상매출(年)', '예상매출(년)']));
        const d = bestDesc(row, idx(['25년영업진행사항', '영업진행사항', '세부내용']));
        r.rawDesc = d.text;
        const col = get(['신규/점유율확대']);
        r.gubun = r.biz === 'PPS' ? col : r.biz === 'MRO' ? itemOf(d.text, MRO_ITEMS, col) : r.biz === 'SCM' ? itemOf(d.text, SCM_ITEMS, col) : '지게차';
      } else if (src.kind === 'ag') {
        r.biz = 'AG';
        r.stage = get(['진행단계']).replace('계약완료', '계약');
        r.amount = numOr0(get(['예상매출']));
        r.gubun = get(['구분']);
        r.rawDesc = bestDesc(row, idx(['세부내용'])).text;
      } else if (src.kind === 'sonik') {
        r.biz = 'SONIK';
        const st = get(['진행여부']);
        r.stage = /완료/.test(st) ? '계약확정' : /진행/.test(st) ? '협의중' : '';
        r.amount = numOr0(get(['년예상효과(천원)', '년예상효과']));
        r.gubun = get(['단가인상구분(LPS품의)', '단가인상구분']);
        r.rawDesc = bestDesc(row, idx(['비고(내용)', '비고'])).text;
      }
      if (!r.region) { dropped.push(r); return; }
      recs.push(r);
    });
    return { recs, dropped, hasHeader };
  }

  // 코드 없는 행 부서 보충: 같은 코드의 다른 행(예: RRPP 견적) 권역
  function fillRegionByCode(all) {
    const byCode = {}; all.forEach((r) => { if (r.code && r.region) byCode[r.code] = r.region; });
    return byCode;
  }

  // ---------- 서술 다듬기 ----------
  function finishDesc(r, kind) {
    const log = [];
    let t = fixText(r.rawDesc, log);
    const fa = fixAmounts(t, log, kind === 'sonik'); t = fa.text;
    // 서술의 예상매출은 금액 열 값으로 맞춤. 사업 데이터는 예상매출액 열(PPS 계약은 금액 열이 효과금액이라 따로 둠), 타겟·농산은 목록 금액.
    const expK = kind === 'biz' && r.exp > 0 ? r.exp : r.amount;
    if (kind === 'biz' && !fa.amounts.some((a) => a.label === '예상매출') && expK) { t = (t ? t + ', ' : '') + '예상매출 ' + fmtAmt(expK) + '/년'; log.push('금액표기'); }
    const first = fa.amounts.find((a) => a.label === '예상매출');
    if (first && expK && kind !== 'sonik' && fmtAmt(first.k) !== fmtAmt(expK)) {
      t = t.replace('예상매출 ' + fmtAmt(first.k), '예상매출 ' + fmtAmt(expK));
      r.flags.push('서술 금액 ' + fmtAmt(first.k) + ' → ' + fmtAmt(expK) + ' 자동수정');
    }
    r.desc = t; r.fix = summarizeFix(log); r.fixMajor = summarizeFix(log, true);
    return r;
  }

  // ---------- 업체 동일 판정·중복 ----------
  const normName = (s) => norm(s).replace(/\(주\)|㈜|주식회사|농업회사법인|영농조합법인|\(농\)|\(유\)|유한회사|\(KCP\)|\(Z\)|\(거래중지\)|\(종료\)/g, '').replace(/[()[\]\-_·.,]/g, '').replace(/지점$|공장$/, '');
  const recKey = (r) => (isCode(r.code) ? 'c' + r.code : 'n' + normName(r.name));

  // ---------- 요약표 붙여넣기 (타겟·농산) ----------
  function groupCols(g, h) {
    const top = g[h] || [], sub = g[h + 1] || [];
    const w = Math.max(top.length, sub.length); const out = []; let grp = '';
    for (let c = 0; c < w; c++) { if (trim(top[c])) grp = norm(top[c]).replace(/\[.*\]/, ''); out.push(grp + '|' + norm(sub[c] || '')); }
    return out;
  }
  const pickCols = (row, cols, keys) => keys.map((k) => { const i = cols.indexOf(k); return i < 0 ? null : toNum(row[i]); });
  function parseTargetSum(str) {
    const g = parseTSV(str); const res = { t1: [], t2: [] };
    const L1 = ['PPS/물류기기', 'SCM(지게차제외)', 'SCM', '지게차', '산업자재유통', '전체'];
    g.forEach((row) => { if (L1.includes(norm(row[0]))) res.t1.push({ label: trim(row[0]), vals: row.slice(2, 13).map(toNum) }); });
    const h = g.findIndex((row, r) => row.some((c) => norm(c) === '대상업체') && row.some((c) => /누계실적/.test(norm(c))) && g[r + 1] && g[r + 1].some((c) => norm(c) === '업체수') && !row.some((c) => norm(c) === '방문'));
    if (h >= 0) {
      const cols = groupCols(g, h);
      const keys = ['대상업체|업체수', '대상업체|예상매출', '누계실적|방문/협의', '누계실적|견적', '누계실적|계약', '누계실적|예상매출(년)', '누계실적|진행율(%)'];
      for (let r = h + 2; r < g.length; r++) if (['경북권역', '부산권역', '경남권역', '본부계'].includes(norm(g[r][0]))) res.t2.push({ label: trim(g[r][0]), vals: pickCols(g[r], cols, keys) });
    }
    return res;
  }
  function parseAgSum(str) {
    const g = parseTSV(str); const res = { a: [], b: [], note: '' };
    const REG = ['경북권역', '부산권역', '경남권역', '영남영업본부'];
    const ha = g.findIndex((row) => row.some((c) => norm(c) === 'KPP기계약'));
    if (ha >= 0) for (let r = ha + 1; r < g.length && res.a.length < 4; r++) if (REG.includes(norm(g[r][0]))) res.a.push({ label: trim(g[r][0]), vals: g[r].slice(1, 9).map(toNum) });
    const hb = g.findIndex((row) => row.some((c) => norm(c) === '2차타겟업체'));
    if (hb >= 0) {
      const cols = groupCols(g, hb);
      const keys = ['2차타겟업체|대상업체수', '2차타겟업체|경쟁사매출', '2차타겟누계실적|방문', '2차타겟누계실적|견적', '2차타겟누계실적|계약완료', '2차타겟누계실적|예상매출'];
      for (let r = hb + 2; r < g.length && res.b.length < 4; r++) if (REG.includes(norm(g[r][0]))) res.b.push({ label: trim(g[r][0]), vals: pickCols(g[r], cols, keys) });
    }
    const nr = g.find((row) => /^※\s*2차/.test(trim(row[0])));
    if (nr) res.note = trim(nr[0]);
    return res;
  }

  // ---------- 모델 ----------
  const BIZ_ORDER = ['PPS', 'SCM', 'MRO', 'GLB', 'MHE'];
  const PREV_TITLE = { PPS: 'PPS', SCM: 'SCM', MRO: '산업자재유통', GLB: '글로벌비즈(RRPP·포워딩)', MHE: 'MHE' };
  const CUR_TITLE = { PPS: 'PPS 추진계획', SCM: 'SCM', MRO: '산업자재유통', GLB: '글로벌비즈(RRPP·포워딩)', MHE: '지게차' };
  const PREV_ITEM = { PPS: 'PPS', SCM: 'SCM', MRO: '산업자재유통', GLB: '글로벌비즈', MHE: '지게차' };
  const CUR_ITEM = { PPS: 'PPS', SCM: 'SCM', MRO: '산업자재유통', GLB: '글로벌비즈', MHE: 'MHE' };
  const TGT_ORDER = ['PPS', 'SCM', 'MRO', 'MHE'];
  const TGT_TITLE = { PPS: 'PPS', SCM: 'SCM', MRO: '산업자재유통', MHE: '지게차' };
  const STAGE3 = ['계약', '견적', '방문'];
  const LISTS = { prev: '전월 사업', cur: '당월 사업', sonik: '손익개선', tgtPrev: '타겟 전월', tgtCur: '타겟 당월', agPrev: '농산 전월', agCur: '농산 당월' };
  const DEFAULT_LIMITS = {
    PPS: { min: 2000, max: 15 }, SCM: { min: 10000, max: 15 }, MRO: { min: 10000, max: 15 }, GLB: { min: 2000, max: 15 }, MHE: { min: 2000, max: 15 },
    SONIK: { min: 0, max: 10 }, TGT: { min: 0, max: 0 }, AG: { min: 0, max: 0 },
  };
  const limitOf = (limits, key, stage) => {
    const L = (limits && limits[key]) || {}; const d = DEFAULT_LIMITS[key];
    const s = (L[stage]) || {};
    return { min: s.min != null ? s.min : L.min != null ? L.min : d.min, max: s.max != null ? s.max : L.max != null ? L.max : d.max };
  };
  const nextMonth = (m) => (m % 12) + 1;

  // inputs: { form, biz:{PPS:{계약,견적},...}, sonik, tgtSum, tgtList, agSum, agList }
  // opts: { limits, placement, exclude, edits, texts }
  function buildModel(inputs, opts) {
    opts = opts || {};
    const form = parseForm(inputs.form);
    const M = form.month, M1 = nextMonth(M);
    const checks = [];
    const all = [];
    const addRecs = (str, src) => {
      if (!trim(str)) return;
      const p = parseRecords(str, src);
      p.recs.forEach((r) => all.push(r));
      p.dropped.forEach((r) => { r._dropped = src.label; all.push(r); });
    };
    BIZ_ORDER.forEach((b) => ['계약', '견적'].forEach((st) => { const s = inputs.biz && inputs.biz[b] && inputs.biz[b][st]; addRecs(s, { id: b + st, kind: 'biz', biz: b, stage: st, label: BIZ_NAME[b] + ' ' + st }); }));
    addRecs(inputs.sonik, { id: 'sonik', kind: 'sonik', label: '손익개선' });
    addRecs(inputs.tgtList, { id: 'tgt', kind: 'target', label: '타겟업체' });
    addRecs(inputs.agList, { id: 'ag', kind: 'ag', label: '농산업종' });
    // 부서 없는 행: 같은 코드의 다른 행 권역으로 채움
    const byCode = fillRegionByCode(all.filter((r) => !r._dropped));
    const recs = [], dropBy = {};
    all.forEach((r) => {
      if (r._dropped) {
        if (r.code && byCode[r.code]) { r.region = byCode[r.code]; r.flags.push('부서: 같은 코드 행에서 가져옴'); }
        else { (dropBy[r._dropped] = dropBy[r._dropped] || []).push(r.name); return; }
      }
      recs.push(r);
    });
    Object.keys(dropBy).forEach((k) => checks.push({ kind: '영남 외·부서 없음 제외', text: k + ' ' + dropBy[k].length + '건 (' + dropBy[k].slice(0, 4).join(', ') + (dropBy[k].length > 4 ? ' 外' : '') + ')' }));
    recs.forEach((r) => finishDesc(r, r.biz === 'SONIK' ? 'sonik' : r.src === 'tgt' || r.src === 'ag' ? 'other' : 'biz'));
    // 결재완료 아님(반려·미결재): 기본은 빼고 목록으로 보여줌. 넣기를 고른 행만 넣음.
    const approve = opts.approve || {}, ndSeen = {};
    const notDone = [];
    for (let i = recs.length - 1; i >= 0; i--) {
      const r = recs[i]; if (!r.status) continue;
      const base = r.src + '|' + (r.code || normName(r.name)) + '|' + (r.month || '') + '|' + Math.round(r.amount || 0);
      ndSeen[base] = (ndSeen[base] || 0) + 1; r.ndId = base + (ndSeen[base] > 1 ? '#' + ndSeen[base] : '');
      const on = !!approve[r.ndId];
      notDone.unshift({ ndId: r.ndId, region: r.region, mgr: r.mgr || '', code: r.code || '', name: r.name, status: r.status, amount: r.amount, label: [BIZ_NAME[r.biz], r.stage, r.month ? r.month + '월' : ''].filter(Boolean).join(' '), on });
      if (on) r.flags.push('결재상태 ' + r.status + ' (넣음)'); else recs.splice(i, 1);
    }
    // 편집 적용
    const edits = opts.edits || {};
    // 목록 나누기
    const L = { prev: [], cur: [], sonik: [], tgtPrev: [], tgtCur: [], agPrev: [], agCur: [] };
    const off = [];
    recs.forEach((r) => {
      let list = null, stage = r.stage;
      if (r.src === 'tgt') list = r.month === M ? 'tgtPrev' : r.month === M1 ? 'tgtCur' : null;
      else if (r.src === 'ag') list = r.month === M ? 'agPrev' : r.month === M1 ? 'agCur' : null;
      else if (r.biz === 'SONIK') { list = r.stage === '협의중' || (r.stage === '계약확정' && r.month === M1) ? 'sonik' : null; }
      else if (r.month === M) list = 'prev';
      else if (r.month === M1) { list = 'cur'; stage = r.stage === '계약' ? '계약확정' : '협의중'; }
      if (!list) { off.push(r); return; }
      r.list = list; r.stageOut = stage; r.key = recKey(r);
      L[list].push(r);
    });
    if (off.length) checks.push({ kind: '기준월 아님 제외', text: off.length + '건 (' + off.slice(0, 4).map((r) => r.name + (r.month ? '·' + r.month + '월' : '·월 없음')).join(', ') + (off.length > 4 ? ' 外' : '') + ')' });
    // id 부여 + 편집
    const seen = {};
    Object.keys(L).forEach((list) => L[list].forEach((r) => {
      const base = list + '|' + r.biz + '|' + r.stageOut + '|' + r.key; seen[base] = (seen[base] || 0) + 1;
      r.id = base + (seen[base] > 1 ? '#' + seen[base] : '');
      const e = edits[r.id]; if (e) { if (e.desc != null) r.desc = e.desc; if (e.gubun != null) r.gubun = e.gubun; if (e.name != null) r.name = e.name; }
    }));
    // 중복 업체
    // PPS 업체만 사업·타겟·농산 목록 사이에서 본다(전월·당월 목록끼리도 비교). 손익개선·다른 사업은 보지 않음.
    // 기본 배치: 타겟·농산에 함께 있으면 타겟·농산에만 넣고 사업 목록에서는 뺌. 머리글 건수·금액은 배치와 무관(업체 행만 빠짐).
    const DUP_LISTS = ['prev', 'tgtPrev', 'agPrev', 'cur', 'tgtCur', 'agCur'];
    const isBizList = (l) => l === 'prev' || l === 'cur';
    const occ = {};
    DUP_LISTS.forEach((list) => L[list].forEach((r) => { if (r.biz === 'PPS' || r.biz === 'AG') (occ[r.key] = occ[r.key] || []).push(r); }));
    const placement = opts.placement || {};
    const dupRow = new Set(), defOff = new Set();
    const placeOf = (key, list) => { const p = placement[key] && placement[key][list]; return p != null ? p : !defOff.has(key + '|' + list); };
    const dups = Object.keys(occ).filter((k) => new Set(occ[k].map((r) => r.list)).size > 1).map((k) => {
      const rs = occ[k]; rs.forEach((r) => dupRow.add(r));
      const key = rs[0].key, lists = DUP_LISTS.filter((l) => rs.some((r) => r.list === l));
      if (lists.some((l) => !isBizList(l))) lists.filter(isBizList).forEach((l) => defOff.add(key + '|' + l));
      return {
        key, name: rs[0].name, region: rs[0].region, mgr: rs.map((r) => r.mgr).find(Boolean) || '', code: rs[0].code || '',
        where: rs.map((r) => ({ list: r.list, label: [LISTS[r.list], BIZ_NAME[r.biz] || '', r.stageOut].filter(Boolean).join(' '), amount: r.amount })),
        lists, on: Object.fromEntries(lists.map((l) => [l, placeOf(key, l)])),
      };
    });
    const exclude = opts.exclude || {};
    // 목록 수정의 넣기 해제만 머리글에도 반영.
    const kept = (r) => !exclude[r.id];
    const placed = (r) => !dupRow.has(r) || placeOf(r.key, r.list);
    const sortAmt = (a, b) => b.amount - a.amount;
    const pick = (rs, lim) => rs.filter((r) => placed(r) && r.amount >= lim.min).slice(0, lim.max > 0 ? lim.max : undefined);
    const head = (rs) => ({ n: rs.length, k: rs.reduce((s, r) => s + r.amount, 0), units: rs.reduce((s, r) => s + (r.units || 0), 0) });
    // 전월 사업
    const prev = BIZ_ORDER.map((b) => {
      const blocks = ['계약', '견적'].map((st) => {
        const all_ = L.prev.filter((r) => r.biz === b && r.stageOut === st && kept(r)).sort(sortAmt);
        const h = form.hdr[b] ? { n: form.hdr[b][st === '계약' ? 'c' : 'q'][0], k: form.hdr[b][st === '계약' ? 'c' : 'q'][1] } : head(all_);
        if (b === 'MHE') Object.assign(h, head(all_));
        if (form.hdr[b] && !h.n && all_.length) { Object.assign(h, head(all_)); checks.push({ kind: '머리글 ↔ 데이터', text: BIZ_NAME[b] + ' ' + st + ': 양식 0건 → 데이터 ' + h.n + '건으로 표시' }); }
        if (form.hdr[b]) { const d = head(all_); if (d.n !== h.n) checks.push({ kind: '머리글 ↔ 데이터', text: BIZ_NAME[b] + ' ' + st + ': 양식 ' + h.n + '건 ' + fmtEok(h.k) + '억 / 데이터 ' + d.n + '건 ' + fmtEok(d.k) + '억' }); }
        return { bkey: 'prev|' + b + '|' + st, stage: st, head: h, rows: pick(all_, limitOf(opts.limits, b, st)), total: all_.length, mhe: b === 'MHE' };
      });
      return { biz: b, title: PREV_TITLE[b], item: PREV_ITEM[b], blocks };
    });
    const sonikText = trim((opts.texts || {}).sonikTop || '');
    const sonikNote = form.sonik ? form.sonik.n + '업체 ' + fmtEok(form.sonik.k) + '억' + (sonikText ? ' : ' + sonikText : '') : sonikText;
    // 당월 사업
    const cur = BIZ_ORDER.map((b) => {
      const blocks = ['계약확정', '협의중'].map((st) => {
        const all_ = L.cur.filter((r) => r.biz === b && r.stageOut === st && kept(r)).sort(sortAmt);
        return { bkey: 'cur|' + b + '|' + st, stage: st, head: head(all_), rows: pick(all_, limitOf(opts.limits, b, st === '계약확정' ? '계약' : '견적')), total: all_.length, mhe: b === 'MHE' };
      });
      const items = [{ name: CUR_ITEM[b], blocks }];
      if (b === 'PPS') {
        const sb = ['계약확정', '협의중'].map((st) => { const all_ = L.sonik.filter((r) => r.stageOut === st && kept(r)).sort(sortAmt); return { bkey: 'sonik|SONIK|' + st, stage: st, head: head(all_), rows: pick(all_, limitOf(opts.limits, 'SONIK', st)), total: all_.length }; });
        items.push({ name: '손익개선', blocks: sb });
      }
      return { biz: b, title: CUR_TITLE[b], items };
    });
    // 타겟·농산
    const stageBlocks = (rs, limKey) => STAGE3.map((st) => {
      const all_ = rs.filter((r) => r.stageOut === st && kept(r)).sort(sortAmt);
      const any = rs.find((r) => r.stageOut === st);
      return { bkey: any ? any.list + '|' + any.biz + '|' + st : '', stage: st, head: head(all_), rows: pick(all_, limitOf(opts.limits, limKey, st)), total: all_.length, mhe: false };
    }).filter((b) => b.bkey && (b.total || rs.some((r) => r.stageOut === b.stage)));
    const tgt = (list) => TGT_ORDER.map((b) => ({ biz: b, title: TGT_TITLE[b], item: TGT_TITLE[b], blocks: stageBlocks(L[list].filter((r) => r.biz === b), 'TGT') })).filter((x) => x.blocks.length);
    const tgtPrev = tgt('tgtPrev'), tgtCur = tgt('tgtCur');
    const agPrev = stageBlocks(L.agPrev, 'AG'), agCur = stageBlocks(L.agCur, 'AG');
    // 점검 모음
    recs.forEach((r) => { if (r.list && r.flags.length) checks.push({ kind: '행 점검', text: (LISTS[r.list] || '') + ' ' + (BIZ_NAME[r.biz] || '') + ' · ' + [r.mgr, r.code].filter(Boolean).join(' ') + (r.mgr || r.code ? ' · ' : '') + r.name + ': ' + r.flags.join(', ') }); });
    const sheetErr = {};
    const tryGrid = (k) => { try { return parseSheetGrid(inputs[k]); } catch (e) { sheetErr[k] = e.message; return null; } };
    const form2 = tryGrid('form2'), form3 = tryGrid('form3');
    const oldAll = oldDetailRows(form3), oldDet = opts.detailKeep ? oldAll : [];
    const detail = buildDetail(L, kept, M1, oldDet);
    const majors = buildMajors(detail);
    if (detail.length > 477) checks.push({ kind: '신규추진(세부)', text: '행이 ' + detail.length + '개라 틀(477행)을 넘습니다. 넘는 행은 빠집니다.' });
    const perfPrev = perfValues(form, M), perfCur = perfValues(form, M1);
    checkPerf(perfPrev, M, checks, M + '월 실적 현황');
    checkPerf(perfCur, M1, checks, M1 + '월 영업추진 계획');
    const texts = Object.assign({}, opts.texts || {});
    const drafts = {
      tgt: {}, ag: planDraft(L.agCur.filter(kept), 'ag'),
    };
    TGT_ORDER.forEach((b) => { drafts.tgt[b] = planDraft(L.tgtCur.filter((r) => r.biz === b && kept(r)), b === 'PPS' ? 'pps' : 'item'); });
    return {
      M, M1, form, perfPrev, perfCur,
      prev, sonikNote, cur, tgtPrev, tgtCur, agPrev, agCur,
      tgtSum: trim(inputs.tgtSum) ? parseTargetSum(inputs.tgtSum) : null,
      agSum: trim(inputs.agSum) ? parseAgSum(inputs.agSum) : null,
      texts, drafts, checks, dups, notDone, lists: L, recs, form2, form3, sheetErr, detail, majors, oldCount: oldAll.length,
    };
  }

  // ---------- 당월 계획 문장 초안 (비슷한 업체 묶기) ----------
  const CATS = [
    [/제지|종이|골판지|지함|포장인쇄|박스|지대/, '제지 및 종이가공'],
    [/김치|반찬|육가공|조미|제과|음료|두부|떡|식품|수산|건어물|제분|장류|소스/, '식품제조'],
    [/농협|농산|감귤|월동무|버섯|과일|청과|미곡|곡물|APC|RPC|영농/, '농산'],
    [/섬유|원단|봉제/, '섬유'],
    [/화장품|화학|수지|플라스틱|고무|사출|유화/, '화학·소재'],
    [/3PL|물류|창고|운수|유통|택배/, '유통·물류'],
    [/자동차|부품|금속|전자|기계/, '제조'],
  ];
  const catOf = (t) => { for (const [re, v] of CATS) if (re.test(t)) return v; return '기타'; };
  function companyBrief(r) {
    const parts = (r.desc || '').split(/,\s*/);
    const place = trim(parts[0] || '').replace(/\s+/g, ' ');
    const biz = trim(parts[1] || '');
    const vol = /물동량\s*([\d,.]+\s*(?:만)?(?:매|박스|BOX|box|대|장|개|롤|PLT)\s*\/\s*년)/.exec(r.desc || '');
    return r.name.replace(/\((주|농|KCP|Z|거래중지|종료)\)|\[|\]|㈜|주식회사|농업회사법인|영농조합법인/g, '').trim() + '(' + [place, [biz, vol ? vol[1].replace(/\s+/g, '') : ''].filter(Boolean).join(' '), fmtAmt(r.amount)].filter(Boolean).join(', ') + ')';
  }
  function planDraft(rs, mode) {
    if (!rs.length) return '';
    const groups = {};
    rs.forEach((r) => {
      const cat = catOf(r.desc + ' ' + r.name);
      const type = mode === 'pps' || mode === 'ag' ? (/재전환/.test(r.gubun + r.desc) ? '재전환' : /점유율/.test(r.gubun + r.desc) ? '점유율 확대' : '신규') : r.gubun || '신규';
      const k = cat + '|' + type; (groups[k] = groups[k] || { cat, type, rs: [], sum: 0 }); groups[k].rs.push(r); groups[k].sum += r.amount;
    });
    const gs = Object.values(groups).sort((a, b) => b.sum - a.sum).slice(0, 3);
    const lines = [];
    gs.forEach((g, i) => {
      if (i) lines.push('');
      const title = mode === 'item' ? g.cat + ' 업종 ' + g.type + ' 영업 확대' : g.cat + ' 업체 ' + g.type + ' 영업 추진';
      lines.push('▷ ' + title);
      const items = g.rs.sort((a, b) => b.amount - a.amount).slice(0, 3).map(companyBrief).join(', ');
      lines.push((mode === 'ag' ? ': ' : '- ') + items);
    });
    return lines.join('\n');
  }

  // ---------- 신규추진(세부)·신규추진계획 시트 ----------
  // 붙여넣은 양식 시트: '팀권역' 칸(틀에서 B5)을 기준으로 행·열을 맞춘다. 반환 { grid, dr, dc } (틀 행 = 격자 행 + dr, 1부터)
  function parseSheetGrid(str) {
    if (!trim(str)) return null;
    const g = parseTSV(str);
    for (let r = 0; r < Math.min(g.length, 15); r++) {
      const c = (g[r] || []).findIndex((x) => norm(x) === '팀권역');
      if (c >= 0) return { grid: g, dr: 5 - r, dc: 2 - c, hdrRow: r, hdrCol: c };
    }
    throw new Error('붙여넣은 신규추진 시트에서 "팀권역" 머리글을 찾지 못했습니다. 시트 전체(A1부터)를 복사해 붙여넣어 주세요.');
  }
  const DET_ITEM_ORDER = ['PPS', 'SCM', '산업자재유통', 'RRPP', 'ULS'];
  const DET_STAGE_ORDER = ['신규확정', '협의중', '계획'];
  const itemOfRec = (r) => (r.biz === 'PPS' || r.biz === 'AG' ? 'PPS' : r.biz === 'SCM' || r.biz === 'MHE' ? 'SCM' : r.biz === 'MRO' ? '산업자재유통' : r.biz === 'GLB' ? (/ULS/.test(r.gubun || '') ? 'ULS' : 'RRPP') : '');
  // 계약 → 신규확정, 견적(방문 포함) → 견적: 사업마다 금액 순위 홀수(1·3·5…)는 협의중, 짝수(2·4·6…)는 계획
  const detStage = (st) => (st === '계약확정' || st === '계약' ? '신규확정' : st === '협의중' || st === '견적' || st === '방문' ? '견적' : '');
  // 월 금액: 연 금액 ÷ 12를 올림(500 미만 50 단위, 그 이상 100 단위: 233 → 250, 620 → 700)
  const monthlyOf = (k) => { const v = k / 12; if (!(v > 0)) return 0; return v < 500 ? Math.ceil(v / 50 - 1e-9) * 50 : Math.ceil(v / 100 - 1e-9) * 100; };
  const DET_MIN = 2000, DET_MIN_COUNT = 5;
  // 당월 사업·타겟·농산 목록 → 세부 시트 행. 같은 업체·항목은 한 번만(계약 우선, 큰 금액).
  function buildDetail(L, kept, M1, old) {
    const pool = {};
    ['cur', 'tgtCur', 'agCur'].forEach((list) => L[list].filter(kept).forEach((r) => {
      const item = itemOfRec(r), stage = detStage(r.stageOut); if (!item || !stage || !(r.amount > 0)) return;
      const k = r.key + '|' + item, cand = { r, item, stage, amount: r.amount, key: k };
      const cur = pool[k];
      if (!cur || (stage === '신규확정' && cur.stage !== '신규확정') || (stage === cur.stage && r.amount > cur.amount)) pool[k] = cand;
    }));
    const oldKeys = new Set((old || []).map((o) => 'n' + normName(o.name) + '|' + o.item));
    const groups = [['PPS'], ['SCM'], ['산업자재유통'], ['RRPP', 'ULS']];
    const rows = [];
    groups.forEach((items) => {
      const cands = Object.values(pool).filter((c) => items.includes(c.item) && !oldKeys.has('n' + normName(c.r.name) + '|' + c.item));
      cands.sort((a, b) => b.amount - a.amount);
      let pick = cands.filter((c) => c.amount >= DET_MIN);
      if (pick.length < DET_MIN_COUNT) pick = pick.concat(cands.filter((c) => c.amount < DET_MIN).slice(0, DET_MIN_COUNT - pick.length));
      pick = pick.map((c) => Object.assign({}, c));
      pick.filter((c) => c.stage === '견적').sort((a, b) => b.amount - a.amount).forEach((c, i) => { c.stage = i % 2 === 0 ? '협의중' : '계획'; });
      pick.sort((a, b) => DET_STAGE_ORDER.indexOf(a.stage) - DET_STAGE_ORDER.indexOf(b.stage) || b.amount - a.amount);
      pick.forEach((c) => {
        const mv = monthlyOf(c.amount), months = {};
        for (let m = M1; m <= 12; m++) months[m] = mv;
        rows.push({ region: c.r.region, name: c.r.name, item: c.item, stage: c.stage, months, k: c.amount, desc: c.r.desc, src: [LISTS[c.r.list], BIZ_NAME[c.r.biz], c.r.stageOut].filter(Boolean).join(' ') });
      });
    });
    return (old || []).map((o) => Object.assign({ old: true }, o)).concat(rows);
  }
  // 양식 세부 시트의 기존 행
  function oldDetailRows(p) {
    if (!p) return [];
    const out = [];
    for (let r = p.hdrRow + 1; r < p.grid.length; r++) {
      const row = p.grid[r] || [], at = (col) => trim(row[col - 2 + p.hdrCol] || ''); // col: 틀 열 번호(B=2)
      if (!at(3) || /^예시/.test(trim(row[p.hdrCol - 1] || '')) || at(3) === 'OO') continue;
      if (!REGIONS.includes(at(2))) continue;
      const months = {}; [6, 7, 8, 9].forEach((c, i) => { const n = toNum(at(c)); if (n) months['c' + i] = n; });
      out.push({ region: at(2), name: at(3), item: at(4), stage: at(5), cols: months, k: toNum(at(11)) || 0, desc: at(12) });
    }
    return out;
  }
  // 신규추진계획 맨 아래 '협의중 / 계획 주요 업체': 권역 × 항목마다 금액 큰 2업체
  function buildMajors(detail) {
    const out = {};
    REGIONS.forEach((reg) => {
      out[reg] = {};
      ['PPS', '물류기기', 'SCM', '산업자재유통', 'RRPP', 'ULS'].forEach((item) => {
        const rs = detail.filter((d) => d.region === reg && d.item === item && (d.stage === '협의중' || d.stage === '계획')).sort((a, b) => b.k - a.k).slice(0, 2);
        out[reg][item] = rs.map((d) => d.name + ' : ' + d.desc).join('\n');
      });
    });
    return out;
  }

  // ---------- 엑셀 쓰기 ----------
  // kitBytes: 서식 틀 xlsx(Uint8Array), model: buildModel 결과, texts: 서술 입력
  async function build(ExcelJS, JSZip, kitBytes, model) {
    const wb = await loadWorkbook(ExcelJS, JSZip, kitBytes);
    const ws = wb.getWorksheet(SHEET);
    const T = (r, c) => text(ws.getCell(r, c).value).trim();
    // 틀 읽기: 견본 행(A열 §키), 데이터 구역 시작
    let kitData = -1; for (let r = 26; r <= ws.rowCount; r++) if (/^※\s*PPS/.test(T(r, 2))) { kitData = r; break; }
    if (kitData < 0) throw new Error('틀에서 데이터 구역(※ PPS 및 물류기기 사업부분)을 찾지 못했습니다.');
    const proto = {}; for (let r = 26; r < kitData; r++) { const k = T(r, 1); if (/^§/.test(k)) proto[k.slice(1)] = r; }
    const merges = allMerges(ws);
    const snaps = {}; for (let r = 1; r <= ws.rowCount; r++) snaps[r] = snapRow(ws, r, MAXCOL);
    const oneRowMerges = {}, blockMerges = {};
    merges.forEach((m) => {
      if (m.top >= kitData || m.bottom <= 25) return;
      if (m.top === m.bottom) (oneRowMerges[m.top] = oneRowMerges[m.top] || []).push([m.left, m.right]);
      else (blockMerges[m.top] = blockMerges[m.top] || []).push([m.bottom - m.top, m.left, m.right]);
    });
    const M = model.M, M1 = model.M1;

    // --- 보고 행 쌓기
    const R = [], MG = [];
    const add = (key, vals, h) => { if (!proto[key]) throw new Error('틀에 견본 행이 없습니다: ' + key); R.push({ key, kitRow: proto[key], vals: vals || {}, h }); return R.length - 1; };
    const addBlock = (name, fill) => { let i = 0; const start = R.length; while (proto[name + ':' + i]) { add(name + ':' + i, {}); i++; } fill((k) => R[start + k].vals, start); return start; };
    const TXT_INDENT = { hq: ['     ', '          '], tgt: ['         ', '         '], ag: ['    ', '      '] };
    const addText = (str, mode, boldHead) => {
      String(str || '').replace(/\r/g, '').split('\n').forEach((line) => {
        if (!trim(line)) { add(mode === 'hq' ? 'blank' : 'sp', {}, mode === 'hq' ? undefined : 8.25); return; }
        const head = /^\s*▷/.test(line);
        const ind = /^\s/.test(line) ? '' : TXT_INDENT[mode][head ? 0 : 1];
        add(head && boldHead ? 'txtB' : 'txt', { 4: ind + line });
      });
    };
    const stageLabel = (b) => {
      if (!b.head.n) return b.stage + '\n(실적 없음)';
      if (b.mhe) return b.stage + '\n(' + b.head.n + '업체 ' + fmtK(b.head.units || 0) + '대\n/ ' + fmtEok(b.head.k) + '억)';
      return b.stage + '\n(' + b.head.n + '업체 ' + fmtEok(b.head.k) + '억)';
    };
    const table = (items) => {
      add('listHdr');
      items.forEach((it, i) => {
        if (i) add('listSep');
        const itemStart = R.length;
        it.blocks.forEach((b, j) => {
          const rows = b.rows.length ? b.rows : [null];
          const bs = R.length;
          rows.forEach((r, k) => {
            const key = k ? 'listRow' : j ? 'listBlockFirst' : i ? 'itemFirst' : 'listFirst';
            const v = {};
            if (!k && !j) v[4] = it.name;
            if (!k) v[5] = stageLabel(b);
            if (r) { v[6] = r.region; v[7] = r.gubun || ''; v[8] = r.name; v[10] = Math.round(r.amount); v[11] = r.desc; }
            add(key, v);
          });
          const last = j === it.blocks.length - 1 && !it.note;
          add(last ? 'listGapLast' : 'listGap');
          MG.push([bs, 5, R.length - 1, 5]);
        });
        if (it.note != null) add('listNote', { 7: '손익개선', 8: it.note });
        MG.push([itemStart, 4, R.length - 1, 4]);
      });
    };
    const fillPerf = (v, P, m, heading) => {
      v(0)[4] = heading; v(2)[11] = m + '월 당월'; v(2)[18] = m + '월 누계';
      REG4.forEach(([reg], ri) => {
        const p = P[reg];
        [['tgt', 'ctgt'], ['act', 'cact'], ['dif', 'cdif']].forEach(([f, cf], t) => {
          const row = v(3 + ri * 3 + t);
          p[f].forEach((x, bi) => { row[6 + bi] = x; }); p[cf].forEach((x, bi) => { row[13 + bi] = x; });
          if (p.tot) { row[11] = { $over: p.tot[f] }; row[18] = { $over: p.tot[cf] }; } // 합계: 상단표 값(없으면 틀 수식)
        });
      });
    };
    const sections = [];
    // 1) 전월 실적 · 당월 계획
    let s = add('label', { 2: M + '월 영업실적현황 및 \n' + M1 + '월 영업추진계획' });
    addBlock('perf', (v) => fillPerf(v, model.perfPrev, M, '  ◎ ' + M + '월 실적 현황'));
    add('blank'); add('h1', { 4: '  ◎ ' + M + '월 영업실적 주요 현황' }); add('sp');
    model.prev.forEach((p) => {
      add('h2', { 4: '    ■ ' + p.title }); add('sp');
      table([{ name: p.item, blocks: p.blocks, note: p.biz === 'PPS' ? model.sonikNote : undefined }]);
      add('blank');
    });
    addBlock('plan', (v) => fillPerf(v, model.perfCur, M1, '  ◎ ' + M1 + '월 영업추진 계획'));
    add('blank');
    const tx = model.texts || {};
    add('h1', { 4: '  ■ 본부 중점 추진사항' }); add('sp', {}, 9.75); addText(tx.hq, 'hq', true); add('blank');
    add('h1', { 4: '  ■ 권역별 영업추진 계획' }); add('sp', {}, 9.75); addText(tx.region, 'hq', true); add('sp', {}, 8.25);
    add('h1', { 4: '  ◎ ' + M1 + '월 사업군별 영업계획' }); add('blank');
    model.cur.forEach((c) => { add('h2', { 4: '     ■ ' + c.title }); add('sp'); table(c.items); add('blank'); });
    add('blank'); sections.push([s, R.length - 1]); add('blank');
    // 2) 타겟업체
    s = add('label', { 2: '본부 영업타겟업체\n영업진행내역 및 계획' });
    addBlock('tgtSum', (v) => {
      const ts = model.tgtSum; if (!ts) return;
      ts.t1.slice(0, 5).forEach((row, i) => { v(4 + i)[5] = row.label; row.vals.forEach((x, k) => { if (x != null) v(4 + i)[7 + k] = x; }); });
      ts.t2.slice(0, 4).forEach((row, i) => { v(12 + i)[5] = row.label; row.vals.forEach((x, k) => { if (x != null) v(12 + i)[6 + k] = x; }); });
    });
    add('blank'); add('h1', { 4: '  ◎ 타겟업체 ' + M + '월 영업진행 현황' }); add('blank');
    model.tgtPrev.forEach((t) => { add('h2', { 4: '    ■ ' + t.title }); add('sp', {}, 8.25); table([{ name: t.item, blocks: t.blocks }]); add('blank'); });
    add('h1', { 4: '  ◎ 타겟업체 ' + M1 + '월 영업계획' }); add('blank');
    model.tgtCur.forEach((t) => {
      add('h2', { 4: '    ■ ' + t.title });
      const plan = tx.tgtPlan && tx.tgtPlan[t.biz] != null ? tx.tgtPlan[t.biz] : model.drafts.tgt[t.biz];
      if (trim(plan)) addText(plan, 'tgt', true);
      table([{ name: t.item, blocks: t.blocks }]); add('blank');
    });
    add('blank'); sections.push([s, R.length - 1]); add('blank');
    // 3) 농산 및 국고보조
    s = add('label', { 2: '농산 및 국고보조업체\n영업진행내역 및 계획' });
    addBlock('agSum', (v) => {
      const a = model.agSum; if (!a) return;
      a.a.forEach((row, i) => { v(8 + i)[5] = row.label; row.vals.forEach((x, k) => { if (x != null) v(8 + i)[6 + k] = x; }); });
      a.b.forEach((row, i) => { v(16 + i)[5] = row.label; row.vals.forEach((x, k) => { if (x != null) v(16 + i)[6 + k] = x; }); });
      if (a.note) v(20)[5] = a.note;
      const tot = a.a.find((row) => row.label === '영남영업본부');
      if (tot) {
        const [n, comp, kpp, kppSales, , plan, planSales] = tot.vals;
        const eok1 = (k) => Math.floor(((k || 0) / 100000) * 10 + 1e-9) / 10;
        Object.assign(v(4), { 5: n, 6: eok1(comp), 7: kpp, 8: eok1(kppSales), 9: plan, 10: eok1(planSales), 11: n ? kpp / n : 0 });
      }
    });
    add('blank'); add('h1', { 4: '  ◎ 농산업체 ' + M + '월 영업진행 현황' }); add('sp', {}, 8.25);
    table([{ name: '농산업체', blocks: model.agPrev.length ? model.agPrev : [{ stage: '계약', head: { n: 0, k: 0 }, rows: [] }] }]);
    add('blank'); add('h1', { 4: '  ◎ 농산업체 ' + M1 + '월 영업 계획' }); add('blank');
    add('txt', { 4: '  ■ 중점 추진사항' }); add('sp', {}, 8.25);
    const agPlan = tx.agPlan != null ? tx.agPlan : model.drafts.ag;
    if (trim(agPlan)) { addText(agPlan, 'ag', false); add('sp', {}, 8.25); }
    if (model.agCur.length) table([{ name: '농산업체', blocks: model.agCur }]);
    add('blank'); add('blank'); sections.push([s, R.length - 1]); add('blank'); add('blank');

    // --- 시트 다시 쓰기
    const oldCount = ws.rowCount;
    const newData = 26 + R.length, dDelta = newData - kitData;
    unmergeAll(ws);
    for (let r = 1; r <= 25; r++) {
      const sn = clone(snaps[r]);
      sn.cells.forEach((c) => { if (c.f) c.f = shiftRows(c.f, kitData, dDelta); });
      fillFromGrid(sn, model.form.grid[r - 1]); guardYoY(sn);
      writeRow(ws, r, sn, MAXCOL);
    }
    R.forEach((o, i) => {
      const r = 26 + i;
      const sn = clone(snaps[o.kitRow]);
      sn.cells[0].v = null;
      sn.cells.forEach((c, ci) => {
        if (c.f) c.f = shiftRows(c.f, 1, r - o.kitRow);
        const v = o.vals[ci + 1];
        if (v && v.$over !== undefined) { c.f = null; c.v = v.$over; } // 수식 칸을 값으로 바꿈
        else if (v !== undefined && !c.f) c.v = v;
      });
      if (o.h) sn.height = o.h;
      writeRow(ws, r, sn, MAXCOL);
    });
    // 데이터 구역: 양식 붙여넣기 값 채움 (※/▶ 제목 기준으로 맞춤)
    const dataSnaps = []; for (let r = kitData; r <= oldCount; r++) dataSnaps.push(clone(snaps[r]));
    const g = model.form.grid;
    const anchorsKit = []; dataSnaps.forEach((sn, i) => { const t = norm(text(sn.cells[1].v)); if (/^[※▶]/.test(t)) anchorsKit.push({ i, t }); });
    const anchorsForm = []; g.forEach((row, i) => { const t = norm(row[0]); if (/^[※▶]/.test(t)) anchorsForm.push({ i, t }); });
    let fi = 0;
    anchorsKit.forEach((a, ai) => {
      const j = anchorsForm.findIndex((b, bi) => bi >= fi && b.t === a.t); if (j < 0) return;
      fi = j + 1;
      const kEnd = ai + 1 < anchorsKit.length ? anchorsKit[ai + 1].i : dataSnaps.length;
      const fEnd = j + 1 < anchorsForm.length ? anchorsForm[j + 1].i : g.length;
      for (let k = 0; k < Math.min(kEnd - a.i, fEnd - anchorsForm[j].i); k++) fillFromGrid(dataSnaps[a.i + k], g[anchorsForm[j].i + k]);
    });
    dataSnaps.forEach((sn, i) => {
      sn.cells.forEach((c) => { if (c.f) c.f = shiftRows(c.f, kitData, dDelta); });
      guardYoY(sn);
      writeRow(ws, newData + i, sn, MAXCOL);
    });
    for (let r = newData + dataSnaps.length; r <= Math.max(oldCount, ws.rowCount); r++) writeRow(ws, r, null, MAXCOL);
    // 병합
    for (let r = 1; r <= 25; r++) merges.filter((m) => m.top === r && m.bottom <= 25).forEach((m) => ws.mergeCells(m.top, m.left, m.bottom, m.right));
    merges.filter((m) => m.top >= kitData).forEach((m) => ws.mergeCells(m.top + dDelta, m.left, m.bottom + dDelta, m.right));
    R.forEach((o, i) => {
      const r = 26 + i;
      (oneRowMerges[o.kitRow] || []).forEach(([a, b]) => ws.mergeCells(r, a, r, b));
      (blockMerges[o.kitRow] || []).forEach(([dh, a, b]) => ws.mergeCells(r, a, r + dh, b));
    });
    MG.forEach(([a, c1, b, c2]) => { if (b > a || c2 > c1) ws.mergeCells(26 + a, c1, 26 + b, c2); });
    sections.forEach(([a, b]) => ws.mergeCells(26 + a, 2, 26 + b, 3));
    // 마무리: 열 때 재계산
    fillPlanSheets(wb, model);
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', showGridLines: false, zoomScale: 95, zoomScaleNormal: 95 }];
    [ws, wb.getWorksheet(SHEET2), wb.getWorksheet(SHEET3)].filter(Boolean).forEach((sh) => stripResults(sh));
    wb.calcProperties = Object.assign({}, wb.calcProperties, { fullCalcOnLoad: true });
    return { wb, rows: { report: R.length, dataStart: newData } };
  }

  // 전년동기누계(U열)는 양식에 없음 → 증가율(V) = R/U-1 은 U가 비면 빈칸
  function guardYoY(sn) {
    const v = sn.cells[21];
    if (v && v.f) { const m = /^R(\d+)\/U\1-1$/.exec(v.f.replace(/\$/g, '')); if (m && (sn.cells[20].v == null || sn.cells[20].v === '')) v.f = 'IFERROR(R' + m[1] + '/U' + m[1] + '-1,"")'; }
  }
  // 틀 행에 양식 붙여넣기 값 넣기 (수식 칸·월 머리글 숫자는 그대로)
  // 신규추진계획(시트2)·신규추진(세부)(시트3) 채우기
  function fillPlanSheets(wb, model) {
    const s2 = wb.getWorksheet(SHEET2), s3 = wb.getWorksheet(SHEET3);
    const isF = (c) => c.type === 6 || (c.value && typeof c.value === 'object' && (c.value.formula || c.value.sharedFormula));
    if (s2) {
      // 양식에서 붙여넣은 숫자: 1~99행의 빈 입력칸(수식·글자 칸 제외)에만
      if (model.form2) {
        const { grid, dr, dc } = model.form2;
        grid.forEach((row, gr) => row.forEach((v, gc) => {
          const r = gr + dr, c = gc + dc; if (r < 1 || r >= 100 || c < 1 || c > 45) return;
          const cell = s2.getCell(r, c); if (isF(cell) || typeof cell.value === 'string') return;
          const n = toNum(v); if (n != null) cell.value = n;
        }));
      }
      if (s2.getCell('AC1').value == null) s2.getCell('AC1').value = model.M1;
      // 주요 업체: '※ 협의중 / 계획 주요 업체' 아래 권역 블록(권역 순서는 1) 표의 B열 순서)
      const regOrder = []; for (let r = 7; r < 36; r++) { const v = text(s2.getCell(r, 2).value).trim(); if (REGIONS.includes(v) && !regOrder.includes(v)) regOrder.push(v); }
      let hr = -1; for (let r = 90; r <= s2.rowCount; r++) if (/주요\s*업체/.test(text(s2.getCell(r, 2).value))) { hr = r; break; }
      if (hr > 0) {
        let bi = -1;
        for (let r = hr + 1; r <= s2.rowCount; r++) {
          const item = text(s2.getCell(r, 3).value).trim(); if (!item) continue;
          if (item === 'PPS') bi++;
          const reg = regOrder[bi]; if (!reg || !model.majors[reg]) continue;
          const t = model.majors[reg][item] || '';
          s2.getCell(r, 4).value = t || null;
          const lines = t ? t.split('\n').length : 0; if (lines > 2) s2.getRow(r).height = lines * 19.5;
        }
      }
    }
    if (s3) {
      s3.getCell('M1').value = model.M1;
      s3.getCell('N1').value = { formula: "'" + SHEET2 + "'!$B$28" };
      const last = s3.rowCount;
      model.detail.forEach((d, i) => {
        const r = 7 + i; if (r > last) return;
        const set = (c, v) => { s3.getCell(r, c).value = v == null || v === '' ? null : v; };
        set(2, d.region); set(3, d.name); set(4, d.item); set(5, d.stage);
        for (let j = 0; j < 4; j++) set(6 + j, d.old ? d.cols['c' + j] : d.months[model.M1 + j]);
        set(11, d.k); set(12, d.desc);
      });
    }
  }

  function fillFromGrid(sn, row) {
    if (!row) return;
    for (let c = 0; c < 19; c++) {
      const cell = sn.cells[c + 1]; if (!cell || cell.f) continue;
      const s = row[c] == null ? '' : row[c];
      if (typeof cell.v === 'number' && /^\s*\d+\s*월\s*$/.test(s)) continue;
      if (!trim(s)) { if (typeof cell.v !== 'string') cell.v = null; continue; }
      const n = toNum(s);
      cell.v = n != null ? n : String(s).replace(/^\s+|\s+$/g, '');
    }
  }

  return {
    SHEET, KEEP_SHEETS, REGIONS, BRANCH, MAXCOL, BIZ_ORDER, BIZ_NAME, TGT_ORDER, LISTS, DEFAULT_LIMITS,
    parseTSV, toNum, fmtEok, fmtAmt, text, norm, loadWorkbook, saveWorkbook, parseForm, parseRecords, buildModel, build, planDraft,
    _i: { snapRow, writeRow, allMerges, unmergeAll, shiftRows, isCrossSheet, stripResults, clone },
  };
});
