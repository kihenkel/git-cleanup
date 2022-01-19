#!/usr/bin/env node

const gitCleanup = require('../lib/git-cleanup');

const [, , ...arguments] = process.argv;
gitCleanup(arguments);