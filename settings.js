/*
 * Jira Tweaks - shared settings shape.
 *
 * Loaded by the content script, the service worker (importScripts) and the
 * options page, so the mapping table is parsed the same way in all three.
 */
'use strict';

(() => {
  const DEFAULTS = {
    internalSite: '',
    mappings: [], // [{ client: 'PLS', internal: 'WC4' }] - one of ours per client project
    fieldLabel: 'Caxy ticket'
  };

  const ISSUE_KEY_RE = /^([A-Z][A-Z0-9_]+)-\d+$/;

  function siteOrigin(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    try {
      return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).origin;
    } catch (_) {
      return '';
    }
  }

  function cleanKey(s) { return String(s || '').trim().toUpperCase(); }

  // 0.2 stored one internal project for a list of client projects. Fold that
  // into the mapping table so an upgrade keeps working without a visit to
  // the options page.
  function migrate(raw) {
    const internal = cleanKey(raw.internalProject);
    if (!internal) return [];
    return String(raw.clientProjects || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(client => ({ client: cleanKey(client), internal }));
  }

  function normalize(raw) {
    const r = raw || {};
    let mappings = (Array.isArray(r.mappings) ? r.mappings : [])
      .map(m => ({ client: cleanKey(m && m.client), internal: cleanKey(m && m.internal) }))
      .filter(m => m.client && m.internal);
    if (!mappings.length) mappings = migrate(r);

    const seen = new Set(); // a client project maps to exactly one of ours
    mappings = mappings.filter(m => !seen.has(m.client) && seen.add(m.client));

    return {
      internalSite: siteOrigin(r.internalSite),
      mappings,
      fieldLabel: String(r.fieldLabel || '').trim() || DEFAULTS.fieldLabel
    };
  }

  function read() {
    return new Promise(resolve => {
      try {
        // Read everything, not just DEFAULTS' keys, so migrate() can see the
        // 0.2 fields.
        chrome.storage.sync.get(null, v => resolve(normalize(v)));
      } catch (_) {
        resolve(normalize({}));
      }
    });
  }

  // Which of our projects backs this client issue, if any.
  function internalFor(settings, issueKey) {
    const m = String(issueKey || '').toUpperCase().match(ISSUE_KEY_RE);
    if (!m) return '';
    const hit = (settings.mappings || []).find(x => x.client === m[1]);
    return hit ? hit.internal : '';
  }

  // Jira tokenizes "PLS-4567/Rework..." on the punctuation, so an unquoted `~`
  // match would also hit PLS-45670. Search the exact phrase.
  function buildJql(project, clientKey) {
    const phrase = '"\\"' + clientKey + '\\""';
    return `project = "${project}" AND summary ~ ${phrase} ORDER BY created DESC`;
  }

  function searchUrl(origin, project, clientKey) {
    return `${origin}/issues/?jql=${encodeURIComponent(buildJql(project, clientKey))}`;
  }

  globalThis.JiraTweaks = {
    DEFAULTS, ISSUE_KEY_RE, siteOrigin, normalize, read, internalFor, buildJql, searchUrl
  };
})();
