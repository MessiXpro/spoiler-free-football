// 构建用户脚本：dist/spoiler-free-football.user.js（支持的站点）和 -global.user.js（全网防剧透版）
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FALLBACK_JS, GUARD_JS } from './guard.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// 部署时（deploy.yml）传入脚本和 core 最后一次改动的提交时间，作为 @version 的第 4 段：脚本管理器只在版本号变大时
// 才更新已安装的脚本，否则每天重新部署的脚本（含识别规则的修复）永远到不了用户那里。
// 打 v* 标签发布（release.yml）不传，仍是 x.y.z（0.2.1 仍大于 0.2.0.1792816139）
const stamp = (process.env.SFF_BUILD_STAMP ?? '').trim();
if (stamp && !/^\d{1,10}$/.test(stamp)) throw new Error('SFF_BUILD_STAMP 必须是数字（提交时间戳）');

const WEB_URL = process.env.SFF_WEB_URL || 'https://messixpro.github.io/spoiler-free-football/';
// 正式构建（SFF_RELEASE=1）不带本机开发地址
const RELEASE = process.env.SFF_RELEASE === '1';
const DEV_PREFIXES = RELEASE ? [] : ['http://localhost:', 'http://127.0.0.1:'];
const WEB_PREFIXES = (
  process.env.SFF_WEB_PREFIXES ||
  [WEB_URL, 'https://spoiler-free-football.pages.dev/', ...DEV_PREFIXES].join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const infoFile = join(dist, '.build-info.mjs');
await build({
  stdin: {
    contents: `export { DEFAULT_SITE_RULES_JSON } from '@sff/core';`,
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
const { rmSync } = await import('node:fs');
rmSync(infoFile);
const hosts = [...new Set(info.DEFAULT_SITE_RULES_JSON.sites.flatMap((s) => s.hosts))];

const webMatches = [
  `${WEB_URL}*`,
  'https://spoiler-free-football.pages.dev/*',
  ...(RELEASE ? [] : ['http://localhost/*', 'http://127.0.0.1/*']),
];
const connectHosts = [
  ...new Set([
    new URL(WEB_URL).hostname,
    'spoiler-free-football.pages.dev',
    ...(RELEASE ? [] : ['localhost', '127.0.0.1']),
  ]),
];

function header(variant) {
  const global = variant === 'global';
  const lines = [
    '// ==UserScript==',
    `// @name         ${global ? '防剧透看球（全网版）' : '防剧透看球'}`,
    '// @namespace    https://github.com/MessiXpro/spoiler-free-football',
    `// @version      ${pkg.version}${stamp ? '.' + stamp : ''}`,
    `// @description  ${
      global
        ? '在设定时段对所有网站隐藏比分和结果词；支持的视频/资讯网站另有专门规则。'
        : '看录像前不被剧透：在咪咕、央视频、CCTV、爱奇艺、腾讯视频、B站、懂球帝、直播吧、虎扑上隐藏比分、结果、时长、弹幕和评论。'
    }`,
    '// @author       spoiler-free-football',
    '// @homepageURL  https://github.com/MessiXpro/spoiler-free-football',
    `// @updateURL    ${WEB_URL}userscript/spoiler-free-football${global ? '-global' : ''}.user.js`,
    `// @downloadURL  ${WEB_URL}userscript/spoiler-free-football${global ? '-global' : ''}.user.js`,
    ...(global ? ['// @match        *://*/*'] : hosts.map((h) => `// @match        *://*.${h}/*`)),
    ...(global ? [] : webMatches.map((m) => `// @match        ${m}`)),
    '// @run-at       document-start',
    '// @grant        GM_getValue',
    '// @grant        GM_setValue',
    '// @grant        GM.getValue',
    '// @grant        GM.setValue',
    '// @grant        GM_addValueChangeListener',
    '// @grant        GM_registerMenuCommand',
    '// @grant        GM_xmlhttpRequest',
    '// @grant        GM.xmlHttpRequest',
    '// @grant        unsafeWindow',
    ...connectHosts.map((h) => `// @connect      ${h}`),
    '// @license      MIT',
    '// ==/UserScript==',
    '',
  ];
  return lines.join('\n');
}

for (const variant of ['sites', 'global']) {
  const name =
    variant === 'global' ? 'spoiler-free-football-global.user.js' : 'spoiler-free-football.user.js';
  const result = await build({
    entryPoints: [join(root, 'src', 'main.ts')],
    bundle: true,
    format: 'iife',
    target: ['chrome90', 'safari15', 'firefox90'],
    write: false,
    legalComments: 'none',
    // 旧浏览器兜底：整个脚本包在兼容性检查里（见 guard.mjs）
    banner: { js: GUARD_JS },
    footer: { js: FALLBACK_JS },
    define: {
      __SFF_WEB_URL__: JSON.stringify(WEB_URL),
      __SFF_WEB_PREFIXES__: JSON.stringify(WEB_PREFIXES),
      __SFF_VARIANT__: JSON.stringify(variant),
    },
    logLevel: 'warning',
  });
  writeFileSync(join(dist, name), header(variant) + result.outputFiles[0].text);
  console.log(`✓ dist/${name}`);
}
