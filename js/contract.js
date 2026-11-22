// 공사 계약서: 견적서를 바탕으로 만들고, 고객이 휴대폰 화면에 직접 서명합니다.
// 서명하면 그때의 견적·업체 정보를 함께 저장(스냅샷)해, 나중에 견적이나 설정을 바꿔도 서명한 계약서는 그대로입니다.
import { esc, num, won, koreanAmount, today } from './util.js';
import { calcTotals, VAT_LABEL } from './quote.js';
import { quoteCanvases, loadPdfLibs } from './pdf.js';

const PAGE_W = 794, PAGE_H = 1123, PAD = 46; // A4 @96dpi

// 2026-11-24 → 2026년 11월 24일
export const krDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
};

// 견적 내용이 있는지 (계약서에 불러올 수 있는지)
export const hasQuoteLines = (q) => (q.lines || []).some((l) => l.name && Number(l.qty) * Number(l.unit));

// 새 계약서: useQuote면 견적 내용·금액을 불러오고, 아니면 빈 계약서 (금액은 직접 입력)
export function newContract(q, s, { useQuote = hasQuoteLines(q) } = {}) {
  const lines = useQuote ? (q.lines || []).map((l) => `· ${l.name}${Number(l.qty) !== 1 ? ` × ${num(l.qty)}` : ''}${l.memo ? ` (${l.memo})` : ''}`) : [];
  return {
    useQuote,
    amount: 0, vatMode: 'none', // 견적을 안 쓸 때 직접 넣는 계약 금액·부가세 표시
    request: useQuote ? [lines.join('\n'), q.memo?.trim()].filter(Boolean).join('\n') : '',
    startDate: '', endDate: '',
    asPeriod: s.contractAs || '1년',
    custom: false, customItem: '',
    depositRate: Number(s.contractDepositRate) || 50,
    deposit: 0, // 주문 제작이 없을 때의 계약금(원). 0이면 계약금 없이 완료 후 일시 지급
    balanceTerm: '작업 완료 시 지급',
    extras: (s.contractExtras || '').split('\n').map((x) => x.trim()).filter(Boolean),
    withQuote: useQuote,
  };
}

// 견적을 쓰는 계약서인지 (예전에 만든 계약서는 견적을 쓰는 것으로 봄)
export const usesQuote = (c) => c.useQuote !== false;

// 금액: 견적을 쓰면 견적 금액(서명했으면 서명 때 금액), 아니면 직접 넣은 금액
export function money(q, c) {
  const qq = c.quoteSnap || q;
  const total = usesQuote(c) ? calcTotals(qq).total : Math.round(Number(c.amount) || 0);
  const vatMode = usesQuote(c) ? qq.vatMode : c.vatMode;
  const deposit = c.custom ? Math.round((total * (Number(c.depositRate) || 0)) / 100) : Math.min(Number(c.deposit) || 0, total);
  return { total, deposit, balance: total - deposit, vat: VAT_LABEL[vatMode || 'none'] };
}

const periodText = (c) => (c.startDate || c.endDate ? `${krDate(c.startDate) || '협의'} ~ ${krDate(c.endDate) || '협의'}` : '협의 후 결정');

// 기본 조항 (선택한 내용에 따라 자동으로 바뀜)
export function clauses(q, c) {
  const m = money(q, c);
  const no = (c.quoteSnap || q).no;
  const out = [
    ['공사 내용', usesQuote(c)
      ? `시공자는 ${no ? `견적서(No. ${no})` : '견적서'}와 이 계약서에 적힌 내용에 따라 공사를 성실히 시공한다.`
      : '시공자는 이 계약서에 적힌 내용에 따라 공사를 성실히 시공한다.'],
    ['대금 지급', m.deposit
      ? `고객은 계약금 ${won(m.deposit)}을 계약 시 지급하고, 잔금 ${won(m.balance)}은 ${(c.balanceTerm || '작업 완료 시 지급').replace(/\s*지급$/, '')} 지급한다.`
      : `고객은 계약 금액 ${won(m.total)}을 ${(c.balanceTerm || '작업 완료 시 지급').replace(/\s*지급$/, '')} 지급한다.`],
  ];
  if (c.custom) {
    out.push(['주문 제작', `주문 제작 품목${c.customItem ? `(${c.customItem})` : ''}이 포함된 공사는 ${usesQuote(c) ? '견적' : '계약'} 금액의 ${Number(c.depositRate) || 0}%(${won(m.deposit)})가 입금된 후 발주를 진행한다.`]);
    out.push(['계약 취소', '주문 제작 품목은 발주 후에는 계약을 취소할 수 없다. 고객의 사정으로 취소를 원하는 경우, 이미 발생한 주문 제작 비용은 고객에게 청구된다.']);
  }
  out.push(['공사 기간', `공사 기간은 ${periodText(c)}로 한다. 날씨, 자재 수급, 현장 여건 등 부득이한 사유가 있으면 서로 협의하여 조정한다.`]);
  if (c.asPeriod && c.asPeriod !== '없음') {
    // 법에서 정한 하자담보책임(민법 등)을 줄이는 조항은 무효가 될 수 있어, 무상 A/S 약속으로 적고 법령 책임은 따로 남겨 둠
    out.push(['하자 보수(A/S)', `시공자의 명백한 시공상 과실로 인한 하자가 발생한 경우, 시공자는 작업 완료일로부터 ${c.asPeriod} 동안 무상으로 보수한다. 단, 고객의 사용 과실, 천재지변, 소모품, 고객이 준비한 제품의 결함으로 인한 경우는 제외한다. 이와 별도로 관계 법령에서 정한 하자담보책임은 그에 따른다.`]);
  }
  out.push(['기타', '이 계약서에 정하지 않은 사항은 서로 협의하여 정한다.']);
  return out;
}

const CSS = `
.ct{width:${PAGE_W}px;height:${PAGE_H}px;padding:${PAD}px ${PAD + 4}px 60px;box-sizing:border-box;background:#fff;color:#1c2430;
  font-family:'Noto Sans KR',sans-serif;font-size:12.5px;line-height:1.55;position:relative;overflow:hidden}
.ct *{box-sizing:border-box}
.ct .ttl{text-align:center;font-size:30px;font-weight:900;letter-spacing:16px;color:#1f3a5f;padding-left:16px;margin:0 0 4px}
.ct .ttl-line{height:4px;border-top:2px solid #1f3a5f;border-bottom:1px solid #1f3a5f;margin:0 0 14px}
.ct .intro{margin:0 0 10px}
.ct table.info{width:100%;border-collapse:collapse;margin-bottom:12px}
.ct table.info th{width:96px;background:#eef2f7;color:#1f3a5f;font-weight:700;text-align:left;padding:6px 10px;border:1px solid #c5cfdc;vertical-align:top}
.ct table.info td{padding:6px 10px;border:1px solid #c5cfdc;white-space:pre-wrap;word-break:keep-all}
.ct .amt b{font-size:14px;color:#1f3a5f}
.ct .cl{margin:0 0 5px;word-break:keep-all}
.ct .cl b{color:#1f3a5f}
.ct h4{margin:10px 0 4px;font-size:13px;color:#1f3a5f}
.ct .sign-intro{margin:12px 0 4px;text-align:center}
.ct .date{text-align:center;font-weight:700;font-size:14px;margin:2px 0 10px}
.ct .parties{display:flex;gap:12px}
.ct .party{flex:1;border:1.5px solid #1f3a5f;border-radius:6px;overflow:hidden}
.ct .party h5{margin:0;background:#1f3a5f;color:#fff;font-size:13px;padding:5px 10px}
.ct .party table{width:100%;border-collapse:collapse;font-size:12px}
.ct .party td{padding:4px 8px;border-top:1px solid #dde3ea;vertical-align:middle;word-break:keep-all}
.ct .party td.k{width:84px;color:#55606f;background:#f7f9fb}
.ct .sg{position:relative;height:58px;display:flex;align-items:center}
.ct .sg .in{color:#8a94a3;margin-left:auto;margin-right:6px}
.ct .sg img.sig{position:absolute;right:4px;top:2px;height:54px;max-width:190px;object-fit:contain}
.ct .sg img.stamp{position:absolute;right:2px;top:4px;width:50px;height:50px;object-fit:contain;opacity:.9}
.ct .ft{position:absolute;left:${PAD}px;right:${PAD}px;bottom:22px;display:flex;justify-content:space-between;font-size:10.5px;color:#8a94a3;border-top:1px solid #e2e6ec;padding-top:6px}
`;

// 계약서 그리기 (여러 장이 되면 서명란은 마지막 장에 함께)
async function contractCanvases(q, c, s) {
  await loadPdfLibs();
  const qq = c.quoteSnap || q;
  const p = c.party || s; // 서명했으면 서명 때 업체 정보
  const m = money(q, c);
  const cust = qq.customer || {};
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:-10000px;top:0';
  stage.innerHTML = `<style>${CSS}</style>`;
  document.body.append(stage);
  const pages = [];
  const newPage = () => {
    const pg = document.createElement('div');
    pg.className = 'ct';
    pg.innerHTML = '<div class="body"></div>';
    stage.append(pg);
    pages.push(pg);
    return pg.firstElementChild;
  };
  const fits = (body) => body.getBoundingClientRect().bottom - body.parentElement.getBoundingClientRect().top <= PAGE_H - 64;
  const add = (html) => {
    let body = pages.length ? pages[pages.length - 1].firstElementChild : newPage();
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const nodes = [...tmp.childNodes];
    nodes.forEach((n) => body.append(n));
    if (!fits(body)) {
      nodes.forEach((n) => n.remove());
      body = newPage();
      nodes.forEach((n) => body.append(n));
    }
  };
  try {
    add(`<div class="ttl">공사계약서</div><div class="ttl-line"></div>
      <p class="intro">고객(이하 "고객")과 ${esc(p.company || '시공자')}(이하 "시공자")는 아래 공사에 대하여 다음과 같이 계약을 맺는다.</p>
      <table class="info">
        <tr><th>공사 내용</th><td>${esc(c.request || '-')}</td></tr>
        <tr><th>현장 주소</th><td>${esc(cust.address || '-')}</td></tr>
        <tr><th>공사 기간</th><td>${esc(periodText(c))}</td></tr>
        <tr><th>계약 금액</th><td class="amt"><b>일금 ${koreanAmount(m.total)}원정 (₩ ${num(m.total)})</b> · ${esc(m.vat)}</td></tr>
        <tr><th>대금 지급</th><td>${m.deposit ? `계약금 ${won(m.deposit)} (${c.custom ? '입금 후 발주' : '계약 시'}) / 잔금 ${won(m.balance)} (${esc(c.balanceTerm || '작업 완료 시 지급')})` : `${won(m.total)} (${esc(c.balanceTerm || '작업 완료 시 지급')})`}${p.account ? `\n입금 계좌: ${esc(p.account)}` : ''}</td></tr>
        <tr><th>하자 보수</th><td>${c.asPeriod && c.asPeriod !== '없음' ? `작업 완료일로부터 ${esc(c.asPeriod)} (시공자 과실로 인한 하자 무상 보수)` : '없음'}</td></tr>
        ${usesQuote(c) && qq.no ? `<tr><th>견적 번호</th><td>No. ${esc(qq.no)} (${esc(qq.date || '')})</td></tr>` : ''}
      </table>`);
    clauses(q, c).forEach(([t, b], i) => add(`<p class="cl"><b>제${i + 1}조 (${esc(t)})</b> ${esc(b)}</p>`));
    if ((c.extras || []).length) add(`<h4>특약 사항</h4>${c.extras.map((x, i) => `<p class="cl">${i + 1}. ${esc(x)}</p>`).join('')}`);
    const signedDay = c.signedAt ? c.signedAt.slice(0, 10) : today();
    add(`<div class="keep">
      <p class="sign-intro">위 계약 내용을 서로 확인하고, 이를 증명하기 위하여 서명한다.</p>
      <div class="date">${krDate(signedDay)}</div>
      <div class="parties">
        <div class="party"><h5>고객</h5><table>
          <tr><td class="k">고객명(상호)</td><td>${esc(cust.name || '')}</td></tr>
          <tr><td class="k">연락처</td><td>${esc(cust.phone || '')}</td></tr>
          <tr><td class="k">현장 주소</td><td>${esc(cust.address || '')}</td></tr>
          <tr><td class="k">서명</td><td><div class="sg"><span class="in">(인/서명)</span>${c.signature ? `<img class="sig" src="${c.signature}" />` : ''}</div></td></tr>
        </table></div>
        <div class="party"><h5>시공자</h5><table>
          <tr><td class="k">상호</td><td>${esc(p.company || '')}</td></tr>
          <tr><td class="k">사업자번호</td><td>${esc(p.bizNo || '')}</td></tr>
          <tr><td class="k">입금 계좌</td><td>${esc(p.account || '')}</td></tr>
          <tr><td class="k">대표</td><td><div class="sg">${esc(p.owner || '')}<span class="in">(인)</span>${p.stamp ? `<img class="stamp" src="${p.stamp}" />` : ''}</div></td></tr>
        </table></div>
      </div></div>`);
    pages.forEach((pg, i) => pg.insertAdjacentHTML('beforeend',
      `<div class="ft"><span>${esc(p.company || '')} ${esc(p.phone || '')}</span><span>${c.signedAt ? '서명 완료' : '서명 전 미리 보기'}${pages.length > 1 ? ` · ${i + 1} / ${pages.length}` : ''}</span></div>`));
    await Promise.all(['400', '500', '700', '900'].map((w) => document.fonts.load(`${w} 14px "Noto Sans KR"`, stage.textContent).catch(() => {})));
    await document.fonts.ready;
    await Promise.all([...stage.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
    const out = [];
    for (const pg of pages) out.push(await window.html2canvas(pg, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }));
    return out;
  } finally {
    stage.remove();
  }
}

// 계약서 PDF. withQuote면 뒤에 견적서를 붙여 합본으로
export async function makeContractPdf(q, c, s, { withQuote } = {}) {
  const canvases = await contractCanvases(q, c, s);
  if (withQuote && hasQuoteLines(c.quoteSnap || q)) canvases.push(...(await quoteCanvases(c.quoteSnap || q, c.party || s)).canvases);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  canvases.forEach((cv, i) => {
    if (i) pdf.addPage();
    pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  });
  const qq = c.quoteSnap || q;
  const safe = (x) => String(x || '').replace(/[\\/:*?"<>|\s]+/g, '_');
  const kind = withQuote && hasQuoteLines(qq) ? '계약서+견적서' : '계약서';
  return { blob: pdf.output('blob'), filename: `${kind}_${safe(qq.customer?.name) || '고객'}_${(c.signedAt || today()).slice(0, 10)}.pdf` };
}

// 미리 보기용: 첫 장 그림 주소
export async function contractPreview(q, c, s) {
  const cv = await contractCanvases(q, c, s);
  return cv.map((x) => x.toDataURL('image/jpeg', 0.85));
}
