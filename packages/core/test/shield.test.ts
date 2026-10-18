// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SpoilerShield, installCloak, revealPage } from '../src/dom/index.ts';
import { ATTR_CARD, ATTR_HIDE, CLASS_FOOTBALL, CLASS_READY } from '../src/dom/css.ts';
import { DEFAULT_SITE_RULES_JSON, hasSpoiler, matchSite, validateSiteRules } from '../src/index.ts';

const rules = validateSiteRules(DEFAULT_SITE_RULES_JSON)!;
const bilibili = matchSite(rules, 'www.bilibili.com')!;

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(html: string, title = '') {
  document.head.innerHTML = `<title>${title}</title>`;
  document.body.innerHTML = html;
  document.documentElement.className = '';
}

let shield: SpoilerShield | null = null;
afterEach(() => {
  shield?.stop();
  shield = null;
});

describe('SpoilerShield', () => {
  it('遮挡已有文字、属性和标签页标题', () => {
    setup(
      '<h1 class="video-title">【英超】阿森纳 2-1 切尔西 全场集锦</h1><a title="萨卡破门 阿森纳逆转">链接</a><p>普通文字 2026 赛季</p>',
      '阿森纳2-1切尔西_哔哩哔哩_bilibili',
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(document.querySelector('h1')!.textContent).toBe('【英超】阿森纳 ■-■ 切尔西 全场集锦');
    expect(hasSpoiler(document.querySelector('a')!.getAttribute('title')!)).toBe(false);
    expect(document.title).toBe('阿森纳■-■切尔西_哔哩哔哩_bilibili');
    expect(document.querySelector('p')!.textContent).toBe('普通文字 2026 赛季');
    expect(document.documentElement.classList.contains(CLASS_FOOTBALL)).toBe(true);
  });

  it('处理动态插入的内容（滚动加载、评论、弹幕）', async () => {
    setup('<div id="list"></div>', '英超集锦');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    const div = document.createElement('div');
    div.textContent = '曼城 3:0 伊普斯维奇，哈兰德帽子戏法';
    document.getElementById('list')!.appendChild(div);
    await tick();
    expect(hasSpoiler(div.textContent!, { football: true })).toBe(false);
    // 修改已有文字
    div.firstChild!.textContent = '利物浦2比1埃弗顿';
    await tick();
    expect(div.textContent).toBe('利物浦■-■埃弗顿');
  });

  it('处理标题被脚本改写', async () => {
    setup('', '首页');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    document.title = '皇马 2-1 巴萨 国家德比';
    await tick();
    expect(document.title).toBe('皇马 ■-■ 巴萨 国家德比');
    expect(document.documentElement.classList.contains(CLASS_FOOTBALL)).toBe(true);
  });

  it('拆成多个元素的比分整体隐藏', () => {
    setup(
      '<div class="board"><span>阿森纳</span><b>2</b><i>-</i><b>1</b><span>切尔西</span></div>',
      '英超',
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(document.querySelector('.board')!.hasAttribute(ATTR_HIDE)).toBe(true);
  });

  it('首页信息流：只给足球卡片换封面，不影响其他卡片', () => {
    setup(
      `<div class="bili-video-card" id="a"><div class="bili-video-card__image"><img src="x.jpg"></div><h3 class="bili-video-card__info--tit">阿森纳 vs 切尔西 全场回放</h3></div>
       <div class="bili-video-card" id="b"><div class="bili-video-card__image"><img src="y.jpg"></div><h3 class="bili-video-card__info--tit">今天做什么菜</h3></div>`,
      '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili',
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(document.getElementById('a')!.hasAttribute(ATTR_CARD)).toBe(true);
    expect(document.getElementById('b')!.hasAttribute(ATTR_CARD)).toBe(false);
    expect(document.documentElement.classList.contains(CLASS_FOOTBALL)).toBe(false);
  });

  it('非足球页面不遮语境词', () => {
    setup('<p>We won the hackathon</p>', '编程日记');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(document.querySelector('p')!.textContent).toBe('We won the hackathon');
  });

  it('暂停后恢复原文，继续后重新遮挡', () => {
    setup('<p>阿森纳 2-1 切尔西</p>', '英超');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(document.querySelector('p')!.textContent).toBe('阿森纳 ■-■ 切尔西');
    shield.pause();
    expect(document.querySelector('p')!.textContent).toBe('阿森纳 2-1 切尔西');
    shield.resume();
    expect(document.querySelector('p')!.textContent).toBe('阿森纳 ■-■ 切尔西');
  });

  it('全网模式（无站点规则）也做文字识别', () => {
    setup('<p>Arsenal 2-1 Chelsea</p>', 'News');
    shield = new SpoilerShield(document, { site: null });
    shield.start();
    expect(document.querySelector('p')!.textContent).toBe('Arsenal ■-■ Chelsea');
  });

  it('open shadow root 里的文字也处理', async () => {
    setup('<div id="host"></div>', '英超');
    const host = document.getElementById('host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>哈兰德梅开二度</p>';
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(root.querySelector('p')!.textContent).not.toContain('梅开二度');
    const p = document.createElement('p');
    p.textContent = '曼城 3-0';
    root.appendChild(p);
    await tick();
    expect(p.textContent).toBe('曼城 ■-■');
  });

  it('遮罩与显示', () => {
    setup('', '');
    installCloak(document);
    expect(document.getElementById('sff-cloak')).not.toBeNull();
    revealPage(document);
    expect(document.documentElement.classList.contains(CLASS_READY)).toBe(true);
  });

  it('生成的样式只包含规则里的选择器', () => {
    setup('', '英超');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    const css = document.getElementById('sff-shield-style')!.textContent!;
    expect(css).toContain('.bpx-player-ctrl-time-duration');
    expect(css).toContain('#danmukuBox');
    expect(css).toContain('bili-comments');
  });

  it('关闭某类遮挡后不生成对应样式', () => {
    setup('', '英超');
    shield = new SpoilerShield(document, {
      site: bilibili,
      prefs: {
        hide: {
          duration: true,
          progress: true,
          danmaku: false,
          comments: true,
          recommend: true,
          scoreboard: true,
        },
      },
    });
    shield.start();
    const css = document.getElementById('sff-shield-style')!.textContent!;
    expect(css).not.toContain('#danmukuBox');
  });
});
