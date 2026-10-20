// 견적서 PDF 만들기: A4 크기 HTML을 그린 뒤 이미지로 찍어 PDF에 붙입니다(한글 글꼴 문제 없음).
import { esc, num, won, koreanAmount, addDays } from './util.js';
import { calcTotals, VAT_LABEL } from './quote.js';

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];
const PAGE_W = 794; // A4 @96dpi
const PAGE_H = 1123;
const PAD = 46;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PDF 도구를 불러오지 못했습니다'));
    document.head.appendChild(s);
  });
}

const CSS = `
.pg{width:${PAGE_W}px;height:${PAGE_H}px;padding:${PAD}px ${PAD + 4}px;box-sizing:border-box;background:#fff;color:#1c2430;
  font-family:'Noto Sans KR',sans-serif;font-size:13px;line-height:1.45;position:relative;overflow:hidden}
.pg *{box-sizing:border-box}
.ttl{text-align:center;font-size:34px;font-weight:900;letter-spacing:18px;color:#1f3a5f;padding-left:18px;margin:0 0 4px}
.ttl-line{height:4px;border-top:2px solid #1f3a5f;border-bottom:1px solid #1f3a5f;margin:0 0 22px}
.hd{display:flex;gap:18px;margin-bottom:16px}
.hd .to{flex:1;display:flex;flex-direction:column;justify-content:space-between}
.hd .cust{font-size:21px;font-weight:700;border-bottom:1.5px solid #1c2430;padding-bottom:4px;margin:6px 0 8px}
.hd .cust small{font-size:14px;font-weight:500;margin-left:6px}
.kv{display:flex;font-size:12.5px;margin:2px 0}.kv b{width:64px;color:#6b7686;font-weight:500;flex:none}
.sup{width:330px;border:1.5px solid #1f3a5f;border-collapse:collapse;font-size:12px}
.sup th{background:#eef2f7;color:#1f3a5f;width:24px;writing-mode:vertical-rl;letter-spacing:6px;font-weight:700;border:1px solid #c5cfdc}
.sup td{border:1px solid #c5cfdc;padding:5px 7px;vertical-align:middle}
.sup td.k{width:72px;background:#f7f9fb;color:#55606f;text-align:center}
.sup .rep{position:relative}
.sup .in{position:relative;display:inline-block;margin-left:34px;color:#aaa}
.sup .in img{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:50px;height:50px;object-fit:contain;opacity:.92}
.sum{display:flex;align-items:center;border:2px solid #1f3a5f;background:#f4f7fb;margin:0 0 14px}
.sum .l{background:#1f3a5f;color:#fff;font-weight:700;padding:10px 16px;font-size:14px}
.sum .m{flex:1;padding:8px 14px;font-size:16px;font-weight:700}
.sum .r{padding:8px 14px;font-size:18px;font-weight:900;color:#1f3a5f}
.sum .v{font-size:11px;font-weight:500;color:#6b7686;margin-left:6px}
.tb{width:100%;border-top:2px solid #1f3a5f}
.ptr{display:flex;border-bottom:1px solid #dde3ea;min-height:30px;align-items:center}
.ptr>div{padding:5px 6px}
.ptr.h{background:#eef2f7;font-weight:700;color:#1f3a5f;border-bottom:1px solid #1f3a5f;text-align:center}
.c1{width:36px;text-align:center;color:#6b7686}.c2{flex:1}.c3{width:52px;text-align:center}
.c4{width:96px;text-align:right}.c5{width:106px;text-align:right;font-weight:700}.c6{width:130px;font-size:11.5px;color:#55606f}
.c2 small{display:block;font-size:10.5px;color:#8a94a3}
.ptr.h>div{text-align:center}
.tot{margin:12px 0 0 auto;width:330px;font-size:13px}
.tot .r{display:flex;justify-content:space-between;padding:4px 4px}
.tot .g{border-top:2px solid #1f3a5f;margin-top:4px;padding-top:8px;font-size:17px;font-weight:900;color:#1f3a5f}
.note{margin-top:18px;border:1px solid #dde3ea;border-radius:6px;padding:10px 14px;font-size:12px;white-space:pre-wrap}
.note h4{margin:0 0 4px;font-size:12.5px;color:#1f3a5f}
.ft{position:absolute;left:${PAD}px;right:${PAD}px;bottom:22px;display:flex;justify-content:space-between;font-size:10.5px;color:#8a94a3;border-top:1px solid #e2e6ec;padding-top:6px}
`;

function headerHtml(q, s, t) {
  const valid = s.validDays ? addDays(q.date, s.validDays) : '';
  return `
  <div class="ttl">견적서</div><div class="ttl-line"></div>
  <div class="hd">
    <div class="to">
      <div>
        <div class="kv"><b>견적번호</b>${esc(q.no || '-')}</div>
        <div class="kv"><b>견적일</b>${esc(q.date)}</div>
        ${q.author ? `<div class="kv"><b>담당자</b>${esc(q.author)}</div>` : ''}
        ${valid ? `<div class="kv"><b>유효기간</b>${esc(valid)}까지</div>` : ''}
      </div>
      <div>
        <div class="cust">${esc(q.customer?.name || '')}<small>귀하</small></div>
        ${q.customer?.phone ? `<div class="kv"><b>연락처</b>${esc(q.customer.phone)}</div>` : ''}
        ${q.customer?.address ? `<div class="kv"><b>현장주소</b>${esc(q.customer.address)}</div>` : ''}
        <div style="margin-top:8px;font-size:12.5px">아래와 같이 견적합니다.</div>
      </div>
    </div>
    <table class="sup">
      <tr><th rowspan="5">공급자</th><td class="k">상호</td><td>${esc(s.company)}</td></tr>
      <tr><td class="k">대표자</td><td class="rep">${esc(s.owner)}${s.owner || s.stamp ? `<span class="in">(인)${s.stamp ? `<img src="${s.stamp}" />` : ''}</span>` : ''}</td></tr>
      <tr><td class="k">사업자번호</td><td>${esc(s.bizNo)}</td></tr>
      <tr><td class="k">주소</td><td>${esc(s.address)}</td></tr>
      <tr><td class="k">연락처</td><td>${esc(s.phone)}</td></tr>
    </table>
  </div>
  <div class="sum">
    <div class="l">합계금액</div>
    <div class="m">일금 ${koreanAmount(t.total)}원정<span class="v">(${VAT_LABEL[q.vatMode || 'none']})</span></div>
    <div class="r">₩ ${num(t.total)}</div>
  </div>`;
}

const TABLE_HEAD = `<div class="ptr h"><div class="c1">No</div><div class="c2">품명</div><div class="c3">수량</div><div class="c4">단가</div><div class="c5">금액</div><div class="c6">비고</div></div>`;

function rowHtml(l, i) {
  return `<div class="ptr"><div class="c1">${i + 1}</div><div class="c2">${esc(l.name)}${l.cat ? `<small>${esc(l.cat)}</small>` : ''}</div>
    <div class="c3">${num(l.qty)}</div><div class="c4">${num(l.unit)}</div><div class="c5">${num(l.qty * l.unit)}</div><div class="c6">${esc(l.memo || '')}</div></div>`;
}

function totalsHtml(q, t) {
  return `<div class="tot">
    <div class="r"><span>공급가 합계</span><span>${won(t.subtotal)}</span></div>
    ${t.discount ? `<div class="r"><span>할인</span><span>-${won(t.discount)}</span></div>` : ''}
    ${q.vatMode === 'add' ? `<div class="r"><span>부가세 (10%)</span><span>${won(t.vat)}</span></div>` : ''}
    ${q.vatMode === 'incl' ? `<div class="r"><span>부가세 포함</span><span>(${won(t.vat)})</span></div>` : ''}
    ${q.vatMode === 'none' || !q.vatMode ? `<div class="r"><span>부가세</span><span>별도</span></div>` : ''}
    <div class="r g"><span>총 견적금액</span><span>${won(t.total)}</span></div>
  </div>`;
}

function notesHtml(q, s) {
  let h = '';
  if (q.memo?.trim()) h += `<div class="note"><h4>특이사항</h4>${esc(q.memo.trim())}</div>`;
  if (s.footerNotes?.trim() || s.account) {
    h += `<div class="note"><h4>안내</h4>${esc((s.footerNotes || '').trim())}${s.account ? `\n입금 계좌 : ${esc(s.account)}` : ''}</div>`;
  }
  return h;
}

export async function makeQuotePdf(q, s) {
  await Promise.all(LIBS.map(loadScript));
  const t = calcTotals(q);
  const stage = document.getElementById('pdf-stage');
  stage.innerHTML = `<style>${CSS}</style>`;

  // 한 장씩 채우다가 넘치면 다음 장으로
  const pages = [];
  const limit = PAGE_H - PAD - 44; // 아래 바닥글 공간
  const newPage = () => {
    const pg = document.createElement('div');
    pg.className = 'pg';
    pg.innerHTML = '<div class="body"></div>';
    stage.appendChild(pg);
    pages.push(pg);
    return pg.firstElementChild;
  };
  const fits = (body) => body.getBoundingClientRect().bottom - body.parentElement.getBoundingClientRect().top <= limit;
  const addBlock = (html, { repeatHead } = {}) => {
    let body = pages.length ? pages[pages.length - 1].firstElementChild : newPage();
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const nodes = [...tmp.childNodes];
    nodes.forEach((n) => body.appendChild(n));
    if (!fits(body)) {
      nodes.forEach((n) => n.remove());
      body = newPage();
      if (repeatHead) body.insertAdjacentHTML('beforeend', `<div class="tb">${TABLE_HEAD}</div>`);
      nodes.forEach((n) => body.appendChild(n));
    }
  };

  newPage().insertAdjacentHTML('beforeend', headerHtml(q, s, t) + `<div class="tb">${TABLE_HEAD}</div>`);
  q.lines.forEach((l, i) => addBlock(rowHtml(l, i), { repeatHead: true }));
  addBlock(totalsHtml(q, t));
  addBlock(notesHtml(q, s));
  pages.forEach((pg, i) => pg.insertAdjacentHTML('beforeend',
    `<div class="ft"><span>${esc(s.company || '')} ${esc(s.phone || '')}</span><span>${i + 1} / ${pages.length}</span></div>`));

  // 한글 글꼴이 다 내려받아진 뒤에 찍기
  const text = stage.textContent;
  await Promise.all(['400', '500', '700', '900'].map((w) => document.fonts.load(`${w} 14px "Noto Sans KR"`, text).catch(() => {})));
  await document.fonts.ready;

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  for (let i = 0; i < pages.length; i++) {
    const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  }
  stage.innerHTML = '';
  const safe = (x) => String(x || '').replace(/[\\/:*?"<>|\s]+/g, '_');
  const filename = `견적서_${safe(q.customer?.name) || '고객'}_${q.date}.pdf`;
  return { blob: pdf.output('blob'), filename };
}
