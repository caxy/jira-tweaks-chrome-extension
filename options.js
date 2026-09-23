'use strict';

const JT = globalThis.JiraTweaks;
const $ = id => document.getElementById(id);
const LEGACY_KEYS = ['internalProject', 'clientProjects'];

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'status error' : 'status';
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
}

// ---------- mapping rows ----------

function addRow(client, internal) {
  const row = document.createElement('div');
  row.className = 'map-row';

  const mk = (cls, placeholder, value) => {
    const i = document.createElement('input');
    i.type = 'text';
    i.className = cls;
    i.placeholder = placeholder;
    i.value = value || '';
    i.spellcheck = false;
    i.addEventListener('input', () => i.classList.remove('invalid'));
    return i;
  };

  const arrow = document.createElement('span');
  arrow.className = 'map-arrow';
  arrow.textContent = '→';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'map-remove';
  remove.textContent = '×';
  remove.title = 'Remove this mapping';
  remove.setAttribute('aria-label', 'Remove this mapping');
  remove.addEventListener('click', () => {
    row.remove();
    if (!$('mappings').children.length) addRow();
  });

  row.append(mk('map-client', 'EXT', client), arrow, mk('map-internal', 'INT', internal), remove);
  $('mappings').appendChild(row);
  return row;
}

function rowValues() {
  return [...$('mappings').children].map(row => ({
    row,
    client: row.querySelector('.map-client'),
    internal: row.querySelector('.map-internal')
  }));
}

// Returns the mappings, or null after marking whatever is wrong.
function collectMappings() {
  const out = [];
  const seen = new Set();
  let bad = null;

  for (const { client, internal } of rowValues()) {
    const c = client.value.trim().toUpperCase();
    const i = internal.value.trim().toUpperCase();
    client.value = c;
    internal.value = i;
    if (!c && !i) continue; // a blank row is just an unused slot

    if (!c || !i) {
      (c ? internal : client).classList.add('invalid');
      bad = bad || 'Fill in both sides of every mapping.';
      continue;
    }
    if (seen.has(c)) {
      client.classList.add('invalid');
      bad = bad || `${c} is mapped twice.`;
      continue;
    }
    seen.add(c);
    out.push({ client: c, internal: i });
  }

  if (bad) { setStatus(bad, true); return null; }
  return out;
}

// ---------- host permission ----------
//
// atlassian.net and jira.com are granted in the manifest. A self-hosted site
// needs an explicit grant, so offer one rather than failing silently later.

function refreshGrant() {
  const origin = JT.siteOrigin($('internalSite').value);
  const card = $('grant');
  if (!origin) { card.hidden = true; return; }
  chrome.permissions.contains({ origins: [`${origin}/*`] }, granted => {
    card.hidden = !!granted;
    if (granted) return;
    $('grantText').textContent =
      `The extension needs permission to read ${origin} in order to look up tickets there.`;
    $('grantBtn').onclick = () => {
      chrome.permissions.request({ origins: [`${origin}/*`] }, ok => {
        if (ok) refreshGrant();
        else setStatus('Permission declined.', true);
      });
    };
  });
}

// ---------- load / save ----------

function load() {
  JT.read().then(s => {
    $('internalSite').value = s.internalSite;
    $('fieldLabel').value = s.fieldLabel;
    $('mappings').textContent = '';
    for (const m of s.mappings) addRow(m.client, m.internal);
    if (!s.mappings.length) addRow();
    refreshGrant();
  });
}

function save(ev) {
  ev.preventDefault();
  const site = $('internalSite').value.trim();
  const origin = JT.siteOrigin(site);
  if (site && !origin) { setStatus('That site URL is not valid.', true); return; }

  const mappings = collectMappings();
  if (!mappings) return;

  const values = {
    internalSite: origin,
    mappings,
    fieldLabel: $('fieldLabel').value.trim() || JT.DEFAULTS.fieldLabel
  };
  chrome.storage.sync.set(values, () => {
    if (chrome.runtime.lastError) { setStatus(chrome.runtime.lastError.message, true); return; }
    // The 0.2 fields have been folded into `mappings`; drop them so they
    // can't be migrated over the table again.
    chrome.storage.sync.remove(LEGACY_KEYS, () => {
      $('internalSite').value = origin;
      $('fieldLabel').value = values.fieldLabel;
      setStatus('Saved. Reload your Jira tab.');
      refreshGrant();
    });
  });
}

// ---------- test ----------

function runTest() {
  const key = $('testKey').value.trim().toUpperCase();
  const out = $('testOut');
  out.hidden = false;
  if (!JT.ISSUE_KEY_RE.test(key)) { out.textContent = 'Enter an issue key like EXT-4567.'; return; }
  out.textContent = 'Searching…';
  chrome.runtime.sendMessage({ type: 'jt:lookup', clientKey: key, fresh: true }, res => {
    if (chrome.runtime.lastError) { out.textContent = chrome.runtime.lastError.message; return; }
    if (!res) { out.textContent = 'No response from the extension.'; return; }
    if (res.ok) {
      out.textContent = `${key} → ${res.project}\n\nFound ${res.key}\n${res.summary}\n${res.url}`;
      return;
    }
    const lines = [res.code === 'notfound'
      ? `${key} → ${res.project}\n\nNo match.`
      : (res.error || 'Lookup failed.')];
    if (res.searchUrl) lines.push('', `Fallback search:\n${res.searchUrl}`);
    out.textContent = lines.join('\n');
  });
}

$('form').addEventListener('submit', save);
$('add').addEventListener('click', () => addRow().querySelector('.map-client').focus());
$('internalSite').addEventListener('change', refreshGrant);
$('testBtn').addEventListener('click', runTest);
$('testKey').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runTest(); } });
load();
