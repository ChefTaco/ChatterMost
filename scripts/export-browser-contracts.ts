#!/usr/bin/env node
// Export only product-owned browser-safe contracts, never backend source.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportBrowserAdminContract } from './lib/browser-contract-export.js';
const index = process.argv.indexOf('--output');
const outputArgument = process.argv[index + 1];
if (index < 0 || !outputArgument) throw Error('--output NEW_DIRECTORY is required');
exportBrowserAdminContract(fileURLToPath(new URL('../', import.meta.url)), resolve(outputArgument));
