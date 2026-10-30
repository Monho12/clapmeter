'use strict';
/* ================================================================
   👏 CLAP METER — EmpaSoft · Night of the Bugs · Костюмын шагнал
   ----------------------------------------------------------------
   Финалист бүрийг (эрэгтэй 3 + эмэгтэй 3) тайзан дээр гаргаж,
   үзэгчдийн алга ташилт/хашгирааг laptop-ын микрофоноор хэмжиж
   1-2-3-р байрыг тодруулна.

   ⚠ "dB" нь ХАРЬЦАНГУЙ түвшин (мэргэжлийн dB метр биш). Нэг мик,
     нэг байрлал ашиглавал оролцогчдыг харьцуулахад шударга.
   🔒 Нэр, зураг, оноо зөвхөн энэ хөтөч дотор (localStorage) хадгалагдана.
   ================================================================ */

/* ================================================================
   1. ТОХИРГОО (анхдагч утга — Admin самбараас өөрчилж болно)
   ================================================================ */
const DEFAULTS = {
  perCategory: 3,    // ангилал бүрт хэдэн финалист
  countdownSec: 3,   // 3-2-1 тоолох хугацаа
  measureSec: 5,     // хэмжих хугацаа
  calib: 0,          // микийн мэдрэмж (dB нэмэх/хасах), -20 … +20
  pin: '1031',       // зохион байгуулагчийн PIN
};
const CATS = {
  m: { label: 'ЭРЭГТЭЙ', icon: '🎩' },
  f: { label: 'ЭМЭГТЭЙ', icon: '👠' },
};
// Метрийн түвшнүүд (харьцангуй dB)
const LEVELS = [
  { from: 30, name: 'ШИВНЭЭ' },
  { from: 55, name: 'ЧИМЭЭ' },
  { from: 70, name: 'ХАШГИРАА' },
  { from: 85, name: 'ТАЙЗ ДОРГИЛОО' },
  { from: 100, name: 'ЧӨТГӨР СЭРЛЭЭ 💀' },
];
const DB_MIN = 30, DB_MAX = 120;
const DB_OFFSET = 105;      // dBFS (0 = микийн дээд хязгаар) → харагдах "dB" руу хувиргах
const WINDOW_MS = 500;      // оноо = 0.5 сек дундаж түвшний хамгийн өндөр утга
const FILTERS = [
  { key: 'mugshot', label: '🔎 MUGSHOT' },
  { key: 'night', label: '🟢 ШӨНИЙН ХАРАА' },
  { key: 'thermal', label: '🔴 ДУЛААНЫ КАМЕР' },
  { key: 'vhs', label: '📼 VHS' },
  { key: 'noir', label: '⚫ НУАР' },
];
const PHOTO_W = 360, PHOTO_H = 480;   // хадгалах зургийн хэмжээ (3:4)
const EVENT_DATE = '2026.10.31';

/* ================================================================
   2. ХАДГАЛАХ (localStorage)
   ================================================================ */
const KEYS = { cfg: 'cm_config_v1', people: 'cm_people_v1', revealed: 'cm_revealed_v1', sound: 'cm_sound_v1' };
const memoryStore = {};
const store = {
  get(k, fb) {
    try { const v = localStorage.getItem(k); return v == null ? (k in memoryStore ? memoryStore[k] : fb) : JSON.parse(v); }
    catch (e) { return k in memoryStore ? memoryStore[k] : fb; }
  },
  set(k, v) {
    memoryStore[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; } // зай дүүрсэн гэх мэт
  },
  del(k) { delete memoryStore[k]; try { localStorage.removeItem(k); } catch (e) { /* алгасна */ } },
};

let CFG = Object.assign({}, DEFAULTS, store.get(KEYS.cfg, {}));
let people = store.get(KEYS.people, []);          // [{id,no,name,costume,cat,photo,score,peak}]
let revealed = store.get(KEYS.revealed, { m: false, f: false });
const saveCfg = () => store.set(KEYS.cfg, CFG);
const saveRevealed = () => store.set(KEYS.revealed, revealed);
function savePeople() {
  if (!store.set(KEYS.people, people)) {
    flash('⚠ ХАДГАЛАХ ЗАЙ ДҮҮРЛЭЭ', 2000);
    return false;
  }
  return true;
}

/* ================================================================
   3. ТУСЛАХ ФУНКЦУУД
   ================================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (x) => Math.round(x * 10) / 10;
const caseNo = (n) => '№ ' + String(n).padStart(4, '0');
const byCat = (cat) => people.filter((p) => p.cat === cat);
const levelOf = (db) => { let l = LEVELS[0]; for (const x of LEVELS) if (db >= x.from) l = x; return l; };
const pct = (db) => clamp((db - DB_MIN) / (DB_MAX - DB_MIN), 0, 1) * 100;
const allMeasured = (cat) => byCat(cat).length > 0 && byCat(cat).every((p) => p.score != null);

// Оноогоор эрэмбэлэх. Тэнцвэл оргил цэг; тэр нь ч тэнцвэл ижил байр.
function ranked(cat) {
  const list = byCat(cat).filter((p) => p.score != null).slice()
    .sort((a, b) => (b.score - a.score) || ((b.peak || 0) - (a.peak || 0)));
  list.forEach((p, i) => {
    const prev = list[i - 1];
    p._place = (prev && prev.score === p.score && (prev.peak || 0) === (p.peak || 0)) ? prev._place : i + 1;
  });
  return list;
}
const medal = (place) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[place] || place + '.');

/* ================================================================
   4. ДУУ (WebAudio). ⚠ Хэмжих үед ямар ч дуу гаргахгүй!
   ================================================================ */
let audioCtx = null;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
const sfx = (() => {
  let on = store.get(KEYS.sound, true);
  function tone(freq, dur, type = 'square', vol = 0.05, delay = 0) {
    if (!on) return;
    try {
      const ctx = getCtx(), t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* дуу дэмжихгүй */ }
  }
  function noise(dur, vol = 0.08, delay = 0, freq = 900) {
    if (!on) return;
    try {
      const ctx = getCtx(), t = ctx.currentTime + delay;
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
      src.connect(f).connect(g).connect(ctx.destination); src.start(t);
    } catch (e) { /* алгасна */ }
  }
  return {
    beep() { tone(880, 0.18, 'square', 0.06); },
    shutter() { noise(0.12, 0.25, 0, 3000); },
    result() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'square', 0.05, i * 0.09)); },
    drumroll(sec) { const n = Math.floor(sec / 0.06); for (let i = 0; i < n; i++) noise(0.05, 0.05 + 0.1 * (i / n), i * 0.06, 220); },
    sting() { tone(196, 0.5, 'sawtooth', 0.07); tone(294, 0.5, 'sawtooth', 0.05, 0.02); },
    fanfare() { [392, 523, 659, 784, 659, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.08, i * 0.14)); },
    toggle() { on = !on; store.set(KEYS.sound, on); return on; },
    get on() { return on; },
  };
})();

/* ================================================================
   5. МИКРОФОН
   Auto gain / чимээ дарагч / echo-г УНТРААНА → чанга алга ташилтыг
   хөтөч өөрөө намсгахгүй, бодит ялгаа харагдана.
   ================================================================ */
const mic = {
  ready: false, an: null, buf: null, stream: null, error: '',
  async init() {
    if (this.ready) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ctx = getCtx();
      const src = ctx.createMediaStreamSource(this.stream);
      this.an = ctx.createAnalyser();
      this.an.fftSize = 2048;
      this.buf = new Float32Array(this.an.fftSize);
      src.connect(this.an); // ⚠ чанга яригч руу холбохгүй (feedback үүснэ)
      this.ready = true;
      return true;
    } catch (e) {
      this.error = e && e.name === 'NotAllowedError' ? 'Микрофоны зөвшөөрөл өгөөгүй байна.' : 'Микрофон олдсонгүй эсвэл ашиглах боломжгүй.';
      return false;
    }
  },
  // Дундаж квадрат (0…1 хооронд) — дууны "хүч"
  power() {
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return s / this.buf.length;
  },
};
// Хүч → харагдах "dB" (30…120)
const toDb = (p) => clamp(10 * Math.log10(p + 1e-12) + DB_OFFSET + Number(CFG.calib || 0), DB_MIN, DB_MAX);

/* ================================================================
   6. ДЭЛГЭЦ СОЛИХ, АНИВЧИЛТ
   ================================================================ */
const app = $('#app');
let view = 'home';
let viewCleanup = null;   // дэлгэцээс гарахад ажиллах цэвэрлэгээ (камер унтраах г.м.)

function swap(html, after) {
  if (viewCleanup) { viewCleanup(); viewCleanup = null; }
  $('#particles').innerHTML = '';   // өмнөх дэлгэцийн бороог арилгана
  app.classList.add('out');
  setTimeout(() => {
    app.innerHTML = html;
    app.classList.remove('out');
    app.classList.add('in');
    window.scrollTo(0, 0);
    if (after) after();
    setTimeout(() => app.classList.remove('in'), 520);
  }, 180);
}

function flash(text, ms = 1400) {
  const el = $('#flash');
  el.textContent = text;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.hidden = true; }, ms);
}

function rainParticles() {
  const box = $('#particles');
  box.innerHTML = '';
  const icons = ['🎃', '👻', '🦇', '💀', '🕸️', '✨', '👏'];
  const count = window.innerWidth < 600 ? 24 : 46;
  for (let k = 0; k < count; k++) {
    const s = document.createElement('span');
    s.textContent = icons[k % icons.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.fontSize = (1.4 + Math.random() * 2) + 'rem';
    s.style.animationDuration = (3 + Math.random() * 3.5) + 's';
    s.style.animationDelay = (Math.random() * 2.5) + 's';
    box.appendChild(s);
  }
  setTimeout(() => { box.innerHTML = ''; }, 9500);
}

function header(sub) {
  return `
    <div class="head">
      <div>
        <h1 class="title glitch" data-text="CLAP METER"><small>EMPASOFT PD // NIGHT OF THE BUGS</small>CLAP METER</h1>
        <div class="case-line">ХЭРГИЙН ДУГААР <b>10/31-HW</b> · ${esc(sub)}</div>
      </div>
      <div class="btn-row">
        <button class="btn btn-small" data-nav="home">🏠 НҮҮР</button>
        <button class="btn btn-small" data-nav="board">🏆 ТЭРГҮҮЛЭГЧИД</button>
      </div>
    </div>`;
}
function bindNav() {
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.nav === 'home') renderHome(); else renderBoard();
  }));
}

/* ================================================================
   7. НҮҮР — ангилал бүрийн финалистууд
   ================================================================ */
function renderHome() {
  view = 'home';
  const col = (cat) => {
    const list = byCat(cat);
    const N = CFG.perCategory;
    const done = allMeasured(cat);
    const slots = list.map((p, i) => `
      <div class="slot" style="animation-delay:${i * 0.05}s">
        <img src="${p.photo}" alt="">
        <div>
          <div class="slot-no">${caseNo(p.no)}</div>
          <div class="slot-name">${esc(p.name)}</div>
          ${p.costume ? `<div class="slot-costume">🎭 ${esc(p.costume)}</div>` : ''}
        </div>
        <div class="slot-score">
          ${p.score != null ? `<b>${p.score.toFixed(1)} dB</b>` : '<span class="pending">— хэмжээгүй</span>'}
          <div class="slot-actions">
            ${p.score == null
              ? `<button class="btn btn-small btn-primary" data-measure="${p.id}">▶ ХЭМЖИХ</button>`
              : `<button class="btn btn-small lock" data-measure="${p.id}">↺</button>`}
            <button class="btn btn-small btn-danger lock" data-del="${p.id}" title="Устгах">🗑</button>
          </div>
        </div>
      </div>`).join('');
    const empties = Array.from({ length: Math.max(0, N - list.length) },
      () => `<div class="slot empty" data-register="${cat}">+ ФИНАЛИСТ БҮРТГЭХ</div>`).join('');
    const next = list.find((p) => p.score == null);
    return `
      <section class="card">
        <div class="cat-head">
          <h2>${CATS[cat].icon} ${CATS[cat].label}</h2>
          <span class="cat-count">${list.length}/${N} бүртгэгдсэн · ${list.filter((p) => p.score != null).length} хэмжсэн
            ${revealed[cat] ? ' · <span class="tag-done">ЗАРЛАГДСАН</span>' : ''}</span>
        </div>
        <div class="slots">${slots}${empties}</div>
        <div class="cat-foot">
          <button class="btn" data-start="${cat}" ${next ? '' : 'disabled'}>▶ ХЭМЖИЛТ ЭХЛҮҮЛЭХ</button>
          <button class="btn btn-gold" data-reveal="${cat}" ${done ? '' : 'disabled'}>🏆 ЯЛАГЧДЫГ ЗАРЛАХ</button>
        </div>
      </section>`;
  };
  swap(`${header('КОСТЮМЫН ШАГНАЛ · ҮЗЭГЧДИЙН АЛГА ТАШИЛТААР')}<div class="cats">${col('m')}${col('f')}</div>`, () => {
    bindNav();
    $$('[data-register]').forEach((b) => b.addEventListener('click', () => renderRegister(b.dataset.register)));
    $$('[data-start]').forEach((b) => b.addEventListener('click', () => {
      const p = byCat(b.dataset.start).find((x) => x.score == null);
      if (p) renderStage(p.id);
    }));
    $$('[data-reveal]').forEach((b) => b.addEventListener('click', () => renderReveal(b.dataset.reveal)));
    $$('[data-measure]').forEach((b) => b.addEventListener('click', () => {
      const p = people.find((x) => x.id === b.dataset.measure);
      if (!p) return;
      if (p.score == null) renderStage(p.id); else requireAdmin(() => renderStage(p.id, true));
    }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => requireAdmin(() => {
      const p = people.find((x) => x.id === b.dataset.del);
      if (!p) return;
      confirmModal(`“${p.name}”-г устгах уу?`, 'Зураг, оноо бүгд устна.', () => {
        people = people.filter((x) => x.id !== p.id);
        savePeople();
        renderHome();
      });
    })));
  });
}

/* ================================================================
   8. БҮРТГЭЛ — нэр, ангилал, костюм + камерын зураг (шүүлтүүртэй)
   ================================================================ */
function renderRegister(cat) {
  if (byCat(cat).length >= CFG.perCategory) { renderHome(); return; }
  view = 'register';
  const no = people.reduce((m, p) => Math.max(m, p.no || 0), 0) + 1;
  let filter = 'mugshot';
  let photo = null;          // хадгалах зураг (dataURL)
  let frozen = false;        // зураг авсны дараа камер зогсоно
  let stream = null, raf = 0, busy = false;

  swap(`
    ${header('ФИНАЛИСТ БҮРТГЭЛ')}
    <div class="register">
      <div>
        <div class="cam-wrap">
          <canvas id="cam" width="${PHOTO_W}" height="${PHOTO_H}"></canvas>
          <div class="cam-msg" id="cam-msg">📷 Камер асаж байна…</div>
          <div class="cam-count" id="cam-count"></div>
          <div class="cam-flash" id="cam-flash"></div>
        </div>
        <div class="filters" id="filters">
          ${FILTERS.map((f) => `<button class="btn btn-small ${f.key === filter ? 'active' : ''}" data-f="${f.key}">${f.label}</button>`).join('')}
        </div>
      </div>
      <form class="card reg-form" id="reg-form" autocomplete="off">
        <h2>🗂 СЭЖИГТЭН ${caseNo(no)}</h2>
        <div class="steps">1) Ангилал, нэрээ бичнэ → 2) Шүүлтүүр сонгоно → 3) 📸 Зураг авна → 4) Хадгална</div>
        <div>
          <label class="lbl">АНГИЛАЛ</label>
          <div class="seg">
            ${Object.keys(CATS).map((c) => `<button type="button" class="btn ${c === cat ? 'active' : ''}" data-cat="${c}" ${byCat(c).length >= CFG.perCategory ? 'disabled' : ''}>${CATS[c].icon} ${CATS[c].label}</button>`).join('')}
          </div>
        </div>
        <div><label class="lbl" for="r-name">НЭР *</label><input id="r-name" type="text" maxlength="22" placeholder="Жишээ: Бат-Эрдэнэ"></div>
        <div><label class="lbl" for="r-costume">КОСТЮМ / ДҮР (заавал биш)</label><input id="r-costume" type="text" maxlength="30" placeholder="Жишээ: Ганнибал Лектер"></div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary btn-big" id="snap" disabled>📸 ЗУРАГ АВАХ</button>
          <button type="button" class="btn" id="retake" hidden>↺ ДАХИН АВАХ</button>
        </div>
        <div class="form-msg" id="r-msg"></div>
        <div class="btn-row">
          <button type="submit" class="btn btn-gold" id="save" disabled>💾 ХАДГАЛАХ</button>
          <button type="button" class="btn" data-nav="home">✕ БОЛИХ</button>
        </div>
      </form>
    </div>`, async () => {
    bindNav();
    const canvas = $('#cam'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true;
    const nameIn = $('#r-name'), costIn = $('#r-costume'), msg = $('#r-msg');

    const update = () => {
      $('#snap').disabled = !nameIn.value.trim() || frozen || !stream || busy;
      $('#save').disabled = !(photo && nameIn.value.trim());
    };
    nameIn.addEventListener('input', update);
    nameIn.focus();

    $$('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      cat = b.dataset.cat;
      $$('[data-cat]').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $$('[data-f]').forEach((b) => b.addEventListener('click', () => {
      if (frozen) return;
      filter = b.dataset.f;
      $$('[data-f]').forEach((x) => x.classList.toggle('active', x === b));
    }));

    // Камер асаах
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      await video.play();
      $('#cam-msg').hidden = true;
    } catch (e) {
      $('#cam-msg').innerHTML = '⚠ Камер нээгдсэнгүй.<br><span class="small">Хөтчийн хаягийн мөрөн дээрх 🔒/📷 дүрс дээр дарж камерын зөвшөөрөл өгөөд хуудсаа refresh хийнэ үү.</span>';
    }
    update();

    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (frozen || !stream || video.readyState < 2) return;
      drawFiltered(ctx, video, filter, { no, name: nameIn.value.trim(), t });
    };
    raf = requestAnimationFrame(loop);

    viewCleanup = () => {
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
    };

    // 3-2-1 → зураг авах
    $('#snap').addEventListener('click', async () => {
      if (busy) return;
      busy = true; update();
      const cnt = $('#cam-count');
      for (let i = CFG.countdownSec; i >= 1; i--) {
        cnt.textContent = i; sfx.beep();
        await wait(1000);
      }
      cnt.textContent = '';
      drawFiltered(ctx, video, filter, { no, name: nameIn.value.trim(), t: performance.now() });
      frozen = true;
      sfx.shutter();
      const fl = $('#cam-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
      photo = canvas.toDataURL('image/jpeg', 0.85);
      busy = false;
      $('#snap').hidden = true; $('#retake').hidden = false;
      msg.textContent = '';
      update();
    });
    $('#retake').addEventListener('click', () => {
      frozen = false; photo = null;
      $('#snap').hidden = false; $('#retake').hidden = true;
      update();
    });

    $('#reg-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      if (!name) { msg.textContent = '✖ Нэрээ бичнэ үү.'; return; }
      if (!photo) { msg.textContent = '✖ Эхлээд зураг авна уу.'; return; }
      if (byCat(cat).length >= CFG.perCategory) { msg.textContent = '✖ Энэ ангилал дүүрсэн байна.'; return; }
      people.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        no, name, costume: costIn.value.trim(), cat, photo, score: null, peak: null,
      });
      if (!savePeople()) { people.pop(); msg.textContent = '✖ Хадгалж чадсангүй (зай дүүрсэн).'; return; }
      sfx.result();
      flash('🗂 ' + caseNo(no) + ' БҮРТГЭГДЛЭЭ', 1100);
      renderHome();
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Камерын шүүлтүүрүүд ---------- */
const off = document.createElement('canvas');           // дулааны камерт ашиглах жижиг canvas
off.width = 120; off.height = 160;
const offCtx = off.getContext('2d', { willReadFrequently: true });
const THERMAL_LUT = (() => {                              // харанхуй → цэнхэр → ягаан → улаан → шар → цагаан
  const stops = [[0, 0, 0, 30], [0.2, 40, 0, 160], [0.4, 170, 0, 170], [0.6, 255, 30, 0], [0.8, 255, 190, 0], [1, 255, 255, 230]];
  const lut = [];
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let k = 0; while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [a, ar, ag, ab] = stops[k], [b, br, bg, bb] = stops[k + 1];
    const f = (x - a) / (b - a);
    lut.push([ar + (br - ar) * f, ag + (bg - ag) * f, ab + (bb - ab) * f]);
  }
  return lut;
})();

// Видеог 3:4 болгон тайрч, толь шиг (selfie) зурна
function drawVideo(ctx, video, W, H, cssFilter) {
  const vw = video.videoWidth, vh = video.videoHeight;
  let sw = vw, sh = vh;
  if (vw / vh > W / H) sw = vh * W / H; else sh = vw * H / W;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  ctx.save();
  ctx.filter = cssFilter || 'none';
  ctx.translate(W, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
  ctx.restore();
  ctx.filter = 'none';
}
function vignette(ctx, W, H, a = 0.6) {
  const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function grain(ctx, W, H, n = 500, color = 'rgba(255,255,255,0.12)') {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
}
function label(ctx, text, x, y, size, color, align = 'left', weight = '700') {
  ctx.font = `${weight} ${size}px "JetBrains Mono", monospace`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function drawFiltered(ctx, video, key, meta) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const name = (meta.name || 'НЭРГҮЙ').toUpperCase();

  if (key === 'mugshot') {
    // Цагдаагийн зураг: өндрийн шугам + дугаартай самбар
    drawVideo(ctx, video, W, H, 'saturate(0.8) contrast(1.12) brightness(1.03)');
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    for (let cm = 140, i = 0; cm <= 200; cm += 10, i++) {
      const y = H - 120 - i * ((H - 150) / 6);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(46, y); ctx.moveTo(W - 46, y); ctx.lineTo(W, y); ctx.stroke();
      label(ctx, cm, 4, y - 4, 11, 'rgba(255,255,255,0.75)');
      label(ctx, cm, W - 4, y - 4, 11, 'rgba(255,255,255,0.75)', 'right');
    }
    // Самбар
    const bw = W * 0.74, bh = 100, bx = (W - bw) / 2, by = H - bh - 12;
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 3; ctx.strokeRect(bx + 4, by + 4, bw - 8, bh - 8);
    label(ctx, 'EMPASOFT PD', W / 2, by + 26, 16, '#ff7a1a', 'center');
    label(ctx, name.slice(0, 18), W / 2, by + 56, 22, '#ffffff', 'center');
    label(ctx, caseNo(meta.no) + '   ' + EVENT_DATE, W / 2, by + 84, 14, '#e8e2d0', 'center', '400');
    grain(ctx, W, H, 250, 'rgba(255,255,255,0.08)');
  } else if (key === 'night') {
    // Шөнийн хараа: ногоон, чимээтэй, REC
    drawVideo(ctx, video, W, H, 'grayscale(1) brightness(1.35) contrast(1.3)');
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#39ff7a'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    grain(ctx, W, H, 900, 'rgba(160,255,190,0.22)');
    for (let y = 0; y < H; y += 3) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, y, W, 1); }
    vignette(ctx, W, H, 0.85);
    if (Math.floor(meta.t / 600) % 2) { ctx.fillStyle = '#ff3355'; ctx.beginPath(); ctx.arc(22, 26, 7, 0, 7); ctx.fill(); }
    label(ctx, 'REC  NV-CAM 03', 36, 31, 15, '#b8ffcc');
    label(ctx, caseNo(meta.no), W - 14, 31, 15, '#b8ffcc', 'right');
    label(ctx, EVENT_DATE + ' 23:59', W - 14, H - 16, 14, '#b8ffcc', 'right', '400');
    label(ctx, name.slice(0, 16), 14, H - 16, 16, '#b8ffcc');
  } else if (key === 'thermal') {
    // Дулааны камер: тод байдлыг өнгөний шатлал руу хувиргана
    drawVideo(offCtx, video, off.width, off.height, 'contrast(1.2)');
    const img = offCtx.getImageData(0, 0, off.width, off.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.min(255, (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0);
      const c = THERMAL_LUT[lum]; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 18, H / 2); ctx.lineTo(W / 2 + 18, H / 2); ctx.moveTo(W / 2, H / 2 - 18); ctx.lineTo(W / 2, H / 2 + 18); ctx.stroke();
    label(ctx, 'THERMAL · 36.6°C', 14, 28, 15, '#ffffff');
    label(ctx, caseNo(meta.no), W - 14, 28, 15, '#ffffff', 'right');
    label(ctx, name.slice(0, 18), 14, H - 16, 17, '#ffffff');
    // температурын шкал
    for (let i = 0; i < 120; i++) { const c = THERMAL_LUT[Math.round(255 - i * 255 / 119)]; ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(W - 22, 50 + i * 2, 10, 2); }
  } else if (key === 'vhs') {
    // VHS: өнгө салалт, гажуудал, PLAY
    drawVideo(ctx, video, W, H, 'saturate(1.5) contrast(1.15)');
    const img = ctx.getImageData(0, 0, W, H), d = img.data, src = new Uint8ClampedArray(d);
    const shift = 5;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        const i = row + x * 4, xr = Math.min(W - 1, x + shift);
        d[i] = src[row + xr * 4];                        // улаан суваг баруун тийш
        const xb = Math.max(0, x - shift); d[i + 2] = src[row + xb * 4 + 2]; // цэнхэр зүүн тийш
      }
    }
    ctx.putImageData(img, 0, 0);
    for (let k = 0; k < 3; k++) {                         // санамсаргүй хэвтээ гажуудал
      const y = Math.random() * H, h = 4 + Math.random() * 14, dx = (Math.random() - 0.5) * 30;
      ctx.drawImage(ctx.canvas, 0, y, W, h, dx, y, W, h);
    }
    for (let y = 0; y < H; y += 2) { ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0, y, W, 1); }
    label(ctx, 'PLAY ▶', 16, 34, 22, '#ffffff');
    label(ctx, 'SP  ' + caseNo(meta.no), W - 14, 34, 16, '#ffffff', 'right', '400');
    label(ctx, 'OCT.31 2026', W - 14, H - 18, 18, '#ffffff', 'right');
    label(ctx, name.slice(0, 16), 16, H - 18, 18, '#ffffff');
  } else {
    // Нуар: хар цагаан, хурц сүүдэр, хөшигний судал
    drawVideo(ctx, video, W, H, 'grayscale(1) contrast(1.6) brightness(0.95)');
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(-0.35); ctx.fillStyle = 'rgba(0,0,0,0.38)';
    for (let y = -H; y < H; y += 46) ctx.fillRect(-W, y, W * 2, 20);
    ctx.restore();
    vignette(ctx, W, H, 0.9);
    grain(ctx, W, H, 700, 'rgba(255,255,255,0.1)');
    label(ctx, 'CASE FILE ' + caseNo(meta.no), W / 2, 34, 15, '#e8e2d0', 'center', '400');
    label(ctx, name.slice(0, 18), W / 2, H - 22, 22, '#ffffff', 'center');
  }
}

/* ================================================================
   9. ТАЙЗ — хэмжилт
   ================================================================ */
let measure = null;   // { id, phase: 'idle'|'countdown'|'measuring'|'done', start, samples, best, peak }
const meterState = { disp: DB_MIN, last: 0 };

function meterHTML() {
  const ticks = [30, 45, 60, 75, 90, 105, 120].map((v) => `<span style="bottom:${pct(v)}%">${v}</span>`).join('');
  const zoneMid = (i) => (LEVELS[i].from + (LEVELS[i + 1] ? LEVELS[i + 1].from : DB_MAX)) / 2;
  const zones = LEVELS.map((l, i) => `<div class="zone" data-z="${i}" style="bottom:${pct(zoneMid(i))}%">${l.name}</div>`).join('');
  return `
    <div class="meter">
      <div class="meter-scale">${ticks}</div>
      <div class="meter-tube"><div class="meter-fill" id="m-fill"></div><div class="meter-peak" id="m-peak"></div></div>
      <div class="meter-zones">${zones}</div>
    </div>`;
}

function renderStage(id, remeasure = false) {
  const p = people.find((x) => x.id === id);
  if (!p) { renderHome(); return; }
  view = 'stage';
  const list = byCat(p.cat);
  const idx = list.indexOf(p) + 1;
  measure = { id, phase: p.score != null && !remeasure ? 'done' : 'idle', start: 0, samples: [], best: -Infinity, peak: -Infinity };

  swap(`
    <div class="stage-head">
      <span class="case-no">ХЭРГИЙН ДУГААР ${caseNo(p.no)}</span>
      <span class="cat-pill">${CATS[p.cat].icon} ${CATS[p.cat].label} · ${idx}/${list.length}</span>
    </div>
    <div class="stage-grid">
      <div class="suspect">
        <div class="evidence-tag">НОТЛОХ БАРИМТ #${String(p.no).padStart(2, '0')}</div>
        <img class="suspect-photo" src="${p.photo}" alt="">
        <div class="suspect-name">${esc(p.name)}</div>
        ${p.costume ? `<div class="suspect-costume">🎭 ${esc(p.costume)}</div>` : ''}
      </div>
      <div class="card meter-panel">
        ${meterHTML()}
        <div class="readout">
          <div class="db-big"><span id="m-db">--</span><small>dB</small></div>
          <div class="level-name" id="m-level"></div>
          <div class="stage-status" id="m-status"></div>
          <div class="measure-bar" id="m-bar"><i></i></div>
          <div id="m-result"></div>
        </div>
      </div>
    </div>
    <div class="stage-actions" id="m-actions"></div>`, () => {
    drawStageUI();
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || !$('#modal').hidden) return;
      if (e.code === 'Space') { e.preventDefault(); const b = $('#act-start'); if (b && !b.disabled) b.click(); }
      if (e.code === 'Enter') { const b = $('#act-next'); if (b) { e.preventDefault(); b.click(); } }
    };
    document.addEventListener('keydown', onKey);
    const mine = measure;
    // Дараагийн оролцогч руу шилжихэд ШИНЭ хэмжилтийг устгахгүйн тулд зөвхөн өөрийнхөө хэмжилтийг арилгана
    viewCleanup = () => { document.removeEventListener('keydown', onKey); if (measure === mine) measure = null; $('.countdown')?.remove(); };
  });
}

// Тайзны товч, үр дүнг одоогийн төлөвөөр зурна
function drawStageUI() {
  if (!measure) return;
  const p = people.find((x) => x.id === measure.id);
  if (!p) return;
  const acts = $('#m-actions'), res = $('#m-result'), status = $('#m-status');
  const nextP = byCat(p.cat).find((x) => x.score == null && x.id !== p.id);
  const homeBtn = '<button class="btn" id="act-home">◀ НҮҮР</button>';

  if (!mic.ready) {
    status.textContent = mic.error || 'Микрофон идэвхгүй байна.';
    acts.innerHTML = `<button class="btn btn-primary btn-big" id="act-mic">🎤 МИК ИДЭВХЖҮҮЛЭХ</button>${homeBtn}`;
    res.innerHTML = '';
  } else if (measure.phase === 'idle') {
    status.textContent = 'Танхимын одоогийн түвшин. Бэлэн үү?';
    res.innerHTML = '';
    acts.innerHTML = `<button class="btn btn-primary btn-big" id="act-start">▶ ХЭМЖИЖ ЭХЛЭХ (SPACE)</button>${homeBtn}`;
  } else if (measure.phase === 'done' && p.score != null) {
    status.textContent = '';
    res.innerHTML = `
      <div class="result">
        <div class="result-score">🏁 ОНОО: <b>${p.score.toFixed(1)} dB</b></div>
        <div class="result-sub">Оргил цэг: ${(p.peak ?? p.score).toFixed(1)} dB · ${CFG.measureSec} сек хэмжилт</div>
      </div>`;
    acts.innerHTML = `
      ${nextP ? '<button class="btn btn-primary btn-big" id="act-next">ДАРААГИЙН ОРОЛЦОГЧ ▶ (ENTER)</button>'
        : (allMeasured(p.cat) ? '<button class="btn btn-gold btn-big" id="act-next">🏆 ЯЛАГЧДЫГ ЗАРЛАХ (ENTER)</button>' : '')}
      <button class="btn lock" id="act-redo">↺ ДАХИН ХЭМЖИХ</button>
      ${homeBtn}`;
  } else {
    acts.innerHTML = ''; res.innerHTML = '';
  }

  $('#act-home')?.addEventListener('click', renderHome);
  $('#act-mic')?.addEventListener('click', async () => {
    status.textContent = 'Зөвшөөрөл хүлээж байна…';
    await mic.init();
    drawStageUI();
  });
  $('#act-start')?.addEventListener('click', startMeasure);
  $('#act-redo')?.addEventListener('click', () => requireAdmin(() => { measure.phase = 'idle'; drawStageUI(); }));
  $('#act-next')?.addEventListener('click', () => {
    if (nextP) renderStage(nextP.id); else renderReveal(p.cat);
  });
}

async function startMeasure() {
  if (!measure || measure.phase !== 'idle' || !mic.ready) return;
  const id = measure.id;
  measure.phase = 'countdown';
  drawStageUI();
  $('#m-status').textContent = 'Бэлдээрэй…';
  const ov = document.createElement('div');
  ov.className = 'countdown';
  document.body.appendChild(ov);
  for (let i = CFG.countdownSec; i >= 1; i--) {
    if (!measure || measure.id !== id) { ov.remove(); return; }
    ov.innerHTML = `<span>${i}</span>`;
    sfx.beep();                          // дуу зөвхөн тоолох үед
    await wait(1000);
  }
  if (!measure || measure.id !== id) { ov.remove(); return; }
  ov.innerHTML = '<span class="go">👏 АЛГА ТАШ!</span>';
  await wait(350);                       // дохионы дуу бүрэн унтрахыг хүлээнэ
  if (!measure || measure.id !== id) { ov.remove(); return; }
  setTimeout(() => ov.remove(), 700);
  Object.assign(measure, { phase: 'measuring', start: performance.now(), samples: [], best: -Infinity, peak: -Infinity });
  $('#m-status').textContent = '🔴 ХЭМЖИЖ БАЙНА… (чимээгүй горим)';
  $('#m-bar').classList.add('on');
}

function finishMeasure() {
  const p = people.find((x) => x.id === measure.id);
  measure.phase = 'done';
  $('#m-bar')?.classList.remove('on');
  if (!p) return;
  const best = Number.isFinite(measure.best) ? measure.best : measure.peak;
  p.score = r1(best);
  p.peak = r1(Math.max(measure.peak, best));
  savePeople();
  setTimeout(() => sfx.result(), 150);   // хэмжилт дууссаны ДАРАА л дуу
  drawStageUI();
}

/* ---------- Нэг давталт: мик унших, метр зурах, хэмжилт хийх ---------- */
function loop(ts) {
  requestAnimationFrame(loop);
  if (!mic.ready) return;
  const p = mic.power();
  const db = toDb(p);
  const dt = meterState.last ? Math.min(0.1, (ts - meterState.last) / 1000) : 0;
  meterState.last = ts;
  // хурдан өгсөж, удаан буурна (бодит метр шиг)
  meterState.disp = db > meterState.disp ? db : Math.max(db, meterState.disp - 35 * dt);

  if (measure && measure.phase === 'measuring') {
    const t = performance.now() - measure.start;
    measure.samples.push({ t, p });
    while (measure.samples.length && measure.samples[0].t < t - WINDOW_MS) measure.samples.shift();
    if (t >= WINDOW_MS) {
      const avg = measure.samples.reduce((s, x) => s + x.p, 0) / measure.samples.length;
      measure.best = Math.max(measure.best, toDb(avg));
    }
    measure.peak = Math.max(measure.peak, db);
    const bar = $('#m-bar i');
    if (bar) bar.style.width = clamp(t / (CFG.measureSec * 1000), 0, 1) * 100 + '%';
    if (t >= CFG.measureSec * 1000) finishMeasure();
  }

  // Тайзны метр
  const fill = $('#m-fill');
  if (fill) {
    const person = measure && people.find((x) => x.id === measure.id);
    const showResult = measure && measure.phase === 'done' && person && person.score != null;
    const shown = showResult ? person.score : meterState.disp;
    fill.style.clipPath = `inset(${100 - pct(meterState.disp)}% 0 0 0)`;
    $('#m-db').textContent = Math.round(shown);
    $('#m-level').textContent = levelOf(shown).name;
    const pk = $('#m-peak');
    const peakVal = measure && measure.phase === 'measuring' ? measure.peak : (showResult ? person.peak : null);
    pk.classList.toggle('on', peakVal != null && Number.isFinite(peakVal));
    if (peakVal != null) pk.style.bottom = `calc(${pct(peakVal)}% - 2px)`;
    const lv = LEVELS.indexOf(levelOf(meterState.disp));
    $$('.zone').forEach((z, i) => { z.classList.toggle('lit', i <= lv); z.classList.toggle('now', i === lv); });
  }
  // Тохиргооны жижиг метр
  const cal = $('#cal-fill');
  if (cal) { cal.style.width = pct(meterState.disp) + '%'; $('#cal-db').textContent = meterState.disp.toFixed(1) + ' dB'; }
}

/* ================================================================
   10. ЯЛАГЧ ЗАРЛАХ — 3 → 2 → 1
   ================================================================ */
function renderReveal(cat, instant = false) {
  view = 'reveal';
  const list = ranked(cat);
  const top = list.slice(0, 3);
  const order = top.map((_, i) => i).reverse();       // 3-р → 2-р → 1-р
  const visual = [1, 0, 2].filter((i) => top[i]);       // индэр: 2-р | 1-р | 3-р
  let step = instant || revealed[cat] ? top.length : 0;
  const other = cat === 'm' ? 'f' : 'm';

  const podHTML = (i) => {
    const p = top[i];
    return `
      <div class="pod p${i + 1} ${step >= top.length ? 'shown' : ''}" id="pod-${i}">
        <div class="pod-card"><div class="pod-inner">
          <div class="pod-front">?</div>
          <div class="pod-back"><img src="${p.photo}" alt=""></div>
        </div></div>
        <div class="pod-info">
          <div class="pod-name">${esc(p.name)}</div>
          ${p.costume ? `<div class="pod-costume">🎭 ${esc(p.costume)}</div>` : ''}
          <div class="pod-score">${p.score.toFixed(1)} dB</div>
        </div>
        <div class="pod-base">${p._place}</div>
      </div>`;
  };
  const restHTML = () => list.length > 3 ? `
    <div class="rest card"><ol class="board-list">${list.slice(3).map((p) => `
      <li><span class="place">${p._place}.</span><img src="${p.photo}" alt=""><span class="bname">${esc(p.name)}<small>${esc(p.costume || '')}</small></span><span class="bscore">${p.score.toFixed(1)} dB</span></li>`).join('')}
    </ol></div>` : '';

  swap(`
    <div class="reveal-title">
      <div class="sub">EMPASOFT PD · ШИЙДВЭР ГАРЛАА</div>
      <h1>🏆 ${CATS[cat].label} — ЯЛАГЧИД</h1>
    </div>
    <div class="suspense" id="suspense"></div>
    <div class="podium">${visual.map(podHTML).join('')}</div>
    <div id="rest">${step >= top.length ? restHTML() : ''}</div>
    <div class="stage-actions" id="rv-actions"></div>`, () => {
    const btns = () => {
      const a = $('#rv-actions');
      if (step < top.length) {
        const place = top[order[step]]._place;
        a.innerHTML = `<button class="btn btn-gold btn-big" id="rv-next">🥁 ${place}-Р БАЙРЫГ ЗАРЛАХ (SPACE)</button>`;
        $('#rv-next').addEventListener('click', next);
      } else {
        a.innerHTML = `
          ${!revealed[other] && allMeasured(other) ? `<button class="btn btn-gold" id="rv-other">🏆 ${CATS[other].label} АНГИЛАЛ ЗАРЛАХ</button>` : ''}
          ${!revealed[other] && !allMeasured(other) && byCat(other).length ? `<button class="btn btn-primary" id="rv-measure">▶ ${CATS[other].label} ХЭМЖИЛТ</button>` : ''}
          <button class="btn" id="rv-replay">↺ ДАХИН ЗАРЛАХ</button>
          <button class="btn" data-nav="board">🏆 ТЭРГҮҮЛЭГЧИД</button>
          <button class="btn" data-nav="home">🏠 НҮҮР</button>`;
        bindNav();
        $('#rv-other')?.addEventListener('click', () => renderReveal(other));
        $('#rv-measure')?.addEventListener('click', () => { const p = byCat(other).find((x) => x.score == null); if (p) renderStage(p.id); });
        $('#rv-replay').addEventListener('click', () => { revealed[cat] = false; saveRevealed(); renderReveal(cat); });
      }
    };
    let busy = false;
    async function next() {
      if (busy || step >= top.length) return;
      busy = true;
      const i = order[step], p = top[i], first = i === 0;
      $('#rv-next').disabled = true;
      const sus = $('#suspense');
      sus.textContent = `🥁 ${p._place}-Р БАЙР…`;
      sus.classList.add('drum');
      sfx.drumroll(first ? 2.6 : 1.6);
      await wait(first ? 2700 : 1700);
      sus.classList.remove('drum');
      $('#pod-' + i).classList.add('shown');
      sus.textContent = `${medal(p._place)} ${p.name}`;
      if (first) { sfx.fanfare(); flash('🏆 1-Р БАЙР: ' + p.name.toUpperCase(), 1600); setTimeout(rainParticles, 600); }
      else sfx.sting();
      step++;
      if (step >= top.length) { revealed[cat] = true; saveRevealed(); $('#rest').innerHTML = restHTML(); }
      busy = false;
      btns();
    }
    btns();
    const onKey = (e) => {
      if (e.code === 'Space' && $('#modal').hidden) { e.preventDefault(); const b = $('#rv-next'); if (b && !b.disabled) b.click(); }
    };
    document.addEventListener('keydown', onKey);
    viewCleanup = () => document.removeEventListener('keydown', onKey);
  });
}

/* ================================================================
   11. ТЭРГҮҮЛЭГЧИД — зарлагдсан ангиллыг л харуулна (spoiler-гүй)
   ================================================================ */
function renderBoard() {
  view = 'board';
  const col = (cat) => {
    const list = ranked(cat);
    let body;
    if (!revealed[cat]) body = `<div class="locked">🔒 Хараахан зарлагдаагүй<br><span class="small">${list.length}/${byCat(cat).length} хэмжсэн</span></div>`;
    else body = `<ol class="board-list">${list.map((p, k) => `
      <li class="${p._place <= 3 ? 'r' + p._place : ''}" style="animation-delay:${k * 0.06}s">
        <span class="place">${medal(p._place)}</span><img src="${p.photo}" alt="">
        <span class="bname">${esc(p.name)}<small>${esc(p.costume || '')}</small></span>
        <span class="bscore">${p.score.toFixed(1)} dB</span>
      </li>`).join('')}</ol>`;
    return `<section class="card"><div class="cat-head"><h2>${CATS[cat].icon} ${CATS[cat].label}</h2></div>${body}</section>`;
  };
  swap(`${header('ТЭРГҮҮЛЭГЧИД · ХАМГИЙН ЧАНГА АЛГА ТАШИЛТ')}<div class="board-cats">${col('m')}${col('f')}</div>`, bindNav);
}

/* ================================================================
   12. ЗОХИОН БАЙГУУЛАГЧ — PIN, тохиргоо
   🔒 Хамгаалалт: устгах, дахин хэмжих, тохиргоо → PIN шаардана.
      PIN-ийг нэг удаа зөв оруулбал хуудсыг refresh хийх хүртэл
      дахин асуухгүй (adminUnlocked).
   ================================================================ */
let adminUnlocked = false;
const modal = $('#modal'), mpanel = $('#modal-panel');
function openModal(html) { mpanel.innerHTML = html; modal.hidden = false; }
function closeModal() { modal.hidden = true; mpanel.innerHTML = ''; }

function requireAdmin(cb) {
  if (adminUnlocked) { cb(); return; }
  openModal(`
    <div class="modal-head"><h2>🔒 ЗОХИОН БАЙГУУЛАГЧИЙН PIN</h2><button class="btn btn-small" id="m-x">✕</button></div>
    <form id="pin-form" autocomplete="off">
      <input id="pin-in" type="password" inputmode="numeric" placeholder="PIN">
      <div class="btn-row" style="margin-top:0.8rem"><button class="btn btn-primary">НЭЭХ</button></div>
      <div class="msg err" id="pin-msg"></div>
    </form>`);
  $('#m-x').addEventListener('click', closeModal);
  $('#pin-in').focus();
  $('#pin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('#pin-in').value === String(CFG.pin)) { adminUnlocked = true; closeModal(); cb(); }
    else { $('#pin-msg').textContent = '✖ PIN буруу байна.'; }
  });
}

function confirmModal(title, text, onYes) {
  openModal(`
    <div class="modal-head"><h2>⚠ ${esc(title)}</h2></div>
    <p class="muted">${esc(text)}</p>
    <div class="btn-row"><button class="btn btn-danger" id="c-yes">ТИЙМ</button><button class="btn" id="c-no">ҮГҮЙ</button></div>`);
  $('#c-no').addEventListener('click', closeModal);
  $('#c-yes').addEventListener('click', () => { closeModal(); onYes(); });
}

function openSettings() {
  requireAdmin(() => {
    openModal(`
      <div class="modal-head"><h2>⚙ ТОХИРГОО</h2><button class="btn btn-small" id="m-x">✕ ХААХ</button></div>
      <div class="sec" style="border:0;margin:0;padding:0">
        <h3>🎤 МИК ШАЛГАХ, МЭДРЭМЖ</h3>
        ${mic.ready ? '' : '<button class="btn btn-primary" id="s-mic">🎤 МИК ИДЭВХЖҮҮЛЭХ</button>'}
        <div class="cal-meter"><i id="cal-fill"></i></div>
        <div class="cal-row"><span>Одоогийн түвшин</span><b id="cal-db">--</b></div>
        <label class="lbl" for="s-cal" style="margin-top:0.6rem">МЭДРЭМЖ: <b id="s-cal-v" class="hl">${CFG.calib > 0 ? '+' : ''}${CFG.calib}</b> dB</label>
        <input id="s-cal" type="range" min="-20" max="20" step="1" value="${CFG.calib}">
        <div class="help">Танхим чимээгүй үед ~40–50, хүчтэй алга ташилтад ~95–110 гарахаар тааруулбал тохиромжтой. Хэмжилт эхэлсний дараа БҮҮ өөрчил (шударга бус болно).</div>
      </div>
      <div class="sec">
        <h3>⏱ ХЭМЖИЛТ</h3>
        <div class="grid2">
          <div><label class="lbl" for="s-n">ФИНАЛИСТ / АНГИЛАЛ</label><input id="s-n" type="number" min="1" max="10" value="${CFG.perCategory}"></div>
          <div><label class="lbl" for="s-cd">ТООЛОХ (сек)</label><input id="s-cd" type="number" min="1" max="10" value="${CFG.countdownSec}"></div>
          <div><label class="lbl" for="s-ms">ХЭМЖИХ (сек)</label><input id="s-ms" type="number" min="2" max="15" value="${CFG.measureSec}"></div>
        </div>
        <div style="margin-top:0.8rem"><label class="lbl" for="s-pin">PIN</label><input id="s-pin" type="text" value="${esc(CFG.pin)}"></div>
        <div class="btn-row" style="margin-top:0.8rem"><button class="btn btn-primary" id="s-save">💾 ХАДГАЛАХ</button></div>
        <div class="msg" id="s-msg"></div>
      </div>
      <div class="sec">
        <h3>🗑 АРИЛГАХ</h3>
        <div class="btn-row">
          <button class="btn btn-danger" id="s-scores">Бүх оноог арилгах</button>
          <button class="btn btn-danger" id="s-all">БҮГДИЙГ УСТГАХ (нэр, зураг, оноо)</button>
        </div>
        <div class="help">Event дууссаны дараа "БҮГДИЙГ УСТГАХ" дарж оролцогчдын зургийг энэ компьютерээс устгаарай.</div>
      </div>`);
    const msg = $('#s-msg');
    $('#m-x').addEventListener('click', closeModal);
    $('#s-mic')?.addEventListener('click', async () => { if (await mic.init()) $('#s-mic').remove(); else msg.textContent = mic.error; });
    $('#s-cal').addEventListener('input', (e) => {
      CFG.calib = Number(e.target.value);
      $('#s-cal-v').textContent = (CFG.calib > 0 ? '+' : '') + CFG.calib;
      saveCfg();
    });
    $('#s-save').addEventListener('click', () => {
      const n = Number($('#s-n').value), cd = Number($('#s-cd').value), ms = Number($('#s-ms').value), pin = $('#s-pin').value.trim();
      if (!(n >= 1 && n <= 10) || !(cd >= 1 && cd <= 10) || !(ms >= 2 && ms <= 15) || !pin) {
        msg.className = 'msg err'; msg.textContent = '✖ Утгуудаа шалгана уу (финалист 1–10, тоолох 1–10, хэмжих 2–15, PIN хоосон биш).';
        return;
      }
      Object.assign(CFG, { perCategory: n, countdownSec: cd, measureSec: ms, pin });
      saveCfg();
      msg.className = 'msg ok'; msg.textContent = '✔ Хадгалагдлаа.';
      if (view === 'home') renderHome();
    });
    $('#s-scores').addEventListener('click', () => confirmModal('Бүх оноог арилгах уу?', 'Оролцогчид үлдэнэ, зөвхөн оноо болон зарлалт арилна.', () => {
      people.forEach((p) => { p.score = null; p.peak = null; });
      revealed = { m: false, f: false };
      savePeople(); saveRevealed(); renderHome();
    }));
    $('#s-all').addEventListener('click', () => confirmModal('БҮГДИЙГ УСТГАХ уу?', 'Бүх оролцогчийн нэр, зураг, оноо энэ компьютерээс бүрмөсөн устна.', () => {
      people = []; revealed = { m: false, f: false };
      store.del(KEYS.people); store.del(KEYS.revealed); renderHome();
    }));
  });
}

/* ================================================================
   13. АРЫН BINARY БОРОО
   ================================================================ */
function startRain() {
  const canvas = $('#bg-rain'), ctx = canvas.getContext('2d'), fs = 16;
  let w, h, cols, drops;
  const resize = () => { w = canvas.width = innerWidth; h = canvas.height = innerHeight; cols = Math.ceil(w / fs); drops = Array.from({ length: cols }, () => Math.random() * -60); };
  resize(); addEventListener('resize', resize);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let last = 0;
  const frame = (t) => {
    requestAnimationFrame(frame);
    if (t - last < 80) return;
    last = t;
    ctx.fillStyle = 'rgba(6,7,8,0.2)'; ctx.fillRect(0, 0, w, h);
    ctx.font = fs + 'px monospace';
    for (let i = 0; i < cols; i += 3) {
      const y = drops[i] * fs;
      ctx.fillStyle = Math.random() < 0.04 ? '#ff7a1a' : '#39ff7a';
      ctx.fillText(Math.random() < 0.5 ? '0' : '1', i * fs, y);
      if (y > h && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
  };
  requestAnimationFrame(frame);
}

/* ================================================================
   14. ЭХЛЭЛ
   ================================================================ */
function init() {
  startRain();
  requestAnimationFrame(loop);

  // Нууц тохиргоо нээх: 💀 дээр 5 удаа · Ctrl+Alt+A
  let taps = 0, tapT;
  $('#admin-trigger').addEventListener('click', () => {
    taps++; clearTimeout(tapT); tapT = setTimeout(() => { taps = 0; }, 2500);
    if (taps >= 5) { taps = 0; openSettings(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.code === 'KeyA') { e.preventDefault(); openSettings(); }
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  const st = $('#sound-toggle');
  st.textContent = sfx.on ? '🔊' : '🔇';
  st.addEventListener('click', () => { st.textContent = sfx.toggle() ? '🔊' : '🔇'; });

  // Хуудас нээгдсэнээс хойш анхны товшилтоор дууны систем асна (хөтчийн дүрэм)
  document.addEventListener('pointerdown', () => { try { getCtx(); } catch (e) { /* алгасна */ } }, { once: true });

  renderHome();
}
document.addEventListener('DOMContentLoaded', init);
