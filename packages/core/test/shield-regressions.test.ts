// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { SpoilerShield, buildShieldCss, installShadowHook, revealPage } from '../src/dom/index.ts';
import { ATTR_CARD, ATTR_HIDE, CLASS_FOOTBALL, CLASS_ON, CLASS_READY } from '../src/dom/css.ts';
import { DEFAULT_SITE_RULES_JSON, matchSite, validateSiteRules } from '../src/index.ts';

const rules = validateSiteRules(DEFAULT_SITE_RULES_JSON)!;
const bilibili = matchSite(rules, 'www.bilibili.com')!;
const dongqiudi = matchSite(rules, 'www.dongqiudi.com')!;
const hupu = matchSite(rules, 'bbs.hupu.com')!;

const tick = () => new Promise((r) => setTimeout(r, 0));
const html = () => document.documentElement.classList;

function setup(body: string, title = '') {
  document.head.innerHTML = `<title>${title}</title>`;
  document.body.innerHTML = body;
  document.documentElement.className = '';
}

let shield: SpoilerShield | null = null;
afterEach(() => {
  shield?.stop();
  shield = null;
});

/** 生成的样式里，作用在 el 上、且声明里含 decl 的规则 */
function matchingRules(css: string, el: Element, decl: string): string[] {
  return css
    .split('\n')
    .filter((line) => line.includes(decl))
    .filter((line) => {
      try {
        return el.matches(line.slice(0, line.indexOf('{')));
      } catch {
        return false;
      }
    });
}

describe('封面选择器直接命中 <img>', () => {
  it('懂球帝新闻缩略图、虎扑帖子图片本身也被替换', () => {
    document.documentElement.className = `${CLASS_ON} ${CLASS_FOOTBALL}`;
    document.body.innerHTML =
      '<div class="news-list"><a><img id="i" src="thumb.jpg"></a></div>' +
      '<ul><li><img id="c" class="cover-img" src="c.jpg"></li></ul>' +
      '<div class="thread-content-detail"><p><img id="h" src="h.jpg"></p></div>' +
      '<div class="other"><img id="o" src="o.jpg"></div>';
    const dqd = buildShieldCss(dongqiudi);
    const img = document.getElementById('i')!;
    expect(matchingRules(dqd, img, 'object-position')).toHaveLength(1);
    expect(matchingRules(dqd, document.getElementById('c')!, 'object-position')).toHaveLength(1);
    expect(
      matchingRules(buildShieldCss(hupu), document.getElementById('h')!, 'object-position'),
    ).toHaveLength(1);
    // 无关图片不受影响
    expect(matchingRules(dqd, document.getElementById('o')!, 'object-position')).toHaveLength(0);
    expect(matchingRules(dqd, document.getElementById('o')!, 'opacity:0')).toHaveLength(0);
    // 生成的仍是合法 CSS：每一行都能被解析成一条规则
    const style = document.createElement('style');
    style.textContent = dqd;
    document.head.appendChild(style);
    expect(style.sheet!.cssRules.length).toBe(dqd.split('\n').length);
    style.remove();
  });

  it('封面选择器命中 <video> 本身时视频透明', () => {
    document.documentElement.className = `${CLASS_ON} ${CLASS_FOOTBALL}`;
    document.body.innerHTML = '<video id="v" class="cover-video"></video>';
    const css = buildShieldCss(dongqiudi);
    expect(matchingRules(css, document.getElementById('v')!, 'opacity:0')).toHaveLength(1);
  });
});

describe('页面改写 <html class>', () => {
  it('sff-on / sff-fb / sff-ready 被冲掉后自动补回', async () => {
    setup(
      '<div class="sc"><span>2</span><i>-</i><span>1</span></div>',
      '阿森纳 vs 切尔西 英超 全场回放',
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    revealPage(document);
    await tick();
    document.documentElement.className = 'night-mode';
    await tick();
    expect(html().contains('night-mode')).toBe(true);
    expect(html().contains(CLASS_ON)).toBe(true);
    expect(html().contains(CLASS_FOOTBALL)).toBe(true);
    expect(html().contains(CLASS_READY)).toBe(true);
    document.documentElement.setAttribute('class', 'foo');
    await tick();
    expect([...html()].sort()).toEqual(['foo', CLASS_FOOTBALL, CLASS_ON, CLASS_READY].sort());
  });

  it('暂停时不补 sff-on，但页面不会重新变空白', async () => {
    setup('<p>阿森纳 2-1 切尔西</p>', '英超');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    revealPage(document);
    shield.pause();
    await tick();
    expect(html().contains(CLASS_ON)).toBe(false);
    document.documentElement.className = 'dark';
    await tick();
    expect(html().contains(CLASS_ON)).toBe(false);
    expect(html().contains(CLASS_READY)).toBe(true);
    shield.resume();
    await tick();
    expect(html().contains(CLASS_ON)).toBe(true);
  });

  it('非足球页面不会被补上 sff-fb', async () => {
    setup('<p>今天做什么菜</p>', '美食');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    document.documentElement.className = 'x';
    await tick();
    expect(html().contains(CLASS_ON)).toBe(true);
    expect(html().contains(CLASS_FOOTBALL)).toBe(false);
  });

  it('页面也在强制自己的 class 时不会无限互相改写', async () => {
    setup('<p>阿森纳 2-1 切尔西</p>', '英超');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    let fights = 0;
    const page = new MutationObserver(() => {
      if (document.documentElement.className === 'page') return;
      fights++;
      document.documentElement.className = 'page';
    });
    page.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    try {
      document.documentElement.className = 'page';
      await tick();
      await tick();
      expect(fights).toBeGreaterThan(0);
      expect(fights).toBeLessThan(30);
    } finally {
      page.disconnect();
    }
  });
});

describe('嵌套 shadow root', () => {
  it('shadow tree 里的元素后来才 attachShadow，内容也被遮挡', async () => {
    installShadowHook(window as Window & typeof globalThis);
    setup('<div id="outer"></div>', '英超');
    const outerRoot = document.getElementById('outer')!.attachShadow({ mode: 'open' });
    outerRoot.innerHTML = '<div id="inner"></div>';
    await tick();
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    const inner = outerRoot.getElementById('inner')!;
    const innerRoot = inner.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = '<p>阿森纳 2-1 切尔西</p>';
    await tick();
    await tick();
    const p = innerRoot.querySelector('p')!;
    expect(p.textContent).toBe('阿森纳 ■-■ 切尔西');
    p.firstChild!.textContent = '曼城 3-0 利物浦';
    await tick();
    expect(p.textContent).toBe('曼城 ■-■ 利物浦');
  });
});

describe('卡片后填内容', () => {
  const NOT_FOOTBALL = '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili';

  it('骨架卡片后插入足球标题：卡片被标记', async () => {
    setup(
      '<div class="bili-video-card" id="c"><div class="bili-video-card__image"><img></div><div class="info"></div></div>',
      NOT_FOOTBALL,
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    const card = document.getElementById('c')!;
    expect(card.hasAttribute(ATTR_CARD)).toBe(false);
    card.querySelector('.info')!.innerHTML =
      '<h3 class="bili-video-card__info--tit">阿森纳 vs 切尔西 全场回放</h3>';
    await tick();
    expect(card.hasAttribute(ATTR_CARD)).toBe(true);
  });

  it('卡片标题原地改写：卡片被标记，先前的语境词也重新处理', async () => {
    setup(
      '<div class="bili-video-card" id="c"><h3 class="bili-video-card__info--tit">今天做什么菜</h3><p class="d">最后还是领先了</p></div>' +
        '<div class="bili-video-card" id="o"><h3>周末去哪玩</h3></div>',
      NOT_FOOTBALL,
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    const card = document.getElementById('c')!;
    const h3 = card.querySelector('h3')!;
    (h3.firstChild as Text).data = '阿森纳 vs 切尔西 全场回放';
    await tick();
    expect(card.hasAttribute(ATTR_CARD)).toBe(true);
    expect(card.querySelector('.d')!.textContent).toBe('最后还是■■了');
    // 无关卡片改写成非足球内容不受影响
    document.querySelector('#o h3')!.textContent = '周末去爬山';
    await tick();
    expect(document.getElementById('o')!.hasAttribute(ATTR_CARD)).toBe(false);
  });
});

describe('语境元素原地更新', () => {
  it('h1 文字原地改写后重新判断足球语境', async () => {
    setup('<h1 class="video-title">加载中</h1><p id="p">最后还是领先了</p>', '视频');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(html().contains(CLASS_FOOTBALL)).toBe(false);
    (document.querySelector('h1')!.firstChild as Text).data = '阿森纳 vs 切尔西 全场回放';
    await tick();
    expect(html().contains(CLASS_FOOTBALL)).toBe(true);
    expect(document.getElementById('p')!.textContent).toBe('最后还是■■了');
  });

  it('h1 textContent 被替换后重新判断', async () => {
    setup('<h1 class="video-title">加载中</h1>', '视频');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    document.querySelector('h1')!.textContent = '曼城 vs 利物浦 英超 全场回放';
    await tick();
    expect(html().contains(CLASS_FOOTBALL)).toBe(true);
  });

  it('往已有的标签容器里插入标签后重新判断', async () => {
    setup(
      '<h1 class="video-title">周末看球 回放</h1><div class="video-tag-container"></div>',
      '视频',
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(html().contains(CLASS_FOOTBALL)).toBe(false);
    const a = document.createElement('a');
    a.textContent = '英超';
    document.querySelector('.video-tag-container')!.appendChild(a);
    await tick();
    expect(html().contains(CLASS_FOOTBALL)).toBe(true);
  });
});

describe('全角数字', () => {
  it('只有全角数字和标点的节点也被遮挡，拆开的全角比分整体隐藏', async () => {
    setup(
      '<div class="m"><span>阿森纳</span><span id="s">２－１</span><span>切尔西</span></div>' +
        '<div class="n"><span>阿森纳</span><b>２</b><i>：</i><b>１</b><span>切尔西</span></div>',
      '英超 阿森纳 vs 切尔西',
    );
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(document.getElementById('s')!.textContent).toBe('■-■');
    expect(document.querySelector('.n')!.hasAttribute(ATTR_HIDE)).toBe(true);
    const late = document.createElement('span');
    late.textContent = '３－０';
    document.body.appendChild(late);
    await tick();
    expect(late.textContent).toBe('■-■');
  });
});

describe('后插入的 iframe', () => {
  type Win = Window & typeof globalThis;
  const frameWin = (id: string) =>
    (document.getElementById(id) as HTMLIFrameElement).contentWindow as Win;

  /** jsdom 的 postMessage 不带 event.source：按浏览器行为转发，source 为调用方窗口 */
  function wire(target: Win, source: Window, log: unknown[] = []) {
    target.postMessage = ((data: unknown) => {
      log.push(data);
      setTimeout(() => target.dispatchEvent(new target.MessageEvent('message', { data, source })));
    }) as typeof target.postMessage;
    return log;
  }

  it('子页面启动时向父页面询问语境，父页面是足球页面时回答', async () => {
    setup('<iframe id="outer"></iframe>', '');
    // vitest 的全局 window 不是 jsdom 里 iframe.parent 指向的那个对象，
    // 所以父页面也放在一个 iframe 里：外层 iframe（父页面）里再插入 iframe（子页面）
    const parentWin = frameWin('outer');
    const parentDoc = parentWin.document;
    parentDoc.title = '阿森纳 vs 切尔西 英超 全场回放';
    const parent = new SpoilerShield(parentDoc, { site: bilibili });
    const iframe = parentDoc.createElement('iframe');
    let child: SpoilerShield | null = null;
    try {
      parent.start();
      expect(parent.isFootballPage).toBe(true);
      // 父页面判断完语境之后才插入的 iframe
      parentDoc.body.appendChild(iframe);
      const childWin = iframe.contentWindow as Win;
      expect(childWin.parent === parentWin).toBe(true);
      const childDoc = iframe.contentDocument!;
      childDoc.title = '哔哩哔哩嵌入式播放器';
      childDoc.body.innerHTML = '<p>最后还是领先了</p>';
      const posted = wire(parentWin, childWin);
      wire(childWin, parentWin);
      child = new SpoilerShield(childDoc, { site: bilibili });
      child.start();
      expect(child.isFootballPage).toBe(false);
      await tick();
      await tick();
      expect(posted).toContainEqual(expect.objectContaining({ request: true }));
      expect(child.isFootballPage).toBe(true);
      expect(childDoc.querySelector('p')!.textContent).toBe('最后还是■■了');
    } finally {
      child?.stop();
      parent.stop();
    }
  });

  it('不是自己子页面的询问不回答', async () => {
    setup('<iframe id="a"></iframe><iframe id="b"></iframe>', '');
    const a = frameWin('a');
    const b = frameWin('b');
    a.document.title = '阿森纳 vs 切尔西 英超 全场回放';
    const parent = new SpoilerShield(a.document, { site: bilibili });
    const replies = wire(b, a);
    try {
      parent.start();
      a.dispatchEvent(
        new a.MessageEvent('message', {
          data: { type: 'sff-football-context', request: true },
          source: b,
        }),
      );
      await tick();
      expect(replies).toHaveLength(0);
    } finally {
      parent.stop();
    }
  });
});

describe('节点离开页面后又插回来', () => {
  it('暂停时仍能恢复原文和属性', async () => {
    setup('<p id="p">阿森纳 2-1 切尔西</p><a id="a" title="阿森纳 2-1 切尔西">x</a>', '英超');
    shield = new SpoilerShield(document, { site: bilibili, onStats: () => {} });
    shield.start();
    const p = document.getElementById('p')!;
    const a = document.getElementById('a')!;
    p.remove();
    a.remove();
    await tick();
    document.body.append(p, a);
    await tick();
    expect(p.textContent).toBe('阿森纳 ■-■ 切尔西');
    shield.pause();
    expect(p.textContent).toBe('阿森纳 2-1 切尔西');
    expect(a.getAttribute('title')).toBe('阿森纳 2-1 切尔西');
  });
});

describe('语境切换与 shadow root', () => {
  it('变成足球页面后，已在监听的 shadow root 里的语境词也遮挡', async () => {
    setup('<p id="light">最后还是领先了</p><div id="host"></div>', '视频');
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>最后还是领先了</p>';
    shield = new SpoilerShield(document, {
      site: null,
      prefs: {
        hide: {
          duration: true,
          progress: true,
          danmaku: true,
          comments: false,
          recommend: true,
          scoreboard: true,
        },
      },
    });
    shield.start();
    expect(root.querySelector('p')!.textContent).toBe('最后还是领先了');
    document.title = '阿森纳 vs 切尔西 全场回放';
    await tick();
    expect(document.getElementById('light')!.textContent).toBe('最后还是■■了');
    expect(root.querySelector('p')!.textContent).toBe('最后还是■■了');
  });
});

describe('相邻文字节点拼成的比分', () => {
  const PARTS = [
    '北京时间10月18日晚，英超第8轮，阿森纳主场迎战切尔西。经过90分钟的激烈争夺，最终比分定格在',
    '2',
    '-',
    '1',
    '，双方球员都拼尽了全力，比赛精彩纷呈，赛后球迷纷纷表示满意。',
  ];

  const build = (withComments = false) => {
    const p = document.createElement('p');
    PARTS.forEach((t, i) => {
      if (withComments && i > 0) p.appendChild(document.createComment(' '));
      p.appendChild(document.createTextNode(t));
    });
    return p;
  };

  it('长段落里被拆成多个文字节点的比分被遮挡，暂停后恢复', () => {
    setup('', '英超');
    const p = build();
    document.body.appendChild(p);
    expect(p.textContent!.length).toBeGreaterThan(60);
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    expect(p.textContent).toContain('定格在■-■，');
    expect(p.textContent).not.toContain('2-1');
    // 周围文字（日期、轮次、时长）不受影响
    expect(p.textContent).toContain('10月18日晚，英超第8轮');
    expect(p.textContent).toContain('90分钟');
    shield.pause();
    expect(p.textContent).toBe(PARTS.join(''));
  });

  it('服务端渲染夹着注释节点、动态插入时也遮挡；其中一个数字后来被改写也能识别', async () => {
    setup('', '英超');
    shield = new SpoilerShield(document, { site: null });
    shield.start();
    const p = build(true);
    document.body.appendChild(p);
    await tick();
    expect(p.textContent).toContain('定格在■-■，');
    const home = [...p.childNodes].filter((n) => n.nodeType === 3)[1] as Text;
    home.data = '3';
    await tick();
    expect(p.textContent).toContain('定格在■-■，');
  });

  it('时间、赛季、阵型拆开也不遮挡', () => {
    setup('<p id="t"></p>', '英超');
    const t = document.getElementById('t')!;
    for (const s of [
      '2025',
      '-',
      '26 赛季 第 3 轮 ',
      '19',
      ':',
      '30 开球，阵型 ',
      '4-3-3',
      ' 时长 1:30:00',
    ])
      t.appendChild(document.createTextNode(s));
    const before = t.textContent;
    shield = new SpoilerShield(document, { site: null });
    shield.start();
    expect(t.textContent).toBe(before);
  });
});

describe('不再持有已离开页面的节点', () => {
  interface Internals {
    observedRoots: Set<ShadowRoot>;
    maskedTexts: Set<Text>;
  }

  it('shadow root 宿主离开页面后不再保留；没有 onStats 时也会清理', async () => {
    setup('', '英超');
    shield = new SpoilerShield(document, { site: bilibili });
    shield.start();
    const internals = shield as unknown as Internals;
    for (let i = 0; i < 60; i++) {
      const host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).innerHTML = '<p>阿森纳 2-1 切尔西</p>';
      document.body.appendChild(host);
      await tick();
      host.remove();
      await tick();
    }
    expect(internals.observedRoots.size).toBeLessThan(60);
    expect(internals.maskedTexts.size).toBeLessThan(60);
    shield.pause();
    shield.resume();
    expect(internals.observedRoots.size).toBe(0);
  });
});

describe('<pre>/<code>', () => {
  it('初始内容和后插入的内容一样遮挡', async () => {
    setup(
      '<pre id="a">昨晚 阿森纳 2-1 切尔西</pre><code id="c">阿森纳 2-1 切尔西</code><pre id="b"></pre>',
      'News',
    );
    shield = new SpoilerShield(document, { site: null });
    shield.start();
    expect(document.getElementById('a')!.textContent).toBe('昨晚 阿森纳 ■-■ 切尔西');
    expect(document.getElementById('c')!.textContent).toBe('阿森纳 ■-■ 切尔西');
    document
      .getElementById('b')!
      .appendChild(document.createTextNode('阿森纳 2-1 切尔西 直接文本'));
    await tick();
    expect(document.getElementById('b')!.textContent).toBe('阿森纳 ■-■ 切尔西 直接文本');
  });
});
