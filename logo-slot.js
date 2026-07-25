/**
 * <logo-slot> — lightweight user-fillable logo placeholder.
 *
 * A trimmed sibling of <image-slot>: drop or pick a PNG/JPEG/WebP/SVG and it
 * shows contained (never cropped) — sized for brand logos. Deliberately has
 * NO ResizeObserver, no reframe/crop machinery and no popover, so many can
 * mount at once cheaply. Dropped logos persist across reloads via a
 * .logo-slots.state.json sidecar (window.omelette.writeFile contract).
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload.
 *   src          Optional fallback logo URL.
 *   placeholder  Empty-state caption. (default 'Drop logo')
 *
 * Sizing: fills its container by default. Put it in a sized wrapper.
 */
(() => {
  const STATE_FILE = '.logo-slots.state.json';
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/avif'];
  const MAX_DIM = 600;

  const subs = new Set();
  let slots = {};
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;

  function load() {
    if (loadP) return loadP;
    loadP = fetch(STATE_FILE)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j === 'object') {
          const merged = Object.assign({}, j, slots);
          for (const id of tombstones) delete merged[id];
          slots = merged;
        }
        tombstones.clear();
      })
      .catch(() => {})
      .then(() => { loaded = true; subs.forEach((fn) => fn()); });
    return loadP;
  }

  let saving = false, saveDirty = false;
  function save() {
    if (saving) { saveDirty = true; return; }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    Promise.resolve(w(STATE_FILE, JSON.stringify(slots)))
      .catch(() => {})
      .then(() => { saving = false; if (saveDirty) { saveDirty = false; save(); } });
  }

  function setSlot(id, val) {
    if (!id) return;
    if (val) { slots[id] = val; tombstones.delete(id); }
    else { delete slots[id]; if (!loaded) tombstones.add(id); }
    subs.forEach((fn) => fn());
    if (loaded) save(); else load().then(save);
  }

  // SVGs pass through as-is (vector, tiny); raster is downscaled + re-encoded
  // to WebP so the sidecar stays small.
  async function toDataUrl(file) {
    if (file.type === 'image/svg+xml') {
      return await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(file);
      });
    }
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return c.toDataURL('image/webp', 0.9);
    } finally { bitmap.close && bitmap.close(); }
  }

  const css =
    ':host{display:block;position:relative;width:100%;height:100%;' +
    '  font:12px/1.3 system-ui,-apple-system,sans-serif;color:rgba(32,30,29,.5)}' +
    '.frame{position:absolute;inset:0;overflow:hidden;border-radius:inherit;' +
    '  display:flex;align-items:center;justify-content:center}' +
    'img{max-width:82%;max-height:76%;object-fit:contain;display:none}' +
    ':host([data-filled]) img{display:block}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:5px;text-align:center;padding:8px;box-sizing:border-box;' +
    '  cursor:pointer;user-select:none}' +
    ':host([data-filled]) .empty{display:none}' +
    '.empty svg{opacity:.4}' +
    '.empty .cap{max-width:92%;font-weight:600;letter-spacing:.01em}' +
    '.empty .sub{font-size:10px;opacity:.8}' +
    '.empty .sub u{text-underline-offset:2px}' +
    '.empty:hover .sub u{color:rgba(32,30,29,.85)}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(32,30,29,.2);' +
    '  border-radius:inherit;transition:border-color .12s}' +
    ':host([data-over]) .ring{border-color:#c67139}' +
    ':host([data-filled]) .ring{display:none}' +
    ':host([data-over]) .frame{outline:2px solid #c67139;outline-offset:-2px}' +
    '.ctl{position:absolute;top:6px;right:6px;display:flex;gap:5px;opacity:0;pointer-events:none;' +
    '  transition:opacity .12s;z-index:3}' +
    ':host([data-filled][data-editable]:hover) .ctl{opacity:1;pointer-events:auto}' +
    '.ctl button{appearance:none;border:0;border-radius:999px;padding:4px 9px;cursor:pointer;' +
    '  background:rgba(32,30,29,.6);color:#fff;font:10px/1 system-ui,-apple-system,sans-serif}' +
    '.ctl button:hover{background:rgba(32,30,29,.82)}' +
    '.err{position:absolute;left:6px;right:6px;bottom:6px;color:#fff;font-size:10px;' +
    '  background:rgba(179,38,30,.92);padding:4px 6px;border-radius:5px;pointer-events:none;z-index:4}';

  const icon =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<path d="m21 15-5-5L5 21"/></svg>';

  class LogoSlot extends HTMLElement {
    static get observedAttributes() { return ['src', 'placeholder', 'id']; }

    constructor() {
      super();
      const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' + css + '</style>' +
        '<div class="frame"><img part="image" alt="" draggable="false"></div>' +
        '<div class="empty" part="empty">' + icon +
        '  <div class="cap"></div><div class="sub">or <u>browse</u></div></div>' +
        '<div class="ring"></div>' +
        '<div class="ctl"><button data-act="replace" type="button">Replace</button>' +
        '  <button data-act="clear" type="button">Remove</button></div>' +
        '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._img = root.querySelector('img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._input = root.querySelector('input');
      this._err = null;
      this._depth = 0;
      this._gen = 0;
      this._subFn = () => this._render();

      this._empty.addEventListener('click', () => {
        if (this.hasAttribute('data-editable')) this._input.click();
      });
      root.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act || !this.hasAttribute('data-editable')) return;
        if (act === 'replace') this._input.click();
        if (act === 'clear') { setSlot(this.id || '', null); if (!this.id) { this._local = null; this._render(); } }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
    }

    connectedCallback() {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((t) => this.addEventListener(t, this));
      this.addEventListener('pointerenter', this._subFn);
      subs.add(this._subFn);
      load();
      this._render();
    }

    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('pointerenter', this._subFn);
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((t) => this.removeEventListener(t, this));
    }

    attributeChangedCallback() { if (this.shadowRoot) this._render(); }

    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        if (--this._depth <= 0) { this._depth = 0; this.removeAttribute('data-over'); }
      } else if (e.type === 'drop') {
        e.preventDefault(); e.stopPropagation();
        this._depth = 0; this.removeAttribute('data-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }
    }

    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) { this._setError('Drop a PNG, JPEG, WebP or SVG.'); return; }
      const gen = ++this._gen;
      try {
        const url = await toDataUrl(file);
        if (gen !== this._gen) return;
        setSlot(this.id || '', { u: url });
        if (!this.id) { this._local = { u: url }; this._render(); }
      } catch (err) {
        if (gen !== this._gen) return;
        this._setError('Could not read that image.');
        console.warn('<logo-slot> ingest failed:', err);
      }
    }

    _setError(msg) {
      if (this._err) { this._err.remove(); this._err = null; }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err'; d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => { if (this._err === d) { d.remove(); this._err = null; } }, 3000);
    }

    _render() {
      const editable = !!(window.omelette && window.omelette.writeFile);
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop logo';

      let stored = this.id ? slots[this.id] : this._local;
      const storedUrl = stored && stored.u && /^data:image\//i.test(stored.u) ? stored.u : null;
      const url = storedUrl || this.getAttribute('src') || '';
      if (url) {
        if (this._img.getAttribute('src') !== url) this._img.src = url;
        this.setAttribute('data-filled', '');
      } else {
        this._img.removeAttribute('src');
        this.removeAttribute('data-filled');
      }
    }
  }

  if (!customElements.get('logo-slot')) customElements.define('logo-slot', LogoSlot);
})();
