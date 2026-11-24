import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
async function check(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const target = new URL(file.name + (file.isDirectory() ? '/' : ''), dir);
    if (file.isDirectory()) await check(target);
    else if (/\.(js|mjs)$/.test(file.name)) {
      const result = spawnSync(process.execPath, ['--check', fileURLToPath(target)], { encoding: 'utf8' });
      if (result.status !== 0) { console.error(result.stderr); process.exitCode = 1; }
    }
  }
}
await check(new URL('src/', root)); await check(new URL('scripts/', root));
if (!process.exitCode) console.log('所有 JavaScript 模块语法检查通过。');
