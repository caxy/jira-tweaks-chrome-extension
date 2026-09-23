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
  JT.normalize({ internalProject: 'int', clientProjects: 'ext' }).mappings,
  [{ client: 'EXT', internal: 'INT' }]);
eq('several client projects share one of ours',
  JT.normalize({ internalProject: 'INT', clientProjects: 'EXT, EXT2' }).mappings,
  [{ client: 'EXT', internal: 'INT' }, { client: 'EXT2', internal: 'INT' }]);
eq('a real mapping table wins over the legacy fields',
  JT.normalize({ mappings: [{ client: 'EXT', internal: 'INT9' }], internalProject: 'INT', clientProjects: 'EXT' }).mappings,
  [{ client: 'EXT', internal: 'INT9' }]);
eq('legacy internal project with no clients',
  JT.normalize({ internalProject: 'INT' }).mappings, []);

console.log('normalize');
eq('keys upper-cased, incomplete rows dropped',
  JT.normalize({ mappings: [{ client: ' ext ', internal: 'int' }, { client: '', internal: 'INT2' }] }).mappings,
  [{ client: 'EXT', internal: 'INT' }]);
eq('a client project maps once - first wins',
  JT.normalize({ mappings: [{ client: 'EXT', internal: 'INT' }, { client: 'EXT', internal: 'INT9' }] }).mappings,
  [{ client: 'EXT', internal: 'INT' }]);
eq('bare host gains https', JT.normalize({ internalSite: 'yourco.atlassian.net' }).internalSite,
  'https://yourco.atlassian.net');
eq('path and query dropped', JT.normalize({ internalSite: 'https://yourco.atlassian.net/jira/x?y=1' }).internalSite,
  'https://yourco.atlassian.net');
eq('unparseable site', JT.normalize({ internalSite: '::::' }).internalSite, '');
// The shipped default, deliberately not a generic placeholder.
eq('default label', JT.normalize({}).fieldLabel, 'Caxy ticket');

console.log('internalFor');
const s = JT.normalize({ mappings: [{ client: 'EXT', internal: 'INT' }, { client: 'EXT2', internal: 'INT2' }] });
eq('EXT -> INT', JT.internalFor(s, 'EXT-4567'), 'INT');
eq('EXT2 -> INT2', JT.internalFor(s, 'EXT2-77'), 'INT2');
eq('lower-case issue key', JT.internalFor(s, 'ext2-77'), 'INT2');
eq('unmapped project', JT.internalFor(s, 'INT-100'), '');
eq('not an issue key', JT.internalFor(s, 'nonsense'), '');

console.log('jql');
eq('client key searched as an exact phrase', JT.buildJql('INT', 'EXT-4567'),
  'project = "INT" AND summary ~ "\\"EXT-4567\\"" ORDER BY created DESC');

console.log(fails ? `\n${fails} test(s) FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
