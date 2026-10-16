// 构建插件：dist/chrome（Chrome/Edge，可「加载已解压的扩展程序」）、dist/firefox，以及上传商店用的 zip
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipDirectory } from './zip.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const WEB_URL = process.env.SFF_WEB_URL || 'https://messixpro.github.io/spoiler-free-football/';
const WEB_MATCHES = (
  process.env.SFF_WEB_MATCHES ||
  [
    'https://messixpro.github.io/spoiler-free-football/*',
    'https://spoiler-free-football.pages.dev/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ].join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
const webOrigins = [...new Set(WEB_MATCHES.map((m) => m.replace(/^(\w+:\/\/[^/]+).*$/, '$1/*')))];

function manifest(target) {
  const m = {
    manifest_version: 3,
    name: '防剧透看球',
    short_name: '防剧透',
    version: pkg.version,
    description:
      '看录像前不被剧透：在咪咕、央视频、CCTV、爱奇艺、腾讯视频、B站、懂球帝、直播吧、虎扑上隐藏比分、结果、时长和评论。',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: '防剧透看球',
      default_popup: 'popup.html',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    },
    options_ui: { page: 'options.html', open_in_tab: true },
    permissions: ['storage', 'alarms', 'scripting'],
    host_permissions: [...SITE_MATCHES, ...webOrigins],
    optional_host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: SITE_MATCHES,
        js: ['content.js'],
        css: ['cloak.css'],
        run_at: 'document_start',
        all_frames: true,
      },
      {
        matches: SITE_MATCHES,
        js: ['shadow-hook.js'],
        run_at: 'document_start',
        all_frames: true,
        world: 'MAIN',
      },
      { matches: WEB_MATCHES, js: ['bridge.js'], run_at: 'document_start' },
    ],
  };
  if (target === 'chrome') {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '111';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: { id: 'spoiler-free-football@messixpro.github.io', strict_min_version: '128.0' },
    };
  }
  return m;
}

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
    },
    logLevel: 'warning',
  });
  cpSync(join(root, 'static'), out, { recursive: true });
  writeFileSync(join(out, 'cloak.css'), `${info.CLOAK_CSS}\n`);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest(target), null, 2)}\n`);
  const zip = join(dist, `spoiler-free-football-${target}-${pkg.version}.zip`);
  zipDirectory(out, zip);
  console.log(`✓ ${relative(process.cwd(), out)}  →  ${relative(process.cwd(), zip)}`);
}
