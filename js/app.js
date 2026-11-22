import './rescue.js'; // 비상 복구(2026-11 서버 이전)
import {
  store, subscribe, initStore, login, logout, saveItem, deleteItem, saveCategory, saveQuote, deleteQuote,
  saveSettings, replacePriceList, newId, saveContractDoc, deleteContractDoc,
} from './store.js';
import { esc, won, num, manwon, parseNum, today, matchScore, highlight, copyText } from './util.js';
import { calcTotals, buildChecklist, buildMessage, nextQuoteNo, STATUSES, VAT_LABEL } from './quote.js';
import { makeQuotePdf } from './pdf.js';
import { newContract, money, makeContractPdf, contractPreview, hasQuoteLines, usesQuote } from './contract.js';
import { signaturePad } from './sign.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const DRAFT_KEY = 'gyeonjeok-draft-v1';
const AUTHOR_KEY = 'gyeonjeok-author';

let tab = (location.hash || '#search').slice(1);
const ui = { q: '', cat: '전체', hq: '', hstatus: '전체', hauthor: '전체', hkind: 'quote', cstatus: '전체' };
let draft = loadDraft();

/* ================= 임시 견적(이 기기) ================= */
function blankDraft() {
  return {
    id: null, no: '', date: today(),
    customer: { name: '', phone: '', address: '' },
    lines: [], discount: 0, vatMode: store.state.settings.vatMode || 'none',
    memo: '', status: '상담중', ckOff: [], ckExtra: '', includeAmount: false, dirty: false,
    author: author(),
  };
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (d && Array.isArray(d.lines)) return d;
  } catch (_) {}
  return blankDraft();
}
function persistDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (_) {}
  updateBadge();
}
function touch() {
  draft.dirty = true;
  persistDraft();
}
function author() {
  try { return localStorage.getItem(AUTHOR_KEY) || ''; } catch (_) { return ''; }
}
// 견적 작성자: 견적서에 적은 이름 → 처음 저장한 사람 순
const quoteAuthor = (q) => (q.author || q.createdBy || '').trim();
function knownAuthors() {
  const set = new Set(store.state.quotes.map(quoteAuthor).filter(Boolean));
  if (author()) set.add(author());
  return [...set].sort((x, y) => x.localeCompare(y, 'ko'));
}

/* ================= 공통 UI ================= */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}
function updateBadge() {
  const b = $('#badge');
  const n = draft.lines.length;
  b.hidden = !n;
  b.textContent = n;
}
function openSheet(html, onMount) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-bg"><div class="sheet"><div class="grab"></div>${html}</div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
  onMount && onMount(bg.firstElementChild);
}
function closeSheet() {
  $('#sheet-root').innerHTML = '';
}
function go(t) {
  tab = t;
  history.replaceState(null, '', '#' + t);
  render();
  window.scrollTo(0, 0);
}
document.getElementById('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});

/* ================= 렌더링 ================= */
function render() {
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  updateBadge();
  if (!store.ready) {
    view.innerHTML = '<div class="empty">불러오는 중…</div>';
    return;
  }
  if (store.mode === 'cloud' && !store.user) return renderLogin();
  $('#tabbar').hidden = false;
  ({ search: renderSearch, quote: renderQuote, contract: renderContract, history: renderHistory, settings: renderSettings }[tab] || renderSearch)();
}

/* ---------- 로그인 ---------- */
function renderLogin() {
  $('#tabbar').hidden = true;
  view.innerHTML = `
    <div class="login">
      <div class="logo">🏠</div>
      <h1>집수리 견적</h1>
      <div class="card">
        <label class="field"><span>이메일</span><input id="lg-email" type="email" autocomplete="username" /></label>
        <label class="field"><span>비밀번호</span><input id="lg-pw" type="password" autocomplete="current-password" /></label>
        <button class="btn block" id="lg-btn">로그인</button>
        <p class="hint">Supabase에서 만든 두 분의 계정으로 로그인합니다. 한 번 로그인하면 계속 유지됩니다.</p>
      </div>
    </div>`;
  $('#lg-btn').onclick = async () => {
    try {
      await login($('#lg-email').value.trim(), $('#lg-pw').value);
    } catch (e) {
      alert(/Invalid login/i.test(e?.message) ? '로그인 실패: 이메일 또는 비밀번호가 맞지 않아요. (2026-11-04에 새로 만든 계정)' : '로그인 실패: ' + (e?.message || e));
    }
  };
}

/* ---------- 단가 검색 ---------- */
function renderSearch() {
  const cats = store.state.categories;
  view.innerHTML = `
    <div class="top">
      <h1>🔍 단가 검색 <span class="sub">${store.mode === 'cloud' && !store.online ? '⚠️ 오프라인 · ' : ''}${store.state.items.length}개 항목 · 만원 단위</span></h1>
      <div class="searchbox">
        <input id="q" type="search" placeholder="예) 변기, 실리콘, ㄷㅇㄹ(초성)" value="${esc(ui.q)}" autocomplete="off" />
      </div>
    </div>
    <div class="chips" id="chips">
      ${['전체', ...cats.map((c) => c.name)].map((n) => `<button class="chip ${ui.cat === n ? 'on' : ''}" data-cat="${esc(n)}">${esc(n)}</button>`).join('')}
    </div>
    <div id="results"></div>`;
  const q = $('#q');
  q.addEventListener('input', () => { ui.q = q.value; renderResults(); });
  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    ui.cat = c.dataset.cat;
    document.querySelectorAll('#chips .chip').forEach((x) => x.classList.toggle('on', x === c));
    renderResults();
  });
  renderResults();
}

function rowHtml(item) {
  const line = draft.lines.find((l) => l.itemId === item.id);
  return `
    <div class="row" data-item="${item.id}">
      <div class="main" data-act="item-info">
        <div class="name">${highlight(item.name, ui.q)}</div>
        <div class="meta">${esc([ui.q ? item.cat : '', item.note].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="price">${manwon(item.price)}</div>
      ${line
        ? `<div class="qtybox">
            <button class="addbtn sub" data-act="sub" aria-label="견적에서 하나 빼기">−</button>
            <span class="qn">${num(line.qty)}</span>
            <button class="addbtn in" data-act="add" aria-label="하나 더 담기">+</button>
          </div>`
        : '<button class="addbtn" data-act="add" aria-label="견적에 추가">+</button>'}
    </div>`;
}

function renderResults() {
  const box = $('#results');
  if (!box) return;
  let items = store.state.items;
  if (!items.length) {
    box.innerHTML = `<div class="card"><p>단가표가 비어 있습니다.</p>
      <p class="hint">설정 → <b>백업 파일에서 단가표 불러오기</b>로 단가표 파일을 넣거나, 아래 직접 입력으로 항목을 추가하세요.</p>
      <button class="btn ghost block" data-act="custom">✏️ 직접 입력해서 추가</button></div>`;
    return;
  }
  if (ui.cat !== '전체') items = items.filter((i) => i.cat === ui.cat);
  let html = '';
  if (ui.q.trim()) {
    // 항목명에서 먼저 찾고, 없으면 분류·비고까지 넓혀서 찾기
    const search = (nameOnly) => items
      .map((i) => [i, matchScore(i, ui.q, nameOnly)])
      .filter(([, s]) => s >= 0)
      .sort((a, b) => a[1] - b[1])
      .map(([i]) => i);
    let found = search(true);
    if (!found.length) found = search(false);
    html += found.length
      ? `<div class="section-h">검색 결과 ${found.length}개</div><div class="list">${found.map(rowHtml).join('')}</div>`
      : `<div class="empty">'${esc(ui.q)}' 검색 결과가 없습니다.</div>`;
  } else {
    const order = store.state.categories.map((c) => c.name);
    const groups = {};
    items.forEach((i) => (groups[i.cat] ||= []).push(i));
    const names = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    html += names.map((n) => `<div class="section-h">${esc(n)}</div><div class="list">${groups[n].map(rowHtml).join('')}</div>`).join('');
  }
  html += `<div style="padding:16px 12px"><button class="btn ghost block" data-act="custom">✏️ ${ui.q.trim() ? `'${esc(ui.q.trim())}' ` : ''}직접 입력해서 추가</button></div>`;
  box.innerHTML = html;
}

function refreshRow(itemId) {
  const row = document.querySelector(`.row[data-item="${itemId}"]`);
  const item = store.state.items.find((i) => i.id === itemId);
  if (row && item) row.outerHTML = rowHtml(item);
}

function addItemToDraft(item, qty = 1) {
  let line = draft.lines.find((l) => l.itemId === item.id);
  if (line) line.qty = (Number(line.qty) || 0) + qty;
  else {
    line = { lid: newId('l'), itemId: item.id, cat: item.cat, name: item.name, qty, unit: Math.round(item.price * 10000), memo: '' };
    draft.lines.push(line);
  }
  touch();
  toast(`${item.name} 담음 (${line.qty}개) · 합계 ${won(calcTotals(draft).total)}`);
}

/* ---------- 항목 상세·수정 시트 ---------- */
function itemInfoSheet(item) {
  const c = store.state.categories.find((x) => x.name === item.cat);
  const asks = [...(item.ask || []), ...(c?.ask || [])];
  const warns = [...(item.warn || []), ...(c?.warn || [])];
  openSheet(`
    <h2>${esc(item.name)}</h2>
    <p class="hint">${esc(item.cat)}${item.note ? ' · ' + esc(item.note) : ''}</p>
    <div class="totals"><div class="tr grand"><span>기본 단가</span><span>${manwon(item.price)}</span></div></div>
    ${asks.length ? `<div class="ck-group"><h3>💬 고객에게 물어볼 것</h3>${asks.map((t) => `<div class="ck">• ${esc(t)}</div>`).join('')}</div>` : ''}
    ${warns.length ? `<div class="ck-group"><h3>⚠️ 안내·주의사항</h3>${warns.map((t) => `<div class="ck">• ${esc(t)}</div>`).join('')}</div>` : ''}
    <div class="btnrow" style="margin-top:14px">
      <button class="btn ghost" id="s-edit">단가표 수정</button>
      <button class="btn orange" id="s-add">견적에 추가</button>
    </div>`, () => {
    $('#s-add').onclick = () => { addItemToDraft(item); closeSheet(); refreshRow(item.id); };
    $('#s-edit').onclick = () => itemEditSheet(item);
  });
}

function catOptions(selected) {
  return store.state.categories.map((c) => `<option ${c.name === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('') +
    `<option value="__new">+ 새 분류 만들기</option>`;
}

async function ensureCategory(name) {
  if (store.state.categories.some((c) => c.name === name)) return;
  await saveCategory({ id: newId('c'), name, ask: [], warn: [], order: store.state.categories.length });
}
function pickCat(sel) {
  if (sel.value !== '__new') return sel.value;
  const n = prompt('새 분류 이름');
  return n && n.trim() ? n.trim() : null;
}
const toLines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function itemEditSheet(item) {
  const isNew = !item;
  item = item || { id: newId('i'), cat: ui.cat !== '전체' ? ui.cat : store.state.categories[0]?.name, name: ui.q.trim(), price: 0, note: '', ask: [], warn: [], order: 999 };
  openSheet(`
    <h2>${isNew ? '단가표에 항목 추가' : '단가표 항목 수정'}</h2>
    <label class="field"><span>분류</span><select id="e-cat">${catOptions(item.cat)}</select></label>
    <label class="field"><span>항목명</span><input id="e-name" value="${esc(item.name)}" /></label>
    <div class="grid2">
      <label class="field"><span>단가 (만원)</span><input id="e-price" inputmode="decimal" value="${item.price || ''}" /></label>
      <label class="field"><span>비고</span><input id="e-note" value="${esc(item.note)}" /></label>
    </div>
    <label class="field"><span>💬 고객에게 물어볼 것 (한 줄에 하나)</span><textarea id="e-ask">${esc((item.ask || []).join('\n'))}</textarea></label>
    <label class="field"><span>⚠️ 안내·주의사항 (한 줄에 하나)</span><textarea id="e-warn">${esc((item.warn || []).join('\n'))}</textarea></label>
    <p class="hint">저장하면 함께 쓰는 사람의 단가표에도 바로 반영됩니다.</p>
    <div class="btnrow">
      ${isNew ? '' : '<button class="btn danger" id="e-del">삭제</button>'}
      <button class="btn" id="e-save">저장</button>
    </div>`, () => {
    $('#e-save').onclick = async () => {
      const cat = pickCat($('#e-cat'));
      const name = $('#e-name').value.trim();
      if (!cat || !name) return alert('분류와 항목명을 입력해 주세요.');
      await ensureCategory(cat);
      await saveItem({
        ...item, cat, name, price: parseNum($('#e-price').value), note: $('#e-note').value.trim(),
        ask: toLines($('#e-ask').value), warn: toLines($('#e-warn').value),
        updatedBy: author(), updatedAt: Date.now(),
      });
      closeSheet();
      toast('단가표에 저장했습니다');
    };
    if (!isNew) $('#e-del').onclick = async () => {
      if (!confirm(`'${item.name}' 항목을 단가표에서 삭제할까요?`)) return;
      await deleteItem(item.id);
      closeSheet();
      toast('삭제했습니다');
    };
  });
}

/* ---------- 직접 입력 시트 ---------- */
function customSheet() {
  const defCat = ui.cat !== '전체' ? ui.cat : '';
  openSheet(`
    <h2>✏️ 직접 입력</h2>
    <label class="field"><span>항목명</span><input id="c-name" value="${esc(ui.q.trim())}" placeholder="예) 베란다 수전 교체" /></label>
    <div class="grid2">
      <label class="field"><span>단가 (만원)</span><input id="c-price" inputmode="decimal" placeholder="예) 12" /></label>
      <label class="field"><span>수량</span><input id="c-qty" inputmode="numeric" value="1" /></label>
    </div>
    <label class="field"><span>분류</span><select id="c-cat"><option value="">기타</option>${catOptions(defCat)}</select></label>
    <label class="field"><span>메모 (견적서 비고란)</span><input id="c-memo" /></label>
    <label class="ck"><input type="checkbox" id="c-save" /> <span class="tx">다음에도 쓰도록 단가표에 저장</span></label>
    <button class="btn orange block" id="c-add" style="margin-top:10px">견적에 추가</button>`, () => {
    if (!defCat) $('#c-cat').value = '';
    $('#c-name').focus();
    $('#c-add').onclick = async () => {
      const name = $('#c-name').value.trim();
      const price = parseNum($('#c-price').value);
      if (!name) return alert('항목명을 입력해 주세요.');
      let cat = $('#c-cat').value;
      if (cat === '__new') cat = pickCat($('#c-cat')) || '';
      let itemId = null;
      if ($('#c-save').checked) {
        const c = cat || '기타';
        await ensureCategory(c);
        itemId = newId('i');
        await saveItem({ id: itemId, cat: c, name, price, note: '', ask: [], warn: [], order: 999, updatedBy: author(), updatedAt: Date.now() });
      }
      draft.lines.push({ lid: newId('l'), itemId, cat: cat || '기타', name, qty: parseNum($('#c-qty').value) || 1, unit: Math.round(price * 10000), memo: $('#c-memo').value.trim() });
      touch();
      closeSheet();
      toast(`${name} 담음`);
      if (tab === 'quote') renderQuote();
    };
  });
}

/* ---------- 견적서 ---------- */
function renderQuote() {
  const d = draft;
  view.innerHTML = `
    <div class="top">
      <h1>🧾 ${d.id ? '견적 수정' : '새 견적'} <span class="sub">${d.no ? 'No. ' + esc(d.no) : '저장 전'}${d.dirty ? ' · 저장 안 됨' : ''}</span></h1>
      <div class="btnrow">
        <select id="q-status" class="btn sm ghost" style="flex:none">${STATUSES.map((x) => `<option ${x === d.status ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <button class="btn sm ghost" data-act="new-quote" style="flex:none;margin-left:auto">＋ 새 견적</button>
      </div>
    </div>

    <div class="card">
      <h2>👤 고객 정보</h2>
      <div class="grid2">
        <label class="field"><span>고객명</span><input data-f="customer.name" value="${esc(d.customer.name)}" /></label>
        <label class="field"><span>연락처</span><input data-f="customer.phone" type="tel" value="${esc(d.customer.phone)}" /></label>
      </div>
      <label class="field"><span>현장 주소</span><input data-f="customer.address" value="${esc(d.customer.address)}" /></label>
      <div class="grid2">
        <label class="field"><span>견적일</span><input data-f="date" type="date" value="${esc(d.date)}" /></label>
        <label class="field"><span>작성자</span><input data-f="author" list="author-list" value="${esc(d.author ?? author())}" placeholder="설정에서 이름 등록" /></label>
      </div>
      <datalist id="author-list">${knownAuthors().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    </div>

    <div class="card">
      <h2>🔧 견적 항목 <span class="right">${d.lines.length}개</span></h2>
      <div id="lines">
        ${d.lines.length ? d.lines.map(lineHtml).join('') : '<div class="empty">아직 담은 항목이 없습니다.<br/>단가 검색에서 + 를 눌러 담아 주세요.</div>'}
      </div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn ghost sm" data-act="goto-search">🔍 항목 찾기</button>
        <button class="btn ghost sm" data-act="custom">✏️ 직접 입력</button>
      </div>
    </div>

    <div class="card">
      <h2>💰 금액</h2>
      <div class="seg" id="vat">
        ${Object.entries(VAT_LABEL).map(([k, v]) => `<button data-vat="${k}" class="${d.vatMode === k ? 'on' : ''}">${v}</button>`).join('')}
      </div>
      <div class="field" style="margin-top:10px"><span>할인 금액</span>
        <div class="money-in"><input data-f="discount" inputmode="numeric" value="${d.discount ? num(d.discount) : ''}" placeholder="0" /><span>원</span></div>
      </div>
      <div class="totals" id="totals"></div>
    </div>

    <div class="card">
      <h2>📝 견적서 특이사항</h2>
      <label class="field"><textarea data-f="memo" placeholder="예) 기존 제품 철거·폐기 포함 / 공사 가능 시간 오전 9시~오후 6시">${esc(d.memo)}</textarea></label>
      <p class="hint">PDF 견적서 아래쪽에 들어갑니다. 공통 안내문은 설정에서 바꿀 수 있습니다.</p>
    </div>

    <div class="card" id="ck-card"></div>

    <div class="fab-row">
      <button class="btn ghost" data-act="save-quote">💾 저장</button>
      <button class="btn orange" data-act="pdf">📄 견적서</button>
    </div>`;

  $('#q-status').onchange = (e) => { d.status = e.target.value; touch(); };
  view.querySelectorAll('[data-f]').forEach((el) => {
    el.addEventListener('input', () => {
      const f = el.dataset.f;
      if (f.startsWith('customer.')) d.customer[f.split('.')[1]] = el.value;
      else if (f === 'discount') d.discount = parseNum(el.value);
      else d[f] = el.value;
      touch();
      if (f === 'discount') renderTotals();
      if (f === 'customer.name') renderChecklist(true);
    });
  });
  $('#vat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vat]');
    if (!b) return;
    d.vatMode = b.dataset.vat;
    $('#vat').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    touch();
    renderTotals();
    renderChecklist(true);
  });
  $('#lines').addEventListener('input', onLineInput);
  renderTotals();
  renderChecklist();
}

function lineHtml(l) {
  return `
    <div class="line" data-lid="${l.lid}">
      <div class="top-row">
        <div class="lname"><input class="lmemo" style="border:0;padding:0;margin:0;font-weight:500;font-size:16px" data-lf="name" value="${esc(l.name)}" /></div>
        <button class="x" data-act="del-line" aria-label="삭제">✕</button>
      </div>
      <div class="ctrl">
        <div class="stepper">
          <button data-act="qty-" aria-label="수량 줄이기">−</button>
          <input data-lf="qty" inputmode="decimal" value="${l.qty}" />
          <button data-act="qty+" aria-label="수량 늘리기">＋</button>
        </div>
        <div class="money-in"><input data-lf="unit" inputmode="numeric" value="${num(l.unit)}" /><span>원</span></div>
      </div>
      <input class="lmemo" data-lf="memo" placeholder="비고 (견적서에 표시)" value="${esc(l.memo || '')}" />
      <div class="amt" data-amt>${won(l.qty * l.unit)}</div>
    </div>`;
}

function onLineInput(e) {
  const el = e.target.closest('[data-lf]');
  if (!el) return;
  const row = el.closest('[data-lid]');
  const l = draft.lines.find((x) => x.lid === row.dataset.lid);
  const f = el.dataset.lf;
  if (f === 'qty') l.qty = parseNum(el.value);
  else if (f === 'unit') l.unit = parseNum(el.value);
  else l[f] = el.value;
  row.querySelector('[data-amt]').textContent = won(l.qty * l.unit);
  touch();
  renderTotals();
}

function renderTotals() {
  const t = calcTotals(draft);
  const el = $('#totals');
  if (!el) return;
  el.innerHTML = `
    <div class="tr"><span>공급가 합계</span><span>${won(t.subtotal)}</span></div>
    ${t.discount ? `<div class="tr"><span>할인</span><span>-${won(t.discount)}</span></div>` : ''}
    ${draft.vatMode === 'add' ? `<div class="tr"><span>부가세 (10%)</span><span>${won(t.vat)}</span></div>` : ''}
    ${draft.vatMode === 'incl' ? `<div class="tr"><span>(부가세 포함 ${won(t.vat)})</span><span></span></div>` : ''}
    <div class="tr grand"><span>총 견적금액</span><span>${won(t.total)}</span></div>`;
}

function renderChecklist(previewOnly) {
  const card = $('#ck-card');
  if (!card) return;
  const msg = buildMessage(draft, store.state);
  if (previewOnly && $('#ck-preview')) {
    $('#ck-preview').textContent = msg;
    return;
  }
  const off = new Set(draft.ckOff || []);
  const { ask, warn } = buildChecklist(draft, store.state);
  const ckRow = (x) => `
    <label class="ck ${off.has(x.text) ? 'off' : ''}"><input type="checkbox" data-ck="${esc(x.text)}" ${off.has(x.text) ? '' : 'checked'} />
      <span class="tx">${esc(x.text)}<span class="src">${esc(x.src)}</span></span></label>`;
  card.innerHTML = `
    <h2>💬 고객 확인·안내 사항</h2>
    <p class="hint">담은 항목에 맞춰 자동으로 모았습니다. 보내지 않을 내용은 체크를 해제하세요.</p>
    <div class="ck-group"><h3>꼭 물어볼 것</h3>${ask.map(ckRow).join('')}</div>
    <div class="ck-group"><h3>안내·주의사항</h3>${warn.map(ckRow).join('')}</div>
    <label class="field"><span>추가로 전할 말</span><textarea id="ck-extra" placeholder="예) 방문 견적은 무료입니다.">${esc(draft.ckExtra || '')}</textarea></label>
    <label class="ck"><input type="checkbox" id="ck-amt" ${draft.includeAmount ? 'checked' : ''} /><span class="tx">견적 금액 요약도 함께 보내기</span></label>
    <div class="section-h" style="padding:10px 0 6px">미리보기</div>
    <div class="preview" id="ck-preview">${esc(msg)}</div>
    <div class="btnrow" style="margin-top:10px">
      <button class="btn" data-act="copy-msg">📋 복사하기</button>
      ${navigator.share ? '<button class="btn ghost" data-act="share-msg">📤 카톡 등으로 보내기</button>' : ''}
    </div>`;
  card.querySelectorAll('[data-ck]').forEach((cb) => cb.addEventListener('change', () => {
    const t = cb.dataset.ck;
    const set = new Set(draft.ckOff || []);
    cb.checked ? set.delete(t) : set.add(t);
    draft.ckOff = [...set];
    cb.closest('.ck').classList.toggle('off', !cb.checked);
    touch();
    renderChecklist(true);
  }));
  $('#ck-extra').addEventListener('input', (e) => { draft.ckExtra = e.target.value; touch(); renderChecklist(true); });
  $('#ck-amt').addEventListener('change', (e) => { draft.includeAmount = e.target.checked; touch(); renderChecklist(true); });
}

// allowEmpty: 견적 내용 없이 계약서만 쓸 때도 견적 한 건으로 저장 (계약서는 견적에 붙어 있음)
async function saveDraft(silent, { allowEmpty = false } = {}) {
  if (!allowEmpty && !draft.lines.length && !draft.customer.name) {
    alert('고객명이나 견적 항목을 먼저 입력해 주세요.');
    return false;
  }
  const isNew = !draft.id;
  if (isNew) {
    draft.id = newId('q');
    draft.no = nextQuoteNo(draft.date || today(), store.state.quotes);
    draft.createdAt = Date.now();
    draft.createdBy = author();
  }
  if (!(draft.author || '').trim()) draft.author = draft.createdBy || author();
  draft.updatedAt = Date.now();
  draft.updatedBy = author();
  draft.total = calcTotals(draft).total;
  const { dirty, ...data } = draft;
  // 계약서는 계약서 탭에서 따로 저장 (예전에 견적에 붙어 있던 계약서 흔적은 지움)
  delete data.contract;
  delete data.contractHistory;
  try {
    await saveQuote(data);
  } catch (e) {
    alert('저장하지 못했습니다: ' + e.message);
    return false;
  }
  draft.dirty = false;
  persistDraft();
  if (!silent) toast(isNew ? `견적 저장 완료 (No. ${draft.no})` : '견적을 수정 저장했습니다');
  if (tab === 'quote') renderQuote();
  return true;
}

function confirmLeaveDraft() {
  if (!draft.dirty || (!draft.lines.length && !draft.customer.name)) return true;
  return confirm('지금 작성 중인 견적이 저장되지 않았습니다. 그래도 계속할까요?');
}

async function doPdf(q) {
  if (!q.lines.length) return alert('견적 항목을 먼저 담아 주세요.');
  toast('PDF 만드는 중…');
  try {
    const { blob, filename } = await makeQuotePdf(q, store.state.settings);
    showPdfSheet(blob, filename, '📄 견적서 PDF 준비 완료');
  } catch (e) {
    console.error(e);
    alert('PDF를 만들지 못했습니다. 인터넷 연결을 확인해 주세요.\n' + e.message);
  }
}

// PDF 보내기·저장·보기 (견적서·계약서 공통)
function showPdfSheet(blob, filename, title) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  {
    let canShareFile = false;
    try { canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) {}
    // 브레이브 등 일부 브라우저는 파일 바로 보내기를 막아 둠 → 저장 후 카톡에서 첨부하도록 안내
    const browser = navigator.brave ? '브레이브(Brave)' : '이 브라우저';
    openSheet(`
      <h2>${title}</h2>
      <p class="hint">${esc(filename)}</p>
      ${canShareFile ? '' : `<div class="notice">
        ${browser}에서는 PDF를 카톡으로 <b>바로 보내기</b>가 지원되지 않아요.<br/>
        ① 아래 <b>💾 휴대폰에 저장</b>을 누르고 → 카톡 채팅방 <b>＋ → 파일</b> → <b>Download(다운로드)</b> 폴더에서 파일을 고르세요.<br/>
        ② 또는 <b>크롬</b>에서 이 앱을 다시 설치하면 바로 보내기 버튼이 생깁니다.
      </div>`}
      <div class="btnrow" style="flex-direction:column">
        ${canShareFile ? '<button class="btn orange block" id="p-share">📤 카톡·문자로 보내기</button>' : ''}
        <button class="btn ${canShareFile ? 'ghost' : 'orange'} block" id="p-down">💾 휴대폰에 저장</button>
        <button class="btn ghost block" id="p-open">👀 열어서 보기</button>
      </div>`, () => {
      const url = URL.createObjectURL(blob);
      const ps = $('#p-share');
      if (ps) ps.onclick = async () => {
        try { await navigator.share({ files: [file], title: filename }); } catch (_) {}
      };
      $('#p-open').onclick = () => window.open(url, '_blank');
      $('#p-down').onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        toast('저장했습니다. 카톡 ＋ → 파일에서 첨부하세요');
      };
    });
  }
}

/* ---------- 공사 계약서 (계약서 탭) ---------- */
// 계약서는 견적과 따로 'contracts'에 보관. 견적을 불러와 만들거나 빈 계약서로 시작.
// 고객이 서명하면 잠기고, 그때의 견적·업체 정보를 함께 저장(스냅샷)
const CDRAFT_KEY = 'gyeonjeok-contract-work-v1';
let cwork = (() => { try { return JSON.parse(localStorage.getItem(CDRAFT_KEY)); } catch (_) { return null; } })();
function persistCwork() {
  try { cwork ? localStorage.setItem(CDRAFT_KEY, JSON.stringify(cwork)) : localStorage.removeItem(CDRAFT_KEY); } catch (_) {}
}
const linkedQuote = (c) => (c?.quoteId ? store.state.quotes.find((x) => x.id === c.quoteId) || null : null);
const contractName = (c) => c.customer?.name || '(고객명 없음)';
function nextContractNo(date, list) {
  const prefix = 'C' + date.replace(/-/g, '').slice(2) + '-';
  const nums = list.map((x) => x.no || '').filter((n) => n.startsWith(prefix)).map((n) => parseInt(n.slice(prefix.length), 10) || 0);
  return prefix + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
}

// 새 계약서 만들기 (q가 있으면 그 견적 내용을 불러옴)
function startContract(q) {
  const c = newContract(q, store.state.settings, { useQuote: !!q });
  cwork = { ...c, id: null, no: '', date: today(), dirty: true };
  persistCwork();
  go('contract');
  toast(q ? `견적 No.${q.no} 내용을 불러왔어요` : '빈 계약서로 시작해요');
}
function openSavedContract(id) {
  const c = store.state.contracts.find((x) => x.id === id);
  if (!c) return toast('계약서를 찾을 수 없어요');
  cwork = { ...structuredClone(c), dirty: false };
  persistCwork();
  go('contract');
}
function confirmLeaveContract() {
  if (!cwork || !cwork.dirty || cwork.signedAt) return true;
  return confirm('작성 중인 계약서가 저장되지 않았어요. 그래도 계속할까요?');
}
async function saveCwork(extra = {}) {
  const isNew = !cwork.id;
  if (isNew) {
    cwork.id = newId('ct');
    cwork.no = nextContractNo(cwork.date || today(), store.state.contracts);
    cwork.createdAt = Date.now();
    cwork.createdBy = author();
  }
  Object.assign(cwork, extra, { updatedAt: Date.now(), updatedBy: author() });
  const { dirty, ...data } = cwork;
  await saveContractDoc(data);
  cwork.dirty = false;
  persistCwork();
  return cwork;
}

// 견적서 고르기 (계약서에 불러올 견적)
function pickQuoteSheet() {
  const list = store.state.quotes.filter(hasQuoteLines).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  openSheet(`
    <h2>📥 견적서에서 불러오기</h2>
    <div class="searchbox" style="padding:0 0 10px"><input id="pq" type="search" placeholder="고객명, 주소, 번호로 찾기" /></div>
    <div class="list" id="pq-list" style="border-radius:10px;overflow:hidden"></div>`, (sh) => {
    const draw = () => {
      const w = $('#pq', sh).value.trim().toLowerCase();
      const rows = list.filter((q) => !w || [q.no, q.customer?.name, q.customer?.address, q.customer?.phone].join(' ').toLowerCase().includes(w)).slice(0, 50);
      $('#pq-list', sh).innerHTML = rows.map((q) => `<div class="row" data-pq="${q.id}" style="cursor:pointer"><div class="main"><div class="name">${esc(q.customer?.name || '(고객명 없음)')} <span class="status s-${esc(q.status)}">${esc(q.status)}</span></div>
        <div class="meta">${esc(q.date)} · No.${esc(q.no)}</div><div class="meta">${esc((q.lines || []).map((l) => l.name).join(', '))}</div></div><div class="price">${won(calcTotals(q).total)}</div></div>`).join('') || '<div class="empty">견적서가 없어요</div>';
      sh.querySelectorAll('[data-pq]').forEach((r) => (r.onclick = () => { closeSheet(); startContract(store.state.quotes.find((x) => x.id === r.dataset.pq)); }));
    };
    $('#pq', sh).addEventListener('input', draw);
    draw();
  });
}

function renderContract() {
  const s = store.state.settings;
  // 시작 화면: 견적서에서 불러오기 / 빈 계약서
  if (!cwork) {
    const recent = [...store.state.contracts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
    view.innerHTML = `
      <div class="top"><h1>✍️ 계약서</h1></div>
      <div class="card">
        <h2>새 계약서 만들기</h2>
        <div class="btnrow" style="flex-direction:column">
          <button class="btn orange block" id="cs-quote">📥 견적서에서 불러오기</button>
          <button class="btn ghost block" id="cs-blank">✏️ 빈 계약서로 시작 (내용·금액 직접 입력)</button>
        </div>
      </div>
      ${recent.length ? `<div class="section-h"><span>최근 계약서</span></div><div class="list">${recent.map(contractRow).join('')}</div>` : ''}`;
    $('#cs-quote').onclick = () => (store.state.quotes.some(hasQuoteLines) ? pickQuoteSheet() : alert('불러올 견적서가 없어요. 빈 계약서로 시작해 주세요.'));
    $('#cs-blank').onclick = () => startContract(null);
    bindContractRows();
    return;
  }
  const c = cwork;
  const q = linkedQuote(c);
  const signed = !!c.signedAt;
  const canMerge = usesQuote(c) && hasQuoteLines(c.quoteSnap || q); // 견적서를 함께 붙일 수 있는지
  const m = money(q, c);
  const cust = c.customer || {};
  view.innerHTML = `
    <div class="top">
      <h1>✍️ 계약서 <span class="sub">${c.no ? 'No. ' + esc(c.no) : '저장 전'}${!signed && c.dirty ? ' · 저장 안 됨' : ''}</span></h1>
      <div class="btnrow"><span class="status ${signed ? 's-완료' : ''}" style="align-self:center">${signed ? '서명 완료' : '작성 중'}</span>
        <button class="btn sm ghost" id="c-new" style="flex:none;margin-left:auto">＋ 새 계약서</button></div>
    </div>
    ${usesQuote(c) ? `<div class="card" style="padding:10px 14px"><span class="hint" style="margin:0">📎 견적 No.${esc((c.quoteSnap || q)?.no || '-')}${q ? '' : ' (견적이 삭제됨)'}에서 불러온 계약서</span></div>` : ''}
    ${signed ? `
    <div class="card">
      <div class="notice">✅ ${esc(c.signedAt.slice(0, 10))} ${esc(cust.name || '')} 고객 서명 완료. 서명한 계약서는 내용을 고칠 수 없어요.<br/>바꿔야 하면 아래 <b>새 계약서로 다시 작성</b>을 누르세요.</div>
      <div class="totals"><div class="tr"><span>계약 금액</span><span>${won(m.total)}</span></div>${m.deposit ? `<div class="tr"><span>계약금</span><span>${won(m.deposit)}</span></div><div class="tr"><span>잔금</span><span>${won(m.balance)}</span></div>` : ''}</div>
      ${canMerge ? `<label class="ck" style="margin-top:10px"><input type="checkbox" id="c-withq" ${c.withQuote !== false ? 'checked' : ''} /><span class="tx">견적서도 함께 붙여서 보내기 (합본 PDF)</span></label>` : ''}
      <div class="btnrow" style="flex-direction:column;margin-top:8px">
        <button class="btn orange block" id="c-send">📤 서명한 계약서 PDF 보내기</button>
        <button class="btn ghost block" id="c-prev">👀 미리 보기</button>
        <button class="btn danger block" id="c-redo">새 계약서로 다시 작성</button>
      </div>
    </div>` : `<div id="c-form">
    <div class="card">
      <h2>🔧 작업 요청 내용 · 작업 기간</h2>
      <label class="field"><span>작업 요청 내용</span><textarea id="c-req" rows="4" placeholder="예) 욕실 타일 보수, 실리콘 재시공">${esc(c.request)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>작업 시작일</span><input type="date" id="c-start" value="${esc(c.startDate)}" /></label>
        <label class="field"><span>완료 예정일</span><input type="date" id="c-end" value="${esc(c.endDate)}" /></label>
      </div>
      <p class="hint" style="margin-top:-6px">비워 두면 "협의 후 결정"으로 들어가요.</p>
    </div>
    <div class="card">
      <h2>💰 금액 · 지급</h2>
      ${usesQuote(c)
    ? `<div class="totals" style="margin-bottom:10px"><div class="tr"><span>계약 금액 (견적서)</span><span>${won(m.total)}</span></div><div class="tr"><span></span><span class="hint" style="margin:0">${esc(m.vat)}</span></div></div>`
    : `<div class="field"><span>계약 금액</span><div class="money-in"><input id="c-amt" inputmode="numeric" value="${c.amount ? num(c.amount) : ''}" placeholder="0" /><span>원</span></div></div>
      <div class="seg" id="c-vat" style="margin:-4px 0 12px">${[['none', '부가세 별도'], ['incl', '부가세 포함']].map(([k, v]) => `<button type="button" data-v="${k}" class="${(c.vatMode || 'none') === k ? 'on' : ''}">${v}</button>`).join('')}</div>`}
      <label class="ck"><input type="checkbox" id="c-custom" ${c.custom ? 'checked' : ''} /><span class="tx"><b>주문 제작 품목 포함</b><span class="src">주문 제작 조항(계약금 입금 후 발주, 발주 후 취소 불가, 취소 시 제작비 청구)은 항상 들어가요. 체크하면 품목 이름과 계약금 금액이 구체적으로 적혀요</span></span></label>
      <div id="c-custom-box" ${c.custom ? '' : 'hidden'}>
        <div class="grid2">
          <label class="field"><span>주문 제작 품목</span><input id="c-item" value="${esc(c.customItem)}" placeholder="예) 중문, 맞춤 가구" /></label>
          <label class="field"><span>계약금 비율 (%)</span><input id="c-rate" inputmode="numeric" value="${esc(c.depositRate)}" /></label>
        </div>
      </div>
      <div id="c-dep-box" ${c.custom ? 'hidden' : ''}>
        <div class="field"><span>계약금 (없으면 비워 두세요)</span><div class="money-in"><input id="c-dep" inputmode="numeric" value="${c.deposit ? num(c.deposit) : ''}" placeholder="0" /><span>원</span></div></div>
      </div>
      <div class="hint" id="c-split" style="margin-top:-4px"></div>
      <label class="field"><span>잔금 지급 시점</span><input id="c-bal" value="${esc(c.balanceTerm)}" /></label>
    </div>
    <div class="card">
      <h2>🛠 A/S 기간 · 특약</h2>
      <div class="field"><span>A/S (하자 보수) 기간</span>
        <div class="seg" id="c-as">${['없음', '6개월', '1년', '2년'].map((x) => `<button type="button" data-as="${x}" class="${c.asPeriod === x ? 'on' : ''}">${x}</button>`).join('')}</div>
        <input id="c-as-in" style="margin-top:6px" value="${esc(c.asPeriod)}" placeholder="직접 입력 (예: 3년)" />
      </div>
      <div class="field"><span>특약 사항 (기본 조항 외에 추가할 내용)</span><div id="c-extras"></div>
        <button type="button" class="btn ghost sm" id="c-add-ex" style="margin-top:6px">＋ 특약 추가</button></div>
    </div>
    <div class="card">
      <h2>👤 고객 정보</h2>
      <label class="field"><span>고객명 (상호명)</span><input id="c-name" value="${esc(cust.name || '')}" /></label>
      <label class="field"><span>연락처</span><input id="c-phone" type="tel" value="${esc(cust.phone || '')}" /></label>
      <label class="field"><span>현장 주소</span><input id="c-addr" value="${esc(cust.address || '')}" /></label>
      ${canMerge ? `<label class="ck"><input type="checkbox" id="c-withq" ${c.withQuote !== false ? 'checked' : ''} /><span class="tx">보낼 때 견적서도 함께 붙이기 (합본 PDF)</span></label>` : ''}
      ${!s.company || !s.owner ? '<div class="notice" style="margin-top:8px">설정에 <b>상호·대표자·사업자번호·계좌·도장</b>을 넣어 두면 계약서에 자동으로 들어가요.</div>' : ''}
    </div>
    <div class="fab-row">
      <button class="btn ghost" id="c-save">💾 저장</button>
      <button class="btn ghost" id="c-prev">👀 미리 보기</button>
      <button class="btn orange" id="c-sign">✍️ 서명받기</button>
    </div></div>`}`;

  $('#c-new').onclick = () => {
    if (!confirmLeaveContract()) return;
    cwork = null;
    persistCwork();
    renderContract();
  };
  const withQ = () => canMerge && $('#c-withq')?.checked !== false;
  if (signed) {
    $('#c-withq') && ($('#c-withq').onchange = async (e) => { c.withQuote = e.target.checked; await saveCwork(); });
    $('#c-prev').onclick = () => previewContract(q, c);
    $('#c-send').onclick = () => sendContract(q, c, withQ());
    $('#c-redo').onclick = async () => {
      if (!confirm('서명한 계약서는 기록으로 남기고, 내용을 고칠 수 있는 새 계약서를 만들까요?\n새 계약서는 고객에게 다시 서명받아야 해요.')) return;
      const { signature, signedAt, party, quoteSnap, signName, id, no, createdAt, createdBy, ...rest } = c;
      cwork = { ...rest, id: null, no: '', date: today(), replaces: c.no, dirty: true };
      persistCwork();
      renderContract();
      toast(`${c.no} 계약서를 바탕으로 새로 작성해요`);
    };
    return;
  }
  const touchC = () => { if (!c.dirty) { c.dirty = true; } persistCwork(); };
  // 특약 사항 목록
  const drawExtras = () => {
    $('#c-extras').innerHTML = (c.extras || []).map((x, i) => `<div class="btnrow" style="margin-bottom:6px;flex-wrap:nowrap"><input data-ex="${i}" value="${esc(x)}" style="flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px" /><button type="button" class="btn ghost sm" data-exdel="${i}" style="flex:none">✕</button></div>`).join('') || '<p class="hint" style="margin:0">없음</p>';
    view.querySelectorAll('[data-ex]').forEach((el) => (el.oninput = () => { c.extras[+el.dataset.ex] = el.value; touchC(); }));
    view.querySelectorAll('[data-exdel]').forEach((b) => (b.onclick = () => { c.extras.splice(+b.dataset.exdel, 1); touchC(); drawExtras(); }));
  };
  drawExtras();
  $('#c-add-ex').onclick = () => { c.extras = [...(c.extras || []), '']; drawExtras(); view.querySelector(`[data-ex="${c.extras.length - 1}"]`)?.focus(); };
  // 화면 값을 계약서에 담기
  const collect = () => {
    c.request = $('#c-req').value.trim();
    c.startDate = $('#c-start').value;
    c.endDate = $('#c-end').value;
    c.custom = $('#c-custom').checked;
    c.customItem = $('#c-item').value.trim();
    c.depositRate = parseNum($('#c-rate').value) || 0;
    c.deposit = parseNum($('#c-dep').value);
    c.balanceTerm = $('#c-bal').value.trim() || '작업 완료 시 지급';
    c.asPeriod = $('#c-as-in').value.trim() || '없음';
    c.extras = (c.extras || []).map((x) => x.trim()).filter(Boolean);
    c.withQuote = withQ();
    if (!usesQuote(c)) {
      c.amount = parseNum($('#c-amt').value);
      c.vatMode = $('#c-vat .on')?.dataset.v || 'none';
    }
    c.customer = { name: $('#c-name').value.trim(), phone: $('#c-phone').value.trim(), address: $('#c-addr').value.trim() };
  };
  // 입력할 때마다 기기에 임시 저장 (창을 닫아도 남게)
  $('#c-form').addEventListener('input', () => { collect(); touchC(); });
  $('#c-form').addEventListener('change', () => { collect(); touchC(); });
  const split = () => {
    const t = { ...c, custom: $('#c-custom').checked, depositRate: parseNum($('#c-rate').value), deposit: parseNum($('#c-dep').value), amount: $('#c-amt') ? parseNum($('#c-amt').value) : c.amount };
    const mm = money(q, t);
    $('#c-split').textContent = mm.deposit ? `계약금 ${won(mm.deposit)} · 잔금 ${won(mm.balance)}` : '계약금 없이 잔금으로 한 번에 받아요';
  };
  split();
  $('#c-custom').onchange = (e) => { $('#c-custom-box').hidden = !e.target.checked; $('#c-dep-box').hidden = e.target.checked; split(); };
  ['#c-rate', '#c-dep', '#c-amt'].forEach((id) => $(id)?.addEventListener('input', split));
  ['#c-dep', '#c-amt'].forEach((id) => $(id)?.addEventListener('input', (e) => { const v = parseNum(e.target.value); e.target.value = v ? num(v) : ''; }));
  $('#c-vat')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    $('#c-vat').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    collect();
    touchC();
  });
  $('#c-as').addEventListener('click', (e) => {
    const b = e.target.closest('[data-as]');
    if (!b) return;
    $('#c-as-in').value = b.dataset.as;
    $('#c-as').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    collect();
    touchC();
  });
  $('#c-save').onclick = async () => { collect(); await saveCwork(); toast(`계약서를 저장했어요 (No. ${c.no})`); renderContract(); };
  $('#c-prev').onclick = () => { collect(); previewContract(q, c); };
  $('#c-sign').onclick = async () => {
    collect();
    if (!c.customer.name) return alert('고객명(상호명)을 먼저 넣어 주세요.');
    if (!c.request) return alert('작업 요청 내용을 먼저 넣어 주세요.');
    const mm = money(q, c);
    if (!mm.total) return alert('계약 금액을 먼저 넣어 주세요.');
    await saveCwork();
    const sig = await signaturePad({ title: '고객 서명', note: `${c.customer.name} · 계약 금액 ${won(mm.total)}` });
    if (!sig) return;
    let snap;
    if (usesQuote(c) && q) {
      const { contract, contractHistory, dirty, ...rest } = structuredClone(q);
      snap = rest;
    }
    await saveCwork({
      signature: sig, signedAt: `${today()}T${new Date().toTimeString().slice(0, 5)}` /* 한국 시간 */, signName: c.customer.name,
      ...(snap ? { quoteSnap: snap } : {}),
      party: { company: s.company, owner: s.owner, bizNo: s.bizNo, phone: s.phone, address: s.address, account: s.account, stamp: s.stamp },
    });
    // 연결된 견적은 '계약' 상태로
    if (q && ['상담중', '발송'].includes(q.status)) await saveQuote({ ...q, status: '계약', updatedAt: Date.now(), updatedBy: author() });
    renderContract();
    toast('서명 완료! 계약서 PDF를 만들고 있어요');
    sendContract(q, cwork, canMerge && cwork.withQuote !== false);
  };
}

async function previewContract(q, c) {
  toast('미리 보기를 만드는 중…');
  try {
    const imgs = await contractPreview(q, c, store.state.settings);
    const ov = document.createElement('div');
    ov.className = 'pv-overlay';
    ov.innerHTML = `<div class="pv-bar"><b>계약서 미리 보기</b><button class="btn sm ghost" id="pv-x">닫기</button></div>${imgs.map((u) => `<img src="${u}" alt="계약서" />`).join('')}`;
    document.body.append(ov);
    ov.querySelector('#pv-x').onclick = () => ov.remove();
  } catch (e) {
    console.error(e);
    alert('미리 보기를 만들지 못했어요. 인터넷 연결을 확인해 주세요.\n' + e.message);
  }
}

async function sendContract(q, c, withQuote) {
  toast(withQuote ? '계약서 + 견적서 PDF 만드는 중…' : '계약서 PDF 만드는 중…');
  try {
    const { blob, filename } = await makeContractPdf(q, c, store.state.settings, { withQuote });
    showPdfSheet(blob, filename, withQuote ? '✍️ 계약서 + 견적서 PDF 준비 완료' : '✍️ 계약서 PDF 준비 완료');
  } catch (e) {
    console.error(e);
    alert('계약서 PDF를 만들지 못했어요. 인터넷 연결을 확인해 주세요.\n' + e.message);
  }
}

// 계약 내역 한 줄
function contractRow(c) {
  const m = money(linkedQuote(c), c);
  return `<div class="row" data-cid="${c.id}" style="cursor:pointer">
    <div class="main">
      <div class="name">${esc(contractName(c))} <span class="status ${c.signedAt ? 's-완료' : ''}">${c.signedAt ? '서명 완료' : '작성 중'}</span></div>
      <div class="meta">${esc((c.signedAt || '').slice(0, 10) || c.date || '')} · No.${esc(c.no || '')}${usesQuote(c) && (c.quoteSnap || linkedQuote(c))?.no ? ` · 견적 ${esc((c.quoteSnap || linkedQuote(c)).no)}` : ''}</div>
      <div class="meta">${esc((c.request || '').split('\n')[0].replace(/^·\s*/, ''))}</div>
    </div>
    <div class="price">${won(m.total)}</div>
  </div>`;
}
function bindContractRows() {
  view.querySelectorAll('[data-cid]').forEach((r) => (r.onclick = () => contractSheet(r.dataset.cid)));
}
function contractSheet(id) {
  const c = store.state.contracts.find((x) => x.id === id);
  if (!c) return;
  const q = linkedQuote(c);
  const m = money(q, c);
  const canMerge = usesQuote(c) && hasQuoteLines(c.quoteSnap || q);
  openSheet(`
    <h2>${esc(contractName(c))} <span class="status ${c.signedAt ? 's-완료' : ''}">${c.signedAt ? '서명 완료' : '작성 중'}</span></h2>
    <p class="hint">계약 No.${esc(c.no)}${c.signedAt ? ` · ${esc(c.signedAt.slice(0, 10))} 서명` : ''}<br/>${esc(c.customer?.address || '')}</p>
    <div class="totals"><div class="tr grand"><span>계약 금액</span><span>${won(m.total)}</span></div></div>
    <div class="btnrow" style="flex-direction:column;margin-top:12px">
      <button class="btn block" id="cs-open">${c.signedAt ? '👀 계약서 열기' : '✏️ 이어서 작성'}</button>
      ${c.signedAt ? '<button class="btn orange block" id="cs-send">📤 계약서 PDF 보내기</button>' : ''}
      <button class="btn danger block" id="cs-del">삭제</button>
    </div>`, () => {
    $('#cs-open').onclick = () => { if (!confirmLeaveContract()) return; closeSheet(); openSavedContract(c.id); };
    $('#cs-send') && ($('#cs-send').onclick = () => { closeSheet(); sendContract(q, c, canMerge && c.withQuote !== false); });
    $('#cs-del').onclick = async () => {
      if (!confirm(`${c.signedAt ? '서명까지 받은 ' : ''}이 계약서를 삭제할까요? 되돌릴 수 없습니다.`)) return;
      await deleteContractDoc(c.id);
      if (cwork?.id === c.id) { cwork = null; persistCwork(); }
      closeSheet();
      toast('삭제했습니다');
    };
  });
}

// 예전에 견적에 붙여 두었던 계약서(q.contract)를 계약서 목록(contracts)으로 옮김 (한 번만)
let movingContracts = false;
async function moveOldContracts() {
  if (movingContracts || !store.ready || (store.mode === 'cloud' && !(store.user && store.online))) return;
  const olds = store.state.quotes.filter((q) => q.contract);
  if (!olds.length) return;
  movingContracts = true;
  try {
    for (const q of olds) {
      const { contract, contractHistory, ...rest } = q;
      const id = 'ct' + q.id;
      if (!store.state.contracts.some((x) => x.id === id)) {
        await saveContractDoc({
          useQuote: true, ...contract, id, quoteId: q.id, customer: { ...(q.customer || {}) },
          no: nextContractNo((contract.signedAt || q.date || today()).slice(0, 10), store.state.contracts),
          date: (contract.signedAt || q.date || today()).slice(0, 10), createdAt: q.updatedAt || Date.now(), updatedAt: Date.now(),
        });
      }
      await saveQuote(rest);
    }
    if (draft.contract) { delete draft.contract; delete draft.contractHistory; persistDraft(); }
  } finally {
    movingContracts = false;
  }
}

/* ---------- 견적 내역 ---------- */
function renderHistory() {
  const isQ = ui.hkind !== 'contract';
  view.innerHTML = `
    <div class="top">
      <h1>📁 견적/계약 내역 <span class="sub">${store.mode === 'cloud' ? '함께 보는 내역' : '이 기기에 저장된 내역'}</span></h1>
      <div class="seg" id="hkind" style="margin:0 0 10px;background:rgba(255,255,255,.15)">
        <button data-k="quote" class="${isQ ? 'on' : ''}" style="${isQ ? '' : 'color:#fff'}">🧾 견적 ${store.state.quotes.length}</button>
        <button data-k="contract" class="${isQ ? '' : 'on'}" style="${isQ ? 'color:#fff' : ''}">✍️ 계약 ${store.state.contracts.length}</button>
      </div>
      <div class="searchbox"><input id="hq" type="search" placeholder="${isQ ? '고객명, 주소, 연락처, 항목 검색' : '고객명, 주소, 연락처, 공사 내용 검색'}" value="${esc(ui.hq)}" /></div>
    </div>
    <div class="chips" id="hchips">
      ${isQ
    ? ['전체', ...STATUSES].map((n) => `<button class="chip ${ui.hstatus === n ? 'on' : ''}" data-st="${n}">${n}</button>`).join('')
    : ['전체', '작성 중', '서명 완료'].map((n) => `<button class="chip ${ui.cstatus === n ? 'on' : ''}" data-st="${n}">${n}</button>`).join('')}
    </div>
    ${isQ && (knownAuthors().length > 1 || ui.hauthor !== '전체') ? `<div class="chips" id="hauthors" style="padding-top:0">
      ${['전체', ...knownAuthors()].map((n) => `<button class="chip ${ui.hauthor === n ? 'on' : ''}" data-au="${esc(n)}">${n === '전체' ? '👥 모든 작성자' : '✍️ ' + esc(n) + (n === author() ? ' (나)' : '')}</button>`).join('')}
    </div>` : ''}
    <div id="hlist"></div>`;
  $('#hkind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b || b.dataset.k === ui.hkind) return;
    ui.hkind = b.dataset.k;
    renderHistory();
  });
  $('#hq').addEventListener('input', (e) => { ui.hq = e.target.value; renderHList(); });
  $('#hchips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-st]');
    if (!c) return;
    if (isQ) ui.hstatus = c.dataset.st;
    else ui.cstatus = c.dataset.st;
    document.querySelectorAll('#hchips .chip').forEach((x) => x.classList.toggle('on', x === c));
    renderHList();
  });
  const ha = $('#hauthors');
  if (ha) ha.addEventListener('click', (e) => {
    const c = e.target.closest('[data-au]');
    if (!c) return;
    ui.hauthor = c.dataset.au;
    ha.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    renderHList();
  });
  renderHList();
}

function renderHList() {
  const box = $('#hlist');
  if (!box) return;
  const w = ui.hq.trim().toLowerCase();
  if (ui.hkind === 'contract') {
    const cl = store.state.contracts
      .filter((c) => ui.cstatus === '전체' || (ui.cstatus === '서명 완료') === !!c.signedAt)
      .filter((c) => !w || [c.no, c.customer?.name, c.customer?.address, c.customer?.phone, c.request].join(' ').toLowerCase().includes(w))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    box.innerHTML = cl.length ? `<div class="list" style="margin-top:8px">${cl.map(contractRow).join('')}</div>` : '<div class="empty">조건에 맞는 계약서가 없습니다.<br/>계약서 탭에서 새로 만들 수 있어요.</div>';
    const ct = cl.reduce((s, c) => s + money(linkedQuote(c), c).total, 0);
    if (cl.length) box.insertAdjacentHTML('afterbegin', `<div class="section-h"><span>${cl.length}건</span><span>합계 ${won(ct)}</span></div>`);
    bindContractRows();
    return;
  }
  const signedQ = new Set(store.state.contracts.filter((c) => c.signedAt && c.quoteId).map((c) => c.quoteId));
  const list = store.state.quotes
    .filter((q) => ui.hstatus === '전체' || q.status === ui.hstatus)
    .filter((q) => ui.hauthor === '전체' || quoteAuthor(q) === ui.hauthor)
    .filter((q) => !w || [q.no, q.customer?.name, q.customer?.address, q.customer?.phone, ...(q.lines || []).map((l) => l.name)].join(' ').toLowerCase().includes(w))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  box.innerHTML = list.length
    ? `<div class="list" style="margin-top:8px">${list.map((q) => `
      <div class="row" data-qid="${q.id}" data-act="open-quote">
        <div class="main">
          <div class="name">${esc(q.customer?.name || '(고객명 없음)')} <span class="status s-${esc(q.status)}">${esc(q.status)}</span>${signedQ.has(q.id) ? ' <span class="status s-완료">✍️ 계약서 서명</span>' : ''}</div>
          <div class="meta">${esc(q.date)} · No.${esc(q.no)}${quoteAuthor(q) ? ' · ✍️ ' + esc(quoteAuthor(q)) : ''}</div>
          <div class="meta">${esc((q.lines || []).map((l) => l.name).join(', '))}</div>
        </div>
        <div class="price">${won(q.total ?? calcTotals(q).total)}</div>
      </div>`).join('')}</div>`
    : '<div class="empty">조건에 맞는 견적이 없습니다.</div>';
  const t = list.reduce((s, q) => s + (q.total ?? calcTotals(q).total), 0);
  if (list.length) box.insertAdjacentHTML('afterbegin', `<div class="section-h"><span>${list.length}건</span><span>합계 ${won(t)}</span></div>`);
}

function quoteSheet(q) {
  const linked = store.state.contracts.filter((c) => c.quoteId === q.id);
  openSheet(`
    <h2>${esc(q.customer?.name || '(고객명 없음)')} <span class="status s-${esc(q.status)}">${esc(q.status)}</span></h2>
    <p class="hint">No.${esc(q.no)} · ${esc(q.date)}${quoteAuthor(q) ? ' · ✍️ ' + esc(quoteAuthor(q)) : ''}<br/>${esc(q.customer?.address || '')}</p>
    <div class="totals">
      ${(q.lines || []).map((l) => `<div class="tr"><span>${esc(l.name)} ×${l.qty}</span><span>${won(l.qty * l.unit)}</span></div>`).join('')}
      <div class="tr grand"><span>합계</span><span>${won(calcTotals(q).total)}</span></div>
    </div>
    <label class="field" style="margin-top:12px"><span>진행 상태</span>
      <select id="h-st">${STATUSES.map((x) => `<option ${x === q.status ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <div class="btnrow" style="flex-direction:column">
      <button class="btn block" id="h-edit">✏️ 불러와서 수정</button>
      <button class="btn orange block" id="h-pdf">📄 PDF 견적서</button>
      <button class="btn block" id="h-contract">✍️ 이 견적으로 계약서 만들기${linked.length ? ` (계약서 ${linked.length}건)` : ''}</button>
      <button class="btn ghost block" id="h-copy">📑 복사해서 새 견적 만들기</button>
      <button class="btn danger block" id="h-del">삭제</button>
    </div>`, () => {
    $('#h-st').onchange = async (e) => { await saveQuote({ ...q, status: e.target.value, updatedAt: Date.now(), updatedBy: author() }); toast('상태를 바꿨습니다'); };
    $('#h-edit').onclick = () => {
      if (!confirmLeaveDraft()) return;
      draft = { ...structuredClone(q), dirty: false };
      persistDraft();
      closeSheet();
      go('quote');
    };
    $('#h-pdf').onclick = () => { closeSheet(); doPdf(q); };
    $('#h-contract').onclick = () => {
      if (!hasQuoteLines(q)) return alert('견적 항목이 없는 견적이에요. 계약서 탭에서 빈 계약서로 시작해 주세요.');
      if (!confirmLeaveContract()) return;
      closeSheet();
      startContract(q);
    };
    $('#h-copy').onclick = () => {
      if (!confirmLeaveDraft()) return;
      draft = { ...structuredClone(q), id: null, no: '', date: today(), status: '상담중', dirty: true, author: author(), createdBy: undefined };
      draft.lines.forEach((l) => (l.lid = newId('l')));
      persistDraft();
      closeSheet();
      go('quote');
      toast('복사한 새 견적입니다. 고객 정보를 확인하세요');
    };
    $('#h-del').onclick = async () => {
      if (!confirm('이 견적을 삭제할까요? 되돌릴 수 없습니다.')) return;
      await deleteQuote(q.id);
      if (draft.id === q.id) { draft.id = null; draft.no = ''; persistDraft(); }
      closeSheet();
      toast('삭제했습니다');
    };
  });
}

/* ---------- 설정 ---------- */
function renderSettings() {
  const s = store.state.settings;
  view.innerHTML = `
    <div class="top"><h1>⚙️ 설정</h1></div>

    <div class="card">
      <h2>🙋 이 휴대폰 사용자</h2>
      <label class="field"><span>내 이름 (견적 작성자로 표시)</span><input id="st-author" value="${esc(author())}" placeholder="예) 남편 / 아내 이름" /></label>
    </div>

    <div class="card">
      <h2>🏢 견적서 업체 정보 <span class="right">${store.mode === 'cloud' ? '함께 사용' : ''}</span></h2>
      <label class="field"><span>상호</span><input data-s="company" value="${esc(s.company)}" /></label>
      <div class="grid2">
        <label class="field"><span>대표자</span><input data-s="owner" value="${esc(s.owner)}" /></label>
        <label class="field"><span>사업자등록번호</span><input data-s="bizNo" value="${esc(s.bizNo)}" /></label>
      </div>
      <label class="field"><span>연락처</span><input data-s="phone" type="tel" value="${esc(s.phone)}" /></label>
      <label class="field"><span>사업장 주소</span><input data-s="address" value="${esc(s.address)}" /></label>
      <label class="field"><span>입금 계좌 (견적서에 표시)</span><input data-s="account" value="${esc(s.account)}" placeholder="예) ○○은행 000-0000-0000 홍길동" /></label>
      <div class="field"><span>도장 이미지</span>
        <div class="btnrow" style="align-items:center">
          ${s.stamp ? `<img src="${s.stamp}" alt="도장" style="width:56px;height:56px;object-fit:contain;flex:none" />` : ''}
          <label class="btn ghost sm" style="flex:none">사진 선택<input type="file" accept="image/*" id="st-stamp" hidden /></label>
          ${s.stamp ? '<button class="btn danger sm" id="st-stamp-del" style="flex:none">지우기</button>' : ''}
        </div>
      </div>
      <div class="grid2">
        <label class="field"><span>견적 유효기간 (일)</span><input data-s="validDays" inputmode="numeric" value="${esc(s.validDays)}" /></label>
        <label class="field"><span>기본 부가세 표시</span><select data-s="vatMode">${Object.entries(VAT_LABEL).map(([k, v]) => `<option value="${k}" ${s.vatMode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>견적서 공통 안내문</span><textarea data-s="footerNotes">${esc(s.footerNotes)}</textarea></label>
      <h2 style="margin-top:16px">✍️ 계약서 기본값</h2>
      <p class="hint" style="margin-top:-6px">새 계약서를 만들 때 처음 채워지는 값이에요. 계약서마다 바꿀 수 있어요.</p>
      <div class="grid2">
        <label class="field"><span>A/S 기간</span><input data-s="contractAs" value="${esc(s.contractAs || '1년')}" placeholder="예) 1년" /></label>
        <label class="field"><span>주문 제작 계약금 (%)</span><input data-s="contractDepositRate" inputmode="numeric" value="${esc(s.contractDepositRate || 50)}" /></label>
      </div>
      <label class="field"><span>기본 특약 사항 (한 줄에 하나씩)</span><textarea data-s="contractExtras" placeholder="예) 공사 중 발생한 폐기물은 시공자가 처리한다.">${esc(s.contractExtras || '')}</textarea></label>
      <button class="btn block" id="st-save">업체 정보 저장</button>
    </div>

    <div class="card">
      <h2>📒 단가표 관리</h2>
      <p class="hint">단가는 검색 화면에서 항목을 누르면 바로 고칠 수 있습니다. 단가를 많이 고친 뒤에는 백업 파일을 받아 PC에 보관해 두세요.</p>
      <div class="btnrow" style="flex-direction:column">
        <button class="btn ghost block" data-act="new-item">＋ 단가표에 새 항목 추가</button>
        <button class="btn ghost block" id="st-export">💾 단가표·견적 백업 파일 받기</button>
        <label class="btn ghost block">📂 백업 파일에서 단가표 불러오기<input type="file" accept=".json,application/json" id="st-import" hidden /></label>
      </div>
    </div>

    <div class="card">
      <h2>☁️ 함께 쓰기</h2>
      ${store.mode === 'cloud'
        ? `<p>${store.online ? '✅ 클라우드에 연결되어 있습니다.' : '⚠️ 지금은 인터넷 연결이 안 되어 휴대폰에 저장된 내용으로 보여드립니다.'}<br/><b>${esc(store.user?.email || '')}</b></p>${store.pending ? `<p class="hint">아직 올리지 못한 변경 ${store.pending}건 · 인터넷이 연결되면 자동으로 올라갑니다.</p>` : ''}<button class="btn ghost block" id="st-logout">로그아웃</button>`
        : `<p class="hint">지금은 <b>이 기기에만</b> 저장됩니다. 남편분과 함께 쓰려면 Supabase 연결이 필요합니다(설치안내.md 참고).</p>`}
    </div>
    <p class="hint" style="text-align:center">집수리 견적 v1.0</p>`;

  $('#st-author').addEventListener('change', (e) => { localStorage.setItem(AUTHOR_KEY, e.target.value.trim()); toast('저장했습니다'); });
  let stamp = s.stamp || '';
  $('#st-stamp').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    stamp = await resizeImage(f, 240);
    await saveSettings({ ...collectSettings(), stamp });
    toast('도장 이미지를 저장했습니다');
  });
  const del = $('#st-stamp-del');
  if (del) del.onclick = async () => { await saveSettings({ ...collectSettings(), stamp: '' }); };
  function collectSettings() {
    const out = { ...store.state.settings };
    view.querySelectorAll('[data-s]').forEach((el) => (out[el.dataset.s] = el.value));
    out.validDays = parseNum(out.validDays) || 0;
    out.contractDepositRate = parseNum(out.contractDepositRate) || 50;
    return out;
  }
  $('#st-save').onclick = async () => { await saveSettings(collectSettings()); toast('업체 정보를 저장했습니다'); };
  $('#st-export').onclick = () => {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), ...store.state }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `견적앱_백업_${today()}.json`;
    a.click();
  };
  $('#st-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!Array.isArray(d.items) || !Array.isArray(d.categories)) throw new Error('단가표가 없는 파일');
      if (!confirm(`단가표를 파일의 내용(${d.items.length}개 항목)으로 바꿀까요?`)) return;
      await replacePriceList(d.categories, d.items);
      toast('단가표를 불러왔습니다');
    } catch (err) {
      alert('불러오지 못했습니다: ' + err.message);
    }
  });
  const lo = $('#st-logout');
  if (lo) lo.onclick = () => logout();
}

function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ================= 클릭 처리 ================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const itemRow = el.closest('[data-item]');
  const item = itemRow && store.state.items.find((i) => i.id === itemRow.dataset.item);
  const lineRow = el.closest('[data-lid]');
  const line = lineRow && draft.lines.find((l) => l.lid === lineRow.dataset.lid);

  switch (act) {
    case 'add':
      addItemToDraft(item);
      refreshRow(item.id);
      break;
    case 'sub': {
      const l = draft.lines.find((x) => x.itemId === item.id);
      if (!l) break;
      l.qty = (Number(l.qty) || 0) - 1;
      if (l.qty <= 0) {
        draft.lines = draft.lines.filter((x) => x !== l);
        toast(`${item.name} 뺌`);
      } else toast(`${item.name} ${l.qty}개로 줄임`);
      touch();
      refreshRow(item.id);
      break;
    }
    case 'item-info':
      itemInfoSheet(item);
      break;
    case 'custom':
      customSheet();
      break;
    case 'new-item':
      ui.q = '';
      itemEditSheet(null);
      break;
    case 'goto-search':
      go('search');
      break;
    case 'qty-':
    case 'qty+': {
      line.qty = Math.max(0, (Number(line.qty) || 0) + (act === 'qty+' ? 1 : -1));
      lineRow.querySelector('[data-lf="qty"]').value = line.qty;
      lineRow.querySelector('[data-amt]').textContent = won(line.qty * line.unit);
      touch();
      renderTotals();
      renderChecklist(true);
      break;
    }
    case 'del-line':
      draft.lines = draft.lines.filter((l) => l !== line);
      touch();
      renderQuote();
      break;
    case 'new-quote':
      if (!confirmLeaveDraft()) return;
      draft = blankDraft();
      persistDraft();
      renderQuote();
      toast('새 견적을 시작합니다');
      break;
    case 'save-quote':
      await saveDraft();
      break;
    case 'pdf':
      if (draft.dirty) await saveDraft(true);
      doPdf(draft);
      break;
    case 'copy-msg':
      toast((await copyText(buildMessage(draft, store.state))) ? '복사했습니다. 카톡에 붙여넣기 하세요' : '복사하지 못했습니다');
      break;
    case 'share-msg':
      try { await navigator.share({ text: buildMessage(draft, store.state) }); } catch (_) {}
      break;
    case 'open-quote': {
      const q = store.state.quotes.find((x) => x.id === el.dataset.qid);
      if (q) quoteSheet(q);
      break;
    }
  }
});

/* ================= 시작 ================= */
let renderQueued = false;
subscribe(() => {
  // 입력 중 화면이 다시 그려져 커서가 사라지지 않도록, 입력과 무관한 부분만 갱신
  moveOldContracts();
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    const active = document.activeElement;
    const typing = active && view.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    if (store.mode === 'cloud' && !store.user) return render();
    if (tab === 'search' && typing) return renderResults();
    if (tab === 'history' && typing) return renderHList();
    if (tab === 'contract' && typing) return; // 계약서 입력 중에는 다시 그리지 않음
    if (typing) return; // 견적서·설정 입력 중에는 다시 그리지 않음
    if (tab === 'search' && $('#results')) {
      renderResults();
      return;
    }
    render();
  });
});

render();
initStore().catch((e) => {
  console.error(e);
  view.innerHTML = `<div class="card">시작하지 못했습니다: ${esc(e.message)}</div>`;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
