const test = require('node:test');
const assert = require('node:assert/strict');
const {
  answerMeansDelete,
  selectLocalOnlyBranches,
} = require('../lib/branch-selection');
const gitCleanup = require('../lib/git-cleanup');
const {
  HELP_TEXT,
  deleteBranch,
  parseBranchRefs,
} = gitCleanup;

test('--help and -h print help text and exit without running git commands', async () => {
  for (const flag of ['--help', '-h']) {
    let output = '';
    let execCalled = false;

    await gitCleanup([flag, '--force', '--dry-run'], {
      exec: async () => {
        execCalled = true;
        return '';
      },
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
    });

    assert.equal(execCalled, false);
    assert.equal(output, HELP_TEXT);
    assert.match(output, /Usage: git-cleanup \[options\]/);
    assert.match(output, /--help/);
    assert.match(output, /--dry-run/);
    assert.match(output, /--force/);
  }
});

test('parseBranchRefs detects ahead and gone tracking states', () => {
  const refs = parseBranchRefs([
    '*|develop|origin/develop|',
    ' |squash-merged|origin/squash-merged|[gone]',
    ' |unpushed-work|origin/unpushed-work|[ahead 2, behind 1]',
  ].join('\n'));

  assert.deepEqual(refs, [
    {
      name: 'develop',
      isCurrent: true,
      upstream: 'origin/develop',
      isGone: false,
      isAhead: false,
    },
    {
      name: 'squash-merged',
      isCurrent: false,
      upstream: 'origin/squash-merged',
      isGone: true,
      isAhead: false,
    },
    {
      name: 'unpushed-work',
      isCurrent: false,
      upstream: 'origin/unpushed-work',
      isGone: false,
      isAhead: true,
    },
  ]);
});

test('keeping is the default answer unless y or yes is provided', () => {
  assert.equal(answerMeansDelete(''), false);
  assert.equal(answerMeansDelete('n'), false);
  assert.equal(answerMeansDelete(' No '), false);
  assert.equal(answerMeansDelete('keep'), false);
  assert.equal(answerMeansDelete('y'), true);
  assert.equal(answerMeansDelete('YES'), true);
  assert.equal(answerMeansDelete(' y '), true);
});

test('non-interactive environments keep all local-only branches by default', async () => {
  let called = false;
  const result = await selectLocalOnlyBranches(
    ['branch-a', 'branch-b'],
    async () => {
      called = true;
      return true;
    },
    { isInteractive: false },
  );

  assert.equal(called, false);
  assert.deepEqual(result, {
    toDelete: [],
    toKeep: ['branch-a', 'branch-b'],
  });
});

test('local-only branches can be kept or deleted individually', async () => {
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

test('deleteBranch deletes merged branches with -d without prompting', async () => {
  const calls = [];
  let promptCount = 0;

  const deleted = await deleteBranch('merged-branch', {
    isDryRun: false,
    isForce: false,
    isConfirmed: false,
    isInteractive: true,
    exec: async (args) => {
      calls.push(args);
      return '';
    },
    confirmForceDelete: async () => {
      promptCount += 1;
      return true;
    },
  });

  assert.equal(deleted, true);
  assert.equal(promptCount, 0);
  assert.deepEqual(calls, [['branch', '-d', 'merged-branch']]);
});

test('deleteBranch prompts before force-deleting an unconfirmed unmerged branch and keeps it when declined', async () => {
  const calls = [];
  const prompted = [];

  const deleted = await deleteBranch('unmerged-gone', {
    isDryRun: false,
    isForce: false,
    isConfirmed: false,
    isInteractive: true,
    exec: async (args) => {
      calls.push(args);
      if (args[1] === '-d') {
        throw "error: The branch 'unmerged-gone' is not fully merged.";
      }
      return '';
    },
    confirmForceDelete: async (branch) => {
      prompted.push(branch);
      return false;
    },
  });

  assert.equal(deleted, false);
  assert.deepEqual(prompted, ['unmerged-gone']);
  assert.deepEqual(calls, [['branch', '-d', 'unmerged-gone']]);
});

test('deleteBranch force-deletes an unconfirmed unmerged branch when user confirms', async () => {
  const calls = [];

  const deleted = await deleteBranch('squash-merged-gone', {
    isDryRun: false,
    isForce: false,
    isConfirmed: false,
    isInteractive: true,
    exec: async (args) => {
      calls.push(args);
      if (args[1] === '-d') {
        throw "error: The branch 'squash-merged-gone' is not fully merged.";
      }
      return '';
    },
    confirmForceDelete: async () => true,
  });

  assert.equal(deleted, true);
  assert.deepEqual(calls, [
    ['branch', '-d', 'squash-merged-gone'],
    ['branch', '-D', 'squash-merged-gone'],
  ]);
});

test('deleteBranch skips unmerged branch in non-interactive mode without --force', async () => {
  const calls = [];
  let promptCalled = false;

  const deleted = await deleteBranch('unmerged-gone', {
    isDryRun: false,
    isForce: false,
    isConfirmed: false,
    isInteractive: false,
    exec: async (args) => {
      calls.push(args);
      if (args[1] === '-d') {
        throw "error: The branch 'unmerged-gone' is not fully merged.";
      }
      return '';
    },
    confirmForceDelete: async () => {
      promptCalled = true;
      return true;
    },
  });

  assert.equal(deleted, false);
  assert.equal(promptCalled, false);
  assert.deepEqual(calls, [['branch', '-d', 'unmerged-gone']]);
});

test('deleteBranch force-deletes without re-prompting when branch deletion was already confirmed or --force is set', async () => {
  const calls = [];
  let promptCalled = false;

  const deleted = await deleteBranch('confirmed-local', {
    isDryRun: false,
    isForce: false,
    isConfirmed: true,
    isInteractive: true,
    exec: async (args) => {
      calls.push(args);
      if (args[1] === '-d') {
        throw "error: The branch 'confirmed-local' is not fully merged.";
      }
      return '';
    },
    confirmForceDelete: async () => {
      promptCalled = true;
      return false;
    },
  });

  assert.equal(deleted, true);
  assert.equal(promptCalled, false);
  assert.deepEqual(calls, [
    ['branch', '-d', 'confirmed-local'],
    ['branch', '-D', 'confirmed-local'],
  ]);
});

test('deleteBranch prompts when a gone branch had unpushed commits before pruning', async () => {
  const calls = [];
  const prompted = [];

  const deleted = await deleteBranch('ahead-before-prune', {
    isDryRun: false,
    isForce: false,
    isConfirmed: false,
    hadUnpushedCommits: true,
    isInteractive: true,
    exec: async (args) => {
      calls.push(args);
      if (args[1] === '-d') {
        throw "error: The branch 'ahead-before-prune' is not fully merged.";
      }
      return '';
    },
    confirmForceDelete: async (branch) => {
      prompted.push(branch);
      return false;
    },
  });

  assert.equal(deleted, false);
  assert.deepEqual(prompted, ['ahead-before-prune']);
  assert.deepEqual(calls, [['branch', '-d', 'ahead-before-prune']]);
});
