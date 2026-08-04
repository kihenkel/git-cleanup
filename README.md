# git-cleanup
A Node.js script that removes local branches that don't exist on remote anymore.

## Installation
Register the script as a global module:

`npm i -g ./`

(make sure you're in this repository's root folder)

## Usage
Execute `git-cleanup`, that's it.
It will cleanup local branches from your current working directory (only if it's a valid git repository of course).

Branches whose remote counterpart is gone are deleted automatically. For each
local-only branch, the CLI asks whether it should be deleted:

```text
Delete local-only branch 'my-work'? [Y/n]
```

Press Enter (or answer `y`) to delete it. Answer `n` to keep that individual
branch. Use `-f` or `--force` to accept deletion of all local-only branches
without prompting, and `--dry-run` to preview the default delete-all selection.

## Notes
Note that since we only provided a local install path npm created a symlink to this folder. That means changes to this script will be reflected immediately, no need to reinstall the module.
