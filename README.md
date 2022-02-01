# git-cleanup
A Node.js script that removes local branches that don't exist on remote anymore.

## Installation
Register the script as a global module:

`npm i -g ./`

(make sure you're in this repository's root folder)

## Usage
Execute `git-cleanup`, that's it.
It will cleanup local branches from your current working directory (only if it's a valid git repository of course).

## Notes
Note that since we only provided a local install path npm created a symlink to this folder. That means changes to this script will be reflected immediately, no need to reinstall the module.