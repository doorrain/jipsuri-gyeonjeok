// 고객 서명 받기: 화면 가득 서명 칸을 띄우고, 손가락(또는 마우스)으로 쓴 서명을 그림(PNG)으로 돌려줍니다.
// 취소하면 null.
export function signaturePad({ title = '고객 서명', note = '' } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'sigpad';
    root.innerHTML = `
      <div class="sp-head"><b>${title}</b>${note ? `<span>${note}</span>` : ''}</div>
      <div class="sp-box"><canvas></canvas><div class="sp-hint">여기에 서명해 주세요</div><div class="sp-line"></div></div>
      <div class="sp-btns">
        <button class="btn ghost" data-sp="cancel">취소</button>
        <button class="btn ghost" data-sp="clear">다시 쓰기</button>
        <button class="btn orange" data-sp="ok" disabled>서명 완료</button>
      </div>`;
    document.body.append(root);
    const cv = root.querySelector('canvas');
    const box = root.querySelector('.sp-box');
    const ctx = cv.getContext('2d');
    const ok = root.querySelector('[data-sp="ok"]');
    let drawing = false, drawn = false, last = null;
    const size = () => {
      const r = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const old = drawn ? cv.toDataURL() : null;
      cv.width = r.width * dpr;
      cv.height = r.height * dpr;
      cv.style.width = r.width + 'px';
      cv.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 3;
      if (old) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = old; }
    };
    size();
    window.addEventListener('resize', size);
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      if (!drawn) { drawn = true; ok.disabled = false; root.querySelector('.sp-hint').hidden = true; }
    });
    const end = () => { drawing = false; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    const close = (val) => { window.removeEventListener('resize', size); root.remove(); resolve(val); };
    root.querySelector('[data-sp="cancel"]').onclick = () => close(null);
    root.querySelector('[data-sp="clear"]').onclick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      drawn = false;
      ok.disabled = true;
      root.querySelector('.sp-hint').hidden = false;
    };
    ok.onclick = () => close(trimmed(cv));
  });
}

// 서명 주변 빈 곳을 잘라 작은 PNG로
function trimmed(cv) {
  const ctx = cv.getContext('2d');
  const { width: w, height: h } = cv;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 8;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
  // 저장 용량을 줄이려고 높이 160px 정도로 줄임
  const k = Math.min(1, 160 / (y1 - y0));
  const out = document.createElement('canvas');
  out.width = Math.round((x1 - x0) * k);
  out.height = Math.round((y1 - y0) * k);
  out.getContext('2d').drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
