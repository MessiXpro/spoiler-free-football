// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.miguvideo.com/p/live/120000000001"}
/**
 * 咪咕回放页默认播「全场集锦」（几分钟的进球合集）：插件/脚本替用户切到第一个全场回放（dom/playback.ts，由 bootShield 启动）。
 * 回放条的结构照抄线上页面（button.match-review__slide，当前播放的带 is-active）；播放器挂在 #sport-live 里，
 * 挂载好之后才有 <video>（线上冷启动时回放条先出来、播放器晚好几秒）。节目 id、解说名都是假的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootShield,
  defaultRules,
  defaultShieldSettings,
  programKind,
  READY_SETTLE_MS,
  type ShieldController,
  type ShieldSettings,
} from '../src/dom/index.ts';
import { matchSite, validateSiteRules, type SiteRule, type SiteRulesDoc } from '../src/index.ts';

const BASE = 'https://example.github.io/app/data/';
const START = '/p/live/120000000001';
const NEXT = '/p/live/120000000002';
const PROGRAMS = [
  '全场集锦',
  '全场回放（解说甲、解说乙）',
  '全场回放（解说丙）',
  '全场回放（智能解说）',
];
const FIRST_FULL = '全场回放（解说甲、解说乙）';

/** 回放条（照抄线上结构）；active 是当前节目的下标，-1 表示还没有选中的 */
function strip(programs: string[] = PROGRAMS, active = 0, cls = 'match-review'): string {
  const slides = programs.map(
    (name, i) =>
      `<button type="button" class="match-review__slide${i === active ? ' is-active' : ''}" data-program-id="p${i + 1}">` +
      `<img alt="${name}" src="poster.webp"><span class="match-review__mask"></span>` +
      `<span class="match-review__title"><span class="match-review__title-text">${name}</span></span></button>`,
  );
  return `<section class="${cls}"><div class="match-review__label" aria-label="本场回顾"></div><div class="match-review__list">${slides.join('')}</div></section>`;
}
const render = (html: string) => {
  document.getElementById('slot')!.innerHTML = html;
};
/** 播放器挂载好：和线上一样，#sport-live 里出现 <video> */
const mountPlayer = () => {
  document.getElementById('sport-live')!.innerHTML =
    '<div class="mg_player_wrapper"><video id="m-player" class="m-player"></video></div>';
};
const slides = () => [...document.querySelectorAll('.match-review__slide')];
const activeName = () =>
  document.querySelector('.match-review__slide.is-active')?.textContent?.trim() ?? null;

/** 页面自己的行为（像线上的 Vue 那样）：点条目，is-active 挪过去；每次点击都记下来 */
let clicks: Array<{ text: string; trusted: boolean }> = [];
let afterPageClick: ((slide: Element) => void) | null = null;
const onPageClick = (e: Event) => {
  const slide = (e.target as Element).closest('.match-review__slide');
  if (!slide) return;
  const text = slide.textContent?.trim() || slide.querySelector('img')?.getAttribute('alt') || '';
  clicks.push({ text, trusted: e.isTrusted });
  slide.parentElement
    ?.querySelectorAll('.match-review__slide')
    .forEach((s) => s.classList.toggle('is-active', s === slide));
  afterPageClick?.(slide);
};
/** 插件/脚本自己点的（不可信的点击） */
const picked = () => clicks.filter((c) => !c.trusted).map((c) => c.text);

/**
 * 用户自己点：jsdom 的 dispatchEvent 一律当成不可信，只能借它内部的派发造一个可信的点击
 * （用到它的测试都会检查页面收到的这次点击确实是可信的，jsdom 改了内部结构会直接失败，不会悄悄通过）
 */
function userClick(el: Element) {
  const impl = (o: object) => {
    const sym = Object.getOwnPropertySymbols(o).find((s) => s.description === 'impl')!;
    return (o as unknown as Record<symbol, { isTrusted: boolean; _dispatch(e: unknown): void }>)[
      sym
    ]!;
  };
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  impl(ev).isTrusted = true;
  impl(el)._dispatch(impl(ev));
}

/** 让假时钟走 ms 毫秒，再把这一轮变化和插件的判断都处理完（MutationObserver 回调、判断在微任务里） */
async function wait(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
/** 足够让插件判断完、等播放器稳定完 */
const settle = () => wait(1000);

const controllers: ShieldController[] = [];
function boot(settings: ShieldSettings = defaultShieldSettings(BASE)): ShieldController {
  const c = bootShield(document, settings, { siteMode: true });
  controllers.push(c);
  return c;
}

/** 内置规则（带 playback），版本改大；改动咪咕那一条 */
function rulesWith(patch: (site: SiteRule) => SiteRule): SiteRulesDoc {
  const rules = defaultRules();
  return {
    ...rules,
    version: '9999-12-31',
    sites: rules.sites.map((s) => (s.id === 'miguvideo' ? patch(s) : s)),
  };
}
const withPlayback = (patch: Partial<NonNullable<SiteRule['playback']>>) =>
  rulesWith((s) => ({ ...s, playback: { ...s.playback!, ...patch } }));

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, '', START);
  document.title = '英超联赛-咪咕视频';
  document.documentElement.className = '';
  document.body.innerHTML =
    '<div id="app"><p class="now">正在播放</p><div id="sport-live" class="live-player-mount"></div><div id="slot"></div></div>';
  clicks = [];
  afterPageClick = null;
  document.addEventListener('click', onPageClick);
});

afterEach(() => {
  for (const c of controllers.splice(0)) c.stop();
  document.removeEventListener('click', onPageClick);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('咪咕回放页：默认是全场集锦时切到第一个全场回放', () => {
  it('页面打开后回放条和播放器先后出来（默认选中全场集锦）：替用户点一次第一个全场回放，别的都不点', async () => {
    boot();
    await wait();
    mountPlayer();
    render(strip());
    await settle();
    expect(activeName()).toBe(FIRST_FULL);
    expect(clicks).toEqual([{ text: FIRST_FULL, trusted: false }]);
  });

  it('条目先出来、过一会儿才标出当前节目；当前节目的标题后渲染：都等到了再判断', async () => {
    boot();
    mountPlayer();
    render(strip(PROGRAMS, -1));
    await settle();
    expect(clicks).toEqual([]);
    // 当前节目先是个空按钮（标题还没出来，只有个零宽空格）
    const first = slides()[0]!;
    first.querySelector('img')!.removeAttribute('alt');
    first.querySelector('.match-review__title-text')!.textContent = String.fromCharCode(0x200b);
    first.classList.add('is-active');
    await settle();
    expect(clicks).toEqual([]);
    first.querySelector('.match-review__title-text')!.textContent = '全场集锦';
    await settle();
    expect(activeName()).toBe(FIRST_FULL);
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('当前已经是全场回放：不点；之后用户切到全场集锦，集锦照常播，不会被切回去', async () => {
    boot();
    mountPlayer();
    render(strip(PROGRAMS, 2));
    await settle();
    expect(clicks).toEqual([]);
    userClick(slides()[0]!);
    await settle();
    expect(clicks).toEqual([{ text: '全场集锦', trusted: true }]);
    expect(activeName()).toBe('全场集锦');
    // 对照：同一个控制器在下一个回放页（单页应用换页）照常切换
    history.pushState(null, '', NEXT);
    render(strip());
    await settle();
    expect(activeName()).toBe(FIRST_FULL);
  });

  it('用户在插件判断之前自己点了条目：这个页面交给用户，不再切换', async () => {
    boot();
    mountPlayer();
    // 条目都在，但页面还没标出当前节目：用户先点了全场集锦
    render(strip(PROGRAMS, -1));
    await settle();
    userClick(slides()[0]!);
    await settle();
    expect(clicks).toEqual([{ text: '全场集锦', trusted: true }]);
    expect(activeName()).toBe('全场集锦');
    // 页面重新渲染回放条（默认又是集锦）也不动
    render(strip());
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([]);
    // 对照：下一个页面照常切换
    history.pushState(null, '', NEXT);
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('页面脚本自己点了条目（不可信的点击，比如初始化时选中默认节目）：不当成用户的选择，照常切换', async () => {
    boot();
    mountPlayer();
    render(strip(PROGRAMS, -1));
    await settle();
    (slides()[0] as HTMLElement).click();
    await settle();
    expect(activeName()).toBe(FIRST_FULL);
    // 页面脚本点的全场集锦，然后才是插件点的全场回放
    expect(clicks).toEqual([
      { text: '全场集锦', trusted: false },
      { text: FIRST_FULL, trusted: false },
    ]);
  });

  it('每个页面只切一次：切过之后用户点全场集锦，集锦照常播；页面重新渲染回放条也不再切', async () => {
    boot();
    mountPlayer();
    render(strip());
    await settle();
    expect(activeName()).toBe(FIRST_FULL);
    userClick(slides()[0]!);
    await settle();
    expect(activeName()).toBe('全场集锦');
    render(strip());
    await settle();
    expect(activeName()).toBe('全场集锦');
    // 只改 # 不算换页
    location.hash = '#comments';
    render(strip());
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([FIRST_FULL]);
    expect(clicks.filter((c) => c.trusted)).toHaveLength(1);
  });

  it('单页应用换页：新地址重新判断一次；回放条还是上一页的时候不判断；回到处理过的地址不再碰', async () => {
    boot();
    mountPlayer();
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
    history.pushState(null, '', NEXT);
    // 换页后先出别的内容，回放条还是上一页的（当前是刚切过去的全场回放）：不能据此认为新页面不用换
    document.getElementById('app')!.insertAdjacentHTML('beforeend', '<div class="loading">…</div>');
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
    render(strip(['全场集锦', '全场回放（解说丁）']));
    await settle();
    expect(activeName()).toBe('全场回放（解说丁）');
    // 回到第一页：地址处理过了，默认又是集锦也不再切
    history.pushState(null, '', START);
    render(strip());
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([FIRST_FULL, '全场回放（解说丁）']);
  });

  it('换页时回放条跟着新内容一起重新渲染（同一批变化）：照常切换', async () => {
    boot();
    mountPlayer();
    render(strip(PROGRAMS, 1));
    await settle();
    history.pushState(null, '', NEXT);
    render(strip(['全场集锦', '全场回放（解说丁）']));
    await settle();
    expect(picked()).toEqual(['全场回放（解说丁）']);
  });

  it('临时显示期间不动；临时显示结束（还在 30 秒内）再切', async () => {
    const c = boot();
    mountPlayer();
    c.pause(5000);
    render(strip());
    await wait(3000);
    expect(clicks).toEqual([]);
    // 计时器到期自动恢复遮挡
    await wait(2000);
    expect(c.shield?.stats.paused).toBe(false);
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('临时显示期间用户自己点了全场集锦、或者临时显示超过 30 秒：恢复遮挡后都不再切', async () => {
    const c = boot();
    mountPlayer();
    c.pause(60_000);
    render(strip());
    await wait();
    userClick(slides()[0]!);
    c.resume();
    await wait(2000);
    expect(activeName()).toBe('全场集锦');
    // 下一个页面：一直临时显示到 30 秒以后
    history.pushState(null, '', NEXT);
    c.pause(60_000);
    render(strip());
    await wait(31_000);
    c.resume();
    await wait(2000);
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([]);
    // 对照：再下一个页面，遮挡一直在工作，照常切换
    history.pushState(null, '', '/p/live/120000000003');
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('停用此站点、关掉插件时不动也不再监听；重新启用（还在 30 秒内）照常切', async () => {
    const s = defaultShieldSettings(BASE);
    const c = boot(s);
    expect(vi.getTimerCount()).toBe(1);
    c.update({ ...s, disabledHosts: ['miguvideo.com'] });
    expect(vi.getTimerCount()).toBe(0);
    mountPlayer();
    render(strip());
    await wait(2000);
    c.update({ ...s, enabled: false });
    await wait();
    expect(clicks).toEqual([]);
    c.update(s);
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('停用超过 30 秒后才重新启用：不动正在看的页面', async () => {
    const s = defaultShieldSettings(BASE);
    const c = boot({ ...s, enabled: false });
    mountPlayer();
    render(strip());
    await wait(31_000);
    c.update(s);
    await settle();
    expect(c.active).toBe(true);
    expect(activeName()).toBe('全场集锦');
    // 对照：启用之后换到下一个页面照常切换
    history.pushState(null, '', NEXT);
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('停用期间单页应用换了页：重新启用后不动这个页面（不知道它是什么时候打开的）', async () => {
    const s = defaultShieldSettings(BASE);
    const c = boot(s);
    mountPlayer();
    c.update({ ...s, enabled: false });
    history.pushState(null, '', NEXT);
    render(strip());
    await wait();
    c.update(s);
    await settle();
    // 页面之后重新渲染回放条（默认又是集锦）也不动
    render(strip());
    await settle();
    expect(c.active).toBe(true);
    expect(activeName()).toBe('全场集锦');
    // 对照：启用之后再换页，照常切换
    history.pushState(null, '', '/p/live/120000000003');
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('stop()：断开监听、清掉计时器，之后的设置更新也不再启动', async () => {
    const s = defaultShieldSettings(BASE);
    const c = boot(s);
    // 还在等回放条：每秒看一次的计时器在跑
    expect(vi.getTimerCount()).toBe(1);
    c.pause(60_000);
    expect(vi.getTimerCount()).toBe(2);
    c.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(c.active).toBe(false);
    c.update(s);
    mountPlayer();
    render(strip());
    await wait(61_000);
    expect(clicks).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() 之前已经排好的判断（等播放器稳定的计时器、这一轮变化的判断）不会再点', async () => {
    const c = boot();
    render(strip());
    await wait(1000);
    mountPlayer();
    await wait(100);
    render(strip());
    c.stop();
    await wait(5000);
    expect(clicks).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('30 秒内没等到可切换的全场回放：这个页面不再碰', async () => {
    boot();
    mountPlayer();
    render(strip(['全场集锦', '赛前分析']));
    await wait(29_000);
    expect(vi.getTimerCount()).toBe(1);
    await wait(2000);
    expect(vi.getTimerCount()).toBe(0);
    render(strip());
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(clicks).toEqual([]);
    // 对照：下一个页面 29 秒时才出现回放条，照常切换
    history.pushState(null, '', NEXT);
    document.getElementById('app')!.append(document.createElement('i'));
    await wait(29_000);
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });
});

describe('等播放器挂载好再点（播放器挂载前点的切换会丢：只换了高亮和标题，播放器照样放集锦）', () => {
  it('回放条先出来、播放器晚好几秒（线上冷启动就是这样）：播放器出来之前一下都不点，出来稳定一会儿再点', async () => {
    boot();
    render(strip());
    await wait(5000);
    expect(clicks).toEqual([]);
    expect(activeName()).toBe('全场集锦');
    mountPlayer();
    await wait(READY_SETTLE_MS - 100);
    expect(clicks).toEqual([]);
    await wait(300);
    expect(activeName()).toBe(FIRST_FULL);
    expect(clicks).toEqual([{ text: FIRST_FULL, trusted: false }]);
  });

  it('播放器先好、回放条后出来（刷新、缓存是热的时候）：回放条一出来就点，不用再等播放器稳定', async () => {
    boot();
    mountPlayer();
    await wait(2000);
    render(strip());
    await wait(150);
    expect(150).toBeLessThan(READY_SETTLE_MS);
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('等播放器稳定期间 <video> 被换掉（播放器重建）：重新等', async () => {
    boot();
    render(strip());
    await wait(1000);
    mountPlayer();
    await wait(READY_SETTLE_MS - 100);
    mountPlayer();
    await wait(READY_SETTLE_MS - 100);
    expect(clicks).toEqual([]);
    await wait(300);
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('播放器一直没好：找到要点的全场回放后最多再等 30 秒（回放条 20 秒才出来、播放器 45 秒才好也照常切）', async () => {
    boot();
    await wait(20_000);
    render(strip());
    await wait(25_000);
    expect(clicks).toEqual([]);
    mountPlayer();
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
    // 下一个页面：回放条 1 秒就出来，播放器 32 秒以后才好：不再碰（这时用户多半已经自己点过了）
    history.pushState(null, '', NEXT);
    document.getElementById('sport-live')!.innerHTML = '';
    render(strip());
    await wait(32_000);
    mountPlayer();
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([FIRST_FULL]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('站点规则没写 ready：不等播放器，回放条出来就点', async () => {
    const rules = rulesWith((s) => ({
      ...s,
      playback: { items: '.match-review__slide', active: '.is-active' },
    }));
    boot({ ...defaultShieldSettings(BASE), rules });
    render(strip());
    await wait();
    expect(picked()).toEqual([FIRST_FULL]);
  });
});

describe('只在足球比赛的回放页上换：回放条和节目名本身不算足球', () => {
  it.each([
    'NBA常规赛 湖人vs勇士-咪咕视频',
    'CBA常规赛 广东vs辽宁-咪咕视频',
    '中国网球公开赛 男单决赛-咪咕视频',
    // 「联赛」本来也算足球语境词：标题写明是篮球就不算
    'CBA联赛-咪咕视频',
    '广东省女子篮球联赛-咪咕视频',
    // 咪咕的标题就是赛事名：别的运动的赛事名里也有「联赛」「世界杯」「预选赛」「德比」，没写是哪个运动也不算足球
    // （东亚超级联赛是篮球；前两个是咪咕赛程里的原标题，最后一个是羽毛球）
    '东亚超级联赛B组常规赛-咪咕视频',
    '国际滑联速度滑冰世界杯北京站Day1-咪咕视频',
    '男篮世界杯亚洲区预选赛 中国vs日本-咪咕视频',
    '世界女排联赛 中国vs巴西-咪咕视频',
    '女排世界杯-咪咕视频',
    '国际滑联短道速滑世界杯-咪咕视频',
    '田径钻石联赛 上海站-咪咕视频',
    '跳水世界杯 总决赛-咪咕视频',
    '王者荣耀职业联赛-咪咕视频',
    '王昶/谢浩南拿下德比战！梨子组合止步-咪咕视频',
    // 别的运动借了足球的赛事名（欧冠、世俱杯、世预赛）：标题写明是哪个运动就不算
    '篮球欧冠 小组赛-咪咕视频',
    '女排世俱杯 决赛-咪咕视频',
    '男篮世预赛 中国vs日本-咪咕视频',
    // 咪咕赛程里的原标题：英文缩写后面紧跟字母也认
    'NBANBA杯-咪咕视频',
  ])(
    '内置规则、标题「%s」：回放条里的「全场集锦」「全场回放」、播放器上方的节目名都不算，不点',
    async (title) => {
      document.title = title;
      boot();
      mountPlayer();
      // 播放器上方的节目标题（线上是 .common-title__name，和当前节目同名）
      document
        .getElementById('app')!
        .insertAdjacentHTML(
          'afterbegin',
          '<div class="common-title"><span class="common-title__name">全场集锦</span></div>',
        );
      render(
        strip([
          '全场集锦',
          '全场回放（解说甲、解说乙）',
          '全场回放（英文原声）',
          '第一节',
          '第二节',
        ]),
      );
      await wait(5000);
      expect(clicks).toEqual([]);
      expect(activeName()).toBe('全场集锦');
    },
  );

  it.each([
    '中超联赛-咪咕视频',
    '中国女足 vs 日本女足 友谊赛-咪咕视频',
    // 咪咕赛程里的原标题
    '西甲联赛-咪咕视频',
    '足总杯第一轮-咪咕视频',
    '英女超联赛-咪咕视频',
    '熊猫杯国际足球锦标赛友谊赛-咪咕视频',
    '湘超1/4决赛第一回合-咪咕视频',
    '琼超-咪咕视频',
    '苏超第10轮 南京vs苏州-咪咕视频',
    '中国足协杯决赛-咪咕视频',
    // 前面没写别的项目的「世界杯」是足球
    '世界杯小组赛 阿根廷vs法国-咪咕视频',
    '2026年美加墨世界杯 1/8决赛-咪咕视频',
    '2030世界杯亚洲区预选赛 中国vs日本-咪咕视频',
    '世预赛亚洲区 中国vs日本-咪咕视频',
    // 队名里夹着别的运动的英文缩写（rase-nba-llsport）不算写明了别的运动
    'RasenBallsport Leipzig vs Bayern-咪咕视频',
  ])('对照：标题「%s」是足球，照常切', async (title) => {
    document.title = title;
    boot();
    mountPlayer();
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('页面变成足球比赛后（30 秒内）再切', async () => {
    document.title = '烹饪大赛 第3期-咪咕视频';
    boot();
    mountPlayer();
    render(strip());
    await wait(3000);
    expect(clicks).toEqual([]);
    document.title = '英超联赛-咪咕视频';
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('标题没写赛事、语境元素里有（比赛标题、队名）：照常切', async () => {
    document.title = '咪咕视频';
    boot();
    mountPlayer();
    document
      .getElementById('app')!
      .insertAdjacentHTML('afterbegin', '<div class="match-title">英超第12轮 曼城vs利物浦</div>');
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  /** 两小时前在防剧透网页上点了这场比赛的链接（6 小时内同一平台的页面都算在看这场） */
  const fromWebApp = (url: string): ShieldSettings => ({
    ...defaultShieldSettings(BASE),
    currentMatch: {
      id: 'm1',
      title: '曼城 vs 利物浦',
      competition: 'epl',
      kickoff: '2026-11-08T16:30:00Z',
      home: { id: 'man-city', name: '曼城' },
      away: { id: 'liverpool', name: '利物浦' },
      url,
      host: 'www.miguvideo.com',
      at: Date.now() - 2 * 3600_000,
    },
  });

  it.each([
    'NBA常规赛-咪咕视频',
    '东亚超级联赛B组常规赛-咪咕视频',
    // 咪咕赛程里的篮球比赛（广东省女子篮球联赛），标题只有队名和比分
    '惠州92-49清远-咪咕视频',
    '咪咕视频',
  ])(
    '从防剧透网页的入口页链接（咪咕全部赛程）进去、6 小时内打开的回放页，标题「%s」没说是足球：不点（进去以后看的是哪一页不知道）',
    async (title) => {
      document.title = title;
      boot(fromWebApp('https://www.miguvideo.com/p/schedule/?competitionId=all'));
      mountPlayer();
      render(strip());
      await wait(5000);
      expect(clicks).toEqual([]);
      expect(activeName()).toBe('全场集锦');
    },
  );

  it('防剧透网页直接链到这个回放页（正在看的比赛）：标题没写足球也切；单页应用换到别的回放页就不算了', async () => {
    document.title = '咪咕视频';
    boot(fromWebApp(`https://www.miguvideo.com${START}#from-app`));
    mountPlayer();
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
    history.pushState(null, '', NEXT);
    render(strip());
    await wait(5000);
    expect(picked()).toEqual([FIRST_FULL]);
    expect(activeName()).toBe('全场集锦');
  });

  it('防剧透网页直接链到这个回放页，标题却写明是别的运动：不点', async () => {
    document.title = 'NBA常规赛-咪咕视频';
    boot(fromWebApp(`https://www.miguvideo.com${START}`));
    mountPlayer();
    render(strip());
    await wait(5000);
    expect(clicks).toEqual([]);
  });
});

describe('只点当前节目同一列表里、不会离开页面的全场回放', () => {
  it('条目是本站链接（点了会重新打开页面，又是集锦，会一直点下去）、或者整条在链接里：都不点', async () => {
    boot();
    mountPlayer();
    render(`<section class="match-review"><div class="match-review__list">
      <a class="match-review__slide is-active" href="/p/live/120000000001?pid=p1">全场集锦</a>
      <a class="match-review__slide" href="/p/live/120000000001?pid=p2">全场回放（解说甲）</a>
      <a class="match-review__slide" href="">全场回放（解说乙）</a>
    </div></section>`);
    await settle();
    expect(clicks).toEqual([]);
    history.pushState(null, '', NEXT);
    render(
      `<a href="/p/live/120000000002?from=strip"><div class="match-review__list">
        <span class="match-review__slide is-active">全场集锦</span>
        <span class="match-review__slide">全场回放（解说甲）</span>
      </div></a>`,
    );
    await settle();
    expect(clicks).toEqual([]);
    // 对照：只跳到本页某处的 # 链接不离开页面，可以点
    history.pushState(null, '', '/p/live/120000000003');
    render(`<section class="match-review"><div class="match-review__list">
      <a class="match-review__slide is-active" href="#p1">全场集锦</a>
      <a class="match-review__slide" href="#p2">全场回放（解说甲）</a>
    </div></section>`);
    await settle();
    expect(picked()).toEqual(['全场回放（解说甲）']);
  });

  it('外站链接、javascript: 链接、表单提交按钮、禁用的按钮：跳过，点后面能点的；都不能点就不点', async () => {
    boot();
    mountPlayer();
    render(`<section class="match-review"><div class="match-review__list">
      <button type="button" class="match-review__slide is-active">全场集锦</button>
      <a class="match-review__slide" href="https://other.example.com/r2">全场回放（外站链接）</a>
      <a class="match-review__slide" href="javascript:void(0)">全场回放（脚本链接）</a>
      <button type="button" class="match-review__slide" disabled>全场回放（不可用）</button>
      <button type="button" class="match-review__slide">全场回放（本站）</button>
    </div></section>`);
    await settle();
    expect(picked()).toEqual(['全场回放（本站）']);
    history.pushState(null, '', NEXT);
    render(`<form><div class="match-review__list">
      <button class="match-review__slide is-active">全场集锦</button>
      <button class="match-review__slide">全场回放（提交按钮）</button>
      <button type="button" class="match-review__slide">全场回放（普通按钮）</button>
    </div></form>`);
    await settle();
    expect(picked()).toEqual(['全场回放（本站）', '全场回放（普通按钮）']);
    history.pushState(null, '', '/p/live/120000000003');
    render(`<section class="match-review"><div class="match-review__list">
      <button type="button" class="match-review__slide is-active">全场集锦</button>
      <a class="match-review__slide" href="https://other.example.com/r3">全场回放（外站链接）</a>
    </div></section>`);
    await settle();
    expect(picked()).toEqual(['全场回放（本站）', '全场回放（普通按钮）']);
    expect(activeName()).toBe('全场集锦');
  });

  it('页面上另有一个回放列表（别的比赛）排在前面：只在当前节目所在的列表里找', async () => {
    document
      .getElementById('app')!
      .insertAdjacentHTML(
        'afterbegin',
        strip(['曼城vs利物浦 全场回放', '阿森纳vs切尔西 全场回放'], -1, 'other-review'),
      );
    boot();
    mountPlayer();
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('规则被改成很宽的选择器（所有链接和按钮）：页面别处的本站链接、按钮（开通会员看完整回放）不点，只点回放条里的', async () => {
    document
      .getElementById('app')!
      .insertAdjacentHTML(
        'afterbegin',
        '<nav><a href="/p/vip/buy" id="vip">开通会员 看完整回放</a><button type="button" id="all">全场回放</button></nav>' +
          '<button type="button" id="buy">立即购买</button><button type="button" id="login">登录</button>',
      );
    const other: string[] = [];
    for (const id of ['vip', 'all', 'buy', 'login']) {
      document.getElementById(id)!.addEventListener('click', (e) => {
        other.push(id);
        e.preventDefault();
      });
    }
    boot({ ...defaultShieldSettings(BASE), rules: withPlayback({ items: 'a, button' }) });
    mountPlayer();
    render(strip());
    await settle();
    expect(other).toEqual([]);
    expect(picked()).toEqual([FIRST_FULL]);
    // 指向「当前」的是任意按钮：第一个按钮（全场回放）不是集锦，什么都不点
    history.pushState(null, '', NEXT);
    controllers.splice(0).forEach((c) => c.stop());
    boot({
      ...defaultShieldSettings(BASE),
      rules: withPlayback({ items: 'a, button', active: 'button' }),
    });
    render(strip());
    await settle();
    expect(other).toEqual([]);
    expect(picked()).toEqual([FIRST_FULL]);
  });
});

describe('用户自己的选择优先', () => {
  it('还没拿到带回放条的规则时用户已经自己点了全场集锦：规则 5 秒后到了也不换', async () => {
    const without = rulesWith((s) => ({ ...s, playback: undefined }));
    const s = { ...defaultShieldSettings(BASE), rules: without };
    const c = boot(s);
    mountPlayer();
    render(strip(PROGRAMS, 2));
    await wait();
    userClick(slides()[0]!);
    await wait(5000);
    expect(activeName()).toBe('全场集锦');
    c.update({ ...s, rules: rulesWith((r) => r) });
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([]);
    // 对照：下一个页面照常切换
    history.pushState(null, '', NEXT);
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('停用期间用户自己点了全场集锦，30 秒内又重新启用：不换', async () => {
    const s = defaultShieldSettings(BASE);
    const c = boot(s);
    mountPlayer();
    c.update({ ...s, disabledHosts: ['miguvideo.com'] });
    render(strip());
    await wait(1000);
    userClick(slides()[0]!);
    await wait(2000);
    c.update(s);
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([]);
  });

  it('网站把选中的节目写进地址（replaceState ?pid=）：用户换回全场集锦后，页面改高亮、改字不会让插件再切回去', async () => {
    afterPageClick = (slide) =>
      history.replaceState(null, '', `${START}?pid=${slide.getAttribute('data-program-id')}`);
    boot();
    mountPlayer();
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
    userClick(slides()[0]!);
    await wait();
    // 页面更新「正在播放」，回放条里的标题加了个滚动的 class
    document.querySelector('.now')!.textContent = '正在播放：全场集锦';
    await wait(200);
    slides()[1]!.querySelector('.match-review__title')!.classList.add('is-marquee');
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('网站因为用户的选择换了地址、又把回放条整个重新渲染出来：也不切回去', async () => {
    afterPageClick = (slide) => {
      const pid = slide.getAttribute('data-program-id');
      history.replaceState(null, '', `${START}?pid=${pid}`);
      setTimeout(() => render(strip(PROGRAMS, Number(pid!.slice(1)) - 1)), 50);
    };
    boot();
    mountPlayer();
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
    userClick(slides()[0]!);
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([FIRST_FULL]);
  });
});

describe('规则被改成很宽的选择器时也不拖慢页面', () => {
  it('变化很密时不是每批都查：半秒里 50 批变化只查几次条目', async () => {
    boot();
    const qsa = vi.spyOn(document, 'querySelectorAll');
    for (let i = 0; i < 50; i++) {
      document.getElementById('app')!.append(document.createElement('span'));
      await wait(10);
    }
    const lookups = qsa.mock.calls.filter(([sel]) => sel === '.match-review__slide').length;
    expect(lookups).toBeGreaterThan(0);
    expect(lookups).toBeLessThanOrEqual(7);
  });

  it('每个条目只读前 200 个字（规则指向一大块元素时不会去读整页文字）', async () => {
    boot({
      ...defaultShieldSettings(BASE),
      rules: withPlayback({ items: '.card', active: '.is-active' }),
    });
    mountPlayer();
    render(`<div class="list">
      <div class="card is-active"><p>${'文'.repeat(300)}</p><p>集锦</p></div>
      <button type="button" class="card match-review__slide">全场回放</button>
    </div>`);
    await settle();
    expect(clicks).toEqual([]);
  });

  it('只看前 50 个条目', async () => {
    boot();
    mountPlayer();
    const filler = Array.from(
      { length: 60 },
      (_, i) => `<button type="button" class="match-review__slide">节目${i}</button>`,
    ).join('');
    render(`<div class="filler">${filler}</div>${strip()}`);
    await settle();
    expect(clicks).toEqual([]);
  });
});

describe('什么算集锦、什么算全场回放（词表在代码里）', () => {
  it.each([
    ['全场集锦（回放）', '全场回放（解说甲）', ['全场集锦（回放）', '全场回放（解说甲）']],
    ['进球集锦', '比赛回放', ['进球集锦', '赛前分析', '比赛回放']],
    ['高光时刻', '完整回放', ['高光时刻', '完整回放']],
    ['精华版', '全场录像', ['精华版', '全场录像']],
    ['Highlights', '全场录播', ['Highlights', '全场录播']],
    ['全場集錦', '全場回放（繁體）', ['全場集錦', '全場回放（繁體）']],
    // 两类词都带的条目不点；名字里的全角空格不影响判断
    [
      '全场集锦',
      '全场\u3000回放（解说乙）',
      ['全场集锦', '全场回放集锦版（解说甲）', '全场\u3000回放（解说乙）'],
    ],
  ])('当前是「%s」：点「%s」', async (_current, pick, programs) => {
    boot();
    mountPlayer();
    render(strip(programs));
    await settle();
    expect(picked()).toEqual([pick]);
  });

  it('只有海报图的 alt、没有标题文字的条目也认得出', async () => {
    boot();
    mountPlayer();
    render(`<section class="match-review"><div class="match-review__list">
      <button type="button" class="match-review__slide is-active"><img alt="全场集锦" src="h.webp"></button>
      <button type="button" class="match-review__slide"><img alt="全场回放" src="r.webp"></button>
    </div></section>`);
    await settle();
    expect(slides()[1]!.classList.contains('is-active')).toBe(true);
    expect(picked()).toEqual(['全场回放']);
  });

  it('单个节目名的判断', () => {
    expect(programKind('全场集锦')).toBe('highlights');
    expect(programKind('全场集锦（回放）')).toBe('highlights');
    expect(programKind('全场 集锦')).toBe('highlights');
    expect(programKind('进球合集')).toBe('highlights');
    expect(programKind('全场回放（智能解说）')).toBe('full');
    expect(programKind('全场回放（解说甲、解说乙）')).toBe('full');
    // 不是集锦，也不是完整比赛：不动
    expect(programKind('赛前分析')).toBe('other');
    expect(programKind('回放')).toBe('other');
    expect(programKind('')).toBe('other');
    // 两类词都有：说不清，不动
    expect(programKind('全场回放集锦版')).toBe('other');
  });
});

describe('站点规则里的 playback', () => {
  const playbackOf = (playback: unknown) =>
    validateSiteRules({
      schema: 1,
      version: 'x',
      sites: [{ id: 'a', hosts: ['a.com'], playback }],
    })!.sites[0]!.playback;

  it('内置咪咕规则带上回放条和播放器；选择器都安全才保留，夹带的其他字段（词表、要点的元素）丢掉', () => {
    expect(matchSite(defaultRules(), 'www.miguvideo.com')?.playback).toEqual({
      items: '.match-review__slide',
      active: '.is-active',
      ready: '#sport-live video',
    });
    expect(playbackOf({ items: '.slide', active: '.on', prefer: ['登录'], click: '#buy' })).toEqual(
      { items: '.slide', active: '.on' },
    );
    expect(playbackOf({ items: '.slide', active: '.on', ready: 'video' })).toEqual({
      items: '.slide',
      active: '.on',
      ready: 'video',
    });
    for (const bad of [
      { items: '.slide{}', active: '.on' },
      { items: '.slide', active: "x[style*='url(evil)']" },
      { items: '.slide', active: '@import x' },
      { items: '.slide' },
      { items: 1, active: '.on' },
      { items: ' ', active: '.on' },
      { items: 'x'.repeat(301), active: '.on' },
      // 写了 ready 却不安全：整条丢掉，不能变成「不等播放器就点」
      { items: '.slide', active: '.on', ready: 'video{}' },
      { items: '.slide', active: '.on', ready: '' },
      { items: '.slide', active: '.on', ready: 3 },
      '.slide',
      null,
    ]) {
      expect(playbackOf(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('规则里没有 playback：不监听、不查找、没有计时器；规则 30 秒内到了照常切，30 秒以后才到不动正在看的页面', async () => {
    const qsa = vi.spyOn(document, 'querySelectorAll');
    const without = rulesWith((s) => ({ ...s, playback: undefined }));
    const s = { ...defaultShieldSettings(BASE), rules: without };
    const c = boot(s);
    mountPlayer();
    render(strip());
    await wait(1000);
    expect(clicks).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(qsa.mock.calls.filter(([sel]) => sel === '.match-review__slide')).toEqual([]);
    // 页面打开 10 秒时下载到了带 playback 的规则
    await wait(9000);
    c.update({ ...s, rules: rulesWith((r) => r) });
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);

    // 另一个页面：规则 30 秒以后才到
    controllers.splice(0).forEach((x) => x.stop());
    history.replaceState(null, '', NEXT);
    const late = boot(s);
    render(strip());
    await wait(31_000);
    late.update({ ...s, rules: rulesWith((r) => r) });
    await settle();
    expect(activeName()).toBe('全场集锦');
    expect(picked()).toEqual([FIRST_FULL]);
  });

  it('切换之后每批变化只对一次地址，不再查找条目', async () => {
    boot();
    mountPlayer();
    render(strip());
    await settle();
    expect(picked()).toEqual([FIRST_FULL]);
    const qsa = vi.spyOn(document, 'querySelectorAll');
    const matches = vi.spyOn(Element.prototype, 'matches');
    for (let i = 0; i < 20; i++) {
      document.getElementById('app')!.append(document.createElement('span'));
      await wait(200);
    }
    expect(qsa.mock.calls.filter(([sel]) => sel === '.match-review__slide')).toEqual([]);
    expect(matches.mock.calls.filter(([sel]) => sel === '.is-active')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('选择器能过安全检查、浏览器却不认：不报错、不点；规则修好后（30 秒内）照常切', async () => {
    for (const bad of [{ items: ':::bad' }, { ready: ':::bad' }]) {
      controllers.splice(0).forEach((x) => x.stop());
      clicks = [];
      history.replaceState(null, '', `${START}?case=${Object.keys(bad)[0]}`);
      const s = { ...defaultShieldSettings(BASE), rules: withPlayback(bad) };
      const c = boot(s);
      mountPlayer();
      render(strip());
      await settle();
      expect(clicks).toEqual([]);
      c.update({ ...s, rules: rulesWith((r) => r) });
      await settle();
      expect(picked()).toEqual([FIRST_FULL]);
    }
  });
});
