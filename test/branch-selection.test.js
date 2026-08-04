const test = require('node:test');
const assert = require('node:assert/strict');
const {
  answerMeansDelete,
  selectLocalOnlyBranches,
} = require('../lib/branch-selection');

test('deletion is the default answer', () => {
  assert.equal(answerMeansDelete(''), true);
  assert.equal(answerMeansDelete('y'), true);
  assert.equal(answerMeansDelete('YES'), true);
});

test('no opts an individual branch out of deletion', () => {
  assert.equal(answerMeansDelete('n'), false);
  assert.equal(answerMeansDelete(' No '), false);
});

test('local-only branches can be kept individually', async () => {
  const answers = new Map([
    ['delete-me', true],
    ['keep-me', false],
    ['also-delete-me', true],
  ]);

  const result = await selectLocalOnlyBranches(
    [...answers.keys()],
    async (branch) => answers.get(branch),
  );

  assert.deepEqual(result, {
    toDelete: ['delete-me', 'also-delete-me'],
    toKeep: ['keep-me'],
  });
});
