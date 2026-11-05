import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportBrowserChatContract } from './lib/browser-contract-export.js';
const index = process.argv.indexOf('--output'),
  output = process.argv[index + 1];
if (index < 0 || !output) throw Error('--output NEW_DIRECTORY required');
exportBrowserChatContract(fileURLToPath(new URL('../', import.meta.url)), resolve(output));
