# git-cleanup
A Node.js script that removes local branches that don't exist on remote anymore.

## Installation
The idea is to register this script as a global npm module:
`npm i -g ./`

## Usage
Execute `git-cleanup`, that's it.
It will cleanup local branches from your current working directory (only if it's a valid git repository of course).

## Notes
Note that since we only provided a local install path npm created a symlink to this folder. That means changes to this script will be reflected immediately, no need to reinstall the module.