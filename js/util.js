export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
export const manwon = (p) => {
  const v = Number(p) || 0;
  return (Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')) + '만원';
};
export const parseNum = (s) => Number(String(s ?? '').replace(/[^\d.-]/g, '')) || 0;

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- 한글 초성 검색 ---------- */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function chosung(str) {
  let out = '';
  for (const ch of str) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[\s·\-_/()]/g, '');
const isChoOnly = (s) => /^[ㄱ-ㅎ]+$/.test(s);

// 검색어 여러 단어(공백 구분)가 모두 들어 있으면 일치. 점수가 낮을수록 앞에 표시
export function matchScore(item, query, nameOnly) {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const name = norm(item.name);
  const hay = nameOnly ? name : norm(item.name + item.cat + (item.note || ''));
  const hayCho = chosung(hay);
  let score = 0;
  for (const w0 of words) {
    const w = norm(w0);
    if (!w) continue;
    if (name.startsWith(w)) score += 0;
    else if (name.includes(w)) score += 1;
    else if (hay.includes(w)) score += 2;
    else if (isChoOnly(w) && hayCho.includes(w)) score += 3;
    else return -1;
  }
  return score;
}

export function highlight(text, query) {
  const t = esc(text);
  const words = String(query || '').trim().split(/\s+/).filter((w) => w && !isChoOnly(w));
  if (!words.length) return t;
  const re = new RegExp('(' + words.map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return t.replace(re, '<mark>$1</mark>');
}

/* ---------- 금액을 한글로 (일금 ○○원정) ---------- */
export function koreanAmount(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return '영';
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const small = ['', '십', '백', '천'];
  const big = ['', '만', '억', '조'];
  let out = '';
  let bi = 0;
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk) {
      let s = '';
      let c = chunk;
      for (let i = 0; i < 4 && c > 0; i++) {
        const d = c % 10;
        if (d) s = digits[d] + small[i] + s;
        c = Math.floor(c / 10);
      }
      out = s + big[bi] + out;
    }
    n = Math.floor(n / 10000);
    bi++;
  }
  return out;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }
}
