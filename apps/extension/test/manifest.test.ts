import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS 构建脚本
import { buildManifest, DEFAULT_WEB_MATCHES, webMatchesFor } from '../manifest.mjs';

type Manifest = {
  host_permissions: string[];
  content_scripts: Array<{ matches: string[]; js: string[] }>;
  browser_specific_settings?: {
    gecko: { id: string; data_collection_permissions?: { required: string[] } };
  };
};

const SITE = ['*://*.bilibili.com/*'];
const manifestFor = (target: 'chrome' | 'firefox', webUrl: string, extra?: string) =>
  buildManifest(target, {
    version: '0.1.0',
    siteMatches: SITE,
    webMatches: webMatchesFor(webUrl, extra),
  }) as Manifest;
const bridgeMatches = (m: Manifest) => m.content_scripts.find((c) => c.js.includes('bridge.js'))!;

describe('防剧透网页的匹配地址', () => {
  it('换了网页地址（自定义域名、国内对象存储、fork）后，桥接脚本和权限跟着新地址走', () => {
    const m = manifestFor('chrome', 'https://football.example.cn/');
    expect(bridgeMatches(m).matches).toContain('https://football.example.cn/*');
    expect(m.host_permissions).toContain('https://football.example.cn/*');
    // 默认地址仍然保留
    expect(bridgeMatches(m).matches).toEqual(expect.arrayContaining(DEFAULT_WEB_MATCHES));

    const fork = manifestFor('chrome', 'https://someone.github.io/spoiler-free-football/');
    expect(bridgeMatches(fork).matches).toContain(
      'https://someone.github.io/spoiler-free-football/*',
    );
  });

  it('match pattern 不带端口，路径取到最后一个 /；设置了 SFF_WEB_MATCHES 也包含网页地址', () => {
    expect(webMatchesFor('http://localhost:5173/app/index.html')).toContain(
      'http://localhost/app/*',
    );
    const list = webMatchesFor('https://cdn.example.cn/sff/', 'https://a.example/*');
    expect(list).toEqual(['https://cdn.example.cn/sff/*', 'https://a.example/*']);
    // 默认地址不重复
    const def = webMatchesFor('https://messixpro.github.io/spoiler-free-football/');
    expect(def).toEqual(DEFAULT_WEB_MATCHES);
  });
});

describe('Firefox manifest', () => {
  it('声明不收集数据（addons.mozilla.org 签名要求）', () => {
    const m = manifestFor('firefox', 'https://messixpro.github.io/spoiler-free-football/');
    expect(m.browser_specific_settings?.gecko.data_collection_permissions).toEqual({
      required: ['none'],
    });
    expect(manifestFor('chrome', 'https://x.example/').browser_specific_settings).toBeUndefined();
  });
});
