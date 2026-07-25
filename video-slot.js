/**
 * <video-slot> — user-fillable video placeholder (sibling of <image-slot>).
 *
 * Drop or pick an MP4/WebM/MOV and it plays inline with native controls.
 * The dropped clip persists across reloads via a .video-slots.state.json
 * sidecar (same read-via-fetch / write-via-window.omelette contract as
 * <image-slot>). Outside the omelette runtime the slot is read-only and
 * plays whatever `src` the author set.
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload.
 *   src          Optional fallback video URL (mp4/webm). A dropped file
 *                overrides it.
 *   poster       Optional poster image URL shown before play.
 *   placeholder  Empty-state caption. (default 'Drop an MP4')
 *
 * Sizing: fills its container by default. Put it in a sized wrapper.
 */
(() => {
  const STATE_FILE = '.video-slots.state.json';
  const ACCEPT = ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'];
  const MAX_BYTES = 60 * 1024 * 1024; // 60MB guardrail for a persisted clip

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

  let saving = false;
  let saveDirty = false;
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

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  const css =
    ':host{display:block;position:relative;width:100%;height:100%;aspect-ratio:9/16;' +
    '  font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55)}' +
    '.frame{position:absolute;inset:0;overflow:hidden;background:#1a1613;border-radius:inherit}' +
    'video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#1a1613;display:none}' +
    ':host([data-filled]) video{display:block}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:8px;text-align:center;padding:14px;box-sizing:border-box;' +
    '  cursor:pointer;user-select:none;color:rgba(255,255,255,.82)}' +
    ':host([data-filled]) .empty{display:none}' +
    '.empty svg{opacity:.8}' +
    '.empty .cap{max-width:90%;font-weight:600;letter-spacing:.01em}' +
    '.empty .sub{font-size:11px;opacity:.75}' +
    '.empty .sub u{text-underline-offset:2px}' +
    '.empty:hover .sub u{color:#fff}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(255,255,255,.28);' +
    '  border-radius:inherit;transition:border-color .12s}' +
    ':host([data-over]) .ring{border-color:#c67139}' +
    ':host([data-filled]) .ring{display:none}' +
    ':host([data-over]) .frame{outline:2px solid #c67139;outline-offset:-2px}' +
    '.ctl{position:absolute;top:8px;right:8px;display:flex;gap:6px;opacity:0;pointer-events:none;' +
    '  transition:opacity .12s;z-index:3}' +
    ':host([data-filled][data-editable]:hover) .ctl{opacity:1;pointer-events:auto}' +
    '.ctl button{appearance:none;border:0;border-radius:999px;padding:5px 11px;cursor:pointer;' +
    '  background:rgba(0,0,0,.62);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' +
    '  backdrop-filter:blur(6px)}' +
    '.ctl button:hover{background:rgba(0,0,0,.8)}' +
    '.err{position:absolute;left:8px;right:8px;bottom:8px;color:#fff;font-size:11px;' +
    '  background:rgba(179,38,30,.92);padding:5px 8px;border-radius:6px;pointer-events:none;z-index:4}';

  const camIcon =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>' +
    '<rect x="2" y="6" width="14" height="12" rx="2"/></svg>';

  class VideoSlot extends HTMLElement {
    static get observedAttributes() { return ['src', 'poster', 'placeholder', 'id']; }

    constructor() {
      super();
      const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' + css + '</style>' +
        '<div class="frame">' +
        '  <video part="video" playsinline preload="metadata" controls controlslist="nodownload"></video>' +
        '  <div class="empty" part="empty">' + camIcon +
        '    <div class="cap"></div>' +
        '    <div class="sub">or <u>browse files</u></div>' +
        '  </div>' +
        '  <div class="ring"></div>' +
        '</div>' +
        '<div class="ctl"><button data-act="replace" type="button">Replace</button>' +
        '  <button data-act="clear" type="button">Remove</button></div>' +
        '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._video = root.querySelector('video');
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
        if (act === 'clear') { this._video.pause(); setSlot(this.id || '', null); if (!this.id) { this._local = null; this._render(); } }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
    }

    connectedCallback() {
      if (!this.id && !VideoSlot._warned) {
        VideoSlot._warned = true;
        console.warn('<video-slot> without an id will not persist its dropped video.');
      }
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
      const okType = ACCEPT.indexOf(file.type) >= 0 || /\.(mp4|webm|mov|ogv)$/i.test(file.name || '');
      if (!file || !okType) { this._setError('Drop an MP4, WebM or MOV video.'); return; }
      if (file.size > MAX_BYTES) {
        this._setError('That clip is over 60MB — trim or compress it first.');
        return;
      }
      const gen = ++this._gen;
      try {
        const url = await readAsDataUrl(file);
        if (gen !== this._gen) return;
        setSlot(this.id || '', { u: url });
        if (!this.id) { this._local = { u: url }; this._render(); }
      } catch (err) {
        if (gen !== this._gen) return;
        this._setError('Could not read that video.');
        console.warn('<video-slot> ingest failed:', err);
      }
    }

    _setError(msg) {
      if (this._err) { this._err.remove(); this._err = null; }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err'; d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => { if (this._err === d) { d.remove(); this._err = null; } }, 3500);
    }

    _render() {
      const editable = !!(window.omelette && window.omelette.writeFile);
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an MP4';

      let stored = this.id ? slots[this.id] : this._local;
      const storedUrl = stored && stored.u && /^data:video\//i.test(stored.u) ? stored.u : null;
      const srcAttr = this.getAttribute('src') || '';
      const url = storedUrl || srcAttr;

      const poster = this.getAttribute('poster') || '';
      if (poster) this._video.setAttribute('poster', poster); else this._video.removeAttribute('poster');

      if (url) {
        if (this._video.getAttribute('src') !== url) this._video.src = url;
        this.setAttribute('data-filled', '');
      } else {
        this._video.removeAttribute('src');
        this.removeAttribute('data-filled');
      }
    }
  }

  if (!customElements.get('video-slot')) customElements.define('video-slot', VideoSlot);
})();
