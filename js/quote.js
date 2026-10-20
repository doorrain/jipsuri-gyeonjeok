import { GENERAL } from './seed.js';
import { won } from './util.js';

export const STATUSES = ['상담중', '발송', '계약', '완료', '취소'];
export const VAT_LABEL = { none: '부가세 별도', add: '부가세 10% 추가', incl: '부가세 포함' };

export function calcTotals(q) {
  const subtotal = (q.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0);
  const discount = Number(q.discount) || 0;
  const base = Math.max(0, subtotal - discount);
  let vat = 0;
  let total = base;
  if (q.vatMode === 'add') {
    vat = Math.round(base * 0.1);
    total = base + vat;
  } else if (q.vatMode === 'incl') {
    vat = base - Math.round(base / 1.1);
  }
  return { subtotal, discount, base, vat, total };
}

// 견적에 담긴 항목·분류에 맞는 질문/주의사항 모으기
export function buildChecklist(q, state) {
  const ask = [];
  const warn = [];
  const seen = new Set();
  const push = (list, text, src) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    list.push({ text, src });
  };
  const lines = q.lines || [];
  const cats = [...new Set(lines.map((l) => l.cat).filter(Boolean))];

  lines.forEach((l) => {
    const item = l.itemId && state.items.find((i) => i.id === l.itemId);
    if (!item) return;
    (item.ask || []).forEach((t) => push(ask, t, item.name));
    (item.warn || []).forEach((t) => push(warn, t, item.name));
  });
  cats.forEach((name) => {
    const c = state.categories.find((x) => x.name === name);
    if (!c) return;
    (c.ask || []).forEach((t) => push(ask, t, c.name));
    (c.warn || []).forEach((t) => push(warn, t, c.name));
  });
  GENERAL.ask.forEach((t) => push(ask, t, '공통'));
  GENERAL.warn.forEach((t) => push(warn, t, '공통'));
  return { ask, warn };
}

export function buildMessage(q, state) {
  const off = new Set(q.ckOff || []);
  const { ask, warn } = buildChecklist(q, state);
  const a = ask.filter((x) => !off.has(x.text));
  const w = warn.filter((x) => !off.has(x.text));
  const s = state.settings || {};
  const name = q.customer?.name ? `${q.customer.name} 고객님` : '고객님';
  const out = [];
  out.push(`안녕하세요${s.company ? `, ${s.company}입니다` : ''}.`);
  out.push(`${name}, 견적 진행을 위해 아래 내용 확인 부탁드립니다.`);
  if (a.length) {
    out.push('', '[확인 부탁드릴 내용]');
    a.forEach((x, i) => out.push(`${i + 1}. ${x.text}`));
  }
  if (w.length) {
    out.push('', '[안내 및 주의사항]');
    w.forEach((x) => out.push(`· ${x.text}`));
  }
  if (q.includeAmount && q.lines?.length) {
    const t = calcTotals(q);
    out.push('', '[견적 요약]');
    q.lines.forEach((l) => out.push(`· ${l.name}${Number(l.qty) !== 1 ? ` ×${l.qty}` : ''} : ${won(l.qty * l.unit)}`));
    if (t.discount) out.push(`· 할인 : -${won(t.discount)}`);
    if (q.vatMode === 'add') out.push(`· 부가세 : ${won(t.vat)}`);
    out.push(`합계 : ${won(t.total)} (${VAT_LABEL[q.vatMode || 'none']})`);
  }
  if (q.ckExtra?.trim()) out.push('', q.ckExtra.trim());
  out.push('', '감사합니다.');
  if (s.phone) out.push(`문의 : ${s.phone}`);
  return out.join('\n');
}

export function nextQuoteNo(date, quotes) {
  const prefix = date.replace(/-/g, '').slice(2) + '-';
  const nums = quotes
    .map((x) => x.no || '')
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10) || 0);
  return prefix + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
}
