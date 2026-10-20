// 데이터 저장소: config.js에 Supabase 설정이 있으면 두 사람이 함께 쓰는 클라우드,
// 없으면 이 기기 안(localStorage)에만 저장합니다.
// 클라우드 모드에서도 마지막 데이터를 휴대폰에 보관해 두어, 신호가 약한 현장에서도 열리고
// 보내지 못한 변경은 인터넷이 다시 연결되면 자동으로 올립니다.
import { supabaseConfig } from '../config.js';
import { DEFAULT_SETTINGS } from './seed.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const LS_KEY = 'gyeonjeok-data-v1';
const CACHE_KEY = 'gyeonjeok-cloud-cache-v1';
const OUTBOX_KEY = 'gyeonjeok-outbox-v1';
const TABLE = 'docs'; // (col, id, data) 한 표에 분류·항목·견적·설정을 모두 저장

const listeners = new Set();
let sb = null;
let channel = null;

export const store = {
  mode: supabaseConfig ? 'cloud' : 'local',
  user: null,
  ready: false,
  online: true,
  pending: 0, // 아직 올리지 못한 변경 수
  state: { categories: [], items: [], quotes: [], settings: { ...DEFAULT_SETTINGS } },
};

function emit() {
  listeners.forEach((fn) => fn(store));
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const COL_KEY = { categories: 'categories', items: 'items', quotes: 'quotes' };
const clean = (o) => JSON.parse(JSON.stringify(o)); // undefined 값 제거

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch (_) {
    return fallback;
  }
}
function writeJSON(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    alert('기기 저장 공간이 부족해 저장하지 못했습니다.');
  }
}

/* ---------- 메모리 상태 변경 (두 모드 공통) ---------- */
function applyPut(col, obj) {
  if (col === 'settings') {
    store.state.settings = { ...DEFAULT_SETTINGS, ...obj };
    return;
  }
  const key = COL_KEY[col];
  if (!key) return;
  const list = store.state[key];
  const i = list.findIndex((x) => x.id === obj.id);
  if (i >= 0) list[i] = obj;
  else list.push(obj);
  if (key !== 'quotes') list.sort(byOrder);
}
function applyDel(col, id) {
  const key = COL_KEY[col];
  if (key) store.state[key] = store.state[key].filter((x) => x.id !== id);
}
function persist() {
  writeJSON(store.mode === 'local' ? LS_KEY : CACHE_KEY, store.state);
}

/* ---------- 이 기기에만 저장 ---------- */
function loadLocal() {
  const d = readJSON(LS_KEY, null);
  if (d) {
    store.state = { ...store.state, ...d, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
    return;
  }
  persist();
}

/* ---------- 클라우드(Supabase) ---------- */
function rowToObj(r) {
  return r.col === 'settings' ? r.data : { ...r.data, id: r.id };
}

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(TABLE).select('col,id,data').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const st = { categories: [], items: [], quotes: [], settings: { ...DEFAULT_SETTINGS } };
  rows.forEach((r) => {
    if (r.col === 'settings') st.settings = { ...DEFAULT_SETTINGS, ...r.data };
    else if (COL_KEY[r.col]) st[COL_KEY[r.col]].push(rowToObj(r));
  });
  st.categories.sort(byOrder);
  st.items.sort(byOrder);
  store.state = st;
  // 아직 못 올린 변경은 화면에 계속 보이도록 다시 적용
  readJSON(OUTBOX_KEY, []).forEach((op) => (op.t === 'put' ? applyPut(op.col, op.obj) : applyDel(op.col, op.id)));
  persist();
}

function startRealtime() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('docs-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (p) => {
      if (p.eventType === 'DELETE') applyDel(p.old.col, p.old.id);
      else applyPut(p.new.col, rowToObj(p.new));
      persist();
      emit();
    })
    .subscribe((status) => {
      // 연결이 끊겼다 다시 붙으면 그사이 바뀐 내용을 한 번 더 받아옴
      if (status === 'SUBSCRIBED' && store.ready) refresh();
    });
}

async function refresh() {
  try {
    await flushOutbox();
    await fetchAll();
    store.online = true;
  } catch (e) {
    store.online = false;
    console.warn('클라우드 연결 실패, 저장된 데이터로 표시합니다', e);
  }
  store.ready = true;
  emit();
}

async function onSignedIn(user) {
  store.user = user;
  // 인터넷이 없어도 마지막 데이터로 바로 열기
  const cached = readJSON(CACHE_KEY, null);
  if (cached) {
    store.state = { ...store.state, ...cached, settings: { ...DEFAULT_SETTINGS, ...(cached.settings || {}) } };
    store.ready = true;
    emit();
  }
  await refresh();
  startRealtime();
}

async function initCloud() {
  const { createClient } = await import(SUPABASE_JS);
  sb = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  store.pending = readJSON(OUTBOX_KEY, []).length;
  const { data } = await sb.auth.getSession();
  if (data.session) await onSignedIn(data.session.user);
  else {
    store.ready = true;
    emit();
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && !store.user) onSignedIn(session.user);
    if (event === 'SIGNED_OUT') {
      store.user = null;
      if (channel) sb.removeChannel(channel);
      channel = null;
      localStorage.removeItem(CACHE_KEY);
      emit();
    }
  });
  window.addEventListener('online', () => store.user && refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && store.user) refresh();
  });
}

/* ---------- 보내지 못한 변경 모아두기 ---------- */
function queue(op) {
  const box = readJSON(OUTBOX_KEY, []);
  box.push(op);
  writeJSON(OUTBOX_KEY, box);
  store.pending = box.length;
}
async function sendOp(op) {
  if (op.t === 'put') {
    const { id, ...rest } = op.obj;
    const { error } = await sb.from(TABLE).upsert({
      col: op.col, id: op.col === 'settings' ? 'main' : id, data: clean(op.col === 'settings' ? op.obj : rest),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } else {
    const { error } = await sb.from(TABLE).delete().match({ col: op.col, id: op.id });
    if (error) throw error;
  }
}
let flushing = null;
function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    let box = readJSON(OUTBOX_KEY, []);
    while (box.length) {
      await sendOp(box[0]); // 실패하면 남겨 두고 중단
      box = readJSON(OUTBOX_KEY, []).slice(1);
      writeJSON(OUTBOX_KEY, box);
      store.pending = box.length;
    }
  })().finally(() => (flushing = null));
  return flushing;
}

async function write(op) {
  if (op.t === 'put') applyPut(op.col, op.obj);
  else applyDel(op.col, op.id);
  persist();
  if (store.mode === 'cloud') {
    queue(op);
    try {
      await flushOutbox();
      store.online = true;
    } catch (e) {
      store.online = false;
      console.warn('나중에 다시 올립니다', e);
    }
  }
  emit();
}

/* ---------- 공개 함수 ---------- */
export async function initStore() {
  if (store.mode === 'local') {
    loadLocal();
    store.ready = true;
    emit();
  } else {
    await initCloud();
  }
}

export async function login(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function logout() {
  await sb.auth.signOut();
}

export const saveItem = (item) => write({ t: 'put', col: 'items', obj: item });
export const deleteItem = (id) => write({ t: 'del', col: 'items', id });
export const saveCategory = (cat) => write({ t: 'put', col: 'categories', obj: cat });
export const saveQuote = (q) => write({ t: 'put', col: 'quotes', obj: q });
export const deleteQuote = (id) => write({ t: 'del', col: 'quotes', id });
export const saveSettings = (s) => write({ t: 'put', col: 'settings', obj: s });

// 단가표(분류+항목)를 통째로 바꾸기: 기본값 되돌리기, 백업 불러오기에 사용
export async function replacePriceList(categories, items) {
  if (store.mode === 'cloud') {
    await flushOutbox();
    const { error } = await sb.from(TABLE).delete().in('col', ['categories', 'items']);
    if (error) throw error;
    const now = new Date().toISOString();
    const rows = [
      ...categories.map(({ id, ...d }) => ({ col: 'categories', id, data: clean(d), updated_at: now })),
      ...items.map(({ id, ...d }) => ({ col: 'items', id, data: clean(d), updated_at: now })),
    ];
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e2 } = await sb.from(TABLE).insert(rows.slice(i, i + 500));
      if (e2) throw e2;
    }
  }
  store.state.categories = [...categories].sort(byOrder);
  store.state.items = [...items].sort(byOrder);
  persist();
  emit();
}

export function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
