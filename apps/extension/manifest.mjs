// 插件 manifest 和防剧透网页的匹配规则（build.mjs 用；单独放一个文件，方便单元测试）

/** 默认部署地址（GitHub Pages、Cloudflare Pages、本地开发） */
export const DEFAULT_WEB_MATCHES = [
  'https://messixpro.github.io/spoiler-free-football/*',
  'https://spoiler-free-football.pages.dev/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
];

/** 网页地址 → match pattern：match pattern 不能带端口，路径取到最后一个 / */
export function webUrlPattern(webUrl) {
  const u = new URL(webUrl);
  return `${u.protocol}//${u.hostname}${u.pathname.replace(/[^/]*$/, '')}*`;
}

/**
 * 防剧透网页的 match pattern：构建时的 SFF_WEB_URL 一定包含在内，
 * 换了域名（国内对象存储、自定义域名）或 fork 到别的账号后，桥接脚本照样能注入。
 * extra 是逗号分隔的额外地址（环境变量 SFF_WEB_MATCHES），不设时用默认地址。
 */
export function webMatchesFor(webUrl, extra) {
  const list = (extra || DEFAULT_WEB_MATCHES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([webUrlPattern(webUrl), ...list])];
}

/** match pattern → 整个源（host_permissions 用） */
export function originsFor(matches) {
  return [...new Set(matches.map((m) => m.replace(/^(\w+:\/\/[^/]+).*$/, '$1/*')))];
}

/** target: 'chrome' | 'firefox' */
export function buildManifest(target, { version, siteMatches, webMatches }) {
  const m = {
    manifest_version: 3,
    name: '防剧透看球',
    short_name: '防剧透',
    version,
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
    host_permissions: [...siteMatches, ...originsFor(webMatches)],
    optional_host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: siteMatches,
        js: ['content.js'],
        css: ['cloak.css'],
        run_at: 'document_start',
        all_frames: true,
      },
      {
        matches: siteMatches,
        js: ['shadow-hook.js'],
        run_at: 'document_start',
        all_frames: true,
        world: 'MAIN',
      },
      { matches: webMatches, js: ['bridge.js'], run_at: 'document_start' },
    ],
  };
  if (target === 'chrome') {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '111';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: 'spoiler-free-football@messixpro.github.io',
        strict_min_version: '128.0',
        // 2025-11 起 addons.mozilla.org 要求新插件声明收集哪些数据（签名、上架都会检查）。
        // 插件只下载公开的规则和比分文件，不收集、不上传任何用户数据
        data_collection_permissions: { required: ['none'] },
      },
    };
  }
  return m;
}
