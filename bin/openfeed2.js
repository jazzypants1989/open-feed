#!/usr/bin/env node
import { main } from '../src2/cli.js';
process.exitCode = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr });
