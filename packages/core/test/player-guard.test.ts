// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpoilerShield, buildShieldCss } from '../src/dom/index.ts';
import { ATTR_CARD, ATTR_HIDE, CLASS_FOOTBALL, CLASS_ON } from '../src/dom/css.ts';
import {
  DEFAULT_SITE_RULES_JSON,
  matchSite,
  validateSiteRules,
  type SiteRule,
} from '../src/index.ts';

/**
 * 主播放器保护（咪咕回放黑屏）：站点规则 [class*='barrage' i] 命中了播放器外层的状态类
 * is-barrage-hidden，整个播放器被藏成黑屏。这里故意用修正前的弹幕选择器，验证的是代码里的保护，
 * 不依赖规则里的 :not([class*='is-barrage' i])。
 * 同一类问题的另一种：封面选择器命中盖在视频上的透明层（爱奇艺 XPlayer_cover、央视频直播的 div.con.poster），
 * 透明层被刷成不透明的中性封面，画面同样看不见。这里同样故意用修正前的封面选择器。
 * 属性名直接写字面量（不从 css.ts 导入），旧代码上这些测试照样能跑、在断言上失败。
 */
const PLAYER = 'data-sff-player';
const OVERLAY = 'data-sff-overlay';
/** 透明层里海报大小的图片、背景图；被遮挡规则命中的外层里在视频旁边的子元素 */
const POSTER = 'data-sff-poster';
const BESIDE = 'data-sff-beside';
const GUARD = `:not([${PLAYER}])`;
const MARKS_SELECTOR = [PLAYER, OVERLAY, POSTER, BESIDE].map((attr) => `[${attr}]`).join(',');
const OVERLAY_GUARD = `:not([${OVERLAY}])`;
const OLD_DANMAKU = [
  "[class*='danmu' i]",
  "[class*='danmaku' i]",
  "[class*='barrage' i]",
  "[class*='bullet' i]",
];
/** 修正前（d8fb95b 之前）的爱奇艺、央视频封面选择器：会命中播放器盖在视频上的透明层 */
const OLD_IQIYI_COVER = [
  "div[class^='video-list-item_'] [class*='img']",
  "div[class^='video-slide_'] [class*='img']",
  "[class*='cover' i]",
  '.qy-mod-link-wrap',
];
const OLD_YSP_COVER = ["[class*='cover' i]", "[class*='poster' i]"];
/** 2faceb5 之前的咪咕封面选择器：还会命中播放器的版权/出错提示层 .mg-cover */
const OLD_MIGU_COVER = ["[class*='cover' i]", "[class*='poster' i]", "[class*='pic' i]"];

const rules = validateSiteRules(DEFAULT_SITE_RULES_JSON)!;
const migu = matchSite(rules, 'www.miguvideo.com')!;
const oldMigu: SiteRule = { ...migu, hide: { ...migu.hide, danmaku: OLD_DANMAKU } };
const oldIqiyi: SiteRule = {
  ...matchSite(rules, 'www.iqiyi.com')!,
  coverSelectors: OLD_IQIYI_COVER,
};
const oldYsp: SiteRule = {
  ...matchSite(rules, 'www.yangshipin.cn')!,
  coverSelectors: OLD_YSP_COVER,
};
const dongqiudi = matchSite(rules, 'www.dongqiudi.com')!;

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 按顶层逗号拆开选择器列表（括号里的逗号不拆） */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const ruleLines = (css: string) =>
  css.split('\n').map((line) => {
    const i = line.indexOf('{');
    return { selectors: splitSelectors(line.slice(0, i)), decl: line.slice(i) };
  });

const HIDING = /visibility:hidden|opacity:0|display:none|background|object-position/;
/**
 * 只去掉元素自己背景图的规则：主播放器外层的背景画在视频下面，透明层自己的背景图是盖在视频上的海报，
 * 去掉都挡不住画面，也挡不住元素里的内容
 */
const BG_ONLY = '{background-image:none!important}';
const OWN_BG = `:is([${PLAYER}],[${OVERLAY}])${BG_ONLY}`;
/** 去掉只换背景图的命中：剩下的才会挡住元素本身（藏起来、刷成中性底色、变透明、图片内容移走） */
const blocking = (hits: string[]) => hits.filter((h) => !h.endsWith(BG_ONLY));

/** 生成的样式里作用在 el 本身、会把它藏起来（或换掉背景、把图片内容移走）的规则（原生时间轴的伪元素规则只藏控件里的时间轴） */
function selfHits(css: string, el: Element): string[] {
  return ruleLines(css)
    .filter((r) => HIDING.test(r.decl))
    .flatMap((r) =>
      r.selectors.filter((s) => !s.includes('::') && el.matches(s)).map((s) => `${s}${r.decl}`),
    );
}

/** el 自己或任何一层外层被遮挡样式命中（在页面上就看不见了） */
function hiddenBy(css: string, el: Element): string[] {
  const hits: string[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    hits.push(...blocking(selfHits(css, cur)).filter((h) => cur === el || !/background/.test(h)));
  }
  return hits;
}

describe('遮挡样式不作用在主播放器上（:not([data-sff-player])）', () => {
  it('每条遮挡规则的每个选择器都以保护条件结尾，只有原生时间轴的伪元素规则、去掉外层和透明层自己背景图的规则例外；封面范围排除透明层', () => {
    for (const site of [oldMigu, oldIqiyi, oldYsp, ...rules.sites]) {
      const css = buildShieldCss(site);
      const cover = `:is(${site.coverSelectors!.join(',')})`;
      let paint = 0;
      let inner = 0;
      let own = 0;
      let poster = 0;
      let hideLines = 0;
      for (const { selectors, decl } of ruleLines(css)) {
        // 遮挡类规则：命中的元素本身，和命中的外层里在视频旁边的子元素（同一条声明）
        const beside = selectors.filter((s) => s.includes(`[${BESIDE}]`));
        if (beside.length) {
          expect(selectors, site.id).toEqual([
            selectors[0],
            `${selectors[0]!.slice(0, -GUARD.length)}[${PLAYER}]>[${BESIDE}]${GUARD}`,
          ]);
          hideLines++;
        }
        for (const s of selectors) {
          const where = `${site.id}: ${s}${decl.slice(0, 40)}`;
          if (s.includes('::-webkit-media-controls')) {
            expect(s, site.id).not.toContain(PLAYER);
            continue;
          }
          if (s.endsWith(`${cover}:is([${PLAYER}],[${OVERLAY}])`)) {
            // 命中封面选择器的主播放器外层、透明层：只去掉它们自己的背景图
            expect(decl, where).toBe(BG_ONLY);
            own++;
            continue;
          }
          expect(s.endsWith(GUARD), where).toBe(true);
          if (decl.startsWith('{background:#1f3d2b')) {
            // 封面元素自己刷底色：排除透明层和主播放器的外层
            expect(s.endsWith(`${cover}${OVERLAY_GUARD}${GUARD}`), where).toBe(true);
            paint++;
          } else if (s.includes(`${cover}${OVERLAY_GUARD} `)) {
            // 封面里面的图片、视频、背景图：范围排除透明层，但不排除主播放器的外层（不带 :not([data-sff-player])）
            expect(s, where).toMatch(/ (img|picture|video|canvas|\*):not\(\[data-sff-player\]\)$/);
            expect(s, where).not.toContain(`${cover}${GUARD}`);
            inner++;
          } else if (s.includes(`${cover}[${OVERLAY}] `)) {
            // 透明层里只有海报大小的（data-sff-poster）照样换掉
            expect(s.endsWith(`[${POSTER}]${GUARD}`), where).toBe(true);
            poster++;
          } else {
            // 遮挡类规则、封面元素本身就是图片/视频的规则：不管透明层
            expect(s, where).not.toContain(OVERLAY);
          }
        }
      }
      expect(paint, site.id).toBe(3);
      expect(inner, site.id).toBe(15);
      expect(own, site.id).toBe(3);
      expect(poster, site.id).toBe(6);
      const categories = Object.values(site.hide ?? {}).filter((list) => list?.length).length;
      expect(hideLines, site.id).toBe(categories + (site.hide?.duration?.length ? 1 : 0));
    }
    // 没有站点规则（全网模式）时只有拆开比分的整块隐藏，也带保护
    expect(buildShieldCss(null)).toBe(
      `html.${CLASS_ON} [${ATTR_HIDE}]${GUARD}{visibility:hidden!important;opacity:0!important}`,
    );
  });

  it('咪咕弹幕、封面、卡片时长规则的写法', () => {
    const css = buildShieldCss(oldMigu).split('\n');
    const fb = `html.${CLASS_ON}.${CLASS_FOOTBALL}`;
    const danmaku = `:is(${OLD_DANMAKU.join(',')})`;
    expect(css).toContain(
      `${fb} ${danmaku}${GUARD},${fb} ${danmaku}[${PLAYER}]>[${BESIDE}]${GUARD}{visibility:hidden!important;opacity:0!important}`,
    );
    const cover = `:is(${migu.coverSelectors!.join(',')})`;
    const background = css.find((l) => l.includes('{background:'))!;
    expect(background.slice(0, background.indexOf('{'))).toBe(
      `${fb} ${cover}${OVERLAY_GUARD}${GUARD},html.${CLASS_ON} [${ATTR_CARD}] ${cover}${OVERLAY_GUARD}${GUARD},html.${CLASS_ON} [${ATTR_CARD}]${cover}${OVERLAY_GUARD}${GUARD}`,
    );
    // 命中封面选择器的主播放器外层、透明层：不刷底色，但自己的背景图照样去掉
    const scopes = [
      `${fb} ${cover}`,
      `html.${CLASS_ON} [${ATTR_CARD}] ${cover}`,
      `html.${CLASS_ON} [${ATTR_CARD}]${cover}`,
    ];
    const own = OWN_BG.slice(0, -BG_ONLY.length);
    expect(css).toContain(scopes.map((s) => `${s}${own}`).join(',') + BG_ONLY);
    // 封面里的视频：范围（封面元素）只排除透明层，视频本身带保护。
    // 范围不再带 :not([data-sff-player])：封面元素恰好包着主视频时，里面别的缩略图也要照样换掉
    expect(css.find((l) => l.endsWith('{opacity:0!important}') && l.includes(' video'))).toContain(
      `${fb} ${cover}${OVERLAY_GUARD} video${GUARD}`,
    );
    expect(css.find((l) => l.includes(BG_ONLY) && l.includes(' *'))).toContain(
      `${fb} ${cover}${OVERLAY_GUARD} *${GUARD}`,
    );
    expect(css.find((l) => l.includes(':is(video,canvas)'))).toContain(
      `${fb} ${cover}:is(video,canvas)${GUARD}`,
    );
    // 透明层里海报大小的图片、背景图
    const poster = (el: string) =>
      scopes.map((s) => `${s}[${OVERLAY}] ${el}[${POSTER}]${GUARD}`).join(',');
    expect(css).toContain(`${poster(':is(img,picture,video,canvas)')}{opacity:0!important}`);
    expect(css).toContain(`${poster('')}${BG_ONLY}`);
    const duration = `:is(${migu.hide!.duration!.join(',')})`;
    const card = `html.${CLASS_ON} [${ATTR_CARD}]`;
    expect(css).toContain(
      `${card} ${duration}${GUARD},${card} ${duration}[${PLAYER}]>[${BESIDE}]${GUARD}{visibility:hidden!important}`,
    );
  });

  it('主播放器和外层不被命中，里面的弹幕、比分、进度条照样遮挡，其他封面照样换掉', () => {
    document.documentElement.className = `${CLASS_ON} ${CLASS_FOOTBALL}`;
    document.body.innerHTML = `
      <section id="wrap" class="live-player-cont is-normal is-barrage-hidden" ${PLAYER}>
        <div class="mg_player_wrapper" ${PLAYER}>
          <video id="v" class="m-player pic-video" ${PLAYER}></video>
          <div id="b" class="barrage-layer">前方高能</div>
          <div id="s" class="match-score">2-1</div>
          <div id="p" class="m-player-progress">进度</div>
        </div>
      </section>
      <div class="list"><div class="pic-box" id="c"><img id="ci"><video id="cv"></video></div></div>`;
    const css = buildShieldCss(oldMigu);
    const $ = (id: string) => document.getElementById(id)!;
    expect(hiddenBy(css, $('v'))).toEqual([]);
    expect(hiddenBy(css, $('wrap'))).toEqual([]);
    expect(selfHits(css, $('b')).join()).toContain('visibility:hidden');
    expect(selfHits(css, $('s')).join()).toContain('visibility:hidden');
    expect(selfHits(css, $('p')).join()).toContain('opacity:0');
    expect(selfHits(css, $('c')).join()).toContain('{background:');
    expect(selfHits(css, $('ci')).join()).toContain('opacity:0');
    expect(selfHits(css, $('cv')).join()).toContain('opacity:0');
    // 去掉标记就是原来的行为：外层被弹幕规则藏起来（整个播放器黑屏）
    document.querySelectorAll(`[${PLAYER}]`).forEach((el) => el.removeAttribute(PLAYER));
    expect(selfHits(css, $('wrap')).join()).toContain("[class*='barrage' i]");
    expect(hiddenBy(css, $('v')).length).toBeGreaterThan(0);
  });

  it('封面元素恰好包着主视频：它自己不刷底色，里面别的缩略图、背景图照样换掉，主视频不受影响', () => {
    document.documentElement.className = `${CLASS_ON} ${CLASS_FOOTBALL}`;
    document.body.innerHTML = `
      <div id="zone" class="match-cover-zone" ${PLAYER}>
        <div id="pw" ${PLAYER}><video id="v" ${PLAYER}></video></div>
        <div class="strip"><img id="t"><picture id="pic"></picture><div id="bg">集锦</div></div>
      </div>`;
    const css = buildShieldCss(oldMigu);
    const $ = (id: string) => document.getElementById(id)!;
    expect(selfHits(css, $('zone')).join()).not.toContain('{background:');
    // 它自己的背景图（海报）照样去掉：画在视频下面，去掉也挡不住画面
    expect(selfHits(css, $('zone')).join()).toContain(OWN_BG);
    expect(hiddenBy(css, $('v'))).toEqual([]);
    expect(selfHits(css, $('pw'))).toEqual([]);
    expect(selfHits(css, $('t')).join()).toContain('opacity:0');
    expect(selfHits(css, $('pic')).join()).toContain('opacity:0');
    expect(selfHits(css, $('bg')).join()).toContain('background-image:none');
  });

  it('盖在主视频上的透明层（data-sff-overlay）不刷底色，里面的图标照常显示；弹幕、比分照样藏，别处的封面照样换掉', () => {
    document.documentElement.className = `${CLASS_ON} ${CLASS_FOOTBALL}`;
    document.body.innerHTML = `
      <div id="slot" ${PLAYER}><video id="v" ${PLAYER}></video></div>
      <div id="layer" class="player-cover" ${OVERLAY}>
        <img id="icon"><span id="ib">播放</span>
        <div id="b" class="barrage-layer">前方高能</div><div id="s" class="score-bar">2-1</div>
        <div class="end-panel"><img id="thumb" ${POSTER}><div id="thumbBg" ${POSTER}>集锦</div></div>
      </div>
      <div id="other" class="pic-box"><img id="oi"></div>`;
    const css = buildShieldCss(oldMigu);
    const $ = (id: string) => document.getElementById(id)!;
    // 透明层自己不刷底色，只去掉它自己的背景图（盖在视频上的海报）
    expect(blocking(selfHits(css, $('layer')))).toEqual([]);
    expect(selfHits(css, $('layer')).join()).toContain(OWN_BG);
    expect(selfHits(css, $('icon'))).toEqual([]);
    expect(selfHits(css, $('ib'))).toEqual([]);
    // 透明层里海报大小的图片、背景图（片尾推荐的缩略图）照样换掉
    expect(selfHits(css, $('thumb')).join()).toContain('opacity:0');
    expect(selfHits(css, $('thumbBg')).join()).toContain(`[${POSTER}]${GUARD}${BG_ONLY}`);
    expect(selfHits(css, $('b')).join()).toContain('visibility:hidden');
    expect(selfHits(css, $('s')).join()).toContain('visibility:hidden');
    expect(selfHits(css, $('other')).join()).toContain('{background:');
    expect(selfHits(css, $('oi')).join()).toContain('opacity:0');
    // 去掉标记就是原来的行为：透明层刷成不透明的中性封面，盖住视频
    $('layer').removeAttribute(OVERLAY);
    expect(selfHits(css, $('layer')).join()).toContain('{background:#1f3d2b');
    expect(selfHits(css, $('icon')).join()).toContain('opacity:0');
  });

  it('遮挡规则命中主播放器的外层：外层里视频旁边的子元素（data-sff-beside）照样按这条规则藏，播放器本身照常', () => {
    document.documentElement.className = `${CLASS_ON} ${CLASS_FOOTBALL}`;
    document.body.innerHTML = `
      <section id="wrap" class="live-player-cont is-barrage-hidden" ${PLAYER}>
        <div id="area" class="live-player-area" ${PLAYER}><video id="v" ${PLAYER}></video><div id="ctrl">控制栏</div></div>
        <aside id="right" class="live-player-right" ${BESIDE}><p>【进球】萨卡破门</p></aside>
      </section>
      <div id="cm" class="comment-wrap" ${PLAYER}><div id="pw" ${PLAYER}><video ${PLAYER}></video></div><div id="list" ${BESIDE}>评论</div></div>`;
    const css = buildShieldCss(oldMigu);
    const $ = (id: string) => document.getElementById(id)!;
    expect(hiddenBy(css, $('v'))).toEqual([]);
    expect(hiddenBy(css, $('ctrl'))).toEqual([]);
    expect(selfHits(css, $('right')).join()).toContain(
      `:is(${OLD_DANMAKU.join(',')})[${PLAYER}]>[${BESIDE}]${GUARD}{visibility:hidden!important;opacity:0!important}`,
    );
    // 命中外层的是哪类规则就按哪类藏：评论区规则 display:none
    expect(selfHits(css, $('list')).join()).toContain('display:none');
    expect(hiddenBy(css, $('pw'))).toEqual([]);
    // 外层没被遮挡规则命中时，带着标记也不藏
    $('wrap').className = 'live-player-cont';
    expect(selfHits(css, $('right'))).toEqual([]);
  });
});

/**
 * jsdom 没有布局：按元素给出位置和尺寸。遮挡样式生效时，被它 display:none 藏起（自己或外层）的元素
 * 和浏览器里一样量不出尺寸；同时记下每次量的时候遮挡样式是否停用
 */
const boxes = new WeakMap<Element, [number, number, number, number]>();
const sized = <T extends Element>(el: T, w: number, h: number, x = 0, y = 0): T => {
  boxes.set(el, [w, h, x, y]);
  return el;
};
let sheetDisabledAtMeasure: Array<boolean | null> = [];

const shieldStyle = () => document.getElementById('sff-shield-style') as HTMLStyleElement | null;
const shieldCss = () => shieldStyle()!.textContent!;
const parentOf = (el: Element): Element | null =>
  el.parentElement ?? (el.parentNode as ShadowRoot | null)?.host ?? null;

function hiddenByShieldSheet(el: Element): boolean {
  const style = shieldStyle();
  if (!style?.sheet || style.sheet.disabled) return false;
  const none = ruleLines(style.textContent ?? '')
    .filter((r) => r.decl.includes('display:none'))
    .flatMap((r) => r.selectors)
    .filter((s) => !s.includes('::'));
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) {
    const node = cur;
    if (node.getRootNode() === document && none.some((s) => node.matches(s))) return true;
  }
  return false;
}

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

const marked = (attr = PLAYER) =>
  [...document.querySelectorAll(`[${attr}]`)].map((el) => el.id || el.className || el.tagName);

const MIGU_PLAYER = `
  <section id="wrap" class="live-player-cont is-normal is-barrage-hidden">
    <div id="area" class="live-player-area">
      <div id="sport-live" class="live-player-mount">
        <section id="mod" class="mod-player">
          <div id="vw" class="video-wrapper">
            <div id="mg" class="mg_player_wrapper">
              <video id="main" class="m-player"></video>
              <div id="barrage" class="barrage-layer"><span>前方高能</span></div>
              <div id="score" class="match-score">2-1</div>
            </div>
          </div>
        </section>
      </div>
    </div>
    <aside id="right" class="live-player-right">
      <div id="card" class="card-item"><div id="cover" class="cover-box"><video id="preview"></video></div>
        <p class="card-title">英超 阿森纳 vs 切尔西 集锦</p></div>
    </aside>
  </section>`;
const CHAIN = ['main', 'mg', 'vw', 'mod', 'sport-live', 'area', 'wrap'];

function setup(body: string, title = '英超 阿森纳 vs 切尔西 全场回放_咪咕视频') {
  document.head.innerHTML = `<title>${title}</title>`;
  document.body.innerHTML = body;
  document.documentElement.className = '';
}

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture 里没有 #${id}`);
  return el;
};

function sizeMiguPlayer() {
  sized($('main'), 1032, 756);
  const preview = document.getElementById('preview');
  if (preview) sized(preview, 300, 170, 1032, 0);
  const card = document.getElementById('card');
  if (card) sized(card, 408, 260, 1032, 0);
}

let shield: SpoilerShield | null = null;
const startShield = (site: SiteRule = oldMigu) => {
  shield = new SpoilerShield(document, { site });
  shield.start();
  return shield;
};

beforeEach(() => {
  sheetDisabledAtMeasure = [];
  setViewport(1440, 900);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const style = shieldStyle();
    sheetDisabledAtMeasure.push(style?.sheet ? style.sheet.disabled : null);
    const [width, height, x, y] = hiddenByShieldSheet(this)
      ? [0, 0, 0, 0]
      : (boxes.get(this) ?? [0, 0, 0, 0]);
    return {
      x,
      y,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      width,
      height,
    } as DOMRect;
  });
});

afterEach(() => {
  shield?.stop();
  shield = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('主播放器标记（咪咕回放黑屏）', () => {
  it('咪咕直播/回放页：外层命中弹幕选择器也不藏；里面的弹幕层、比分照样藏；足球卡片里的小预览视频照样透明', () => {
    setup(MIGU_PLAYER);
    sizeMiguPlayer();
    startShield();
    expect(document.documentElement.classList.contains(CLASS_FOOTBALL)).toBe(true);
    expect(marked()).toEqual([...CHAIN].reverse());
    const css = shieldCss();
    expect(css).toContain("[class*='barrage' i],");
    expect(hiddenBy(css, $('main'))).toEqual([]);
    expect(hiddenBy(css, $('wrap'))).toEqual([]);
    expect(selfHits(css, $('barrage')).join()).toContain("[class*='barrage' i]");
    expect(selfHits(css, $('score')).join()).toContain("[class*='score' i]");
    expect($('score').textContent).toBe('■-■');
    // 卡片里的预览视频：不算主播放器，封面规则照样让它透明
    expect($('card').hasAttribute(ATTR_CARD)).toBe(true);
    expect($('preview').hasAttribute(PLAYER)).toBe(false);
    expect(selfHits(css, $('preview')).join()).toContain('opacity:0');
  });

  it('量尺寸时不停用遮挡样式（不为量尺寸额外重排整页）', () => {
    // 行为有意改变：f3baf25 每次判断都先停用整份遮挡样式再量，评论很多的页面上插入一个视频要卡 95ms，
    // 每次播放、暂停后继续也要重排两次整页。现在照常量，只有下一个测试里的情况才停用
    setup(MIGU_PLAYER);
    sizeMiguPlayer();
    startShield();
    expect(marked()).toContain('wrap');
    expect(sheetDisabledAtMeasure.length).toBeGreaterThan(0);
    expect(sheetDisabledAtMeasure.every((disabled) => disabled === false)).toBe(true);
    expect(shieldStyle()!.sheet!.disabled).toBe(false);
  });

  it('主视频的外层被推荐区规则误伤（display:none，量不出尺寸）：临时停用遮挡样式量一次，同一个任务里恢复', () => {
    setup(`
      <div id="rel" class="related-player"><div id="pw"><video id="main"></video></div></div>
      <div id="cm" class="comment-list"><p>B费点射扳平</p><div id="cvw"><video id="cv"></video></div></div>`);
    sized($('main'), 1032, 580, 0, 64);
    sized($('cv'), 1032, 580, 0, 1400);
    startShield();
    expect(sheetDisabledAtMeasure).toContain(true);
    expect(shieldStyle()!.sheet!.disabled).toBe(false);
    expect(marked()).toEqual(['rel', 'pw', 'main']);
    const css = shieldCss();
    expect(hiddenBy(css, $('main'))).toEqual([]);
    // 评论区里一样大的视频在第一屏以下：不算，评论区照样藏
    expect(selfHits(css, $('cm')).join()).toContain('display:none');
  });

  it('评论区、推荐区里的视频只有在页面第一屏里才可能是主播放器', () => {
    setup(
      `<div id="cm" class="comment-list"><p>B费点射扳平</p><div><video id="cv"></video></div></div>`,
    );
    sized($('cv'), 1032, 580, 0, 1400);
    startShield();
    expect(sheetDisabledAtMeasure).toContain(true);
    expect(marked()).toEqual([]);
    expect(selfHits(shieldCss(), $('cm')).join()).toContain('display:none');
  });

  it('停用样式量出来的视频：外面被藏起的评论区、推荐区比视频大得多（真的评论区）时不算，误伤的播放器外层才算', () => {
    // 第一屏里的评论区：一条带视频的评论加上下面的长评论列表
    setup(`
      <div id="cm" class="comment-list"><div id="cvw"><video id="cv"></video></div>
        <p>B费点射扳平，曼联绝境续命</p><p>第二条评论</p></div>`);
    sized($('cm'), 1032, 2400, 0, 100);
    sized($('cv'), 1032, 580, 0, 100);
    startShield();
    expect(sheetDisabledAtMeasure).toContain(true);
    expect(marked()).toEqual([]);
    expect(selfHits(shieldCss(), $('cm')).join()).toContain('display:none');
    shield!.stop();

    // 咪咕那样外层比视频宽一些（1440×756 包着 1032×756）：是被误伤的播放器外层
    setup(`
      <section id="wrap" class="live-chatroom-layout"><div id="pw"><video id="main"></video></div>
        <aside id="side"><p>聊天室</p></aside></section>`);
    sized($('wrap'), 1440, 756, 0, 72);
    sized($('main'), 1032, 756, 0, 72);
    sized($('side'), 408, 756, 1032, 72);
    startShield();
    expect(marked()).toEqual(['wrap', 'pw', 'main']);
    expect(hiddenBy(shieldCss(), $('main'))).toEqual([]);
    // 命中外层的是聊天室（评论）规则：外层里视频旁边的聊天栏照样藏
    expect($('side').hasAttribute(BESIDE)).toBe(true);
    expect(selfHits(shieldCss(), $('side')).join()).toContain('display:none');
  });

  it('有看得见的主视频时，藏在评论区、推荐区里的视频更大才换成它；每个这样的视频只停用一次样式量尺寸', async () => {
    // 规则误伤了主播放器的外层（display:none），页面下面还有一个看得见的 640×360 视频
    setup(`
      <div id="wrap" class="live-chatroom-layout"><video id="main"></video></div>
      <section id="hl"><h2>赛前看点</h2><video id="v2"></video></section>
      <div id="cm" class="comment-list"><div><video id="cv"></video></div></div>`);
    sized($('main'), 1032, 580, 0, 100);
    sized($('v2'), 640, 360, 0, 1100);
    sized($('cv'), 640, 360, 0, 690);
    startShield();
    expect(marked()).toEqual(['wrap', 'main']);
    expect(hiddenBy(shieldCss(), $('main'))).toEqual([]);
    expect(selfHits(shieldCss(), $('cm')).join()).toContain('display:none');
    const toggles = () => sheetDisabledAtMeasure.filter(Boolean).length;
    const first = toggles();
    expect(first).toBeGreaterThan(0);

    // 之后的判断（窗口变化、插入 iframe）不再为它们停用样式
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event('resize'));
      await wait(200);
    }
    document.body.append(document.createElement('iframe'));
    await tick();
    expect(toggles()).toBe(first);
    expect(marked()).toEqual(['wrap', 'main']);
    // 加载出元数据、分辨率没变（换了同样大小的片源）：不重新量
    $('cv').dispatchEvent(new Event('loadedmetadata'));
    await wait(300);
    expect(toggles()).toBe(first);
    // 加载出不一样的分辨率（视频尺寸可能跟着变）、规则更新时重新量
    Object.defineProperty($('cv'), 'videoWidth', { value: 1280, configurable: true });
    Object.defineProperty($('cv'), 'videoHeight', { value: 720, configurable: true });
    $('cv').dispatchEvent(new Event('loadedmetadata'));
    await wait(300);
    const second = toggles();
    expect(second).toBeGreaterThan(first);
    $('cv').dispatchEvent(new Event('loadedmetadata'));
    await wait(300);
    expect(toggles()).toBe(second);
    shield!.update({ site: { ...oldMigu } });
    expect(toggles()).toBeGreaterThan(second);
    expect(marked()).toEqual(['wrap', 'main']);
  });

  it('手机宽度上不停用样式量尺寸：整宽的视频都够格，主视频还没出来时评论区、推荐区不会露出来', async () => {
    setViewport(390, 844);
    setup(`
      <h1>英超 曼联 vs 热刺</h1>
      <section id="mount" class="mod-player"></section>
      <div id="cm" class="comment-area"><p>B费点射扳平，曼联绝境续命</p><div><video id="cv"></video></div></div>
      <section id="gl" class="guess-you-like"><h3>猜你喜欢</h3><div><video id="gv" autoplay></video><p>【进球】萨卡破门</p></div></section>`);
    sized($('cm'), 390, 270, 0, 259);
    sized($('cv'), 390, 219, 0, 300);
    sized($('gl'), 390, 330, 0, 529);
    sized($('gv'), 390, 219, 0, 560);
    startShield();
    expect(sheetDisabledAtMeasure).not.toContain(true);
    expect(marked()).toEqual([]);
    const css = shieldCss();
    expect(selfHits(css, $('cm')).join()).toContain('display:none');
    expect(selfHits(css, $('gl')).join()).toContain('display:none');

    // 主视频后来才出来
    const main = sized(document.createElement('video'), 390, 219, 0, 40);
    $('mount').appendChild(main);
    await tick();
    expect(marked()).toEqual(['mount', 'VIDEO']);
    expect(selfHits(shieldCss(), $('cm')).join()).toContain('display:none');
  });

  it('手机上主播放器是嵌入的 iframe：推荐区里的预览视频不会让推荐区露出来', () => {
    setViewport(390, 844);
    setup(`
      <section id="wrap" class="live-player-cont"><iframe id="f"></iframe></section>
      <section id="gl" class="guess-you-like"><h3>猜你喜欢</h3><div><video id="gv" autoplay></video><p>【进球】萨卡破门</p></div></section>`);
    sized($('f'), 390, 219, 0, 100);
    sized($('gv'), 390, 219, 0, 380);
    startShield();
    expect(marked()).toEqual(['wrap', 'f']);
    expect(selfHits(shieldCss(), $('gl')).join()).toContain('display:none');
  });

  it('播放、暂停后继续、拖动（playing 事件）不再重新判断；加载出元数据（loadedmetadata）照旧重新判断', async () => {
    setup(MIGU_PLAYER);
    sizeMiguPlayer();
    startShield();
    await wait(200);
    const before = sheetDisabledAtMeasure.length;
    $('main').dispatchEvent(new Event('playing'));
    await wait(300);
    expect(sheetDisabledAtMeasure.length).toBe(before);
    $('main').dispatchEvent(new Event('loadedmetadata'));
    await wait(300);
    expect(sheetDisabledAtMeasure.length).toBeGreaterThan(before);
  });

  it('播放器后插入、被移走、窗口宽度变化后重新判断；不会自己触发自己', async () => {
    setup('<div id="mount"></div>');
    startShield();
    expect(marked()).toEqual([]);
    $('mount').innerHTML = MIGU_PLAYER;
    sized($('main'), 600, 338);
    await tick();
    // 600px 不到下限（窗口宽度的一半，最多 640px）：不算主播放器，外层照样按规则藏
    expect(marked()).toEqual([]);
    expect(selfHits(shieldCss(), $('wrap')).length).toBeGreaterThan(0);
    // 窗口变窄：够格了
    setViewport(1200, 900);
    window.dispatchEvent(new Event('resize'));
    await wait(300);
    expect(marked()).toEqual(['mount', ...[...CHAIN].reverse()]);
    expect(hiddenBy(shieldCss(), $('main'))).toEqual([]);

    // 标记写的属性不会再触发判断（不会无限循环）
    const calls = sheetDisabledAtMeasure.length;
    await wait(400);
    expect(sheetDisabledAtMeasure.length).toBe(calls);

    // 窗口又变宽：已经选出来的主播放器不够格了，但没有别的够格的视频，继续保护（行为有意改变：以前马上去掉保护）
    setViewport(1440, 900);
    window.dispatchEvent(new Event('resize'));
    await wait(300);
    expect(marked()).toContain('wrap');
    expect(hiddenBy(shieldCss(), $('main'))).toEqual([]);

    // 主视频被移走：外层不再标记
    $('main').remove();
    await wait(300);
    expect(marked()).toEqual([]);
  });

  it('主播放器滚动后缩成小窗：没有别的够格的视频时继续保护；被页面藏起来（尺寸为空）后不再保护；有别的够格的视频时选它', async () => {
    setup(`${MIGU_PLAYER}<div id="aw" class="barrage-article"><video id="article"></video></div>`);
    sizeMiguPlayer();
    startShield();
    expect(marked()).toContain('wrap');
    const resized = async () => {
      window.dispatchEvent(new Event('resize'));
      await wait(300);
    };
    // 缩成右下角 400×225 的小窗
    sized($('main'), 400, 225, 1020, 655);
    await resized();
    expect(marked()).toContain('wrap');
    expect(hiddenBy(shieldCss(), $('main'))).toEqual([]);
    // 文章里的视频变成够格的大小：选它
    sized($('article'), 640, 360, 0, 1200);
    await resized();
    expect(marked()).toEqual(['aw', 'article']);
    expect(selfHits(shieldCss(), $('wrap')).length).toBeGreaterThan(0);
    // 页面把文章里的视频藏起来：没有可保护的
    sized($('article'), 0, 0);
    await resized();
    expect(marked()).toEqual([]);
  });

  it('手机上整宽的视频都够大：只保护面积最大的主视频，评论区里同样大的视频不会让评论区露出来', () => {
    setViewport(390, 844);
    setup(`
      <div id="top" class="mod-player"><video id="main"></video></div>
      <div id="cm" class="comment-area"><p>B费点射扳平，曼联绝境续命</p><div id="cvw"><video id="cv"></video></div></div>
      <div id="gl" class="guess-you-like"><div><video id="gv"></video></div></div>`);
    sized($('main'), 390, 219, 0, 0);
    sized($('cv'), 390, 219, 0, 600);
    sized($('gv'), 390, 219, 0, 900);
    startShield();
    expect(marked()).toEqual(['top', 'main']);
    const css = shieldCss();
    expect(hiddenBy(css, $('main'))).toEqual([]);
    expect(selfHits(css, $('cm')).join()).toContain('display:none');
    expect(selfHits(css, $('gl')).join()).toContain('display:none');
  });

  it('每个页面只保护一个主播放器：面积最大的（一样大取窗口里露出多的），加上和它重叠的（叠在上面的广告视频）', async () => {
    setup(`
      <div id="mw" class="barrage-wrap"><video id="main"></video>
        <div id="adw" class="barrage-ad"><video id="ad"></video></div></div>
      <div id="sw" class="barrage-side"><video id="side"></video></div>`);
    sized($('main'), 1032, 580, 0, 0);
    sized($('ad'), 1032, 580, 0, 0);
    sized($('side'), 1032, 580, 0, 700);
    startShield();
    expect(marked()).toEqual(['mw', 'main', 'adw', 'ad']);
    expect(selfHits(shieldCss(), $('sw')).join()).toContain("[class*='barrage' i]");
    // 下面那个变大了：它成了主播放器，原来的不再保护
    sized($('side'), 1280, 720, 0, 700);
    window.dispatchEvent(new Event('resize'));
    await wait(300);
    expect(marked()).toEqual(['sw', 'side']);
  });

  it('竖屏信息流（咪咕 /p/vertical/）：上一条、下一条预载在窗口外、一样大，保护窗口里正在看的那条；滑到下一条后跟着换', async () => {
    const slot = (n: number) =>
      `<div id="slot${n}" class="vertical-content vertical-content-slot-${n}"><section id="mod${n}" class="mod-player is-danmu-on"><video id="v${n}"></video></section></div>`;
    setup(`<div id="feed" class="vertical-viewport">${slot(1)}${slot(2)}${slot(3)}</div>`);
    // 上一条在窗口上面（只露出 72px，被顶栏挡住），正在看的在窗口里，下一条在窗口下面
    sized($('v1'), 1440, 828, 0, -756);
    sized($('v2'), 1440, 828, 0, 72);
    sized($('v3'), 1440, 828, 0, 900);
    startShield();
    expect(marked()).toEqual(['feed', 'slot2', 'mod2', 'v2']);
    const css = shieldCss();
    expect(hiddenBy(css, $('v2'))).toEqual([]);
    expect(selfHits(css, $('mod1')).join()).toContain("[class*='danmu' i]");
    // 往下滑一条：页面插入新的下一条，各条往上移
    sized($('v1'), 1440, 828, 0, -1584);
    sized($('v2'), 1440, 828, 0, -756);
    sized($('v3'), 1440, 828, 0, 72);
    $('feed').insertAdjacentHTML('beforeend', slot(4));
    sized($('v4'), 1440, 828, 0, 900);
    await tick();
    expect(marked()).toEqual(['feed', 'slot3', 'mod3', 'v3']);
    expect(hiddenBy(shieldCss(), $('v3'))).toEqual([]);
  });

  it('大屏上固定宽度的播放器、文章里 640×360 的视频也算主播放器', () => {
    setViewport(2560, 1440);
    setup(MIGU_PLAYER);
    sized($('main'), 960, 540);
    startShield();
    expect(marked()).toContain('wrap');
    expect(hiddenBy(shieldCss(), $('main'))).toEqual([]);
    shield!.stop();

    // 懂球帝（总是按足球页处理）：文章里的视频在命中封面选择器的外层里
    setViewport(1440, 900);
    setup(
      '<article class="article-col"><div id="vc" class="video-cover-box"><video id="v"></video></div></article>',
      '懂球帝',
    );
    sized($('v'), 640, 360);
    startShield(dongqiudi);
    expect(marked()).toEqual(['article-col', 'vc', 'v']);
    expect(hiddenBy(shieldCss(), $('v'))).toEqual([]);
  });

  it('信息流里的足球卡片里的大视频不算主播放器；恰好匹配卡片选择器的页面级容器不影响', () => {
    setup(
      '<div class="card-item" id="card"><div class="cover-box" id="cover"><video id="v"></video></div><p>英超 阿森纳 vs 切尔西 集锦</p></div>',
    );
    sized($('card'), 700, 440);
    sized($('v'), 680, 383);
    startShield();
    expect($('card').hasAttribute(ATTR_CARD)).toBe(true);
    expect(marked()).toEqual([]);
    expect(selfHits(shieldCss(), $('v')).join()).toContain('opacity:0');
    shield!.stop();

    // 咪咕赛程/详情页：整页内容的容器 div.detail-main-item 也匹配 [class*='item' i]，被当成足球卡片
    setup(
      `<div id="page" class="detail-main-item"><h2>英超 阿森纳 vs 切尔西 全场回放</h2>${MIGU_PLAYER}</div>`,
    );
    sized($('page'), 1440, 3950);
    sizeMiguPlayer();
    startShield();
    expect($('page').hasAttribute(ATTR_CARD)).toBe(true);
    expect(marked()).toContain('page');
    expect(marked()).toContain('wrap');
    expect(hiddenBy(shieldCss(), $('main'))).toEqual([]);
  });

  it('链接里的大视频（首页大图、信息流的预览）不算主播放器', () => {
    setup(
      '<a id="hero" href="/p/detail/120000000001"><div id="hw" class="barrage-box"><video id="v"></video></div></a>',
    );
    sized($('v'), 1280, 720);
    startShield();
    expect(marked()).toEqual([]);
    expect(selfHits(shieldCss(), $('hw')).join()).toContain("[class*='barrage' i]");
  });

  it('嵌入播放器的大 iframe 和视频一起比面积；小广告、又宽又矮的横幅、比宽还高的评论框不算', async () => {
    setup(`
      <div id="fw" class="barrage-frame"><iframe id="f"></iframe></div>
      <div id="aw" class="barrage-ad"><iframe id="ad"></iframe></div>
      <div id="bw" class="barrage-banner"><iframe id="banner"></iframe></div>
      <div id="vw" class="barrage-video"><video id="small"></video></div>`);
    sized($('f'), 1032, 580, 0, 0);
    sized($('ad'), 300, 250, 1100, 0);
    sized($('banner'), 970, 250, 0, 700);
    sized($('small'), 300, 170, 1100, 300);
    startShield();
    expect(marked()).toEqual(['fw', 'f']);
    const css = shieldCss();
    expect(hiddenBy(css, $('f'))).toEqual([]);
    for (const id of ['aw', 'bw', 'vw']) expect(selfHits(css, $(id)).length, id).toBeGreaterThan(0);
    shield!.stop();

    // 行为有意改变：以前有够格的视频时只认视频，iframe 播放器下面有一段 640×360 的视频，iframe 播放器就不保护了
    setup(`
      <div id="fw" class="barrage-frame"><iframe id="f"></iframe></div>
      <div id="vw" class="barrage-video"><video id="v"></video></div>
      <div id="cw" class="barrage-comments"><iframe id="comments"></iframe></div>`);
    sized($('f'), 1032, 580, 0, 0);
    sized($('v'), 700, 394, 0, 700);
    sized($('comments'), 700, 2400, 0, 1200);
    startShield();
    expect(marked()).toEqual(['fw', 'f']);
    expect(selfHits(shieldCss(), $('vw')).length).toBeGreaterThan(0);
    expect(selfHits(shieldCss(), $('cw')).length).toBeGreaterThan(0);
    // 视频比 iframe 大：保护视频
    sized($('v'), 1280, 720, 0, 700);
    window.dispatchEvent(new Event('resize'));
    await wait(300);
    expect(marked()).toEqual(['vw', 'v']);
  });

  it('shadow root 里的主视频：宿主和外层都标记', () => {
    setup('<div id="outer" class="barrage-box"><x-player id="host"></x-player></div>');
    const root = $('host').attachShadow({ mode: 'open' });
    root.innerHTML = '<div class="inner"><video></video></div>';
    sized(root.querySelector('video')!, 1280, 720);
    startShield();
    expect($('host').hasAttribute(PLAYER)).toBe(true);
    expect($('outer').hasAttribute(PLAYER)).toBe(true);
    expect(hiddenBy(shieldCss(), $('host'))).toEqual([]);
  });

  it('拆开的比分直接摆在播放器外层里：不整块藏（藏不住），改成遮住数字；暂停后恢复', async () => {
    setup('<div id="box"><b>2</b><i>-</i><b>1</b></div>');
    startShield();
    const box = $('box');
    expect(box.getAttribute(ATTR_HIDE)).toBe('score');
    // 之后播放器插进了这个元素：整块藏起会被保护条件抵消，改成遮数字
    box.appendChild(sized(document.createElement('video'), 1032, 580));
    await tick();
    expect(box.hasAttribute(PLAYER)).toBe(true);
    expect(box.textContent).toBe('■-■');
    // 比分又变了：照样遮住
    (box.querySelector('b') as HTMLElement).textContent = '3';
    await tick();
    expect(box.textContent).toBe('■-■');
    shield!.pause();
    expect(box.textContent).toBe('3-1');
  });

  it('页面复制出来的带标记的元素（cloneNode 会带上属性）不算播放器', async () => {
    setup(MIGU_PLAYER);
    sizeMiguPlayer();
    startShield();
    const wrap = $('wrap');
    const deep = wrap.cloneNode(true) as Element;
    deep.id = 'deep';
    const shallow = wrap.cloneNode(false) as Element;
    shallow.id = 'shallow';
    await wait(200);
    document.body.append(deep, shallow);
    await tick();
    expect(deep.hasAttribute(PLAYER)).toBe(false);
    expect(deep.querySelector(`[${PLAYER}]`)).toBeNull();
    expect(shallow.hasAttribute(PLAYER)).toBe(false);
    expect(selfHits(shieldCss(), shallow).join()).toContain("[class*='barrage' i]");
    expect(wrap.hasAttribute(PLAYER)).toBe(true);
  });

  it('后插进来的主视频马上保护（这批变化绘制出来之前），哪怕刚为别的视频判断过', async () => {
    setup(
      '<section id="wrap" class="live-player-cont is-barrage-hidden"><div id="pw"></div></section>',
    );
    startShield();
    // 先插入一个小视频（触发一次判断），紧接着插入主视频
    document.body.appendChild(sized(document.createElement('video'), 10, 10));
    await tick();
    $('pw').appendChild(sized(document.createElement('video'), 1032, 580));
    await tick();
    expect(marked()).toEqual(['wrap', 'pw', 'VIDEO']);
    expect(hiddenBy(shieldCss(), $('pw'))).toEqual([]);
  });

  it('页面复制出来的带标记的元素：紧接着上一次判断复制的，也在绘制出来之前去掉标记', async () => {
    setup(`${IQIYI_PAGE}<div id="side" class="recommend-panel"></div>`, IQIYI_TITLE);
    sizeIqiyi();
    startShield(oldIqiyi);
    expect(marked(OVERLAY)).toEqual(IQIYI_LAYERS);
    document.body.appendChild(sized(document.createElement('video'), 10, 10));
    await tick();
    const copy = $('areaLeftContainer').cloneNode(true) as Element;
    copy.id = 'copy';
    $('side').append(copy);
    await tick();
    expect(copy.hasAttribute(PLAYER)).toBe(false);
    expect(copy.querySelector(MARKS_SELECTOR)).toBeNull();
    expect($('areaLeftContainer').hasAttribute(PLAYER)).toBe(true);
    expect(marked(OVERLAY)).toEqual(IQIYI_LAYERS);
  });

  it('信息流卡片按结构判断，不按宽度：列表里重复的卡片（手机上整宽）、页面有 <h1> 时不含 <h1> 的大图卡片里的视频都是预览', () => {
    // 首页的大图卡片：1200×500 的自动播放预览，页面的 <h1> 在卡片外面
    setup(
      `<h1>精选赛事 英超</h1>
      <div id="hero" class="focus-card"><div class="focus-cover"><video id="hv" autoplay muted loop></video></div>
        <p class="card-title">英超第12轮 曼联vs热刺 全场集锦</p></div>`,
      '咪咕视频-精选赛事 英超 中超',
    );
    sized($('hero'), 1200, 530, 120, 60);
    sized($('hv'), 1200, 500, 120, 60);
    startShield();
    expect($('hero').hasAttribute(ATTR_CARD)).toBe(true);
    expect(marked()).toEqual([]);
    expect(selfHits(shieldCss(), $('hv')).join()).toContain('opacity:0');
    shield!.stop();

    // 手机上的信息流：整宽的足球卡片，第四张自动播放预览
    setViewport(390, 844);
    const card = (i: number) =>
      `<div id="c${i}" class="match-card"><div class="pic-box">${i === 4 ? '<video id="c4v" autoplay muted></video>' : '<img>'}</div><p class="card-title">中超第${i}轮 山东泰山vs成都蓉城 集锦</p></div>`;
    setup(`<div class="list">${[1, 2, 3, 4, 5].map(card).join('')}</div>`, '咪咕视频-精选');
    for (const i of [1, 2, 3, 4, 5]) sized($(`c${i}`), 358, 240, 16, (i - 1) * 252);
    sized($('c4v'), 358, 201, 16, 756);
    startShield();
    expect($('c4').hasAttribute(ATTR_CARD)).toBe(true);
    expect(marked()).toEqual([]);
    expect(selfHits(shieldCss(), $('c4v')).join()).toContain('opacity:0');
    shield!.stop();

    // 大屏上恰好匹配卡片选择器、含 <h1> 的页面主体（比窗口宽度的 60% 窄）：不是信息流卡片
    setViewport(2560, 1440);
    setup(`
      <div id="col" class="match-detail-item"><h1>英超 阿森纳 vs 切尔西</h1>
        <section id="wrap" class="live-player-cont is-barrage-hidden"><video id="v"></video></section>
        <p>阿森纳 主场迎战 切尔西</p></div>`);
    sized($('col'), 1200, 780, 680, 0);
    sized($('v'), 1200, 675, 680, 60);
    startShield();
    expect($('col').hasAttribute(ATTR_CARD)).toBe(true);
    expect(marked()).toEqual(['col', 'wrap', 'v']);
    expect(hiddenBy(shieldCss(), $('v'))).toEqual([]);
  });

  it('遮挡规则命中主播放器的外层：外层里视频旁边的内容照样藏，外层的 class 变了马上跟着改；盖在视频上的界面照常', async () => {
    setup(MIGU_PLAYER);
    sizeMiguPlayer();
    sized($('area'), 1032, 756, 0, 0);
    sized($('right'), 408, 756, 1032, 0);
    startShield();
    expect(marked(BESIDE)).toEqual(['right']);
    const css = shieldCss();
    expect(selfHits(css, $('right')).join()).toContain("[class*='barrage' i]");
    expect(hiddenBy(css, $('main'))).toEqual([]);
    expect(hiddenBy(css, $('area'))).toEqual([]);
    // 播放器自己的弹幕层、比分照样按自己的规则藏，不算“旁边”
    expect($('barrage').hasAttribute(BESIDE)).toBe(false);
    // 外层不再命中弹幕规则：旁边的内容不再藏；又命中了：马上又藏
    $('wrap').className = 'live-player-cont is-normal';
    await tick();
    expect(marked(BESIDE)).toEqual([]);
    $('wrap').className = 'live-player-cont is-normal is-barrage-hidden';
    await tick();
    expect(marked(BESIDE)).toEqual(['right']);
    // 外层里后插进来的子元素
    const tabs = sized(document.createElement('div'), 1032, 40, 0, 756);
    $('wrap').appendChild(tabs);
    await tick();
    expect(tabs.hasAttribute(BESIDE)).toBe(true);
    shield!.stop();

    // 本来就该藏的比分容器恰好包着视频：视频照常，比分（图片数字）照样藏
    setup(`
      <div id="sw" class="live-score-wrap"><div id="teams" class="teams">阿森纳 <img class="num"> - <img class="num"> 切尔西 · 第90+3分钟</div>
        <video id="v"></video></div>`);
    sized($('teams'), 1032, 60, 0, 0);
    sized($('v'), 1032, 581, 0, 60);
    startShield();
    expect(marked()).toEqual(['sw', 'v']);
    expect(marked(BESIDE)).toEqual(['teams']);
    expect(selfHits(shieldCss(), $('teams')).join()).toContain("[class*='score' i]");
    expect(hiddenBy(shieldCss(), $('v'))).toEqual([]);
    shield!.stop();

    // 命中整页容器（比视频大得多）显然是误伤：它里面的其他内容不跟着藏（不能只剩一个播放器）
    setup(`
      <div id="page" class="page-danmu-on"><header id="hd">导航</header>
        <section id="pw"><video id="v"></video></section><div id="info">简介</div></div>`);
    sized($('page'), 1440, 3000, 0, 0);
    sized($('hd'), 1440, 72, 0, 0);
    sized($('v'), 1032, 580, 0, 72);
    sized($('info'), 1440, 2000, 0, 700);
    startShield();
    expect(marked()).toEqual(['page', 'pw', 'v']);
    expect(marked(BESIDE)).toEqual([]);
  });

  it('停止后去掉所有标记', () => {
    setup(`${IQIYI_PAGE}`, IQIYI_TITLE);
    sizeIqiyi();
    startShield(oldIqiyi);
    expect(marked().length).toBeGreaterThan(0);
    expect(marked(OVERLAY).length).toBeGreaterThan(0);
    // 再加上外层旁边的内容、透明层里的海报
    $('areaLeftContainer').classList.add('has-score-panel');
    $('xc').insertAdjacentHTML('beforeend', '<img id="endThumb">');
    sized($('endThumb'), 320, 180, 100, 100);
    shield!.update({ site: { ...oldIqiyi } });
    expect(marked(POSTER)).toEqual(['endThumb']);
    shield!.stop();
    shield = null;
    expect(document.querySelector(MARKS_SELECTOR)).toBeNull();
  });
});

/** 爱奇艺 PC 播放页（照着线上页面）：视频在骨架里的静态节点，XPlayer 的控制层、默认封面层整块盖在上面 */
const IQIYI_TITLE = '欧冠联赛 皇家马德里vs利物浦 全场回放-体育-爱奇艺';
const IQIYI_PAGE = `
<div id="areaLeftContainer">
  <div id="slot"><video id="main" class="fast-play"></video></div>
  <div id="xroot" class="XPlayer_root__eWzab"><div id="content" class="XPlayer_content__qYA-c"><div id="video">
    <div id="videoContent"><div class="Video_container__jfBSy"></div>
      <div id="vcc1" class="XPlayer_defaultCover__JY37H"></div>
      <div id="bar" class="qy-barrage-layer">前方高能</div></div>
    <div id="vcc2" class="XPlayer_defaultCover__JY37H"></div>
    <div id="dc" class="XPlayer_defaultCover__JY37H"><div id="xc" class="XPlayer_cover__nATh2">
      <img id="icon" class="ctrl-icon"><span id="ctrlbg" class="ctrl-bg">播放</span>
      <div id="strip" class="progressBar_bottomCover__f47Ic"></div>
      <div id="score" class="score-board">2-1</div>
    </div></div>
    <img id="posterImg" class="XPlayer_posterCover">
  </div></div></div>
</div>
<div id="tvg"><div id="thumbBox" class="videoListItem_coverContainer__8ZmbJ"><img id="thumb"></div></div>`;
const IQIYI_LAYERS = ['vcc1', 'vcc2', 'dc', 'xc'];

function sizeIqiyi() {
  sized($('main'), 1100, 836, 0, 64);
  for (const id of [...IQIYI_LAYERS, 'xroot', 'content', 'video', 'videoContent', 'posterImg']) {
    if (document.getElementById(id)) sized($(id), 1100, 836, 0, 64);
  }
  if (document.getElementById('strip')) sized($('strip'), 1100, 48, 0, 852);
  sized($('thumbBox'), 116, 65, 1100, 64);
  sized($('thumb'), 116, 65, 1100, 64);
}

describe('盖在主视频上的透明层（爱奇艺、央视频画面被刷成封面）', () => {
  it('爱奇艺：控制层、默认封面层不刷成中性封面，图标照常；弹幕、比分照样藏；选集缩略图、盖在上面的海报图照样换掉', () => {
    setup(IQIYI_PAGE, IQIYI_TITLE);
    sizeIqiyi();
    startShield(oldIqiyi);
    expect(document.documentElement.classList.contains(CLASS_FOOTBALL)).toBe(true);
    expect(marked()).toEqual(['areaLeftContainer', 'slot', 'main']);
    expect(marked(OVERLAY)).toEqual(IQIYI_LAYERS);
    const css = shieldCss();
    expect(css).toContain("[class*='cover' i],");
    expect(hiddenBy(css, $('main'))).toEqual([]);
    // 透明层不刷底色，只去掉它们自己的背景图
    for (const id of IQIYI_LAYERS) expect(blocking(selfHits(css, $(id))), id).toEqual([]);
    for (const id of IQIYI_LAYERS) expect(selfHits(css, $(id)).join(), id).toContain(OWN_BG);
    expect(selfHits(css, $('icon'))).toEqual([]);
    expect(selfHits(css, $('ctrlbg'))).toEqual([]);
    // 遮挡类规则不受影响
    expect(selfHits(css, $('bar')).join()).toContain('visibility:hidden');
    expect(selfHits(css, $('score')).join()).toContain('visibility:hidden');
    // 只盖住一条边的层、替换元素（盖在视频上的海报图）、别处的缩略图：照样换掉
    expect(selfHits(css, $('strip')).join()).toContain('{background:#1f3d2b');
    expect($('posterImg').hasAttribute(OVERLAY)).toBe(false);
    expect(selfHits(css, $('posterImg')).join()).toContain('object-position');
    expect(selfHits(css, $('thumbBox')).join()).toContain('{background:#1f3d2b');
    expect(selfHits(css, $('thumb')).join()).toContain('opacity:0');
  });

  it('央视频直播：盖在视频上的 div.con.poster 不刷成中性封面，按钮图标照常；海报图本身、进度条、别处的封面照样处理', () => {
    setup(
      `<div class="live-main-l-player play-div-div"><div class="play-div-div-content">
        <div id="box" class="c-container img">
          <div id="vc" class="video-con"><video id="main" class="video-js"></video></div>
          <div id="overlay" class="con poster">
            <div class="container"><span id="play" class="play play2"></span></div>
            <div id="pc" class="poster-con"><img id="pcc" class="poster-con-cover"><img id="btn" class="playBtn"></div>
            <div id="prog" class="player-progress"></div>
          </div>
        </div>
      </div></div>
      <div class="list"><div id="card" class="video-card-item"><img id="thumb" class="card-poster"><p>英超 阿森纳 vs 切尔西 集锦</p></div></div>`,
      '2026/27赛季英超第12轮 阿森纳vs切尔西_央视频',
    );
    for (const id of ['main', 'overlay', 'pc', 'pcc', 'box', 'vc']) sized($(id), 978, 550, 30, 100);
    sized($('btn'), 100, 100, 469, 325);
    sized($('card'), 300, 220, 1040, 100);
    sized($('thumb'), 300, 170, 1040, 100);
    startShield(oldYsp);
    expect(marked()).toContain('box');
    expect(marked(OVERLAY)).toEqual(['overlay', 'pc']);
    const css = shieldCss();
    expect(hiddenBy(css, $('main'))).toEqual([]);
    expect(blocking(selfHits(css, $('overlay')))).toEqual([]);
    expect(selfHits(css, $('play'))).toEqual([]);
    expect(selfHits(css, $('btn'))).toEqual([]);
    expect(selfHits(css, $('pcc')).join()).toContain('object-position');
    expect(selfHits(css, $('prog')).join()).toContain('opacity:0');
    expect(selfHits(css, $('thumb')).join()).toContain('object-position');
  });

  it('透明层比视频后渲染出来也会标记；视频移走后标记去掉', async () => {
    setup(IQIYI_PAGE, IQIYI_TITLE);
    const xroot = $('xroot');
    xroot.remove();
    sizeIqiyi();
    startShield(oldIqiyi);
    expect(marked()).toContain('main');
    expect(marked(OVERLAY)).toEqual([]);
    $('areaLeftContainer').appendChild(xroot);
    sizeIqiyi();
    await wait(300);
    expect(marked(OVERLAY)).toEqual(IQIYI_LAYERS);
    expect(blocking(selfHits(shieldCss(), $('xc')))).toEqual([]);

    $('main').remove();
    await wait(300);
    expect(marked()).toEqual([]);
    expect(marked(OVERLAY)).toEqual([]);
    expect(selfHits(shieldCss(), $('xc')).join()).toContain('{background:#1f3d2b');
  });

  it('先藏着、后来才显示出来的层（咪咕的版权/出错提示层）：尺寸一变就重新判断，不刷成中性封面', async () => {
    // jsdom 没有 ResizeObserver：换成一个记下盯着哪些元素、能手动触发回调的
    const observed = new Set<Element>();
    let notify: (entries: Array<{ target: Element }>) => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: Array<{ target: Element }>) => void) {
          notify = callback;
        }
        observe(el: Element) {
          observed.add(el);
        }
        unobserve(el: Element) {
          observed.delete(el);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
    setup(`
      <section id="mod" class="mod-player">
        <div id="vw" class="video-wrapper"><div id="mg" class="mg_player_wrapper"><video id="main"></video></div></div>
        <div id="err" class="mg-cover mg-cover-shadow"><p>很抱歉，因版权限制，请前往咪咕视频APP继续观看</p><img id="qr"></div>
      </section>
      <div class="pic-list"><img id="thumb"></div>`);
    sized($('main'), 1032, 756);
    startShield({ ...oldMigu, coverSelectors: OLD_MIGU_COVER });
    expect(marked()).toContain('mod');
    expect($('err').hasAttribute(OVERLAY)).toBe(false);
    expect(observed.has($('err'))).toBe(true);
    expect(observed.has($('main'))).toBe(true);
    // 离主视频远的封面元素不用盯
    expect(observed.has($('thumb').parentElement!)).toBe(false);

    // 开始盯着时的第一次通知（尺寸没变）：不重新判断
    const measured = sheetDisabledAtMeasure.length;
    notify([{ target: $('main') }, { target: $('err') }]);
    await wait(300);
    expect(sheetDisabledAtMeasure.length - measured).toBe(2);

    sized($('err'), 1032, 756);
    sized($('qr'), 120, 120, 456, 400);
    notify([{ target: $('err') }]);
    await wait(300);
    expect($('err').hasAttribute(OVERLAY)).toBe(true);
    const css = shieldCss();
    expect(blocking(selfHits(css, $('err')))).toEqual([]);
    // 层里不到海报大小的二维码照常显示，盯着它的尺寸
    expect(selfHits(css, $('qr'))).toEqual([]);
    expect(observed.has($('qr'))).toBe(true);
    expect(selfHits(css, $('thumb')).join()).toContain('opacity:0');
    // 层里藏着的图片显示出来、变成海报大小：通知一到马上换掉（ResizeObserver 的通知在绘制之前）
    sized($('qr'), 320, 180, 356, 300);
    notify([{ target: $('qr') }]);
    expect($('qr').hasAttribute(POSTER)).toBe(true);
    expect(selfHits(shieldCss(), $('qr')).join()).toContain('opacity:0');
    expect(observed.has($('qr'))).toBe(false);
  });

  it('透明层里海报大小的图片、背景图照样换掉（海报层、片尾推荐、后插进来的缩略图），小图标照常显示；整页弹窗不算透明层', async () => {
    setup(`
      <section id="mod" class="mod-player"><video id="main"></video>
        <div id="poster" class="video-poster" style="background-image:url(poster.jpg)"></div>
        <div id="end" class="end-cover"><p>您观看的视频已播放完毕 · 热门推荐</p>
          <img id="t1"><img id="icon"><div id="t2" style="background-image:url(t2.jpg)"></div><div id="list"></div></div>
      </section>
      <div id="popup" class="popup-cover"><p>继续观看 · 为你推荐</p><img id="pt"></div>`);
    sized($('main'), 1032, 581, 0, 0);
    sized($('poster'), 1032, 581, 0, 0);
    sized($('end'), 1032, 581, 0, 0);
    sized($('t1'), 200, 112, 40, 100);
    sized($('icon'), 32, 32, 16, 530);
    sized($('t2'), 200, 112, 260, 100);
    sized($('popup'), 1440, 900, 0, 0);
    sized($('pt'), 240, 135, 600, 380);
    startShield();
    expect(marked(OVERLAY)).toEqual(['poster', 'end']);
    expect(marked(POSTER)).toEqual(['t1', 't2']);
    const css = shieldCss();
    // 海报层：不刷底色（不挡画面），它自己的海报背景图照样去掉
    expect(blocking(selfHits(css, $('poster')))).toEqual([]);
    expect(selfHits(css, $('poster')).join()).toContain(OWN_BG);
    // 片尾推荐的缩略图照样换掉，控制图标照常
    expect(selfHits(css, $('t1')).join()).toContain('opacity:0');
    expect(selfHits(css, $('t2')).join()).toContain(BG_ONLY);
    expect(selfHits(css, $('icon'))).toEqual([]);
    // 比视频大得多的整页弹窗不是播放器的透明层：照样刷成中性封面，里面的缩略图照样透明
    expect(selfHits(css, $('popup')).join()).toContain('{background:#1f3d2b');
    expect(selfHits(css, $('pt')).join()).toContain('opacity:0');

    // 后插进来的缩略图：这批变化绘制出来之前就换掉（距上次判断不到 150ms）
    const t3 = sized(document.createElement('img'), 200, 112, 480, 100);
    $('list').appendChild(t3);
    await tick();
    expect(t3.hasAttribute(POSTER)).toBe(true);
    expect(selfHits(shieldCss(), t3).join()).toContain('opacity:0');
  });

  it('透明层停在控制栏上方、只盖住视频里 16:9 的画面部分也算；只盖住一条边的、替换元素不算', () => {
    setup(`
      <div id="wrap" class="mg_player_wrapper"><video id="main"></video>
        <div id="above" class="player-poster-layer"></div>
        <div id="pic" class="video-cover-mask"></div>
        <div id="bar" class="bottom-cover"></div>
        <img id="img" class="poster-img"></div>`);
    // 1032×756 的视频元素（咪咕），控制层停在底部 96px 的控制栏上方（87%），画面层只盖住中间 16:9 的部分（77%）
    sized($('main'), 1032, 756, 0, 0);
    sized($('above'), 1032, 660, 0, 0);
    sized($('pic'), 1032, 580, 0, 88);
    sized($('bar'), 1032, 64, 0, 692);
    sized($('img'), 1032, 756, 0, 0);
    startShield();
    expect(marked(OVERLAY)).toEqual(['above', 'pic']);
    const css = shieldCss();
    for (const id of ['above', 'pic']) expect(blocking(selfHits(css, $(id))), id).toEqual([]);
    expect(selfHits(css, $('bar')).join()).toContain('{background:#1f3d2b');
    expect(selfHits(css, $('img')).join()).toContain('object-position');
  });

  it('后来才加上 class 的层、紧接着插进来的层：这批变化绘制出来之前就判断是不是透明层', async () => {
    setup(
      `<div id="wrap" class="mg_player_wrapper"><video id="main"></video><div id="layer" class="layer"></div></div>`,
    );
    sized($('main'), 1032, 580, 0, 0);
    sized($('layer'), 1032, 580, 0, 0);
    startShield();
    expect(marked(OVERLAY)).toEqual([]);
    // 暂停时页面给层加上 class，它才命中封面选择器
    $('layer').className = 'layer pause-cover-show';
    await tick();
    expect($('layer').hasAttribute(OVERLAY)).toBe(true);
    expect(blocking(selfHits(shieldCss(), $('layer')))).toEqual([]);
    // 视频之后马上（距上次判断不到 150ms）插进来的层
    const late = sized(document.createElement('div'), 1032, 580, 0, 0);
    late.className = 'player-poster-layer';
    $('wrap').appendChild(late);
    await tick();
    expect(late.hasAttribute(OVERLAY)).toBe(true);
  });

  it('封面元素是主视频的外层时不算透明层（它是播放器的一部分，本身就不刷）', () => {
    setup(
      '<div id="zone" class="match-cover-zone"><div id="pw"><video id="main"></video></div><div class="strip"><img id="t"></div></div>',
    );
    sized($('zone'), 1032, 700);
    sized($('main'), 1032, 580);
    startShield();
    expect($('zone').hasAttribute(PLAYER)).toBe(true);
    expect($('zone').hasAttribute(OVERLAY)).toBe(false);
    const css = shieldCss();
    expect(selfHits(css, $('zone')).join()).not.toContain('{background:');
    // 它自己的背景图（海报）照样去掉：画在视频下面，挡不住画面
    expect(selfHits(css, $('zone')).join()).toContain(OWN_BG);
    expect(selfHits(css, $('t')).join()).toContain('opacity:0');
    expect(hiddenBy(css, $('main'))).toEqual([]);
  });
});
