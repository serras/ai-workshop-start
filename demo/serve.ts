// The web view on the demo's fake GitHub: `node demo/serve.ts [port]`, 3100 by default.
import { startWeb } from '../src/web.ts';
import { open } from './source.ts';

const web = await startWeb({ open, port: Number(process.argv[2] ?? 3100) });
console.log(`Skill Atlas demo at ${web.url}`);
