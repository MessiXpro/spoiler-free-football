import type { PlaybackRule, SiteRule } from '../rules/schema.ts';
import { namesFootball } from '../text/detect.ts';
import { normalizeText } from '../text/normalize.ts';

/**
 * 回放页默认播的是「全场集锦」：几分钟的进球合集，一打开就等于看了比分（咪咕 /p/live/ 回放页都是这样）。
 * 当前节目是集锦、同一个列表里又有全场回放时，替用户点一次第一个全场回放。
 *
 * - 什么算集锦、什么算全场回放写在这里，不在站点规则里：规则是远程下载的数据，就算被改了，
 *   也只能说「条目在哪、哪个是当前的、播放器什么时候好」，要点的只能是当前条目同一列表里、名字是全场回放的那个，
 *   而且不点链接（点了会跳走）、表单提交按钮和禁用的按钮
 * - 只在遮挡工作中（没停用、没临时显示）、页面本身点名了足球时动手：回放条和节目名不算（集锦、全场回放什么运动都有），
 *   别的运动也用的词也不算（「东亚超级联赛」是篮球、「速度滑冰世界杯」是滑冰）；从防剧透网页的入口页链接（咪咕全部赛程）
 *   进去的也一样，进去以后打开的是哪一场不知道
 * - 规则给了 ready（播放器挂载好之后才有的元素）就等它出现再点：咪咕播放器挂载前点的切换会丢，
 *   只换了高亮和标题，播放器照样放集锦
 * - 每个页面地址（不含 #）只判断一次：换了、不用换、用户自己先点了条目、等超时，都不再碰这个地址；
 *   这次打开期间想看集锦自己点就行，不会被切回去
 */

/** 集锦一类：当前节目带这些词、又没有全场回放的字样，才换 */
export const HIGHLIGHT_WORDS = [
  '集锦',
  '集錦',
  '精华',
  '精華',
  '高光',
  '进球合集',
  '進球合集',
  '精彩合集',
  '精彩回顾',
  '精彩回顧',
  '精彩瞬间',
  '精彩瞬間',
  'highlights',
];

/** 完整比赛：要点的条目必须带这些词之一，而且不带集锦一类的词 */
export const FULL_MATCH_WORDS = [
  '全场回放',
  '全場回放',
  '完整回放',
  '全场录像',
  '全場錄像',
  '全场录播',
  '全場錄播',
  '比赛回放',
  '比賽回放',
  '全场重播',
  '全場重播',
  '全程回放',
];

/** 页面打开（或单页应用换页）后最多等这么久回放条；等不到就不再碰这个地址 */
export const PICK_TIMEOUT_MS = 30_000;
/** 要点的全场回放找到了、播放器还没好：从那时起最多再等这么久（播放器没出来之前什么都没在放） */
export const READY_TIMEOUT_MS = 30_000;
/** 播放器（规则里的 ready）出现后再等这么久才点，慢的机器上播放器也接得住 */
export const READY_SETTLE_MS = 300;
/** 条目都在、但遮挡临时显示中 / 还不是足球页面 / 播放器还没好时，隔这么久再看一次 */
const POLL_MS = 1000;
/** 两次判断之间至少隔这么久（变化很密的页面上不用每批变化都查一遍） */
const CHECK_GAP_MS = 100;
/** 用户自己点了条目之后这么久之内换了地址：新地址是用户选的（有的网站把选中的节目写进地址） */
const USER_URL_MS = 1000;
/** 最多看这么多个条目、每个条目最多读这么多字、走这么多个节点：规则被改成很宽的选择器时也不会拖慢页面 */
const MAX_ENTRIES = 50;
const MAX_CHILDREN = 200;
const MAX_NAME_CHARS = 200;
const MAX_NODES = 200;
/** 判断足球页面：和遮挡一样，最多看 12 个语境元素、每个 300 字 */
const MAX_CONTEXT = 12;
const MAX_CONTEXT_CHARS = 300;
/** 插件还没拿到规则、停用期间用户点过的地方：拿到规则后还要知道用户是不是已经自己选过节目 */
const MAX_RECENT_CLICKS = 8;

/** 等待期间：新加的节点、文字、表示「当前」的属性变化都要知道 */
const PENDING_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: [
    'class',
    'alt',
    'aria-selected',
    'aria-current',
    'aria-pressed',
    'aria-checked',
  ],
};
/** 处理完之后只为发现单页应用换页：页面换内容一定伴随节点增删 */
const IDLE_OPTIONS: MutationObserverInit = { childList: true, subtree: true };

export type ProgramKind = 'highlights' | 'full' | 'other';

const IGNORABLE = /[\s\u200b-\u200d\u2060\ufeff]+/g;

/** 比较用的节目名：全角转半角、去掉空白和零宽字符、英文小写 */
const nameKey = (text: string) => normalizeText(text).replace(IGNORABLE, '').toLowerCase();
/** 判断足球页面用的文字：全角转半角、空白合并（英文队名区分大小写，不转小写） */
const flat = (text: string) => normalizeText(text).replace(IGNORABLE, ' ').trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 节目名用词：什么运动的回放页都有，不能拿来说明是足球 */
const PROGRAM_WORDS = new RegExp(
  [...HIGHLIGHT_WORDS, ...FULL_MATCH_WORDS].map(escapeRe).join('|'),
  'gi',
);
/**
 * 页面标题写明是别的运动（咪咕的标题就是赛事名）：不是足球，除非标题里也写了足球。别的运动也借足球的赛事名
 * （篮球欧冠、女排世俱杯、男篮世预赛），点名足球的词也拦不住这些。篮：篮球、男篮、女篮、欧篮联。
 * 英文缩写左边不能紧挨着字母（「RasenBallsport Leipzig」里有 nba），右边可以（咪咕的标题「NBANBA杯」）。
 * 只看标题：页面别处（导航、推荐）提到 NBA 不能让足球回放页不切
 */
const OTHER_SPORT_TITLE = new RegExp(
  [
    '(?<![A-Za-z])(?:NBA|WNBA|CBA|WCBA|EASL|WTT|BWF|WTA|ATP|NFL|UFC)',
    '篮|东亚超级联赛|排球|女排|男排|排超|乒乓|乒超|羽毛球|羽超|网球',
    '手球|水球|曲棍球|棒球|垒球|冰球|橄榄球|高尔夫|斯诺克|台球',
    '冰壶|滑雪|滑冰|速滑|短道|花滑|滑联|田径|马拉松|游泳|跳水|体操|射击|射箭|击剑|举重|攀岩',
    '自行车|帆船|赛艇|皮划艇|拳击|格斗|摔跤|柔道|跆拳道|赛车|电竞|王者荣耀|英雄联盟',
  ].join('|'),
  'i',
);
const FOOTBALL_TITLE = /足球|女足|男足|国足|足协/;

/** 按节目名判断：集锦、完整比赛，还是都不是（两类词都有时也算都不是，不动它） */
export function programKind(text: string): ProgramKind {
  const t = nameKey(text);
  const highlights = HIGHLIGHT_WORDS.some((w) => t.includes(w));
  const full = FULL_MATCH_WORDS.some((w) => t.includes(w));
  if (highlights === full) return 'other';
  return highlights ? 'highlights' : 'full';
}

/**
 * 元素里的文字，加上里面图片的 alt（只有海报、没有标题文字时也认得出），分开返回：[文字, alt...]。
 * 最多读 max 个字、走 MAX_NODES 个节点；skip 这个子树不读
 */
function readParts(
  root: Element,
  max: number,
  alts: boolean,
  skip: Element | null = null,
): string[] {
  let text = '';
  const altTexts: string[] = [];
  const take = (img: Element) => {
    const alt = img.getAttribute('alt');
    if (alt && altTexts.length < 4) altTexts.push(alt.slice(0, max));
  };
  if (alts && root.tagName === 'IMG') take(root);
  const walker = root.ownerDocument.createTreeWalker(root, 1 /* ELEMENT */ | 4 /* TEXT */, {
    acceptNode: (node) => (node === skip ? 2 /* REJECT */ : 1 /* ACCEPT */),
  });
  for (
    let node = walker.nextNode(), seen = 0;
    node && seen < MAX_NODES && text.length < max;
    node = walker.nextNode(), seen++
  ) {
    if (node.nodeType === 3) text += (node as Text).data;
    else if (alts && (node as Element).tagName === 'IMG') take(node as Element);
  }
  return [text.slice(0, max), ...altTexts];
}

const entryParts = (el: Element) => readParts(el, MAX_NAME_CHARS, true);
const entryKind = (el: Element) => programKind(entryParts(el).join(' '));

/** 地址去掉 # 后面的部分 */
function withoutHash(href: string): string {
  const hash = href.indexOf('#');
  return hash < 0 ? href : href.slice(0, hash);
}
/** 当前页面地址（不含 #） */
const pageUrl = (doc: Document) => withoutHash(doc.location?.href ?? '');

const isValidSelector = (doc: Document, sel: string) => {
  try {
    doc.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
};

const elementOf = (node: EventTarget | Node | null): Element | null => {
  if (!node || typeof (node as Node).nodeType !== 'number') return null;
  const n = node as Node;
  return n.nodeType === 1 ? (n as Element) : n.parentElement;
};

/** 只跳到本页某个位置（href="#..."）的链接，点了不离开页面 */
function samePageAnchor(link: Element, doc: Document): boolean {
  const href = (link.getAttribute('href') ?? '').trim();
  if (!href.includes('#')) return false;
  try {
    const url = new URL(href, doc.baseURI).href;
    return url.slice(0, url.indexOf('#')) === pageUrl(doc);
  } catch {
    return false;
  }
}

/**
 * 点下去会离开或重新打开页面的不点：自己是、或者在链接里（同站的也不行：重新打开的页面又是集锦，
 * 会一直点下去；只跳到本页某处的 # 链接可以），表单的提交按钮；禁用的按钮点了也没用
 */
function clickable(el: Element, doc: Document): boolean {
  if (typeof (el as HTMLElement).click !== 'function' || el.matches(':disabled')) return false;
  const link = el.closest('a[href], area[href]');
  if (link && !samePageAnchor(link, doc)) return false;
  const control = el.closest('button, input') as HTMLButtonElement | HTMLInputElement | null;
  return !(control?.form && (control.type === 'submit' || control.type === 'image'));
}

/** 列表（当前条目的父元素）里的条目，按顺序，最多 MAX_ENTRIES 个 */
function entriesIn(list: Element, items: string): Element[] {
  const out: Element[] = [];
  for (
    let el = list.firstElementChild, seen = 0;
    el && seen < MAX_CHILDREN && out.length < MAX_ENTRIES;
    el = el.nextElementSibling, seen++
  ) {
    if (el.matches(items)) out.push(el);
  }
  return out;
}

export interface PlaybackHooks {
  /** 遮挡正在工作：没停用、没临时显示 */
  working(): boolean;
  /**
   * 用户从防剧透网页点进来看的比赛的链接地址。就是这个页面（直达本场的链接）时标题没写足球也算；
   * 入口页链接（咪咕全部赛程）不算：进去以后打开的是哪一场、是不是足球都不知道
   */
  matchUrl?(): string | null | undefined;
}

export interface PlaybackOptions {
  timeoutMs?: number;
  settleMs?: number;
}

/** 用户点过的地方（点击时的整条祖先链，之后元素被页面重新渲染掉也认得出） */
interface RecentClick {
  url: string;
  path: Element[];
  at: number;
}

/**
 * 回放条：当前是集锦时切到第一个全场回放。整个页面一个，跟着遮挡的状态走：
 * update(site) 开始或换规则，update(null) 暂停（停用、没有规则时；用户的点击照样记着），stop() 彻底停止
 */
export class PlaybackPicker {
  private readonly doc: Document;
  private readonly hooks: PlaybackHooks;
  private readonly timeoutMs: number;
  private readonly settleMs: number;
  private site: SiteRule | null = null;
  private rule: PlaybackRule | null = null;
  private contextSelector: string | null = null;
  private observer: MutationObserver | null = null;
  private mode: MutationObserverInit | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private queued = false;
  private lastRun = -Infinity;
  private listening = false;
  /** 处理完的页面地址：换过、不用换、用户自己点过、等超时，都不再碰 */
  private readonly done = new Set<string>();
  /** 最近一次对上的页面地址，和这个地址最晚等到什么时候 */
  private url: string;
  private deadline: number;
  /** 这个地址上找到要点的条目、开始等播放器的时间 */
  private waitingSince = 0;
  /** 单页应用刚换页：页面上可能还是上一页的回放条，等新条目插进来再判断 */
  private stale = false;
  /** 播放器元素（规则里的 ready）和第一次看到它的时间 */
  private readyEl: Element | null = null;
  private readySince = 0;
  private readonly recent: RecentClick[] = [];
  /** 用户上一次自己点条目的时间 */
  private userPickAt = -Infinity;

  constructor(doc: Document, hooks: PlaybackHooks, options: PlaybackOptions = {}) {
    this.doc = doc;
    this.hooks = hooks;
    this.timeoutMs = options.timeoutMs ?? PICK_TIMEOUT_MS;
    this.settleMs = options.settleMs ?? READY_SETTLE_MS;
    // 从创建（页面打开时）算起：之后才拿到规则、才启用的，过了时间就不动正在看的页面
    this.url = pageUrl(doc);
    this.deadline = Date.now() + this.timeoutMs;
    // 从一开始就记下用户点过哪里：规则晚到、停用后重新启用时，用户已经自己选过的节目不能被换掉
    doc.addEventListener('click', this.onClick, true);
    this.listening = true;
  }

  /** 设置或换规则（远程规则下载完、设置更新）；站点没有回放条规则时暂停 */
  update(site: SiteRule | null | undefined): void {
    const rule = site?.playback;
    if (
      !this.listening ||
      !rule ||
      !isValidSelector(this.doc, rule.items) ||
      !isValidSelector(this.doc, rule.active) ||
      (rule.ready !== undefined && !isValidSelector(this.doc, rule.ready))
    ) {
      this.rule = null;
      this.site = null;
      this.halt();
      return;
    }
    this.site = site;
    this.rule = rule;
    const ctx = [...(site.contextSelectors ?? []), 'h1'].filter((s) =>
      isValidSelector(this.doc, s),
    );
    this.contextSelector = ctx.join(',');
    if (!this.observer) {
      this.observer = new MutationObserver(this.onMutations);
      // 没在监听期间换过的地址不知道是什么时候打开的：当成已处理
      this.syncUrl(false);
      // 没在监听期间用户已经自己点过条目：这个地址交给用户
      if (
        this.recent.some((c) => c.url === this.url && c.path.some((el) => el.matches(rule.items)))
      ) {
        this.done.add(this.url);
      }
      this.syncUrl(true);
    }
    this.schedule();
  }

  /** 彻底停止并清理（已处理过的地址仍然记着） */
  stop(): void {
    this.halt();
    this.rule = null;
    this.site = null;
    this.listening = false;
    this.doc.removeEventListener('click', this.onClick, true);
  }

  /** 暂停：断开监听、清掉计时器（用户的点击照样记着） */
  private halt() {
    this.observer?.disconnect();
    this.observer = null;
    this.mode = null;
    this.stopPoll();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly onMutations = (records: MutationRecord[]) => {
    // 每批变化：对一次地址；处理完的地址到这里就结束
    if (!this.syncUrl(true)) return;
    if (this.stale) {
      // 只有新插进来的条目才算新页面的回放条：原地改个高亮、改个字（比如用户刚选了节目）不算
      if (!records.some((r) => this.addsEntry(r))) return;
      this.stale = false;
    }
    this.schedule();
  };

  /** 用户自己点（可信的点击；插件和页面脚本的点击不算）：点的是条目，这个地址交给用户，不再碰 */
  private readonly onClick = (e: Event) => {
    if (!e.isTrusted) return;
    const path = e
      .composedPath()
      .filter((n): n is Element => (n as Node).nodeType === 1)
      .slice(0, 16);
    const target = elementOf(e.target);
    if (target && !path.includes(target)) path.unshift(target);
    const url = pageUrl(this.doc);
    this.recent.push({ url, path, at: Date.now() });
    if (this.recent.length > MAX_RECENT_CLICKS) this.recent.shift();
    const rule = this.rule;
    if (!rule || !this.observer || !path.some((el) => el.matches(rule.items))) return;
    this.userPickAt = Date.now();
    this.syncUrl(true);
    this.finish(url);
  };

  /**
   * 对上当前页面地址，返回这个地址是否还在等。地址变了（单页应用换页）就当成新页面重新等；
   * observing 为 false（刚开始监听）时变了的地址是没在监听期间换的，不碰；用户刚点过条目就换了地址，也不碰
   */
  private syncUrl(observing: boolean): boolean {
    const url = pageUrl(this.doc);
    const now = Date.now();
    if (url !== this.url) {
      this.url = url;
      this.deadline = now + this.timeoutMs;
      this.stale = true;
      this.waitingSince = 0;
      this.readyEl = null;
      if (!observing || now - this.userPickAt < USER_URL_MS) this.done.add(url);
    }
    if (!this.done.has(url) && now >= this.deadline) this.done.add(url);
    const pending = !this.done.has(url);
    if (pending) {
      this.poll ??= setInterval(() => this.schedule(), POLL_MS);
    } else {
      this.stopPoll();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
    this.watch(pending ? PENDING_OPTIONS : IDLE_OPTIONS);
    return pending;
  }

  private watch(mode: MutationObserverInit) {
    if (!this.observer || this.mode === mode) return;
    this.mode = mode;
    // 对同一个节点再 observe 一次就是换监听内容
    this.observer.observe(this.doc.documentElement, mode);
  }

  private stopPoll() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  /** 这批变化插进了条目（新渲染的回放条） */
  private addsEntry(r: MutationRecord): boolean {
    const items = this.rule?.items;
    if (!items || r.type !== 'childList') return false;
    for (const node of r.addedNodes) {
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.matches(items) || el.querySelector(items)) return true;
    }
    return false;
  }

  /**
   * 安排一次判断：放到这一轮变化都处理完之后，两次之间至少隔 CHECK_GAP_MS；
   * at 指定最早什么时候（等播放器稳定）
   */
  private schedule(at = 0) {
    if (!this.observer) return;
    const now = Date.now();
    const when = Math.max(at, this.lastRun + CHECK_GAP_MS);
    if (when <= now) {
      if (this.queued) return;
      this.queued = true;
      void Promise.resolve().then(() => {
        this.queued = false;
        this.run();
      });
      return;
    }
    if (this.timer && this.timerAt <= when) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = when;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, when - now);
  }

  private run() {
    if (!this.observer) return;
    this.lastRun = Date.now();
    this.check();
  }

  private finish(url = this.url) {
    this.done.add(url);
    this.syncUrl(true);
  }

  /** 当前播放的条目：按顺序前 MAX_ENTRIES 个条目里第一个匹配 active 的 */
  private currentEntry(rule: PlaybackRule): Element | null {
    const all = this.doc.querySelectorAll(rule.items);
    for (let i = 0; i < all.length && i < MAX_ENTRIES; i++) {
      if (all[i]!.matches(rule.active)) return all[i]!;
    }
    return null;
  }

  /**
   * 页面本身说明在看足球。标题写明是别的运动的不算，先看这个（防剧透网页链过来的、规则说是足球的也一样）；
   * 防剧透网页直达这个页面的链接点进来的、规则说整站都是足球或地址里带足球的算；
   * 否则看标题和语境元素（同遮挡），要点名足球才算：回放条、节目名（含集锦、全场回放这些词）不算，
   * 别的运动也用的词（联赛、比赛、世界杯、德比……）也不算（namesFootball）
   */
  private isFootball(list: Element, names: string[]): boolean {
    const title = flat(this.doc.title ?? '');
    if (OTHER_SPORT_TITLE.test(title) && !FOOTBALL_TITLE.test(title)) return false;
    const linked = this.hooks.matchUrl?.();
    if (linked && withoutHash(linked) === pageUrl(this.doc)) return true;
    const site = this.site;
    if (site?.context === 'always') return true;
    const href = (this.doc.location?.href ?? '').toLowerCase();
    if (site?.footballUrlParts?.some((part) => href.includes(part.toLowerCase()))) return true;
    const parts = [title];
    if (this.contextSelector) {
      const els = this.doc.querySelectorAll(this.contextSelector);
      for (let i = 0, n = 0; i < els.length && n < MAX_CONTEXT; i++) {
        const el = els[i]!;
        if (list.contains(el)) continue;
        parts.push(readParts(el, MAX_CONTEXT_CHARS, false, el.contains(list) ? list : null)[0]!);
        n++;
      }
    }
    let text = flat(parts.join('\n'));
    for (const name of names) if (name) text = text.split(name).join('\n');
    return namesFootball(text.replace(PROGRAM_WORDS, '\n'));
  }

  private check() {
    const rule = this.rule;
    if (!rule || !this.observer || !this.syncUrl(true) || this.stale || !this.hooks.working()) {
      return;
    }
    const now = Date.now();
    if (rule.ready) {
      const ready = this.doc.querySelector(rule.ready);
      if (ready !== this.readyEl) {
        this.readyEl = ready;
        this.readySince = now;
      }
    }
    const current = this.currentEntry(rule);
    const list = current?.parentElement;
    const currentParts = current ? entryParts(current) : [];
    // 条目还没渲染出来、还没有选中的、或者标题还是空的：接着等
    if (!current || !list || !nameKey(currentParts.join(''))) return;
    if (programKind(currentParts.join(' ')) !== 'highlights') {
      this.finish();
      return;
    }
    // 只在同一个列表里找：页面别处（别的比赛的回放列表、会员购买链接）的不点
    const siblings = entriesIn(list, rule.items);
    const target = siblings.find(
      (el) => el !== current && entryKind(el) === 'full' && clickable(el, this.doc),
    );
    // 全场回放还没出来（可能还在渲染）：接着等，到时间就算了
    if (!target) return;
    if (rule.ready) {
      if (!this.waitingSince) {
        this.waitingSince = now;
        this.deadline = Math.max(this.deadline, now + READY_TIMEOUT_MS);
      }
      // 播放器还没挂载好：这时点的切换会丢，接着等
      if (!this.readyEl) return;
      const left = this.readySince + this.settleMs - now;
      if (left > 0) {
        this.schedule(now + left);
        return;
      }
    }
    const names = [current, ...siblings].flatMap((el) => entryParts(el).map(flat));
    if (!this.isFootball(list, names)) return;
    this.finish();
    (target as HTMLElement).click();
  }
}
