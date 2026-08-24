#!/usr/bin/env node
// The entry point. Everything it does is in `src/cli.js`, which takes its argv, its streams,
// and its reader as arguments — so the command is testable as a function rather than only as
// a process.

import process from 'node:process';
import { run } from '../src/cli.js';

process.exitCode = await run({ argv: process.argv.slice(2) });
