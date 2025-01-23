const { exec: doExec } = require('child_process');

const exec = (command, { ignoreStderr } = { ignoreStderr: false }) => {
  return new Promise((resolve, reject) => {
    doExec(command, (error, stdout, stderr) => {
      if (error) return reject(`Error: ${error.message}`);
      if (stderr && !ignoreStderr) return reject(`Stderr: ${stderr}`);
      resolve(stdout);
    });
  });
};

const MAIN_BRANCH_NAMES = ['master', 'main', 'develop'];

const getFlags = (arguments) => {
  const isDryRun = !!arguments?.includes('--dry-run');
  if (isDryRun) {
    console.log('  [--dry-run] Doing dry run! Will not delete any branches.');
  }
  const isForce = !!arguments?.includes('-f') || !!arguments?.includes('--force');
  if (isForce) {
    console.log('  [-f, --force] Forcing deletion of branches!');
  }
  return { isDryRun, isForce };
}

const sanitizeBranchOutput = (output) => output
    .split('\n')
    .map((str) => str.replace(/\s/g, ''))
    .filter((str) => str);

const asCurrentBranch = (branch) => `*${branch}`;
const isRemoteBranch = (localBranch, remoteBranchRaw) => {
  const remoteBranch = remoteBranchRaw.replace('origin/', '');
  return remoteBranch === localBranch || remoteBranch === asCurrentBranch(localBranch);
};

module.exports = async (arguments) => {
  console.log('Starting local branch cleanup ...');
  if (arguments?.length) {
    console.log('  with arguments:', arguments);
  }
  const { isDryRun, isForce } = getFlags(arguments);
  try {
    const localStdout = await exec('git branch');
    const localBranches = sanitizeBranchOutput(localStdout);
    const foundMainBranches = MAIN_BRANCH_NAMES.filter((branch) => localBranches.includes(branch) || localBranches.includes(`*${branch}`));
    if (foundMainBranches.length > 1) {
      console.log('Multiple main branches detected:', foundMainBranches.join(', '));
    } else if (foundMainBranches.length === 1) {
      console.log('Main branch detected:', foundMainBranches[0]);
    } else {
      console.log('No main branch detected! Aborting ...');
      return;
    }

    const currentBranch = localBranches.find(localBranch => localBranch.includes('*'));
    if (foundMainBranches.every((mainBranchName) => currentBranch !== `*${mainBranchName}`)) {
      console.log(`Not on a main branch! Switch to one of the following branches first and then try again: ${foundMainBranches.join(', ')}`);
      return;
    }
    await exec('git fetch -p', { ignoreStderr: true });
    const remoteStdout = await exec('git branch -r');
    const remoteBranches = sanitizeBranchOutput(remoteStdout);
    const branchesToDelete = localBranches.filter((localBranch) => {
      return remoteBranches.every((remoteBranch) => !isRemoteBranch(localBranch, remoteBranch)) && localBranch !== currentBranch && !MAIN_BRANCH_NAMES.includes(localBranch);
    });
    if (!branchesToDelete.length) {
      console.log('No local branches need to be deleted.');
      return;
    }
    let deletedBranches = 0;
    await branchesToDelete.reduce((currentPromise, branch) => {
      return currentPromise
        .then(() => {
          console.log(`Deleting ${branch} ...`);
          const deleteBranchCommand = `git branch ${isForce ? '-D' : '-d'} ${branch}`;
          if (isDryRun) {
            console.log(`DRY RUN: Would execute '${deleteBranchCommand}' now.`);
            return Promise.resolve();
          }
          return exec(deleteBranchCommand)
            .then(() => {
              deletedBranches++;
            })
            .catch((error) => {
              if (typeof error === 'string' && error.includes('not fully merged')) {
                console.error(`ERROR: Local branch ${branch} is not fully identical with one of the main branches (${foundMainBranches.join(', ')}). This can happen after a rebase, squash on merge or if your current branch is not fully up-to-date. Try again with -f or --force to delete branch anyway.`);
                return;
              }
              console.error(error);
            });
        });
    }, Promise.resolve());
    console.log(`Deleted ${deletedBranches} out of ${branchesToDelete.length} local branches!`);
  } catch (error) {
    console.error('Git cleanup failed:', error);
  }
};
