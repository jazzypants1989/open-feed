#!/usr/bin/env node
// The shim: argv in, exit code out. Everything worth testing lives in src/cli.js, which takes its
// streams as arguments — this is the only place the real ones are supplied.
import { main } from '../src/cli.js';

process.exitCode = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr });
