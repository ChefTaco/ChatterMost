import { readFileSync, writeFileSync } from 'node:fs';
import { buildBrowserChatOpenApi } from '../src/shared/browser-chat.js';
const text = JSON.stringify(buildBrowserChatOpenApi(), null, 2) + '\n',
  file = new URL('../docs/openapi-browser.json', import.meta.url);
if (process.argv.includes('--write')) writeFileSync(file, text);
else if (readFileSync(file, 'utf8') !== text)
  throw Error('Browser OpenAPI drift; regenerate and review');
