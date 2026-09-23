/*
 * Pure-logic tests for settings.js: run with `node test/settings.test.js`.
 * The DOM behaviour is exercised by hand through test/mock.html.
 */
'use strict';

require('../settings.js');
const JT = globalThis.JiraTweaks;

let fails = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { console.log(`  ok   ${label}`); return; }
  fails++;
  console.log(`  FAIL ${label}\n         got  ${g}\n         want ${w}`);
}

console.log('0.2 -> 0.3 migration');
eq('one client project',
  JT.normalize({ internalProject: 'wc4', clientProjects: 'pls' }).mappings,
  [{ client: 'PLS', internal: 'WC4' }]);
eq('several client projects share one of ours',
  JT.normalize({ internalProject: 'WC4', clientProjects: 'PLS, ACME' }).mappings,
  [{ client: 'PLS', internal: 'WC4' }, { client: 'ACME', internal: 'WC4' }]);
eq('a real mapping table wins over the legacy fields',
  JT.normalize({ mappings: [{ client: 'PLS', internal: 'WC9' }], internalProject: 'WC4', clientProjects: 'PLS' }).mappings,
  [{ client: 'PLS', internal: 'WC9' }]);
eq('legacy internal project with no clients',
  JT.normalize({ internalProject: 'WC4' }).mappings, []);

console.log('normalize');
eq('keys upper-cased, incomplete rows dropped',
  JT.normalize({ mappings: [{ client: ' pls ', internal: 'wc4' }, { client: '', internal: 'WC5' }] }).mappings,
  [{ client: 'PLS', internal: 'WC4' }]);
eq('a client project maps once - first wins',
  JT.normalize({ mappings: [{ client: 'PLS', internal: 'WC4' }, { client: 'PLS', internal: 'WC9' }] }).mappings,
  [{ client: 'PLS', internal: 'WC4' }]);
eq('bare host gains https', JT.normalize({ internalSite: 'yourco.atlassian.net' }).internalSite,
  'https://yourco.atlassian.net');
eq('path and query dropped', JT.normalize({ internalSite: 'https://yourco.atlassian.net/jira/x?y=1' }).internalSite,
  'https://yourco.atlassian.net');
eq('unparseable site', JT.normalize({ internalSite: '::::' }).internalSite, '');
eq('default label', JT.normalize({}).fieldLabel, 'Caxy ticket');

console.log('internalFor');
const s = JT.normalize({ mappings: [{ client: 'PLS', internal: 'WC4' }, { client: 'ACME', internal: 'WC5' }] });
eq('PLS -> WC4', JT.internalFor(s, 'PLS-4567'), 'WC4');
eq('ACME -> WC5', JT.internalFor(s, 'ACME-77'), 'WC5');
eq('lower-case issue key', JT.internalFor(s, 'acme-77'), 'WC5');
eq('unmapped project', JT.internalFor(s, 'WC4-100'), '');
eq('not an issue key', JT.internalFor(s, 'nonsense'), '');

console.log('jql');
eq('client key searched as an exact phrase', JT.buildJql('WC4', 'PLS-4567'),
  'project = "WC4" AND summary ~ "\\"PLS-4567\\"" ORDER BY created DESC');

console.log(fails ? `\n${fails} test(s) FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
