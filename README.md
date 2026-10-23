# git-cleanup
A Node.js script that removes local branches that don't exist on remote anymore.

## Installation
Register the script as a global module:

`npm i -g ./`

(make sure you're in this repository's root folder)

## Usage
Execute `git-cleanup`, that's it.
It will cleanup local branches from your current working directory (only if it's a valid git repository of course).

Branches whose remote counterpart is gone are deleted automatically (including
squash- or rebase-merged branches), unless the local branch was ahead of its
remote before pruning (i.e. had unpushed local commits), in which case the CLI
asks for confirmation before force-deleting it. For each local-only branch, the
CLI also asks whether it should be deleted:

```text
Delete local-only branch 'my-work'? [y/N]
```

Answer `y` (or `yes`) to delete it. Press Enter (or answer `n`) to keep that
individual branch. In non-interactive shells, local-only and unmerged branches
are kept by default. Use `-f` or `--force` to delete all local-only and unmerged
branches without prompting, `--dry-run` to preview what would be deleted
without modifying the repository, and `-h` or `--help` to display usage
information and exit.

## Notes
Note that since we only provided a local install path npm created a symlink to this folder. That means changes to this script will be reflected immediately, no need to reinstall the module.
