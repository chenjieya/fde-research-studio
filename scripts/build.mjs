import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
for (const path of ['index.html', 'src', 'assets']) await cp(new URL(path, root), new URL(`dist/${path}`, root), { recursive: true });
console.log('构建完成：dist/，纯静态产物，无运行时依赖。');
