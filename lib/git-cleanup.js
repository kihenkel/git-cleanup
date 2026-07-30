const { execFile } = require('child_process');
const readline = require('readline');
const log = require('./logger');

const MAIN_BRANCH_NAMES = ['master', 'main', 'develop'];

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
    log.warn('Force mode: local-only branches will be deleted without prompting.');
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

const promptYesNo = async (question) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { answered: false, interactive: false };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question(question, (value) => {
      rl.close();
      resolve(value);
    });
  });
  const normalized = String(answer || '').trim().toLowerCase();
  return {
    answered: normalized === 'y' || normalized === 'yes',
    interactive: true,
  };
};

const isNotFullyMergedError = (error) => {
  return typeof error === 'string' && error.toLowerCase().includes('not fully merged');
};

const deleteBranch = async (branch, { isDryRun }) => {
  if (isDryRun) {
    log.info(`Would delete '${branch}'.`);
    return true;
  }

  try {
    await execGit(['branch', '-d', branch]);
    log.success(`Deleted '${branch}'.`);
    return true;
  } catch (error) {
    if (!isNotFullyMergedError(error)) {
      log.error(`Failed to delete '${branch}': ${error}`);
      return false;
    }

    log.warn(`'${branch}' is not fully merged into HEAD (common after squash/rebase merges). Force-deleting because its remote is gone or deletion was confirmed.`);
    try {
      await execGit(['branch', '-D', branch]);
      log.success(`Force-deleted '${branch}'.`);
      return true;
    } catch (forceError) {
      log.error(`Failed to force-delete '${branch}': ${forceError}`);
      return false;
    }
  }
};

const deleteBranches = async (branches, { isDryRun }) => {
  let deleted = 0;
  for (const branch of branches) {
    log.info(`Deleting '${branch}' ...`);
    if (await deleteBranch(branch, { isDryRun })) deleted += 1;
  }
  return deleted;
};

module.exports = async (args = []) => {
  log.info('Starting local branch cleanup ...');
  if (args.length) {
    log.info(`with arguments: ${args.join(' ')}`);
  }
  const { isDryRun, isForce } = getFlags(args);

  try {
    const branchStdout = await execGit([
      'for-each-ref',
      '--format=%(HEAD)|%(refname:short)|%(upstream:short)|%(upstream:track)',
      'refs/heads',
    ]);
    const branches = parseBranchRefs(branchStdout);
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
    const refreshedBranches = parseBranchRefs(refreshedStdout);

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

    let branchesToDelete = [...gone];

    if (localOnly.length) {
      if (isForce) {
        log.warn('Including local-only branches because --force was set.');
        branchesToDelete = branchesToDelete.concat(localOnly);
      } else if (isDryRun) {
        log.info('Dry run: local-only branches would require confirmation before deletion.');
      } else {
        const { answered, interactive } = await promptYesNo(
          `Delete ${localOnly.length} local-only branch(es) as well? [y/N] `,
        );
        if (answered) {
          branchesToDelete = branchesToDelete.concat(localOnly);
        } else if (!interactive) {
          log.warn('Skipping local-only branches (no interactive TTY). Re-run with -f/--force to delete them.');
        } else {
          log.info('Skipping local-only branches.');
        }
      }
    }

    if (!branchesToDelete.length) {
      log.info('Nothing to delete.');
      return;
    }

    const deleted = await deleteBranches(branchesToDelete, { isDryRun });
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
