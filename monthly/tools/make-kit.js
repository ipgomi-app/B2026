/* 완성본 xlsx → 서식 틀(kit.js) 생성
 * 3시트(영남영업본부, (영남)하반기 신규추진계획, (영남)하반기 신규추진(세부))만 남기고
 * 업체 데이터(업체명·서술·금액)를 모두 지운 뒤 서식·수식·라벨만 남긴다.
 * 영남영업본부 보고 부분은 행 서식 견본(A열 표시 §키)만 남기고, 아래 데이터 구역은 입력칸을 비운다.
 * 사용: node tools/make-kit.js <완성본.xlsx>   (exceljs, jszip 필요)
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const E = require('../engine.js');
const I = E._i;

const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// 42시트 원본 → 3시트만 남긴 zip (ExcelJS 로딩 전에 잘라서 빠르게)
async function prune(data) {
  const zip = await JSZip.loadAsync(data);
  let wbx = await zip.file('xl/workbook.xml').async('string');
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/>/g)) relMap[/Id="([^"]+)"/.exec(m[0])[1]] = /Target="([^"]+)"/.exec(m[0])[1];
  for (const m of [...wbx.matchAll(/<sheet\b[^>]*\/>/g)]) {
    const s = m[0]; const name = dec(/name="([^"]*)"/.exec(s)[1]); const rid = /r:id="([^"]+)"/.exec(s)[1];
    if (E.KEEP_SHEETS.includes(name)) { wbx = wbx.replace(s, s.replace(/\s+state="[^"]*"/, '')); continue; }
    wbx = wbx.replace(s, '');
    rels = rels.replace(new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*/>'), '');
    const p = 'xl/' + relMap[rid].replace(/^\/?xl\//, '');
    zip.remove(p); const rp = p.replace('worksheets/', 'worksheets/_rels/') + '.rels'; if (zip.file(rp)) zip.remove(rp);
  }
  wbx = wbx.replace(/<definedNames>[\s\S]*?<\/definedNames>/, '').replace(/activeTab="\d+"/, 'activeTab="0"').replace(/firstSheet="\d+"/, 'firstSheet="0"');
  zip.file('xl/workbook.xml', wbx); zip.file('xl/_rels/workbook.xml.rels', rels);
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    let ct = await zip.file('[Content_Types].xml').async('string'); ct = ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''); zip.file('[Content_Types].xml', ct);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

(async () => {
  const src = process.argv[2];
  if (!src) { console.error('usage: node tools/make-kit.js <완성본.xlsx>'); process.exit(1); }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await prune(fs.readFileSync(src)));
  const ws = wb.getWorksheet(E.SHEET);
  const MC = E.MAXCOL;
  const T = (r, c) => E.text(ws.getCell(r, c).value).trim();
  const find = (pred, from = 1, to = ws.rowCount) => { for (let r = from; r <= to; r++) if (pred(r)) return r; return -1; };

  // --- 비밀 문자열(누출 검사용): 보고 부분 업체명·세부내용, 세부 시트 업체명·내용
  const dataStart = find((r) => /^※\s*PPS/.test(T(r, 2)));
  const secret = new Set();
  for (let r = 26; r < dataStart; r++) if (/(권역|대전)$/.test(T(r, 6)) && T(r, 8) && !/^[\d.,\s-]+$/.test(T(r, 8))) [8, 11].forEach((c) => { const t = T(r, c); if (t.length >= 3) secret.add(t); });
  const det = wb.getWorksheet(E.KEEP_SHEETS[2]);
  for (let r = 7; r <= det.rowCount; r++) [3, 12].forEach((c) => { const t = E.text(det.getCell(r, c).value).trim(); if (t.length >= 3) secret.add(t); });

  // --- 견본 행 위치 (완성본 기준)
  const lab1 = find((r) => /영업실적현황/.test(T(r, 2)));
  const lab2 = find((r) => /영업타겟업체/.test(T(r, 2)));
  const lab3 = find((r) => /농산 및 국고보조/.test(T(r, 2)));
  const perf = find((r) => /◎\s*\d+월 실적 현황/.test(T(r, 4)));
  const plan = find((r) => /◎\s*\d+월 영업추진 계획/.test(T(r, 4)));
  const tgt = find((r) => /◎\s*타겟업체 영업진행 현황/.test(T(r, 4)));
  const ag = find((r) => /◎\s*농산&국고보조업체 영업진행 현황/.test(T(r, 4)));
  const endOf = (from, pred) => find(pred, from);
  const hdr = find((r) => T(r, 4) === '항목' && T(r, 5) === '진행사항');
  const note = find((r) => T(r, 7) === '손익개선' && r < plan);
  const planItem2 = find((r) => T(r, 4) === '손익개선' && r > plan);
  const blocks = {
    perf: [perf, endOf(perf, (r) => T(r, 5) === '달성율')],
    plan: [plan, endOf(plan, (r) => T(r, 5) === '달성율')],
    tgtSum: [tgt, endOf(tgt, (r) => T(r, 5) === '본부계')],
    agSum: [ag, endOf(ag, (r) => /^※\s*2차/.test(T(r, 5)))],
  };
  const singles = {
    label: lab1, blank: note + 1, h1: find((r) => /◎.*영업실적 주요 현황/.test(T(r, 4))),
    sp: find((r) => /◎.*영업실적 주요 현황/.test(T(r, 4))) + 1,
    h2: find((r) => /■\s*PPS/.test(T(r, 4))),
    listHdr: hdr, listFirst: hdr + 1, listRow: hdr + 2,
    listGap: find((r) => !T(r, 6) && !T(r, 8), hdr + 1),
    listNote: note,
    listGapLast: plan - 2,
    listSep: planItem2 - 1, itemFirst: planItem2,
    txtB: find((r) => /^\s*▷/.test(T(r, 4)), plan),
    txt: find((r) => /^\s*-/.test(T(r, 4)), plan),
  };
  singles.listBlockFirst = singles.listGap + 1;
  const need = Object.assign({}, singles, { lab1, lab2, lab3, dataStart });
  Object.entries(need).forEach(([k, v]) => { if (!(v > 0)) throw new Error('견본 행을 찾지 못함: ' + k); });
  Object.entries(blocks).forEach(([k, [a, b]]) => { if (!(a > 0 && b >= a)) throw new Error('견본 블록을 찾지 못함: ' + k); });

  const merges = I.allMerges(ws);
  const snaps = {}; for (let r = 1; r <= ws.rowCount; r++) snaps[r] = I.snapRow(ws, r, MC);

  // 견본 행 정리: 값 비우기(블록은 라벨·수식 유지, 숫자만 비움)
  const blankVals = (sn) => { sn.cells.forEach((c) => { if (!c.f) c.v = null; }); return sn; };
  const blockVals = (sn) => { sn.cells.forEach((c) => { if (!c.f && typeof c.v === 'number') c.v = null; }); return sn; };

  // --- 새 행 순서 만들기
  const out = []; // { sn, from(원래 행 or null), key }
  for (let r = 1; r <= 25; r++) out.push({ sn: I.clone(snaps[r]), from: r });
  const protoStart = out.length + 1;
  Object.entries(singles).forEach(([k, r]) => { const sn = k === 'listHdr' ? I.clone(snaps[r]) : blankVals(I.clone(snaps[r])); out.push({ sn, from: r, key: k, single: true }); });
  Object.entries(blocks).forEach(([k, [a, b]]) => { for (let r = a; r <= b; r++) out.push({ sn: blockVals(I.clone(snaps[r])), from: r, key: k + ':' + (r - a), block: true }); });
  out.push({ sn: I.clone(snaps[lab1 - 1]), from: null }, { sn: I.clone(snaps[lab1 - 1]), from: null });
  const newData = out.length + 1;
  for (let r = dataStart; r <= ws.rowCount; r++) out.push({ sn: I.clone(snaps[r]), from: r, data: true });

  // 원래 행 → 새 행 (데이터 구역·1~25행만: 수식 행 옮기기 대상)
  const rowMap = {}; out.forEach((o, i) => { if (o.from && (o.data || o.from <= 25)) rowMap[o.from] = i + 1; });
  const dDelta = newData - dataStart;

  out.forEach((o, i) => {
    const r = i + 1;
    o.sn.cells.forEach((c, ci) => {
      if (!c.f) return;
      if (I.isCrossSheet(c.f)) { delete c.f; c.v = null; return; } // 다른 시트 참조 → 입력칸
      if (o.single || o.block) c.f = I.shiftRows(c.f, 1, r - o.from);
      else c.f = I.shiftRows(c.f, dataStart, dDelta);
    });
    if (o.data) {
      // 입력 숫자 비우기(머리글의 월 숫자 1~12는 남김)
      const lab = [1, 2, 3].map((k) => E.text(o.sn.cells[k].v)).join(' ');
      const isHdr = /구\s*분|부\s*서|사업부문/.test(lab);
      o.sn.cells.forEach((c) => { if (!c.f && typeof c.v === 'number' && !isHdr) c.v = null; });
    }
    if (o.key) o.sn.cells[0].v = '§' + o.key;
  });
  // T1(기준월)은 입력칸, 1~25행 숫자 입력 비움
  out[0].sn.cells[19].v = null; delete out[0].sn.cells[19].f;

  // --- 시트 다시 쓰기
  const oldCount = ws.rowCount;
  I.unmergeAll(ws);
  out.forEach((o, i) => I.writeRow(ws, i + 1, o.sn, MC));
  for (let r = out.length + 1; r <= oldCount; r++) I.writeRow(ws, r, null, MC);
  ws.views = [{ state: 'normal', zoomScale: (ws.views && ws.views[0] && ws.views[0].zoomScale) || 85 }];
  // 병합 다시: 1~25행, 데이터 구역(옮김), 견본(블록 안 여러 행 병합 포함, 한 행 병합)
  const newRowOf = (r) => rowMap[r];
  const protoRowOf = {}; out.forEach((o, i) => { if (o.single || o.block) (protoRowOf[o.from] = protoRowOf[o.from] || []).push(i + 1); });
  merges.forEach((m) => {
    if (m.bottom <= 25 || m.top >= dataStart) {
      const t = m.top <= 25 ? m.top : newRowOf(m.top), b = m.bottom <= 25 ? m.bottom : newRowOf(m.bottom);
      if (t && b) ws.mergeCells(t, m.left, b, m.right);
      return;
    }
    if (m.left <= 3) return; // 구역 라벨(B:C)은 엔진이 만든다
    // 견본: 한 행 병합(머리글 등) 또는 블록 안 병합
    const tops = protoRowOf[m.top] || [];
    tops.forEach((t) => {
      const o = out[t - 1];
      const b = t + (m.bottom - m.top);
      if (m.bottom !== m.top && !(o.block && out[b - 1] && out[b - 1].block && out[b - 1].from === m.bottom)) return;
      ws.mergeCells(t, m.left, b, m.right);
    });
  });

  // --- 신규추진계획: 다른 시트 참조 수식·배열수식 → 비움, 입력 숫자 비움
  const planWs = wb.getWorksheet(E.KEEP_SHEETS[1]);
  let majorRow = Infinity;
  planWs.eachRow((row, r) => { row.eachCell((c) => { if (/주요 업체/.test(E.text(c.value)) && r < majorRow) majorRow = r; }); });
  planWs.eachRow((row, r) => row.eachCell((c, cn) => { if (r > majorRow && cn >= 4 && typeof c.value === 'string') { secret.add(c.value.trim().slice(0, 40)); c.value = null; } }));
  planWs.eachRow((row) => row.eachCell((c) => {
    if (c.type === 6) { const f = c.formula || (c.value && c.value.formula) || ''; if (!f || /2026년현황|\(26년\)/.test(f)) c.value = null; }
    else if (typeof c.value === 'number') c.value = null;
  }));
  // --- 신규추진(세부): 예시(6행) 아래 데이터 비움
  det.eachRow((row, r) => { if (r >= 7) row.eachCell((c) => { if (c.type !== 6) c.value = null; }); });
  det.getRow(1).eachCell((c) => { if (c.type === 6 && /2026년현황|하반기 신규추진계획/.test(c.formula || '')) c.value = null; });

  [ws, planWs, det].forEach((s) => I.stripResults(s));
  if (![ws, planWs, det].some((s) => s.getImages().length)) wb.media = [];
  wb.creator = ''; wb.lastModifiedBy = ''; wb.company = ''; wb.manager = '';
  wb.calcProperties = Object.assign({}, wb.calcProperties, { fullCalcOnLoad: true });
  const buf = Buffer.from(await wb.xlsx.writeBuffer());

  // --- 누출 검사
  const zip = await JSZip.loadAsync(buf);
  let all = '';
  for (const f of Object.keys(zip.files)) if (/\.(xml|rels|vml)$/.test(f)) all += await zip.file(f).async('string');
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const leaks = [...secret].filter((t) => all.includes(esc(t).slice(0, 40)));
  if (leaks.length) { if (process.env.KIT_DEBUG) fs.writeFileSync(process.env.KIT_DEBUG, buf); console.error('데이터 잔존:', leaks.slice(0, 10)); process.exit(2); }

  const outp = path.join(__dirname, '..', 'kit.js');
  fs.writeFileSync(outp, '/* 영남영업본부 월간회의자료 서식 틀 (데이터 없음, tools/make-kit.js 로 생성) */\n' +
    "(function (k) { if (typeof module === 'object' && module.exports) module.exports = k; else self.MONTHLY_KIT = k; })('" + buf.toString('base64') + "');\n");
  console.log('kit.js', buf.length, 'bytes; protos', protoStart, '~', newData - 1, '; data', newData, '~', out.length, '; checked', secret.size, 'strings');
})().catch((e) => { console.error(e); process.exit(1); });
