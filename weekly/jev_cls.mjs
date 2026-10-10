#!/usr/bin/env node
// Jev AI(TypeSafe System One) 로 업무일지 활동을 분류하고 규칙 분류·정답표와 비교한다.
//
//   TYPESAFE_API_KEY=... node weekly/jev_cls.mjs --units zunits.json [--gold gold.json] [--out ./jev_out]
//                        [--limit 20] [--dry] [--order fwd|rev] [--concurrency 6] [--model jev-latest]
//
// 입력 units(JSON 배열, 권역_주간회의 V2.0.html 의 V2U 와 같은 꼴):
//   {num, dcode, emp, name, typ, lab, text, cat, src}  cat = 규칙 분류명(예 '회수')
// 입력 gold(JSON 배열): {num, dcode, text, gold}  gold = 코드('1'..'9','M','X')
// 출력: <out>/jev_cache.json(응답 캐시), <out>/jev_cmp.tsv(건별 비교), 표준출력에 요약.
// 회사 데이터 파일은 저장소에 넣지 않는다. API 키는 환경변수로만 받는다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ARG = Object.fromEntries(process.argv.slice(2).map((a, i, A) => a.startsWith('--') ? [a.slice(2), A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true] : []).filter(x => x.length));
const UNITS = ARG.units;
if (!UNITS) { console.error('--units <zunits.json> 필요'); process.exit(2); }
const GOLD = ARG.gold ? JSON.parse(fs.readFileSync(ARG.gold, 'utf8')) : null;
const OUT = ARG.out || path.dirname(path.resolve(UNITS));
const LIMIT = ARG.limit ? +ARG.limit : Infinity;
const DRY = !!ARG.dry;
const ORDER = ARG.order === 'rev' ? 'rev' : 'fwd';
const CONC = ARG.concurrency ? +ARG.concurrency : 6;
const MODEL = typeof ARG.model === 'string' ? ARG.model : 'jev-latest';
const KEY = process.env.TYPESAFE_API_KEY;
const BASE = process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai';
const PROMPT_VER = 'kpp-v1';

// ───────── 분류 정의 (README "V2 분류 기준" 과 2026-10-09 결정 사항을 그대로 옮김) ─────────
const CODES = ['1', '2', '3', 'M', '4', '5', '6', '7', '8', '9', 'X'];
const NAME = { '1': '신규·전환영업', '2': '기존확대·손익', '3': '신규업체확인', 'M': '입고미회수', '4': '회수', '5': '재고실사', '6': '수불·전산', '7': '클레임', '8': '채권·리스크', '9': '기타업무', 'X': '제외' };
const NAME2CODE = Object.fromEntries(Object.entries(NAME).map(([k, v]) => [v, k]));
NAME2CODE['확인필요'] = '?';

// 선택지 이름은 영문 키(모델 1차 언어가 영어). 설명은 영어 + 본문에 그대로 나오는 한국어 단서.
const OPT = {
  '1': ['new_or_switch_sales', 'SALES to win a NEW customer or to SWITCH a competitor\'s customer to KPP: quotation (견적), proposal (제안), new contract (신규계약), target/competitor survey (타겟, 경쟁사, 정보조사, BIGs/빅스), conversion to KPP (전환), re-approaching a lost customer (이탈, 재영업), referral (소개), expected volume/revenue (물동량, 예상매출), engineering project visit form (프로젝트 구분 : 엔지니어링). NOT for an existing KPP contract customer expanding use (that is existing_expand).'],
  '2': ['existing_expand_profit', 'An EXISTING KPP contract customer: re-contract (재계약), unit-price raise/negotiation/cut (단가인상, 단가협의, 단가인하, 단가조정), contract extension/termination/cancel (연장, 계약종료, 해지, 위약금), additional use/order/items (추가사용, 추가발주, 추가품목), contract transfer (계약승계), share expansion (점유율), profit (손익), MOQ, lead time (납기). If the text also shows conversion/target/new-contract/lost-customer sales signals, prefer new_or_switch_sales.'],
  '3': ['new_customer_check', 'Operational CHECK of a newly registered customer/site/code (신규업체, 신규현장, 신규공사, 신규코드): first visit, confirming pallets on site, confirming the new site uses KPP pallets. Not a sales pitch, not a contract. If the activity name says 재고실사 (stock count) use stock_count instead.'],
  'M': ['delivered_not_returned', 'Managing DELIVERED-BUT-NOT-RETURNED pallets (입고미회수, 미입고 확인): checking a customer that received pallets but has not returned them, asking them to tidy outbound records or return (출고정리, 회수 요청) under the 입고미회수 program. If the text or activity name says 입고미회수, choose this even if it also mentions 회수 or 자료수정.'],
  '4': ['pallet_recovery', 'RECOVERING empty pallets in the field (회수): checking empty pallets (공파렛트 확인), recovery negotiation/instruction/completion (회수협의, 회수요청, 회수지시, 회수완료, 전량회수, 회수율), asking drivers/recovery staff to collect (기사 전달, 회수프로), stock-increase customers (재고증가업체, 누계증감), construction sites (건설현장), IoT, misuse of pallets (타용도), unvisited customers (미방문, 런업체, 결차지역), return/reshipment arrangements (반납, 재입고반송). Legal-team visits to stock-increase customers also belong here.'],
  '5': ['stock_count', 'STOCK COUNT / physical inventory at a customer (재고실사, 재고조사, 실사, 실재고, 실물확인, 유휴재고): counting pallets on site and comparing with records. Also when the activity name is 신규업체 재고실사. If the memo turns into an actual recovery request to a driver or a regular recovery agreement, pallet_recovery may apply instead; a plain stock check stays here.'],
  '6': ['records_and_system', 'In/out RECORDS and SYSTEM data work (수불, 전산): closing (마감), data correction (자료수정, 전산 수정, 데이터 입력, 오입력), DRS, actual destination (실착지), mapping/code merge (매핑, 코드, 중복코드, 병합), offset (상계), billing (청구, 거래명세서), re-receipt processing (재입고 처리/협의/청구), outbound omission tidy-up (출고누락, 출고정리), hand-written slips (수기전표), transfer of accounts (이관), deletion requests (삭제요청). Choose this when the main action is fixing or entering records, including 재고증가 memos whose action is 자료수정/데이터 입력.'],
  '7': ['claim', 'CUSTOMER CLAIM / complaint handling (클레임): quality defect (품질 불량), breakage compensation (파손, 변상), dispatch mistake or problem (배차 실수, 배차문제), late delivery (납품 지연), wrong delivery (오입고), problem-solving visit (문제해결). If present, this wins over operational categories.'],
  '8': ['receivables_risk', 'RECEIVABLES and RISK management (채권): unpaid amounts (미수, 미수금), payment collection (입금, 독촉, 결제조건, 변제), guarantee insurance renewal/expiry without re-contract (보증보험 갱신·재가입·만기), collateral (담보), deposit (보증금), legal action on money (법적대응, 내용증명, 가처분, 지급명령, 회생, 연체), lost-pallet compensation (분실, 변상). If present with money words, this wins over operational categories.'],
  '9': ['other_internal', 'OTHER / internal work: meetings (회의), training (교육), inspection (검수), reports and document hand-over (보고자료, 자료전달), handover of accounts between staff (담당 이관), checking a closed/ghost/vanished business (폐업, 사장업체, 무적) with no other action. Use when none of the specific categories applies.'],
  'X': ['excluded_not_activity', 'NOT a work activity: vacation (휴가, 연차, 반차), a bare commute memo with no content (출근, 퇴근, 직출, 직퇴, 내근, 사무실, 복귀 only), an auto-generated quotation form (일자 : … 업체코드 : … 제목 : [..] 견적서), an attachment row, or empty text. If the memo has real work content after 직출/직퇴, classify that content instead.'],
};
const KEY2CODE = Object.fromEntries(Object.entries(OPT).map(([c, [k]]) => [k, c]));

const INSTRUCTIONS = [
  'You are classifying ONE field-staff daily work-log entry from KPP, a Korean pallet-pooling company (팔레트 렌탈·회수). Pick the single category that best describes the MAIN activity of this entry.',
  'The entry is in Korean. Fields: `checkbox_category` is the detail type the writer ticked in the log system (often generic or stale; use only as a weak hint), `customer` is the customer/site name, `activity_name` is the program/activity name the writer typed at the top (if any), `body` is the written content.',
  'Decision order: (1) a form or auto-generated template decides by its template type; (2) if `activity_name` names a specific program (재고실사, 입고미회수, 신규업체/신규현장/신규코드, 미수금/채권, 클레임, 재계약/단가, 영업/견적/경쟁사, 자료수정/DRS/상계/마감, 폐업/사장업체/회의/교육) that program decides even if the body mentions other actions; (3) otherwise the body\'s action verbs decide: claim and receivables actions win when present, sales actions win when sales signals are clear, and among operational categories the FIRST action written wins; (4) only if the body has no action, fall back to `checkbox_category`.',
  'Status phrases such as 지속 회수 진행, 재입고 없이, 폐업 미확인 are not actions. Legal-team involvement (법무파트, 법조치, 내용증명) does not by itself decide the category: a stock-increase/misuse/recovery matter is pallet_recovery, a 입고미회수 matter is delivered_not_returned, a money/deposit/contract matter is receivables_risk.',
].join(' ');

function buildQuestion(order) {
  const codes = order === 'rev' ? [...CODES].reverse() : CODES;
  const criteria = {};
  for (const c of codes) criteria[OPT[c][0]] = OPT[c][1];
  return { type: 'choice', instructions: INSTRUCTIONS, criteria };
}
function buildState(u) {
  return {
    checkbox_category: u.typ || '',
    customer: u.name || '',
    activity_name: u.lab || '',
    body: (u.text || '').replace(/\s+/g, ' ').trim(),
  };
}

// ───────── 캐시·호출 ─────────
fs.mkdirSync(OUT, { recursive: true });
const CACHE_F = path.join(OUT, 'jev_cache.json');
const cache = fs.existsSync(CACHE_F) ? JSON.parse(fs.readFileSync(CACHE_F, 'utf8')) : {};
let dirty = 0;
const saveCache = () => { if (dirty) { fs.writeFileSync(CACHE_F, JSON.stringify(cache)); dirty = 0; } };
const ckey = (u, order) => crypto.createHash('sha1').update([PROMPT_VER, MODEL, order, u.num, u.dcode, u.typ, u.name, u.lab, u.text].join('\u0001')).digest('hex');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function callJev(body) {
  let wait = 1000;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(BASE + '/v1/systemone', { method: 'POST', headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const txt = await res.text();
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const ra = +res.headers.get('retry-after');
      await sleep(ra ? ra * 1000 : wait); wait = Math.min(wait * 2, 30000); continue;
    }
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  throw new Error('재시도 한도 초과');
}

async function classify(u, order) {
  const k = ckey(u, order);
  if (cache[k]) return cache[k];
  if (!KEY) { console.error('캐시에 없는 건이 있는데 TYPESAFE_API_KEY 환경변수가 없습니다. (PowerShell: $env:TYPESAFE_API_KEY="키" 후 실행)'); process.exit(2); }
  const body = { model: MODEL, state: buildState(u), questions: { category: buildQuestion(order) } };
  const r = await callJev(body);
  const a = r.answers.category;
  const probs = {};
  for (const [name, p] of Object.entries(a.probabilities)) probs[KEY2CODE[name] || name] = +p.toFixed(4);
  const rec = { code: KEY2CODE[a.choice] || '?', conf: +a.confidence.toFixed(4), probs, model: r.model, in: r.usage.input_tokens, out: r.usage.output_tokens };
  cache[k] = rec; dirty++;
  if (dirty % 20 === 0) saveCache();
  return rec;
}

// ───────── 실행 ─────────
const units = JSON.parse(fs.readFileSync(UNITS, 'utf8')).slice(0, LIMIT);
const gkey = u => u.num + '|' + u.dcode + '|' + (u.text || '').replace(/\s+/g, '').slice(0, 60);
const gm = GOLD ? new Map(GOLD.map(g => [gkey(g), g])) : null;

if (DRY) {
  const u = units[0];
  const body = { model: MODEL, state: buildState(u), questions: { category: buildQuestion(ORDER) } };
  console.log(JSON.stringify(body, null, 1));
  const chars = units.reduce((s, x) => s + JSON.stringify(buildState(x)).length, 0);
  const qchars = JSON.stringify(buildQuestion(ORDER)).length;
  console.log(`\nunits=${units.length}  state chars=${chars}  question chars=${qchars}  대략 토큰(한글 1.7자/토큰, 영문 4자/토큰) ≈ ${Math.round(chars / 1.7 + units.length * qchars / 4)}  ≈ $${(((chars / 1.7 + units.length * qchars / 4)) / 1e6 * 0.042).toFixed(3)}`);
  process.exit(0);
}
// 키가 없어도 캐시(jev_cache.json)에 전부 있으면 비교까지 돈다. 캐시에 없는 건이 나올 때만 키가 필요하다.
const results = new Array(units.length);
let done = 0, fail = 0;
const t0 = Date.now();
async function worker(idx) {
  for (let i = idx; i < units.length; i += CONC) {
    try { results[i] = await classify(units[i], ORDER); }
    catch (e) { fail++; results[i] = { code: '!', conf: 0, probs: {}, err: e.message }; if (/HTTP 40[13]/.test(e.message)) { console.error(e.message); process.exit(1); } }
    done++;
    if (done % 50 === 0 || done === units.length) process.stderr.write(`${done}/${units.length} (${((Date.now() - t0) / 1000).toFixed(0)}s, 실패 ${fail})\n`);
  }
}
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
saveCache();

// ───────── 비교 ─────────
const rows = [['i', 'num', 'dcode', 'emp', 'typ', 'lab', 'rule', 'jev', 'jev_conf', 'jev_2nd', 'gold', 'rule_ok', 'jev_ok', 'text']];
let n = 0, ruleOk = 0, jevOk = 0, agree = 0, agreeOk = 0, bothWrong = 0, inTok = 0, outTok = 0;
const bucket = {}; const confJ = {}; const confR = {}; const perCat = {};
for (let i = 0; i < units.length; i++) {
  const u = units[i], r = results[i];
  inTok += r.in || 0; outTok += r.out || 0;
  const rule = NAME2CODE[u.cat] || u.cat || '?';
  const g = gm ? gm.get(gkey(u)) : null;
  const gold = g ? g.gold : '';
  const second = Object.entries(r.probs || {}).sort((a, b) => b[1] - a[1])[1];
  const rOk = gold ? rule === gold : '', jOk = gold ? r.code === gold : '';
  rows.push([u.i ?? i, u.num, u.dcode, u.emp, u.typ, u.lab || '', rule, r.code, r.conf, second ? second[0] + ':' + second[1] : '', gold, rOk, jOk, (u.text || '').replace(/\s+/g, ' ').slice(0, 300)]);
  if (rule === r.code) agree++;
  if (!gold) continue;
  n++;
  if (rOk) ruleOk++;
  if (jOk) jevOk++;
  if (rule === r.code) { if (jOk) agreeOk++; else bothWrong++; }
  const b = r.conf >= 0.8 ? '≥0.8' : r.conf >= 0.5 ? '0.5~0.8' : r.conf >= 0.3 ? '0.3~0.5' : '<0.3';
  bucket[b] = bucket[b] || { n: 0, ok: 0 }; bucket[b].n++; if (jOk) bucket[b].ok++;
  if (!jOk) confJ[r.code + '>' + gold] = (confJ[r.code + '>' + gold] || 0) + 1;
  if (!rOk) confR[rule + '>' + gold] = (confR[rule + '>' + gold] || 0) + 1;
  perCat[gold] = perCat[gold] || { n: 0, r: 0, j: 0 }; perCat[gold].n++; if (rOk) perCat[gold].r++; if (jOk) perCat[gold].j++;
}
fs.writeFileSync(path.join(OUT, `jev_cmp_${ORDER}.tsv`), rows.map(r => r.join('\t')).join('\n'));

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
console.log(`\n모델 ${results.find(r => r && r.model)?.model || MODEL}  선택지 순서 ${ORDER}  건수 ${units.length}  실패 ${fail}  입력토큰 ${inTok}  출력토큰 ${outTok}  비용 ≈ $${(inTok / 1e6 * 0.042).toFixed(3)}`);
console.log(`규칙 vs Jev 일치: ${agree}/${units.length} (${pct(agree, units.length)})`);
if (gm) {
  console.log(`정답표 대비 — 규칙 ${ruleOk}/${n} (${pct(ruleOk, n)})   Jev ${jevOk}/${n} (${pct(jevOk, n)})`);
  console.log(`둘이 일치한 ${agreeOk + bothWrong}건 중 정답 ${agreeOk} (${pct(agreeOk, agreeOk + bothWrong)}), 둘 다 틀림 ${bothWrong}`);
  console.log('Jev 신뢰도 구간별 정확도: ' + Object.entries(bucket).map(([k, v]) => `${k} ${v.ok}/${v.n} (${pct(v.ok, v.n)})`).join('  '));
  console.log('분류별(정답 기준) n/규칙/Jev: ' + Object.entries(perCat).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${NAME[k] || k} ${v.n}/${pct(v.r, v.n)}/${pct(v.j, v.n)}`).join('  '));
  console.log('Jev 오류 상위: ' + Object.entries(confJ).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x.join(':')).join('  '));
  console.log('규칙 오류 상위: ' + Object.entries(confR).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x.join(':')).join('  '));
}
// 두 순서(fwd/rev)가 모두 있으면 일관성
const other = path.join(OUT, `jev_cmp_${ORDER === 'fwd' ? 'rev' : 'fwd'}.tsv`);
if (fs.existsSync(other)) {
  const o = fs.readFileSync(other, 'utf8').split('\n').slice(1).map(l => l.split('\t'));
  const om = new Map(o.map(r => [r[1] + '|' + r[2], r[7]]));
  let same = 0, tot = 0;
  for (const r of rows.slice(1)) { const v = om.get(r[1] + '|' + r[2]); if (v !== undefined) { tot++; if (v === r[7]) same++; } }
  console.log(`선택지 순서를 뒤집어도 같은 답: ${same}/${tot} (${pct(same, tot)})`);
}
