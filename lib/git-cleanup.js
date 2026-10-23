const { execFile } = require('child_process');
const readline = require('readline');
const log = require('./logger');
const {
  answerMeansDelete,
  selectLocalOnlyBranches,
} = require('./branch-selection');

const MAIN_BRANCH_NAMES = ['master', 'main', 'develop'];

const HELP_TEXT = `Usage: git-cleanup [options]

Cleans up local Git branches that no longer exist on the remote.

What it does:
  1. Verifies you are on a main branch (${MAIN_BRANCH_NAMES.join(', ')}).
  2. Runs 'git fetch -p' to prune deleted remote-tracking branches and fast-forwards
     the current branch to match its upstream ('git merge --ff-only @{u}').
  3. Automatically deletes local branches whose remote upstream is gone, including
     squash- or rebase-merged branches.
  4. Prompts [y/N] before deleting local-only branches (never pushed / no upstream)
     or gone branches that had unpushed local commits before pruning.

Options:
  -h, --help     Show this help message and exit without modifying the repository
      --dry-run  Preview which branches would be deleted without modifying the repository
  -f, --force    Delete all gone, local-only, and unmerged branches without prompting
`;

const hasHelpFlag = (args = []) => args.includes('-h') || args.includes('--help');

const execGit = (args, { ignoreStderr = false } = {}) => {
  return new Promise((resolve, reject) => {
    execFile('git', args, (error, stdout, stderr) => {
      if (error) {
        const details = [stderr, error.message].filter(Boolean).join('\n').trim();
        return reject(details);
      }
      if (stderr && !ignoreStderr) return reject(stderr.trim());
      resolve(stdout);
    });
  });
};

const getFlags = (args) => {
  const isDryRun = args.includes('--dry-run');
  if (isDryRun) {
    log.info('Doing dry run! Will not delete any branches.');
  }
  const isForce = args.includes('-f') || args.includes('--force');
  if (isForce) {
    log.warn('Force mode: local-only and unmerged branches will be deleted without prompting.');
  }
  return { isDryRun, isForce };
};

const parseBranchRefs = (stdout) => {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [head, name, upstream = '', track = ''] = line.split('|');
      return {
        name,
        isCurrent: head === '*',
        upstream: upstream || null,
        isGone: track.includes('[gone]'),
        isAhead: /\[ahead \d+/.test(track),
      };
    });
};

const parseRemotes = (stdout) => stdout
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const remoteBranchName = (rawRef, remotes) => {
  if (rawRef.includes('->') || rawRef.endsWith('/HEAD')) return null;
  const remote = remotes
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((name) => rawRef === name || rawRef.startsWith(`${name}/`));
  if (!remote || !rawRef.startsWith(`${remote}/`)) return null;
  return rawRef.slice(remote.length + 1);
};

const parseRemoteBranchNames = (stdout, remotes) => {
  const names = new Set();
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((rawRef) => {
      const name = remoteBranchName(rawRef, remotes);
      if (name) names.add(name);
    });
  return names;
};

const classifyBranches = (branches, remoteBranchNames) => {
  const gone = [];
  const localOnly = [];

  branches.forEach((branch) => {
    if (branch.isCurrent || MAIN_BRANCH_NAMES.includes(branch.name)) return;

    if (branch.isGone) {
      gone.push(branch.name);
      return;
    }

    if (branch.upstream) {
      // Still tracks a live remote branch — keep it.
      return;
    }

    if (remoteBranchNames.has(branch.name)) {
      // Exists on a remote but has no upstream configured — keep it.
      return;
    }

    // No upstream and no matching remote branch: never pushed (or remote removed
    // without ever setting upstream). Prompt before deleting.
    localOnly.push(branch.name);
  });

  return { gone, localOnly };
};

const isInteractiveTTY = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

const promptForLocalOnlyBranches = async (branches, { isInteractive = isInteractiveTTY() } = {}) => {
  if (!isInteractive) {
    return {
      ...await selectLocalOnlyBranches(branches, null, { isInteractive: false }),
      interactive: false,
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askToDelete = (branch) => new Promise((resolve) => {
    rl.question(`Delete local-only branch '${branch}'? [y/N] `, (answer) => {
      resolve(answerMeansDelete(answer));
    });
  });

  try {
    return {
      ...await selectLocalOnlyBranches(branches, askToDelete, { isInteractive: true }),
      interactive: true,
    };
  } finally {
    rl.close();
  }
};

const promptToForceDeleteBranch = async (branch) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await new Promise((resolve) => {
      rl.question(`Force-delete unmerged branch '${branch}'? [y/N] `, (answer) => {
        resolve(answerMeansDelete(answer));
      });
    });
  } finally {
    rl.close();
  }
};

const isNotFullyMergedError = (error) => {
  return typeof error === 'string' && error.toLowerCase().includes('not fully merged');
};

const deleteBranch = async (
  branch,
  {
    isDryRun,
    isForce = false,
    isConfirmed = false,
    hadUnpushedCommits = false,
    exec = execGit,
    confirmForceDelete = promptToForceDeleteBranch,
    isInteractive = isInteractiveTTY(),
  } = {},
) => {
  if (isDryRun) {
    log.info(`Would delete '${branch}'.`);
    return true;
  }

  try {
    await exec(['branch', '-d', branch]);
    log.success(`Deleted '${branch}'.`);
    return true;
  } catch (error) {
    if (!isNotFullyMergedError(error)) {
      log.error(`Failed to delete '${branch}': ${error}`);
      return false;
    }

    if (!isForce && (!isConfirmed || hadUnpushedCommits)) {
      log.warn(
        hadUnpushedCommits
          ? `'${branch}' had unpushed commits before its remote was removed and is not fully merged into HEAD.`
          : `'${branch}' is not fully merged into HEAD.`,
      );
      if (!isInteractive) {
        log.warn(`No interactive TTY; skipping unmerged branch '${branch}' (use --force to force-delete).`);
        return false;
      }

      const confirmed = await confirmForceDelete(branch);
      if (!confirmed) {
        log.info(`Keeping unmerged branch '${branch}'.`);
        return false;
      }
    } else {
      log.info(`'${branch}' is not ancestor-merged into HEAD (common after squash/rebase merges). Force-deleting because its remote is gone or deletion was confirmed.`);
    }

    try {
      await exec(['branch', '-D', branch]);
      log.success(`Force-deleted '${branch}'.`);
      return true;
    } catch (forceError) {
      log.error(`Failed to force-delete '${branch}': ${forceError}`);
      return false;
    }
  }
};

const deleteBranches = async (branches, { isDryRun, isForce = false } = {}) => {
  let deleted = 0;
  for (const entry of branches) {
    const {
      name,
      isConfirmed = false,
      hadUnpushedCommits = false,
    } = typeof entry === 'string'
      ? { name: entry, isConfirmed: false, hadUnpushedCommits: false }
      : entry;
    log.info(`Deleting '${name}' ...`);
    if (await deleteBranch(name, { isDryRun, isForce, isConfirmed, hadUnpushedCommits })) deleted += 1;
  }
  return deleted;
};

const gitCleanup = async (args = [], { exec = execGit, stdout = process.stdout } = {}) => {
  if (hasHelpFlag(args)) {
    stdout.write(HELP_TEXT);
    return;
  }

  log.info('Starting local branch cleanup ...');
  if (args.length) {
    log.info(`with arguments: ${args.join(' ')}`);
  }
  const { isDryRun, isForce } = getFlags(args);

  try {
    const branchStdout = await exec([
      'for-each-ref',
      '--format=%(HEAD)|%(refname:short)|%(upstream:short)|%(upstream:track)',
      'refs/heads',
    ]);
    const branches = parseBranchRefs(branchStdout);
    const aheadBeforePrune = new Set(
      branches.filter((branch) => branch.isAhead).map((branch) => branch.name),
    );
    const foundMainBranches = MAIN_BRANCH_NAMES.filter((name) => (
      branches.some((branch) => branch.name === name)
    ));

    if (foundMainBranches.length > 1) {
      log.warn(`Multiple main branches detected: ${foundMainBranches.join(', ')}`);
    } else if (foundMainBranches.length === 1) {
      log.info(`Main branch detected: ${foundMainBranches[0]}`);
    } else {
      log.error('No main branch detected! Aborting ...');
      return;
    }

    const currentBranch = branches.find((branch) => branch.isCurrent);
    if (!currentBranch || !foundMainBranches.includes(currentBranch.name)) {
      log.error(`Not on a main branch! Switch to one of the following branches first and then try again: ${foundMainBranches.join(', ')}`);
      return;
    }

    let refreshedBranches = branches;
    if (isDryRun) {
      log.info('Dry run: skipping remote prune and fast-forward merge.');
    } else {
      await execGit(['fetch', '-p'], { ignoreStderr: true });

      try {
        await execGit(['merge', '--ff-only', '@{u}'], { ignoreStderr: true });
        log.info('Fast-forwarded current branch to match upstream.');
      } catch (error) {
        log.warn(`Could not fast-forward current branch to upstream; merge detection may be less accurate. (${error})`);
      }

      // Re-read after prune so upstream track status ([gone]) is current.
      const refreshedStdout = await execGit([
        'for-each-ref',
        '--format=%(HEAD)|%(refname:short)|%(upstream:short)|%(upstream:track)',
        'refs/heads',
      ]);
      refreshedBranches = parseBranchRefs(refreshedStdout);
    }

    const remotes = parseRemotes(await execGit(['remote']));
    const remoteStdout = await execGit(['branch', '-r']);
    const remoteBranchNames = parseRemoteBranchNames(remoteStdout, remotes);
    const { gone, localOnly } = classifyBranches(refreshedBranches, remoteBranchNames);

    if (!gone.length && !localOnly.length) {
      log.info('No local branches need to be deleted.');
      return;
    }

    if (gone.length) {
      log.info(`Found ${gone.length} branch(es) with a gone remote: ${gone.join(', ')}`);
    } else {
      log.info('No branches with a gone remote.');
    }

    if (localOnly.length) {
      log.warn(`Found ${localOnly.length} local-only branch(es) (never pushed or no upstream): ${localOnly.join(', ')}`);
    }

    let branchesToDelete = gone.map((name) => ({
      name,
      isConfirmed: !aheadBeforePrune.has(name),
      hadUnpushedCommits: aheadBeforePrune.has(name),
    }));

    if (localOnly.length) {
      if (isForce) {
        log.warn('Including local-only branches because --force was set.');
        branchesToDelete = branchesToDelete.concat(
          localOnly.map((name) => ({ name, isConfirmed: true })),
        );
      } else if (isDryRun) {
        log.info('Dry run: skipping local-only branches (kept by default; use --force to include them).');
      } else {
        const { toDelete, toKeep, interactive } = await promptForLocalOnlyBranches(localOnly);
        branchesToDelete = branchesToDelete.concat(
          toDelete.map((name) => ({ name, isConfirmed: true })),
        );

        if (!interactive) {
          log.warn('No interactive TTY; skipping local-only branches by default (use --force to delete them).');
        } else if (toKeep.length) {
          log.info(`Keeping ${toKeep.length} local-only branch(es): ${toKeep.join(', ')}`);
        }
      }
    }

    if (!branchesToDelete.length) {
      log.info('Nothing to delete.');
      return;
    }

    const deleted = await deleteBranches(branchesToDelete, { isDryRun, isForce });
    const summary = `${isDryRun ? 'Would delete' : 'Deleted'} ${deleted} out of ${branchesToDelete.length} local branch(es).`;
    if (deleted === branchesToDelete.length) {
      log.success(summary);
    } else {
      log.warn(summary);
    }
  } catch (error) {
    log.error(`Git cleanup failed: ${error}`);
  }
};

gitCleanup.HELP_TEXT = HELP_TEXT;
gitCleanup.hasHelpFlag = hasHelpFlag;
gitCleanup.deleteBranch = deleteBranch;
gitCleanup.classifyBranches = classifyBranches;
gitCleanup.parseBranchRefs = parseBranchRefs;
gitCleanup.parseRemoteBranchNames = parseRemoteBranchNames;

module.exports = gitCleanup;
