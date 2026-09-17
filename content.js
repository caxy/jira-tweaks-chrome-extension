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
    const browse = url.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
    if (browse) return browse[1];
    return null;
  }

  function issueKeyFromDom(startEl) {
    const meta = document.querySelector('meta[name="ajs-issue-key"]');
    if (meta && meta.content) return meta.content;
    let el = startEl;
    for (let depth = 0; el && depth < 12; depth++, el = el.parentElement) {
      const links = el.querySelectorAll('a[href*="/browse/"]');
      for (const a of links) {
        const m = a.getAttribute('href').match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  function resolveIssueKey(startEl) {
    return issueKeyFromUrl() || issueKeyFromDom(startEl);
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

  function findDueDateLabels(root) {
    const labels = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!LABEL_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || p.closest('.jt-editor, script, style, option')) return NodeFilter.FILTER_REJECT;
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
    for (const label of findDueDateLabels(root || document.body)) {
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

  // ---------- boot ----------

  let scheduled = null;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = setTimeout(() => { scheduled = null; enhance(); }, 250);
  }

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnhance();
  debug('loaded');
})();
