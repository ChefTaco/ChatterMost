import { createServerApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
await createServerApp(env);
process.stdout.write('ChatterMost seed complete\n');
