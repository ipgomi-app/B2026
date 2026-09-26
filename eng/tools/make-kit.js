/* 제출본 xlsx → 서식 틀(kit.js) 생성
 * 업체 데이터(업체명·담당자·서술 등)를 모두 지우고 서식·수식·라벨만 남긴다.
 * 사용: node tools/make-kit.js <제출본.xlsx>   (exceljs, jszip 필요)
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const E = require('../engine.js');
const I = E._i;

(async () => {
  const src = process.argv[2];
  if (!src) { console.error('usage: node tools/make-kit.js <submission.xlsx>'); process.exit(1); }
  const wb = await E.loadWorkbook(ExcelJS, JSZip, fs.readFileSync(src));
  const { pool, sum } = E.findSheets(wb);
  const L = E.poolLayout(pool);
  const orig = E.readPool(pool, L);
  const secret = new Set();
  orig.rows.forEach((sn) => [L.name, L.mgr, L.needs].forEach((c) => { const t = E.text(sn.cells[c - 1].v).trim(); if (t.length >= 2) secret.add(t); }));

  // 1) 숨김 시트 제거 (다른 시트에서 참조하지 않음)
  wb.worksheets.filter((ws) => ws.state !== 'visible').forEach((ws) => wb.removeWorksheet(ws.id));

  // 2) 수주풀: 대표 서식 행 하나만 남김 (값은 비우고 업체명 칸만 '·')
  const sig = (c) => JSON.stringify(c.s);
  const mode = [];
  for (let c = 0; c < L.maxCol; c++) {
    const cnt = {}; orig.rows.forEach((sn) => { const k = sig(sn.cells[c]); cnt[k] = (cnt[k] || 0) + 1; });
    mode.push(Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]);
  }
  const best = orig.rows.map((sn) => ({ sn, score: sn.cells.filter((c, i) => sig(c) === mode[i]).length }))
    .sort((a, b) => b.score - a.score)[0].sn;
  // 과거분 행(월구분이 'N월'이 아닌 행: 25 3Q, 2510 …)은 회색 서식 → 두 번째 서식 행
  const isOld = (sn) => !/^\d{1,2}월$/.test(E.text(sn.cells[L.month - 1].v).trim());
  const olds = orig.rows.filter(isOld);
  const oldBest = olds.length ? olds[olds.length - 1] : null;
  const place = (sn) => {
    const ph = JSON.parse(JSON.stringify(sn));
    ph.cells.forEach((c) => { if (!c.f) c.v = null; delete c.note; });
    ph.cells[L.name - 1].v = '·';
    ph.height = 24;
    return ph;
  };
  const kitRows = [place(best)];
  if (oldBest) { const o = place(oldBest); o.cells[L.month - 1].v = '25 3Q'; kitRows.push(o); }
  I.writePool(pool, L, kitRows, orig.lastRow, I.formulaPatterns(orig.rows, L));
  pool.dataValidations.model = {};

  // 3) 영남영업본부: 상단 입력 숫자는 0, 하단 목록은 섹션별 서식 행 하나('·')만
  const maxCol = I.sumMaxCol(sum);
  const info = I.readSections(sum, maxCol);
  for (let r = 1; r < info.start; r++) for (let c = 1; c <= maxCol; c++) {
    const cell = sum.getCell(r, c);
    if (cell.type !== 6 && typeof cell.value === 'number') cell.value = 0;
  }
  info.secs.forEach((sec) => {
    if (sec.data.length) {
      const d = JSON.parse(JSON.stringify(sec.data[0]));
      d.cells.forEach((c) => { if (c.v != null && E.text(c.v).trim() !== '') c.v = '·'; delete c.f; delete c.note; });
      sec.data = [d];
    }
  });
  I.writeSections(sum, info.start, info.end, info.secs, maxCol);

  // 4) 3번째 시트: 헤더/데이터 서식 행만 (표 2개)
  const third = wb.worksheets.find((s) => s !== pool && s !== sum);
  if (third) {
    const mc = 30, merges = I.rowMergeMap(third);
    const isHdr = (sn) => { const k = sn.cells.map((c) => E.text(c.v).replace(/\s+/g, '')); return k.includes('업체명') && k.includes('코드'); };
    const snaps = []; for (let r = 1; r <= third.rowCount; r++) snaps.push(I.snapRow(third, r, mc, merges));
    const hs = snaps.map((sn, i) => (isHdr(sn) ? i : -1)).filter((i) => i >= 0);
    const keep = [{ cells: new Array(mc).fill(null).map(() => ({ v: null, s: {} })), merges: [] }];
    hs.forEach((h, k) => {
      if (k) keep.push({ cells: new Array(mc).fill(null).map(() => ({ v: null, s: {} })), merges: [] });
      keep.push(snaps[h]);
      const d = JSON.parse(JSON.stringify(snaps[h + 1]));
      d.cells.forEach((c) => { if (c.v != null && E.text(c.v).trim() !== '') c.v = '·'; delete c.note; delete c.f; });
      keep.push(d);
    });
    I.unmergeRows(third, 1, third.rowCount);
    keep.forEach((sn, i) => I.writeRow(third, i + 1, sn, mc, null));
    for (let r = keep.length + 1; r <= snaps.length; r++) I.writeRow(third, r, null, mc, null);
    keep.forEach((sn, i) => (sn.merges || []).forEach(([a, b]) => { if (b > a) third.mergeCells(i + 1, a, i + 1, b); }));
    third.dataValidations.model = {};
  }

  I.stripResults(sum); I.stripResults(pool);
  wb.creator = ''; wb.lastModifiedBy = ''; wb.company = ''; wb.manager = '';
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  // 5) 데이터 잔존 검사: 원본 업체명/담당자/서술이 한 글자라도 남아 있으면 중단
  const zip = await JSZip.loadAsync(buf);
  let all = '';
  for (const f of Object.keys(zip.files)) if (/\.(xml|rels|vml)$/.test(f)) all += await zip.file(f).async('string');
  const leaks = [...secret].filter((t) => all.includes(t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 40)));
  if (leaks.length) { console.error('데이터 잔존:', leaks.slice(0, 10)); process.exit(2); }

  const out = path.join(__dirname, '..', 'kit.js');
  fs.writeFileSync(out, '/* 영남 엔지니어링 제출본 서식 틀 (데이터 없음, tools/make-kit.js 로 생성) */\n' +
    "(function (k) { if (typeof module === 'object' && module.exports) module.exports = k; else self.ENG_KIT = k; })('" + buf.toString('base64') + "');\n");
  console.log('kit.js', buf.length, 'bytes xlsx, checked', secret.size, 'strings, sheets:', wb.worksheets.map((w) => w.name).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
