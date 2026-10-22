// 把用户脚本和插件 zip 放进网页构建产物，一起部署：
//   <网页>/userscript/spoiler-free-football.user.js
//   <网页>/downloads/spoiler-free-football-chrome-<版本>.zip
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const site = join(root, 'apps', 'web', 'dist');
if (!existsSync(site)) throw new Error('先运行 pnpm --filter @sff/web build');

const us = join(root, 'apps', 'userscript', 'dist');
mkdirSync(join(site, 'userscript'), { recursive: true });
for (const f of readdirSync(us).filter((f) => f.endsWith('.user.js')))
  cpSync(join(us, f), join(site, 'userscript', f));

const ext = join(root, 'apps', 'extension', 'dist');
mkdirSync(join(site, 'downloads'), { recursive: true });
for (const f of readdirSync(ext).filter((f) => f.endsWith('.zip'))) {
  cpSync(join(ext, f), join(site, 'downloads', f));
  // 再放一份不带版本号的，方便网页里用固定链接
  cpSync(join(ext, f), join(site, 'downloads', f.replace(/-\d+\.\d+\.\d+\.zip$/, '.zip')));
}

// Cloudflare Pages：允许插件/用户脚本跨域读取数据（GitHub Pages 默认就允许）
writeFileSync(
  join(site, '_headers'),
  [
    '/data/*',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: no-cache',
    '/userscript/*',
    '  Access-Control-Allow-Origin: *',
    '  Content-Type: text/javascript; charset=utf-8',
    '',
  ].join('\n'),
);
// 404 页面「回到首页」要指向网页根目录（可能在子目录下），构建时填进去；本地构建没有地址就用相对路径
const notFound = join(site, '404.html');
if (existsSync(notFound)) {
  const home = process.env.SFF_WEB_URL ? `${process.env.SFF_WEB_URL.replace(/\/+$/, '')}/` : './';
  writeFileSync(notFound, readFileSync(notFound, 'utf8').replaceAll('__SFF_WEB_URL__', home));
}
// GitHub Pages 不要用 Jekyll 处理
writeFileSync(join(site, '.nojekyll'), '');
console.log('✓ 已把用户脚本和插件 zip 放进', site);
