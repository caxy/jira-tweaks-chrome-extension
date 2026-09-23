/*
 * Jira Tweaks - editable Due Date
 *
 * Jira's board issue panel shows "Due date" but (depending on screen config)
 * renders it read-only. This script finds that read-only value, lets you click
 * it to pick a date, and saves via Jira's own REST API using the session
 * cookies already present on the page. No tokens, no extra auth.
 */
(() => {
  'use strict';

  const LABEL_RE = /^\s*due\s*date:?\s*$/i;
  const KEY_RE = /([A-Z][A-Z0-9_]+-\d+)/;
  // Something that looks like a date, or an "empty" placeholder.
  const DATE_LIKE_RE = /\d/;
  const EMPTY_LIKE_RE = /^\s*(none|—|–|-|)\s*$/i;
  const DC_DATE_RE = /^\s*(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})\s*$/;
  const ISO_DATE_RE = /^\s*(\d{4})-(\d{2})-(\d{2})/;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const INTERACTIVE_SEL = 'button, input, select, textarea, [contenteditable="true"], [role="button"], [role="combobox"], [role="textbox"]';

  const debug = (...args) => {
    try {
      if (localStorage.getItem('jiraTweaksDebug') === '1') console.log('[Jira Tweaks]', ...args);
    } catch (_) { /* ignore */ }
  };

  // ---------- context helpers ----------

  function contextPath() {
    const meta = document.querySelector('meta[name="ajs-context-path"]');
    return meta && meta.content ? meta.content.replace(/\/$/, '') : '';
  }

  function issueKeyFromUrl() {
    const url = new URL(location.href);
    const selected = url.searchParams.get('selectedIssue');
    if (selected && KEY_RE.test(selected)) return selected.match(KEY_RE)[1];
    // /browse/KEY, and the newer /jira/software/.../issues/KEY form.
    const path = url.pathname.match(/\/(?:browse|issues)\/([A-Z][A-Z0-9_]+-\d+)(?:[/?#]|$)/);
    if (path) return path[1];
    return null;
  }

  function keyFromHref(a) {
    const m = (a.getAttribute('href') || '').match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
    return m ? m[1] : null;
  }

  // A board card wraps its content next to a single "/browse/KEY" link. If the
  // value sits inside such a card, that card's key wins over the URL, which may
  // point at whichever issue is open in the side panel.
  function issueKeyFromCard(startEl) {
    let el = startEl;
    for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
      for (const child of el.children) {
        if (child.tagName === 'A') {
          const key = keyFromHref(child);
          if (key) return key;
        }
      }
    }
    return null;
  }

  function issueKeyFromDom(startEl) {
    const meta = document.querySelector('meta[name="ajs-issue-key"]');
    if (meta && meta.content) return meta.content;
    let el = startEl;
    for (let depth = 0; el && depth < 12; depth++, el = el.parentElement) {
      for (const a of el.querySelectorAll('a[href*="/browse/"]')) {
        const key = keyFromHref(a);
        if (key) return key;
      }
    }
    return null;
  }

  function resolveIssueKey(startEl) {
    return issueKeyFromCard(startEl) || issueKeyFromUrl() || issueKeyFromDom(startEl);
  }

  // ---------- date helpers ----------

  function pad(n) { return String(n).padStart(2, '0'); }

  function toIso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

  function parseDisplayedDate(text) {
    const t = (text || '').trim();
    if (!t || EMPTY_LIKE_RE.test(t)) return '';
    let m = t.match(ISO_DATE_RE);
    if (m) return toIso(m[1], m[2], m[3]);
    m = t.match(DC_DATE_RE);
    if (m) {
      const mi = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
      if (mi >= 0) {
        const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        return toIso(y, mi + 1, m[1]);
      }
    }
    const d = new Date(t);
    if (!isNaN(d.getTime())) return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return '';
  }

  function formatLikeOriginal(iso, originalText) {
    if (!iso) return 'None';
    const [y, m, d] = iso.split('-').map(Number);
    if (DC_DATE_RE.test(originalText || '')) {
      return `${pad(d)}/${MONTHS[m - 1]}/${String(y).slice(-2)}`;
    }
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }

  // ---------- REST ----------

  async function jiraFetch(path, options = {}) {
    const res = await fetch(contextPath() + path, {
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Atlassian-Token': 'no-check',
        ...(options.headers || {})
      },
      ...options
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    if (!res.ok) {
      const err = new Error(describeError(body, res.status));
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function describeError(body, status) {
    if (body) {
      const parts = [];
      if (Array.isArray(body.errorMessages)) parts.push(...body.errorMessages);
      if (body.errors && typeof body.errors === 'object') parts.push(...Object.values(body.errors));
      if (parts.length) return parts.join(' ');
    }
    if (status === 401 || status === 403) return `Not allowed (HTTP ${status}). Are you logged in?`;
    return `Request failed (HTTP ${status}).`;
  }

  function getDueDate(key) {
    return jiraFetch(`/rest/api/2/issue/${encodeURIComponent(key)}?fields=duedate`)
      .then(b => (b && b.fields ? (b.fields.duedate || '') : ''));
  }

  function setDueDate(key, iso) {
    return jiraFetch(`/rest/api/2/issue/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { duedate: iso || null } })
    });
  }

  // ---------- toast ----------

  let toastTimer = null;
  function toast(message, kind) {
    let el = document.querySelector('.jt-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'jt-toast';
      document.body.appendChild(el);
    }
    el.className = `jt-toast jt-toast-${kind || 'info'}`;
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), kind === 'error' ? 8000 : 3000);
  }

  // ---------- DOM discovery ----------

  function findLabels(root, re) {
    const labels = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!re.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || p.closest('.jt-editor, [data-jt-linkrow], script, style, option')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) labels.push(n.parentElement);
    return labels;
  }

  function containsInteractive(el) {
    return !!(el.matches(INTERACTIVE_SEL) || el.querySelector(INTERACTIVE_SEL));
  }

  // From a label element, find the sibling element holding the value.
  function findValueNode(label) {
    let branch = label;
    for (let depth = 0; branch && branch.parentElement && depth < 6; depth++) {
      const container = branch.parentElement;
      if (container.children.length >= 2) {
        const candidates = [];
        if (branch.nextElementSibling) candidates.push(branch.nextElementSibling);
        for (const child of container.children) {
          if (child !== branch && !candidates.includes(child)) candidates.push(child);
        }
        for (const c of candidates) {
          if (c.contains(label)) continue;
          const txt = (c.textContent || '').trim();
          if (LABEL_RE.test(txt)) continue;
          if (DATE_LIKE_RE.test(txt) || EMPTY_LIKE_RE.test(txt)) {
            // Ignore huge blocks: a value cell is short.
            if (txt.length <= 40) return c;
          }
        }
      }
      branch = container;
    }
    return null;
  }

  function enhance(root) {
    for (const label of findLabels(root || document.body, LABEL_RE)) {
      const value = findValueNode(label);
      if (!value) { debug('no value node for label', label); continue; }
      if (value.dataset.jtProcessed) continue;
      value.dataset.jtProcessed = '1';
      if (containsInteractive(value)) { debug('already editable, skipping', value); continue; }
      debug('enhancing', value);
      value.classList.add('jt-due-value');
      value.title = 'Click to edit due date';
      value.addEventListener('click', onValueClick);
    }
  }

  // ---------- editor ----------

  function onValueClick(ev) {
    const value = ev.currentTarget;
    if (value.querySelector('.jt-editor')) return;
    ev.preventDefault();
    ev.stopPropagation();
    openEditor(value);
  }

  function openEditor(value) {
    const key = resolveIssueKey(value);
    if (!key) {
      toast('Jira Tweaks: could not determine which issue this is.', 'error');
      return;
    }
    const originalText = value.textContent;
    const originalHtml = value.innerHTML;

    const editor = document.createElement('span');
    editor.className = 'jt-editor';
    editor.addEventListener('click', e => e.stopPropagation());

    const input = document.createElement('input');
    input.type = 'date';
    input.value = parseDisplayedDate(originalText);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'jt-save';
    save.textContent = 'Save';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';

    editor.append(input, save, clear, cancel);
    value.classList.remove('jt-due-value');
    value.innerHTML = '';
    value.appendChild(editor);
    input.focus();

    let userTouched = false;
    input.addEventListener('input', () => { userTouched = true; });

    // Pull the authoritative value in case the displayed text didn't parse.
    getDueDate(key).then(iso => {
      if (!userTouched && iso !== undefined) input.value = iso;
    }).catch(err => debug('could not fetch current due date', err));

    const restore = () => {
      value.innerHTML = originalHtml;
      value.classList.add('jt-due-value');
    };

    const commit = async (iso) => {
      editor.classList.add('jt-saving');
      save.disabled = clear.disabled = cancel.disabled = true;
      try {
        await setDueDate(key, iso);
        value.textContent = formatLikeOriginal(iso, originalText);
        value.classList.add('jt-due-value');
        toast(`${key} due date ${iso ? 'set to ' + iso : 'cleared'}.`, 'success');
      } catch (err) {
        debug('save failed', err);
        toast(`Jira Tweaks: ${err.message}`, 'error');
        editor.classList.remove('jt-saving');
        save.disabled = clear.disabled = cancel.disabled = false;
        input.focus();
      }
    };

    save.addEventListener('click', () => commit(input.value));
    clear.addEventListener('click', () => commit(''));
    cancel.addEventListener('click', restore);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); restore(); }
      e.stopPropagation();
    });
  }

  // ---------- back-link to our own board ----------
  //
  // Our internal tickets carry the client key at the front of the summary:
  // "PLS-4567/Some description". Automation links our board to the client's,
  // but not the other way, so on a client issue we render that missing row
  // ourselves: a link to the matching internal ticket, under Parent.
  //
  // Read-only. Nothing in this section writes to the client's Jira - the row
  // is drawn in this browser and the only request is a search on our site.

  const PARENT_LABEL_RE = /^\s*parent\s*:?\s*$/i;

  // settings.js has to be injected first (manifest content_scripts, or a
  // <script> before this one). If it isn't, say so and fall back to due-date
  // editing only - throwing here would take that feature down too.
  const JT = globalThis.JiraTweaks || null;
  if (!JT) console.warn('[Jira Tweaks] settings.js did not load; back-link row disabled. Reload the extension at chrome://extensions.');

  let settings = JT ? JT.normalize({}) : null;
  let settingsLoaded = false;
  const lookups = new Map(); // clientKey -> Promise<result>, also de-dupes in flight

  function loadSettings() {
    if (!JT) return Promise.resolve();
    // test/mock.html stands in for storage so the UI can be tried offline.
    const raw = window.jiraTweaksSettings;
    return (raw ? Promise.resolve(JT.normalize(raw)) : JT.read())
      .then(s => { settings = s; settingsLoaded = true; });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // The client issue on screen, plus which of our projects is mapped to it.
  // No mapping means no row: our own board already links outward.
  function currentMapping() {
    const clientKey = issueKeyFromUrl();
    if (!clientKey) return null;
    const internal = JT.internalFor(settings, clientKey);
    return internal ? { clientKey, internal } : null;
  }

  function lookup(clientKey) {
    if (lookups.has(clientKey)) return lookups.get(clientKey);
    const p = new Promise(resolve => {
      if (window.jiraTweaksLookup) { resolve(window.jiraTweaksLookup(clientKey)); return; }
      try {
        chrome.runtime.sendMessage({ type: 'jt:lookup', clientKey }, res => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, code: 'error', error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, code: 'error', error: 'No response from the extension.' });
        });
      } catch (e) {
        resolve({ ok: false, code: 'error', error: String((e && e.message) || e) });
      }
    });
    lookups.set(clientKey, p);
    return p;
  }

  // Split a field row into its label and value children, so the row can be
  // cloned and re-labelled. Same walk as findValueNode, different acceptance.
  function splitRow(label) {
    let branch = label;
    for (let depth = 0; branch && branch.parentElement && depth < 6; depth++) {
      const container = branch.parentElement;
      const children = [...container.children];
      if (children.length >= 2) {
        for (const sib of children) {
          if (sib === branch || sib.contains(label)) continue;
          const txt = (sib.textContent || '').trim();
          if (!txt || PARENT_LABEL_RE.test(txt) || txt.length > 200) continue;
          return { container, labelIdx: children.indexOf(branch), valueIdx: children.indexOf(sib) };
        }
      }
      branch = container;
    }
    return null;
  }

  function findParentRow() {
    for (const label of findLabels(document.body, PARENT_LABEL_RE)) {
      const split = splitRow(label);
      if (split) return split;
    }
    return null;
  }

  function setLabelText(el, text) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (PARENT_LABEL_RE.test(n.nodeValue)) { n.nodeValue = text; return; }
    }
    el.textContent = text;
  }

  // Cloning the real row is what makes this look native: it inherits Jira's
  // own spacing, type and theme without us guessing at class names.
  function buildRow(split, clientKey) {
    const clone = split.container.cloneNode(true);
    clone.setAttribute('data-jt-linkrow', '1');
    clone.setAttribute('data-jt-key', clientKey);
    // A clone carries the original's identity: duplicated ids and testids
    // confuse Jira's own scripts and screen readers.
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of ['id', 'for', 'data-testid', 'data-jt-processed',
                          'aria-labelledby', 'aria-describedby']) {
        el.removeAttribute(attr);
      }
    }
    const labelEl = clone.children[split.labelIdx];
    const valueEl = clone.children[split.valueIdx];
    if (!labelEl || !valueEl) return null;
    setLabelText(labelEl, settings.fieldLabel);
    valueEl.classList.add('jt-link-value');
    valueEl.textContent = 'Searching…';
    return clone;
  }

  function linkTo(href, text) {
    const a = document.createElement('a');
    a.className = 'jt-link';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.textContent = text;
    return a;
  }

  function renderResult(row, map, res) {
    const value = row.querySelector('.jt-link-value');
    if (!value || !row.isConnected) return;
    value.textContent = '';

    if (res && res.ok) {
      value.appendChild(linkTo(res.url, res.key));
      // The summary repeats the client key we are already standing on.
      const rest = (res.summary || '')
        .replace(new RegExp(`^\\s*${escapeRe(map.clientKey)}\\s*[/:\\-–]?\\s*`, 'i'), '').trim();
      if (rest) {
        const span = document.createElement('span');
        span.className = 'jt-link-summary';
        span.textContent = rest;
        value.appendChild(span);
      }
      return;
    }

    const project = (res && res.project) || map.internal;
    const href = (res && res.searchUrl) || JT.searchUrl(settings.internalSite, project, map.clientKey);
    const a = linkTo(href, res && res.code === 'notfound'
      ? `No ${project} ticket — search`
      : `Search ${project}`);
    a.classList.add('jt-link-muted');
    if (res && res.error) a.title = res.error;
    value.appendChild(a);
  }

  function enhanceBackLink() {
    if (!JT || !settingsLoaded || !settings.internalSite) return;
    const map = currentMapping();

    const existing = document.querySelector('[data-jt-linkrow]');
    if (existing) {
      // Still the right issue and still attached: nothing to do.
      if (map && existing.getAttribute('data-jt-key') === map.clientKey) return;
      existing.remove();
    }
    if (!map) return;

    const split = findParentRow();
    if (!split) { debug('no Parent row to hang the back-link on'); return; }
    const row = buildRow(split, map.clientKey);
    if (!row) { debug('could not build back-link row'); return; }

    split.container.insertAdjacentElement('afterend', row);
    debug('back-link row inserted for', map.clientKey, '->', map.internal);
    lookup(map.clientKey).then(res => renderResult(row, map, res));
  }

  // ---------- boot ----------

  let scheduled = null;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      enhance();
      enhanceBackLink();
    }, 250);
  }

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      lookups.clear();
      const row = document.querySelector('[data-jt-linkrow]');
      if (row) row.remove();
      loadSettings().then(enhanceBackLink);
    });
  } catch (_) { /* no extension APIs, e.g. test/mock.html */ }

  // The first pass can run before storage answers, so re-run once it has.
  loadSettings().then(enhanceBackLink);
  scheduleEnhance();
  debug('loaded');
})();
