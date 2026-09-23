/*
 * Jira Tweaks - cross-site back-link lookup.
 *
 * A content script on the client's Jira site can't reach our own site's REST
 * API: different origin, different cookies. The service worker can, because
 * the extension holds host permissions for both. It answers one question:
 * "which ticket on the mapped project has this client key in its summary?"
 */
'use strict';

importScripts('settings.js');

const { read, internalFor, buildJql, searchUrl, ISSUE_KEY_RE } = globalThis.JiraTweaks;

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // clientKey -> { at, result }

const debug = (...args) => {
  chrome.storage.local.get({ jtDebug: false }, v => {
    if (v && v.jtDebug) console.log('[Jira Tweaks bg]', ...args);
  });
};

// ---------- REST ----------

async function jiraSearch(origin, jql) {
  const query = `jql=${encodeURIComponent(jql)}&fields=summary&maxResults=10`;
  // Jira Cloud moved search to /search/jql; Server/DC and older Cloud only
  // have /rest/api/2/search. Try the new one, fall back on 404/410.
  const paths = [`/rest/api/3/search/jql?${query}`, `/rest/api/2/search?${query}`];
  let lastStatus = 404;
  for (const path of paths) {
    const res = await fetch(origin + path, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (res.status === 404 || res.status === 410) continue;
    break;
  }
  const err = new Error(`HTTP ${lastStatus}`);
  err.status = lastStatus;
  throw err;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickIssue(issues, clientKey) {
  if (!Array.isArray(issues) || !issues.length) return null;
  const key = escapeRe(clientKey);
  const prefix = new RegExp(`^\\s*${key}\\b`, 'i');
  const anywhere = new RegExp(`(^|[^A-Z0-9_-])${key}([^0-9]|$)`, 'i');
  const summaryOf = i => (i.fields && i.fields.summary) || '';
  return issues.find(i => prefix.test(summaryOf(i)))
    || issues.find(i => anywhere.test(summaryOf(i)))
    || null;
}

// ---------- lookup ----------

async function lookup(clientKey) {
  const settings = await read();
  const origin = settings.internalSite;
  const project = internalFor(settings, clientKey);
  if (!origin || !project) {
    return {
      ok: false,
      code: 'unconfigured',
      error: origin
        ? `No project mapped for ${clientKey.split('-')[0]} in the Jira Tweaks options.`
        : 'Set your Jira site in the Jira Tweaks options.'
    };
  }

  const fallback = searchUrl(origin, project, clientKey);
  try {
    const body = await jiraSearch(origin, buildJql(project, clientKey));
    const issue = pickIssue(body && body.issues, clientKey);
    if (!issue) return { ok: false, code: 'notfound', project, searchUrl: fallback };
    return {
      ok: true,
      key: issue.key,
      project,
      summary: (issue.fields && issue.fields.summary) || '',
      url: `${origin}/browse/${issue.key}`,
      searchUrl: fallback
    };
  } catch (err) {
    const status = err && err.status;
    const code = status === 401 || status === 403 ? 'auth' : 'error';
    const error = code === 'auth'
      ? `Not signed in to ${origin} (HTTP ${status}).`
      : `Lookup failed: ${(err && err.message) || err}`;
    return { ok: false, code, error, project, searchUrl: fallback };
  }
}

async function lookupCached(clientKey) {
  const hit = cache.get(clientKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  const result = await lookup(clientKey);
  // Cache answers, not outages: a failed sign-in should retry on the next view.
  if (result.ok || result.code === 'notfound') cache.set(clientKey, { at: Date.now(), result });
  debug('lookup', clientKey, result);
  return result;
}

// ---------- messaging ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'jt:lookup') return undefined;
  const clientKey = String(msg.clientKey || '').toUpperCase();
  if (!ISSUE_KEY_RE.test(clientKey)) {
    sendResponse({ ok: false, code: 'error', error: 'Not an issue key.' });
    return undefined;
  }
  (msg.fresh ? lookup(clientKey) : lookupCached(clientKey))
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, code: 'error', error: String((e && e.message) || e) }));
  return true; // keep the channel open for the async reply
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') cache.clear();
});
