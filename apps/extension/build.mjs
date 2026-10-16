// 构建插件：dist/chrome（Chrome/Edge，可「加载已解压的扩展程序」）、dist/firefox，以及上传商店用的 zip
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildManifest, webMatchesFor } from './manifest.mjs';
import { zipDirectory } from './zip.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const WEB_URL = process.env.SFF_WEB_URL || 'https://messixpro.github.io/spoiler-free-football/';
// 网页地址（SFF_WEB_URL）本身一定在桥接脚本的匹配范围里；SFF_WEB_MATCHES 可以再加别的地址
const WEB_MATCHES = webMatchesFor(WEB_URL, process.env.SFF_WEB_MATCHES);

// 从 core 里读出遮罩 CSS 和站点域名，保证插件和用户脚本用的是同一份
const infoFile = join(dist, '.build-info.mjs');
mkdirSync(dist, { recursive: true });
await build({
  stdin: {
    contents: `export { CLOAK_CSS } from '@sff/core/dom'; export { DEFAULT_SITE_RULES_JSON } from '@sff/core';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: infoFile,
  logLevel: 'silent',
});
const info = await import(pathToFileURL(infoFile).href + `?t=${Date.now()}`);
rmSync(infoFile);

const hosts = [...new Set(info.DEFAULT_SITE_RULES_JSON.sites.flatMap((s) => s.hosts))];
const SITE_MATCHES = hosts.map((h) => `*://*.${h}/*`);

const entries = [
  'content',
  'bridge',
  'background',
  'popup',
  'options',
  'shadow-hook',
  'global-flag',
];

for (const target of ['chrome', 'firefox']) {
  const out = join(dist, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: Object.fromEntries(entries.map((e) => [e, join(root, 'src', `${e}.ts`)])),
    bundle: true,
    format: 'iife',
    target: target === 'chrome' ? 'chrome111' : 'firefox128',
    outdir: out,
    minify: false,
    legalComments: 'none',
    define: {
      __SFF_WEB_URL__: JSON.stringify(WEB_URL),
      __SFF_SITE_MATCHES__: JSON.stringify(SITE_MATCHES),
      __SFF_WEB_MATCHES__: JSON.stringify(WEB_MATCHES),
    },
    logLevel: 'warning',
  });
  cpSync(join(root, 'static'), out, { recursive: true });
  writeFileSync(join(out, 'cloak.css'), `${info.CLOAK_CSS}\n`);
  writeFileSync(
    join(out, 'manifest.json'),
    `${JSON.stringify(
      buildManifest(target, {
        version: pkg.version,
        siteMatches: SITE_MATCHES,
        webMatches: WEB_MATCHES,
      }),
      null,
      2,
    )}\n`,
  );
  const zip = join(dist, `spoiler-free-football-${target}-${pkg.version}.zip`);
  zipDirectory(out, zip);
  console.log(`✓ ${relative(process.cwd(), out)}  →  ${relative(process.cwd(), zip)}`);
}
