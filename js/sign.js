// 고객 서명 받기: 화면 가득 [성명] 칸과 [서명] 칸을 띄우고, 손가락(또는 마우스)으로 쓴 것을 그림(PNG)으로 돌려줍니다.
// 순서: 성명 칸에 이름을 쓴 다음 → 서명 칸을 눌러 서명. 둘 다 써야 '서명 완료'가 눌려요.
// 결과: { name: 성명 그림, sign: 서명 그림 }, 취소하면 null.
export function signaturePad({ title = '고객 서명', note = '' } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'sigpad';
    root.innerHTML = `
      <div class="sp-head"><b>${title}</b>${note ? `<span>${note}</span>` : ''}</div>
      <div class="sp-lbl"><b>① 성명</b><span>고객님 이름을 또박또박 써 주세요</span><button type="button" class="sp-clr" data-clr="name">지우기</button></div>
      <div class="sp-box sp-name" data-pad="name"><canvas></canvas><div class="sp-hint">여기에 이름을 써 주세요</div><div class="sp-line"></div></div>
      <div class="sp-lbl"><b>② 서명</b><span>이름을 쓴 다음 아래 칸에 서명해 주세요</span><button type="button" class="sp-clr" data-clr="sign">지우기</button></div>
      <div class="sp-box sp-sign" data-pad="sign"><canvas></canvas><div class="sp-hint">먼저 위에 이름을 써 주세요</div><div class="sp-line"></div></div>
      <div class="sp-btns">
        <button class="btn ghost" data-sp="cancel">← 이전</button>
        <button class="btn ghost" data-sp="clear">다시 쓰기</button>
        <button class="btn orange" data-sp="ok" disabled>서명 완료</button>
      </div>`;
    document.body.append(root);
    const ok = root.querySelector('[data-sp="ok"]');
    const pads = {};
    const update = () => {
      const hasName = pads.name.drawn;
      pads.sign.box.classList.toggle('locked', !hasName);
      pads.sign.hint.textContent = hasName ? '여기에 서명해 주세요' : '먼저 위에 이름을 써 주세요';
      ok.disabled = !(pads.name.drawn && pads.sign.drawn);
    };
    root.querySelectorAll('[data-pad]').forEach((box) => {
      const key = box.dataset.pad;
      pads[key] = makePad(box, () => {
        if (key === 'sign' && !pads.name.drawn) return false; // 이름 먼저
        return true;
      }, update);
    });
    update();
    const onResize = () => Object.values(pads).forEach((p) => p.size());
    window.addEventListener('resize', onResize);
    const close = (val) => { window.removeEventListener('resize', onResize); root.remove(); resolve(val); };
    root.querySelector('[data-sp="cancel"]').onclick = () => close(null);
    root.querySelector('[data-sp="clear"]').onclick = () => { pads.name.clear(); pads.sign.clear(); update(); };
    root.querySelectorAll('[data-clr]').forEach((b) => (b.onclick = () => { pads[b.dataset.clr].clear(); update(); }));
    // 서명 칸을 이름보다 먼저 누르면 안내
    pads.sign.box.addEventListener('pointerdown', () => {
      if (!pads.name.drawn) {
        pads.name.box.classList.add('blink');
        setTimeout(() => pads.name.box.classList.remove('blink'), 700);
      }
    });
    ok.onclick = () => close({ name: trimmed(pads.name.cv, 120), sign: trimmed(pads.sign.cv, 160) });
  });
}

// 손가락으로 쓰는 칸 하나
function makePad(box, canStart, onChange) {
  const cv = box.querySelector('canvas');
  const hint = box.querySelector('.sp-hint');
  const ctx = cv.getContext('2d');
  const pad = { box, cv, hint, drawn: false };
  let drawing = false, last = null;
  pad.size = () => {
    const r = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const old = pad.drawn ? cv.toDataURL() : null;
    cv.width = r.width * dpr;
    cv.height = r.height * dpr;
    cv.style.width = r.width + 'px';
    cv.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#111';
    ctx.lineWidth = 3;
    if (old) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = old; }
  };
  pad.clear = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.restore();
    pad.drawn = false;
    hint.hidden = false;
  };
  pad.size();
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!canStart()) return;
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
    if (!pad.drawn) { pad.drawn = true; hint.hidden = true; onChange(); }
  });
  const end = () => { drawing = false; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  return pad;
}

// 글씨 주변 빈 곳을 잘라 작은 PNG로 (저장 용량을 줄이려고 높이 maxH px 정도로 줄임)
function trimmed(cv, maxH = 160) {
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
  const k = Math.min(1, maxH / (y1 - y0));
  const out = document.createElement('canvas');
  out.width = Math.round((x1 - x0) * k);
  out.height = Math.round((y1 - y0) * k);
  out.getContext('2d').drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
