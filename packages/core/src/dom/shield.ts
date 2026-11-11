import { findSpoilers, isFootballText, MASK_CHAR, redact } from '../text/detect.ts';
import type { SiteRule } from '../rules/schema.ts';
import {
  ATTR_BESIDE,
  ATTR_CARD,
  ATTR_HIDE,
  ATTR_OVERLAY,
  ATTR_PLAYER,
  ATTR_POSTER,
  buildShieldCss,
  CLASS_FOOTBALL,
  CLASS_ON,
  CLASS_READY,
  CLOAK_CSS,
  DEFAULT_CSS_PREFS,
  type CssPrefs,
} from './css.ts';

export interface ShieldPrefs extends CssPrefs {
  /** 处理标签页标题 */
  title: boolean;
}

export const DEFAULT_SHIELD_PREFS: ShieldPrefs = { ...DEFAULT_CSS_PREFS, title: true };

export interface ShieldOptions {
  /** 当前站点的规则；全网模式下为 null，只做通用文字识别 */
  site: SiteRule | null;
  extraWords?: string[];
  safePhrases?: string[];
  prefs?: Partial<ShieldPrefs>;
  /** 已知这是足球页面（例如从防剧透网页跳转过来） */
  forceFootball?: boolean;
  onStats?: (stats: ShieldStats) => void;
}

export interface ShieldStats {
  texts: number;
  attributes: number;
  blocks: number;
  football: boolean;
  paused: boolean;
}

// <pre>/<code> 不跳过：纯文本帖子、贴进来的战报也会用它们显示比分
const IGNORE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE']);
const ATTRS = ['title', 'alt', 'aria-label', 'placeholder', 'data-title'];
const STYLE_ID = 'sff-shield-style';
const CLOAK_ID = 'sff-cloak';
const FRAME_MSG = 'sff-football-context';
/** 跨元素拼出来的比分（<span>2</span>-<span>1</span>）只在短文字里找 */
const SPLIT_SCORE_MAX_LEN = 60;
/** 同一元素里相邻文字节点拼起来识别时的长度上限 */
const TEXT_RUN_MAX_LEN = 5000;
/** 数字（含全角 ０-９：识别时会归一化，这里的预筛也要认） */
const HAS_DIGIT = /[0-9０-９]/;
const HAS_WORD = /[0-9A-Za-z０-９Ａ-Ｚａ-ｚ一-鿿]/;
const NUMBER_RUN = /[0-9０-９]+|[零〇一二两三四五六七八九十]+/g;
/** 每处理这么多批变化，清理一次已离开页面的节点（没有 onStats 时 stats 不会被读取） */
const PRUNE_EVERY = 50;
/**
 * 主播放器的候选：至少这么宽（窗口宽度的一半，但不超过 640px、不小于 320px）、这么高的 <video>；
 * 大屏上固定宽度的播放器、文章里 640×360 的视频也算，手机上整宽的视频都够格，所以每个页面只选一个（见 pickPlayers）
 */
const PLAYER_MIN_WIDTH = 320;
const PLAYER_WIDTH_CAP = 640;
const PLAYER_MIN_HEIGHT = 180;
const PLAYER_VIEWPORT_SHARE = 0.5;
/**
 * 嵌入播放器的 iframe 的高宽比（16:9 是 0.56）在这个范围里：又宽又矮的横幅广告、比分条，
 * 比宽还高的评论框、整页嵌入都不算
 */
const FRAME_MIN_ASPECT = 0.4;
const FRAME_MAX_ASPECT = 1;
/**
 * 页面没有 <h1> 时，足球卡片比窗口宽度的这个比例还窄：是信息流里的卡片，里面的视频是预览，不算主播放器
 * （其他判断见 isFeedCard）
 */
const FEED_CARD_SHARE = 0.6;
/** 和主视频重叠的面积超过两者中较小一个的这个比例：叠在上面的广告、第二路画面，一起保护 */
const PLAYER_OVERLAP = 0.5;
/** 面积相差不到这个比例算一样大：取在窗口里露出面积大的（竖屏信息流把上一条、下一条预载在窗口外面） */
const PLAYER_TIE = 0.02;
/**
 * 命中封面选择器的元素和主视频重叠的部分至少是视频面积的一半、也至少是它自己面积的 85%：
 * 播放器自己盖在视频上的透明层（控制层、默认封面层；停在控制栏上方的、只盖住 16:9 画面部分的也算）。
 * 比视频大得多的（整页弹窗、页面背景）不算
 */
const OVERLAY_VIDEO_SHARE = 0.5;
const OVERLAY_LAYER_SHARE = 0.85;
/**
 * 主视频往上这么多层以内命中封面选择器的元素要盯着尺寸：先藏着、后来才显示出来的层
 * （咪咕的版权/出错提示层先插进来、出错时才显示）显示出来时重新判断是不是透明层。
 * 这一块里的 class 变化也要看：本来不命中封面选择器的层后来加上了 class（暂停时显示的层）
 */
const OVERLAY_WATCH_DEPTH = 4;
/**
 * 透明层里至少这么大（视频小时按视频宽、高的 1/4）的图片、视频、画布、带背景图的元素是海报、片尾推荐的缩略图，
 * 照样换掉；更小的是播放器的控制图标，照常显示
 */
const POSTER_MIN_WIDTH = 160;
const POSTER_MIN_HEIGHT = 90;
const POSTER_VIDEO_SHARE = 0.25;
/**
 * 播放器外层最多是视频面积的这么多倍（咪咕的外层 1440×756 包着 1032×756 的视频），更大的是页面级容器、真的评论区：
 * 临时停用遮挡样式量出来的视频，外面被评论区、推荐区规则 display:none 藏起的元素都不超过这么大，才是被误伤的播放器外层；
 * 遮挡规则命中的外层不超过这么大，它里面视频旁边的内容才照样藏（命中整页的容器显然是误伤，不能只剩一个播放器）
 */
const WRAPPER_AREA_RATIO = 2;
/** 自己显示图像的替换元素：不会是透明层（盖在视频上的海报图照样换掉） */
const REPLACED_TAGS = new Set(['img', 'picture', 'video', 'canvas', 'iframe']);
/** 透明层里可能是海报的元素：图片、视频、画布（另外还有带背景图的元素） */
const MEDIA_TAGS = new Set(['img', 'picture', 'video', 'canvas']);
/** 窗口、视频尺寸变化后重新判断主播放器：合并这段时间内的多次变化，视频频繁移走时也最多这么久判断一次 */
const PLAYER_RECHECK_MS = 150;
/** 主播放器保护写在页面元素上的标记 */
const MARKS = [ATTR_PLAYER, ATTR_BESIDE, ATTR_OVERLAY, ATTR_POSTER];

/** 父元素；在 shadow root 顶层时是宿主元素 */
const composedParent = (el: Element): Element | null =>
  el.parentElement ?? (el.parentNode as ShadowRoot | null)?.host ?? null;

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;

/** 两个框重叠部分的面积 */
const overlapArea = (a: Box, b: Box): number => {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};

const sizeKey = (box: Box) => `${Math.round(box.width)}x${Math.round(box.height)}`;

/** 视频本身的分辨率（加载出元数据之前是 0×0） */
const mediaSize = (el: Element) => {
  const video = el as HTMLVideoElement;
  return `${video.videoWidth ?? 0}x${video.videoHeight ?? 0}`;
};

interface Candidate {
  el: Element;
  box: DOMRect;
  area: number;
}

/** 选出来的主播放器：最大的候选（main）和跟它重叠的候选（members，含 main） */
interface PlayerPick {
  main: Element | null;
  box: DOMRect | null;
  area: number;
  members: Element[];
  boxes: DOMRect[];
}

interface Rec {
  orig: string;
  masked: string;
}

const isIgnored = (el: Element) => IGNORE_TAGS.has(el.tagName) || el.hasAttribute('data-sff-ui');

/** 元素是否在用户脚本自己的界面里（跨 shadow 边界向上找） */
function inOwnUi(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.closest(`[${ATTR_UI}]`)) return true;
    cur = (cur.getRootNode() as Node & { host?: Element }).host ?? null;
  }
  return false;
}

const hasClassToken = (value: string | null, token: string) =>
  (value ?? '').split(/\s+/).includes(token);

/**
 * 页面脚本可能整个改写 <html class>（主题切换、react-helmet 等），把 sff-* 类一起冲掉：
 * 遮挡样式全部失效、整页遮罩重新出现。监听 class 变化，把应有的类补回去
 * （只在缺少时写，不会循环触发）。sff-ready 出现过一次就一直保留。
 * 返回停止监听的函数。
 */
export function keepRootClasses(doc: Document, wanted: () => string[] = () => []): () => void {
  const root = doc.documentElement;
  if (!root) return () => {};
  let ready = root.classList.contains(CLASS_READY);
  let windowStart = 0;
  let writes = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const restore = () => {
    const cl = root.classList;
    const want = wanted();
    if (ready) want.push(CLASS_READY);
    const missing = want.filter((c) => !cl.contains(c));
    if (!missing.length) return;
    // 页面如果也在监听并改回自己的 class，两边会无限互相改写：每秒最多补 20 次，超出就稍后再补
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      writes = 0;
    }
    if (++writes > 20) {
      retry ??= setTimeout(() => {
        retry = null;
        restore();
      }, 1000);
      return;
    }
    cl.add(...missing);
  };
  const observer = new MutationObserver((records) => {
    if (
      root.classList.contains(CLASS_READY) ||
      records.some((r) => hasClassToken(r.oldValue, CLASS_READY))
    ) {
      ready = true;
    }
    restore();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  return () => {
    observer.disconnect();
    if (retry) clearTimeout(retry);
    retry = null;
  };
}

/**
 * 在页面最早期插入整页遮罩（用户脚本用；插件由 manifest 注入同样的 CSS）。
 * document-start 时 <html> 可能还没创建，这时等它出现再插入（MutationObserver 回调在绘制前执行）。
 */
export function installCloak(doc: Document): void {
  const insert = () => {
    const root = doc.documentElement;
    if (!root) return false;
    if (doc.getElementById(CLOAK_ID)) return true;
    const style = doc.createElement('style');
    style.id = CLOAK_ID;
    style.textContent = CLOAK_CSS;
    (doc.head ?? root).appendChild(style);
    return true;
  };
  if (insert()) return;
  new MutationObserver((_, observer) => {
    if (insert()) observer.disconnect();
  }).observe(doc, { childList: true });
}

/** 等到 <html> 元素存在 */
export function whenDocumentElement(doc: Document): Promise<HTMLElement> {
  if (doc.documentElement) return Promise.resolve(doc.documentElement);
  return new Promise((resolve) => {
    new MutationObserver((_, observer) => {
      if (doc.documentElement) {
        observer.disconnect();
        resolve(doc.documentElement);
      }
    }).observe(doc, { childList: true });
  });
}

/** 带这个属性的元素（用户脚本自己的悬浮面板）不处理 */
export const ATTR_UI = 'data-sff-ui';

export function revealPage(doc: Document): void {
  doc.documentElement.classList.add(CLASS_READY);
}

export class SpoilerShield {
  private readonly doc: Document;
  private readonly win: Window;
  private opts: ShieldOptions;
  private prefs: ShieldPrefs;
  private observer: MutationObserver | null = null;
  private readonly textRecs = new WeakMap<Text, Rec>();
  private readonly maskedTexts = new Set<Text>();
  private readonly attrRecs = new WeakMap<Element, Map<string, Rec>>();
  private readonly maskedAttrEls = new Set<Element>();
  private readonly hiddenBlocks = new Set<Element>();
  private readonly cardCache = new WeakMap<Element, boolean>();
  private readonly observedRoots = new Set<ShadowRoot>();
  private football = false;
  private paused = false;
  private started = false;
  private lastUrl = '';
  private cardSelector: string | null = null;
  private contextSelector: string | null = null;
  private stopRootClasses: (() => void) | null = null;
  private batches = 0;
  /** 封面选择器（偏好里关了封面替换时为 null）：找盖在主视频上的透明层 */
  private coverSelector: string | null = null;
  /** 足球页上 display:none 藏起的类别（评论、推荐）的选择器：主视频的外层被它误伤时尺寸是空的 */
  private hiddenSelector: string | null = null;
  /** 所有开着的遮挡类规则（不管是不是足球页）：命中主播放器外层时，外层里视频旁边的内容照样藏 */
  private hideSelector: string | null = null;
  /** 带 data-sff-player 的元素：主视频和它的各层外层容器 */
  private players = new Set<Element>();
  /** 带 data-sff-beside 的元素：被遮挡规则命中的外层里，在视频旁边的子元素 */
  private besides = new Set<Element>();
  /** 带 data-sff-overlay 的元素：盖在主视频上的透明层 */
  private overlays = new Set<Element>();
  /** 带 data-sff-poster 的元素：透明层里海报大小的图片、背景图 */
  private posters = new Set<Element>();
  /** 选出来的主播放器（<video> 或嵌入播放器的 <iframe>） */
  private mainPlayer: Element | null = null;
  /** 上次判断时主播放器的位置和尺寸 */
  private mainBox: DOMRect | null = null;
  /** 处理过的新内容里有 <video>/<iframe>：这批变化绘制出来之前马上重新判断 */
  private videosAdded = false;
  /** 主视频或它的外层被移走、页面复制了带标记的元素：需要重新判断（距上次判断太近时稍后） */
  private videosDirty = false;
  private playersAt = Number.NEGATIVE_INFINITY;
  private playerTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 停用遮挡样式量过的视频（藏在评论区、推荐区里、尺寸为空的）和当时视频本身的分辨率：不再为它们反复停用样式量尺寸，
   * 规则、偏好、足球语境变了，或者视频加载出不一样的分辨率时重新量
   */
  private examined = new WeakMap<Element, string>();
  private sizeObserver: ResizeObserver | null = null;
  /**
   * ResizeObserver 正在盯着的元素和上次量到的尺寸：所有视频、iframe，主视频附近命中封面选择器的元素。
   * 尺寸没变的通知（开始盯着时的第一次通知）不重新判断
   */
  private readonly sized = new Map<Element, string>();
  /** ResizeObserver 正在盯着的透明层里还不够海报大小的图片、背景图（藏着的、还没加载出来的）：变大了马上换掉 */
  private readonly posterWatch = new Set<Element>();
  /** 盯着主视频附近、各层外层的 class 变化（透明层后来才加上 class、外层后来才被遮挡规则命中） */
  private classObserver: MutationObserver | null = null;
  private classTargets: Element[] = [];
  /** 窗口大小变化 */
  private readonly onLayoutChange = () => this.requestPlayers();
  /** 视频加载出元数据：尺寸可能变了；藏着的视频分辨率变了也重新量 */
  private readonly onMetadata = (e: Event) => {
    const video = e.target as Element | null;
    if (video && this.examined.get(video) !== mediaSize(video)) this.examined.delete(video);
    this.requestPlayers();
  };
  private readonly onShadow = (e: Event) => {
    // 宿主本身在另一个 shadow tree 里时，事件到 document 已被重定向成最外层宿主；
    // composedPath()[0] 才是真正调用 attachShadow 的元素
    const host = (e.composedPath()[0] ?? e.target) as Element | null;
    if (host?.shadowRoot && !inOwnUi(host)) this.attachShadowRoot(host.shadowRoot);
  };
  private readonly onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string; football?: boolean; request?: boolean } | null;
    if (data?.type !== FRAME_MSG) return;
    if (data.request) {
      // 后插入的 iframe 启动时来问语境：只回答自己的子页面
      const source = e.source as Window | null;
      if (!this.football || !source || source === this.win) return;
      try {
        if (source.parent !== this.win) return;
        source.postMessage({ type: FRAME_MSG, football: true }, '*');
      } catch {
        /* 忽略 */
      }
      return;
    }
    if (e.source === this.win.parent && data.football && !this.football) {
      this.opts = { ...this.opts, forceFootball: true };
      this.evaluatePage(true);
    }
  };

  constructor(doc: Document, options: ShieldOptions) {
    this.doc = doc;
    this.win = doc.defaultView ?? (globalThis as unknown as Window);
    this.opts = options;
    this.prefs = { ...DEFAULT_SHIELD_PREFS, ...options.prefs };
    this.computeSelectors();
  }

  get isFootballPage(): boolean {
    return this.football;
  }

  get stats(): ShieldStats {
    this.prune();
    return {
      texts: this.maskedTexts.size,
      attributes: this.maskedAttrEls.size,
      blocks: this.hiddenBlocks.size,
      football: this.football,
      paused: this.paused,
    };
  }

  private computeSelectors() {
    const site = this.opts.site;
    // 一个写错的选择器会让整个 :is(...) 查询抛错，站点其他规则就全失效了：先逐个检查，跳过无效的
    const valid = (list: readonly string[] | undefined) =>
      (list ?? []).filter((sel) => {
        try {
          this.doc.createDocumentFragment().querySelector(sel);
          return true;
        } catch {
          return false;
        }
      });
    const cards = valid(site?.cardSelectors);
    this.cardSelector = cards.length ? `:is(${cards.join(',')})` : null;
    const ctx = [...valid(site?.contextSelectors), 'h1'];
    this.contextSelector = `:is(${ctx.join(',')})`;
    const covers = this.prefs.covers ? valid(site?.coverSelectors) : [];
    this.coverSelector = covers.length ? `:is(${covers.join(',')})` : null;
    const hidden = (['comments', 'recommend'] as const).flatMap((cat) =>
      this.prefs.hide[cat] ? valid(site?.hide?.[cat]) : [],
    );
    this.hiddenSelector = hidden.length ? `:is(${hidden.join(',')})` : null;
    const hide = Object.entries(site?.hide ?? {}).flatMap(([cat, list]) =>
      this.prefs.hide[cat as keyof ShieldPrefs['hide']] ? valid(list) : [],
    );
    this.hideSelector = hide.length ? `:is(${hide.join(',')})` : null;
    // 规则、偏好变了：藏在评论区、推荐区里的视频重新量
    this.examined = new WeakMap();
  }

  /** 开始工作：注入样式、处理已有内容、监听后续变化 */
  start(): void {
    if (this.started) return;
    this.started = true;
    const root = this.doc.documentElement;
    root.classList.add(CLASS_ON);
    this.injectStyle();
    this.evaluatePage(false);
    this.processSubtree(root);
    this.markPlayers();
    this.flush();
    this.observe();
    // 暂停时不补 sff-on / sff-fb（继续时 resume 会重新加上）
    this.stopRootClasses = keepRootClasses(this.doc, () => {
      if (!this.started || this.paused) return [];
      return this.football ? [CLASS_ON, CLASS_FOOTBALL] : [CLASS_ON];
    });
    this.doc.addEventListener('sff-shadow', this.onShadow, true);
    this.win.addEventListener('message', this.onMessage);
    this.win.addEventListener('resize', this.onLayoutChange);
    // 媒体事件不冒泡，在捕获阶段监听；外层被 display:none 藏起时 ResizeObserver 看不到视频尺寸变化，靠它兜底。
    // 不听 playing：每次播放、暂停后继续、拖动、缓冲完都会触发，尺寸变化已经由 ResizeObserver 和页面变化覆盖
    this.doc.addEventListener('loadedmetadata', this.onMetadata, true);
    this.requestFrameContext();
    if (this.doc.readyState === 'loading') {
      this.doc.addEventListener('DOMContentLoaded', () => this.evaluatePage(true), { once: true });
    }
    this.emit();
  }

  /** 在 iframe 里：父页面之前发的语境消息可能没收到（iframe 后插入、监听注册晚），启动时主动问一次 */
  private requestFrameContext() {
    try {
      const parent = this.win.parent;
      if (parent && parent !== this.win) {
        parent.postMessage({ type: FRAME_MSG, request: true }, '*');
      }
    } catch {
      /* 忽略 */
    }
  }

  /** 更新站点规则或偏好（例如远程规则下载完成） */
  update(options: Partial<ShieldOptions>): void {
    this.opts = { ...this.opts, ...options };
    this.prefs = { ...DEFAULT_SHIELD_PREFS, ...this.opts.prefs };
    this.computeSelectors();
    if (!this.started || this.paused) return;
    this.injectStyle();
    this.evaluatePage(true);
    this.markPlayers();
  }

  stop(): void {
    this.pause();
    this.stopRootClasses?.();
    this.stopRootClasses = null;
    this.doc.removeEventListener('sff-shadow', this.onShadow, true);
    this.win.removeEventListener('message', this.onMessage);
    this.win.removeEventListener('resize', this.onLayoutChange);
    this.doc.removeEventListener('loadedmetadata', this.onMetadata, true);
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    this.sized.clear();
    this.posterWatch.clear();
    this.classObserver?.disconnect();
    this.classObserver = null;
    this.classTargets = [];
    // 去掉所有标记（包括页面复制出来的）：停止后不能留下让以后的规则失效的属性
    const all = [
      ...this.players,
      ...this.besides,
      ...this.overlays,
      ...this.posters,
      ...this.markedElements(),
    ];
    for (const el of new Set(all)) for (const attr of MARKS) el.removeAttribute(attr);
    this.players.clear();
    this.besides.clear();
    this.overlays.clear();
    this.posters.clear();
    this.mainPlayer = null;
    this.mainBox = null;
    this.doc.getElementById(STYLE_ID)?.remove();
    this.started = false;
  }

  /** 一键临时显示：恢复所有原文、去掉遮挡样式 */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.observer?.disconnect();
    this.observer = null;
    if (this.playerTimer) clearTimeout(this.playerTimer);
    this.playerTimer = null;
    for (const node of this.maskedTexts) {
      const rec = this.textRecs.get(node);
      if (rec && node.data === rec.masked) node.data = rec.orig;
      this.textRecs.delete(node);
    }
    this.maskedTexts.clear();
    for (const el of this.maskedAttrEls) {
      const recs = this.attrRecs.get(el);
      recs?.forEach((rec, attr) => {
        if (el.getAttribute(attr) === rec.masked) el.setAttribute(attr, rec.orig);
      });
      this.attrRecs.delete(el);
    }
    this.maskedAttrEls.clear();
    this.doc.documentElement.classList.remove(CLASS_ON);
    this.emit();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.doc.documentElement.classList.add(CLASS_ON);
    this.injectStyle();
    this.evaluatePage(false);
    this.prune();
    this.processSubtree(this.doc.documentElement);
    this.observedRoots.forEach((r) => this.processSubtree(r));
    // 暂停期间不监听页面变化：播放器可能换过了，藏着的视频也重新量
    this.examined = new WeakMap();
    this.markPlayers();
    this.flush();
    this.observe();
    this.emit();
  }

  private emit() {
    this.opts.onStats?.(this.stats);
  }

  private injectStyle() {
    let style = this.doc.getElementById(STYLE_ID);
    if (!style) {
      style = this.doc.createElement('style');
      style.id = STYLE_ID;
      (this.doc.head ?? this.doc.documentElement).appendChild(style);
    }
    const css = buildShieldCss(this.opts.site, this.prefs);
    if (style.textContent !== css) style.textContent = css;
  }

  private observe() {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observeRoot(this.doc.documentElement);
    this.observedRoots.forEach((r) => this.observeRoot(r));
  }

  private observeRoot(root: Node) {
    this.observer?.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  private attachShadowRoot(root: ShadowRoot) {
    if (this.observedRoots.has(root)) return;
    this.observedRoots.add(root);
    this.processSubtree(root);
    this.flushPlayers();
    this.flush();
    this.observeRoot(root);
  }

  private onMutations(records: MutationRecord[]) {
    if (this.paused) return;
    let contextDirty = false;
    let besidesDirty = false;
    const layers: Element[] = [];
    const touchedCards = new Set<Element>();
    for (const rec of records) {
      const target = rec.target.nodeType === 1 ? (rec.target as Element) : rec.target.parentElement;
      if (rec.type === 'childList') {
        // 移走的是主视频或它的外层：重新判断（新加入的 <video>/<iframe> 由 processSubtree 发现）
        rec.removedNodes.forEach((node) => {
          if (this.players.has(node as Element)) this.videosDirty = true;
        });
        rec.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const el = node as Element;
            if (
              el.tagName === 'TITLE' ||
              (this.contextSelector && this.matchesOrContains(el, this.contextSelector))
            ) {
              contextDirty = true;
            }
            this.processSubtree(el);
            if (this.mainPlayer) {
              // 主视频已经在了，播放器的控制层、默认封面层后渲染出来（看它是不是盖在视频上的透明层），
              // 或者透明层里后插进来的内容（片尾推荐的缩略图）
              if (
                (this.coverSelector && this.matchesOrContains(el, this.coverSelector)) ||
                this.inOverlay(el)
              ) {
                layers.push(el);
              }
              // 主播放器的外层里后插进来的子元素：外层被遮挡规则命中时，它可能在视频旁边
              const parent = composedParent(el);
              if (parent && this.players.has(parent)) besidesDirty = true;
            }
          } else if (node.nodeType === 3) {
            this.processText(node as Text);
            if (node.parentElement?.tagName === 'TITLE') contextDirty = true;
          }
        });
        // 语境元素里的内容被原地替换（React/Vue 改 textContent、往空的标签容器里插标签）
        if (rec.addedNodes.length && target && this.inContext(target)) contextDirty = true;
      } else if (rec.type === 'characterData') {
        this.processText(rec.target as Text);
        if (target && (target.tagName === 'TITLE' || this.inContext(target))) contextDirty = true;
      } else if (rec.type === 'attributes' && rec.attributeName) {
        this.processAttr(rec.target as Element, rec.attributeName);
      }
      // 卡片先渲染骨架、后填标题，或者原地换内容（"换一换"、虚拟列表）：重新判断所在卡片
      if (target && this.cardSelector) {
        const card = this.cardOf(target);
        if (card && !card.hasAttribute(ATTR_CARD)) touchedCards.add(card);
      }
    }
    for (const card of touchedCards) {
      if (card.hasAttribute(ATTR_CARD) || !this.cardIsFootball(card)) continue;
      this.markCard(card);
      // 卡片里先前按非足球语境处理过的文字（"领先"等语境词）重新处理
      this.processSubtree(card);
    }
    if (this.win.location.href !== this.lastUrl) contextDirty = true;
    // 先标记主播放器再处理拆开的比分：比分要是直接摆在播放器外层里，不能整块藏。
    // 没有整体重新判断时，后插进来的层、外层里的子元素在这批变化绘制出来之前单独判断
    if (!this.flushPlayers()) {
      if (layers.length) this.checkLayers(layers, true);
      if (besidesDirty) this.refreshBesides();
    }
    this.flush();
    if (contextDirty) this.evaluatePage(true);
    if (!this.opts.onStats && ++this.batches % PRUNE_EVERY === 0) this.prune();
    this.emit();
  }

  private matchesOrContains(el: Element, selector: string): boolean {
    try {
      return el.matches(selector) || Boolean(el.querySelector(selector));
    } catch {
      return false;
    }
  }

  /** 元素是否在语境元素（标题、标签）里面 */
  private inContext(el: Element): boolean {
    if (!this.contextSelector) return false;
    try {
      return Boolean(el.closest(this.contextSelector));
    } catch {
      return false;
    }
  }

  /** 判断当前页面是不是足球页面，并切换 html.sff-fb */
  private evaluatePage(reprocess: boolean) {
    this.lastUrl = this.win.location.href;
    const site = this.opts.site;
    let football = Boolean(this.opts.forceFootball) || site?.context === 'always';
    if (!football && site?.footballUrlParts?.length) {
      const url = this.lastUrl.toLowerCase();
      football = site.footballUrlParts.some((part) => url.includes(part.toLowerCase()));
    }
    if (!football) {
      const parts: string[] = [this.originalTitle()];
      if (this.contextSelector) {
        try {
          const els = this.doc.querySelectorAll(this.contextSelector);
          for (let i = 0; i < els.length && i < 12; i++)
            parts.push((els[i]?.textContent ?? '').slice(0, 300));
        } catch {
          /* 选择器无效时忽略 */
        }
      }
      const text = parts.join('\n');
      football = text.includes(MASK_CHAR) || isFootballText(text);
    }
    const changed = football !== this.football;
    this.football = football;
    this.doc.documentElement.classList.toggle(CLASS_FOOTBALL, football);
    if (football) this.notifyFrames();
    if (changed && football && reprocess && !this.paused) {
      // 语境变成足球后，"领先""击败"这类语境词也要遮（包括已经在监听的 shadow root）
      this.processSubtree(this.doc.documentElement);
      [...this.observedRoots].forEach((r) => this.processSubtree(r));
      this.flush();
    }
    // 足球页才有的遮挡（评论、推荐区 display:none）开始或停止生效：主视频的外层可能刚被误伤，藏着的视频重新量
    if (changed) this.examined = new WeakMap();
    if (changed && reprocess) this.requestPlayers();
  }

  private notifyFrames() {
    const frames = this.doc.querySelectorAll('iframe');
    frames.forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({ type: FRAME_MSG, football: true }, '*');
      } catch {
        /* 忽略 */
      }
    });
  }

  private originalTitle(): string {
    const titleEl = this.doc.querySelector('title');
    const node = titleEl?.firstChild;
    if (node && node.nodeType === 3) {
      return this.textRecs.get(node as Text)?.orig ?? (node as Text).data;
    }
    return this.doc.title ?? '';
  }

  private pendingScoreCheck = new Set<Element>();

  private processSubtree(root: Node) {
    if (root.nodeType === 1 && isIgnored(root as Element)) return;
    const walker = this.doc.createTreeWalker(root, 1 /* SHOW_ELEMENT */ | 4 /* SHOW_TEXT */, {
      acceptNode: (node) =>
        node.nodeType === 1 && isIgnored(node as Element)
          ? 2 /* FILTER_REJECT */
          : 1 /* FILTER_ACCEPT */,
    });
    let node: Node | null = root.nodeType === 1 || root.nodeType === 11 ? root : walker.nextNode();
    if (root.nodeType === 3) {
      this.processText(root as Text);
      return;
    }
    while (node) {
      if (node.nodeType === 3) {
        this.processText(node as Text);
      } else if (node.nodeType === 1) {
        const el = node as Element;
        // 新的 <video>/<iframe>：绘制出来之前重新判断
        if (el.localName === 'video' || el.localName === 'iframe') this.videosAdded = true;
        // 页面复制了带标记的元素（cloneNode 会带上属性）：这份复制品不一定还是播放器，绘制出来之前先去掉标记，再重新判断
        if (this.stripCopiedMarks(el)) this.videosDirty = true;
        for (const attr of ATTRS) if (el.hasAttribute(attr)) this.processAttr(el, attr);
        if (this.cardSelector) this.evaluateCard(el);
        const shadow = (el as HTMLElement).shadowRoot;
        if (shadow && !this.observedRoots.has(shadow)) {
          this.observedRoots.add(shadow);
          this.processSubtree(shadow);
          this.observeRoot(shadow);
        }
      }
      node = walker.nextNode();
    }
  }

  private contextFor(el: Element): boolean {
    if (this.football) return true;
    const card = this.cardOf(el);
    return card ? this.cardIsFootball(card) : false;
  }

  private cardOf(el: Element): Element | null {
    if (!this.cardSelector) return null;
    try {
      return el.closest(this.cardSelector);
    } catch {
      return null;
    }
  }

  private cardIsFootball(card: Element): boolean {
    if (card.hasAttribute(ATTR_CARD)) return true;
    const cached = this.cardCache.get(card);
    if (cached) return true;
    const text = (card.textContent ?? '').slice(0, 600);
    const result = text.includes(MASK_CHAR) || isFootballText(text);
    if (result) this.cardCache.set(card, true);
    return result;
  }

  private evaluateCard(el: Element) {
    if (!this.cardSelector || el.hasAttribute(ATTR_CARD)) return;
    let isCard = false;
    try {
      isCard = el.matches(this.cardSelector);
    } catch {
      return;
    }
    if (isCard && this.cardIsFootball(el)) this.markCard(el);
  }

  private markCardOf(el: Element) {
    const card = this.cardOf(el);
    if (card && !card.hasAttribute(ATTR_CARD) && this.cardIsFootball(card)) this.markCard(card);
  }

  private markCard(card: Element) {
    card.setAttribute(ATTR_CARD, '');
    // 主视频原来不在足球卡片里，现在所在的容器成了足球卡片：改按卡片里的预览视频处理
    if (this.players.has(card)) this.requestPlayers();
  }

  private detectOptions(football: boolean) {
    return {
      football,
      extraWords: this.opts.extraWords,
      safePhrases: this.opts.safePhrases,
    };
  }

  private processText(node: Text) {
    if (this.paused) return;
    const parent = node.parentElement;
    if (!parent || IGNORE_TAGS.has(parent.tagName) || parent.closest(`[${ATTR_UI}]`)) return;
    if (parent.tagName === 'TITLE' && !this.prefs.title) return;
    if ((parent as HTMLElement).isContentEditable) return;
    const data = node.data;
    const rec = this.textRecs.get(node);
    if (rec && data === rec.masked) {
      // 离开页面一段时间又插回来的节点（KeepAlive、标签页、虚拟列表）：重新登记，暂停时才能恢复
      this.maskedTexts.add(node);
      return;
    }
    if (data.length < 2 || !HAS_WORD.test(data)) {
      if (rec) this.forgetText(node);
      if (HAS_DIGIT.test(data)) this.pendingScoreCheck.add(parent);
      return;
    }
    const masked = redact(data, this.detectOptions(this.contextFor(parent)));
    if (masked !== data) {
      this.textRecs.set(node, { orig: data, masked });
      this.maskedTexts.add(node);
      node.data = masked;
      this.markCardOf(parent);
    } else if (rec) {
      this.forgetText(node);
    }
    if (HAS_DIGIT.test(masked)) this.pendingScoreCheck.add(parent);
  }

  private forgetText(node: Text) {
    this.textRecs.delete(node);
    this.maskedTexts.delete(node);
  }

  private processAttr(el: Element, attr: string) {
    if (this.paused) return;
    const value = el.getAttribute(attr);
    let recs = this.attrRecs.get(el);
    const rec = recs?.get(attr);
    if (value === null) return;
    if (rec && value === rec.masked) {
      this.maskedAttrEls.add(el);
      return;
    }
    const masked = redact(value, this.detectOptions(this.contextFor(el)));
    if (masked !== value) {
      if (!recs) {
        recs = new Map();
        this.attrRecs.set(el, recs);
      }
      recs.set(attr, { orig: value, masked });
      this.maskedAttrEls.add(el);
      el.setAttribute(attr, masked);
    } else if (rec) {
      recs?.delete(attr);
    }
  }

  /** 处理被拆成多个元素的比分：<span>2</span><i>-</i><span>1</span> */
  private flush() {
    if (!this.pendingScoreCheck.size) return;
    const items = [...this.pendingScoreCheck];
    this.pendingScoreCheck.clear();
    for (const start of items) {
      this.maskTextRuns(start);
      let el: Element | null = start;
      for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
        if (el === this.doc.body || el === this.doc.documentElement) break;
        const player = el.hasAttribute(ATTR_PLAYER);
        if (el.hasAttribute(ATTR_HIDE) && !player) break;
        const text = el.textContent ?? '';
        if (text.length > SPLIT_SCORE_MAX_LEN) break;
        if (player) {
          // 主播放器（或它的外层）整块藏不住（遮挡样式不作用在它上面）：按原文识别，跨元素的比分只遮数字
          if (this.maskScoreIn(el)) break;
          continue;
        }
        if (!HAS_DIGIT.test(text)) continue;
        const spans = findSpoilers(text, this.detectOptions(this.contextFor(el)));
        if (spans.some((s) => s.kind === 'score')) {
          el.setAttribute(ATTR_HIDE, 'score');
          this.hiddenBlocks.add(el);
          break;
        }
      }
    }
  }

  /**
   * 拆开的比分直接摆在主播放器（或它的外层）里时不能整块藏：把块里所有文字（已遮的按原文）拼起来识别，
   * 跨元素的比分只把数字换成遮挡符。返回块里有没有比分
   */
  private maskScoreIn(el: Element): boolean {
    const nodes: Text[] = [];
    const walker = this.doc.createTreeWalker(el, 1 /* SHOW_ELEMENT */ | 4 /* SHOW_TEXT */, {
      acceptNode: (node) =>
        node.nodeType === 1 && isIgnored(node as Element)
          ? 2 /* FILTER_REJECT */
          : 1 /* FILTER_ACCEPT */,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) nodes.push(n as Text);
    }
    return nodes.length > 1 && this.maskTextRun(nodes, el);
  }

  /**
   * 处理完一批变化后重新判断主播放器：有新的 <video>/<iframe> 时马上判断（这批变化绘制出来之前，
   * 后插进来的主视频的外层被规则误伤也不会先黑一下）；只是有元素移走、被复制时，距上次判断太近就推迟，
   * 视频频繁移走的页面不会每批都重排。返回有没有马上整体判断过
   */
  private flushPlayers(): boolean {
    if (this.videosAdded) {
      this.markPlayers();
      return true;
    }
    if (!this.videosDirty) return false;
    if (Date.now() - this.playersAt < PLAYER_RECHECK_MS) {
      this.requestPlayers();
      return false;
    }
    this.markPlayers();
    return true;
  }

  /** 稍后重新判断主播放器（窗口、视频尺寸变化等）：已经排上的不再重排 */
  private requestPlayers() {
    if (!this.started || this.paused || this.playerTimer) return;
    this.playerTimer = setTimeout(() => {
      this.playerTimer = null;
      this.markPlayers();
    }, PLAYER_RECHECK_MS);
  }

  /**
   * 主播放器保护：每个页面选一个主播放器（pickPlayers），它和它的各层外层容器（跨 shadow 边界，到 <body> 为止）
   * 加上 data-sff-player，遮挡样式都不作用在它们身上。站点规则是宽泛的子串选择器，难免命中播放器外层
   * （咪咕外层的 is-barrage-hidden 被当成弹幕，整个播放器黑屏）；播放器里的弹幕、比分、进度条本身不带这个属性，照样遮挡，
   * 被命中的外层里在视频旁边的内容也照样藏（markBesides）。
   * 盖在主视频上的透明层另外标记（markOverlays），不刷成中性封面。
   * 这些属性都不在 MutationObserver 的 attributeFilter 里，写它们不会触发自己的观察器。
   */
  private markPlayers() {
    if (this.playerTimer) clearTimeout(this.playerTimer);
    this.playerTimer = null;
    this.videosDirty = false;
    this.videosAdded = false;
    if (!this.started || this.paused) return;
    const videos = this.collect('video');
    const frames = this.collect('iframe');
    const marked = this.markedElements();
    if (!videos.length && !frames.length && !marked.length && !this.mainPlayer) {
      this.watchSizes([]);
      this.watchPosters(new Set());
      this.watchClasses();
      return;
    }
    this.playersAt = Date.now();
    const pick = this.pickPlayers(videos, frames);
    const next = new Set<Element>();
    for (const member of pick.members) {
      for (
        let el: Element | null = member;
        el && el !== this.doc.body && el !== this.doc.documentElement;
        el = composedParent(el)
      ) {
        next.add(el);
      }
    }
    // 不再够格的，以及页面复制出来的带标记的元素去掉标记
    const changed = this.applyMarks(ATTR_PLAYER, this.players, next, marked, (el) => {
      // 先前当作普通元素整块藏起的拆开比分：现在整块藏不住了，改成遮住数字
      if (el.hasAttribute(ATTR_HIDE)) this.maskScoreIn(el);
    });
    this.players = next;
    this.mainPlayer = pick.main;
    // 标记变了，布局可能跟着变（外层不再被藏、旁边的内容藏起来了）：重新量主视频
    this.mainBox = changed ? (pick.main?.getBoundingClientRect() ?? null) : pick.box;
    if (this.markBesides(marked)) this.mainBox = pick.main?.getBoundingClientRect() ?? null;
    this.markOverlays(marked);
    this.watchSizes([...videos, ...frames, ...this.nearbyCovers()]);
    this.watchClasses();
  }

  /**
   * 选主播放器：<video> 和嵌入播放器的大 <iframe> 里布局尺寸够大的候选（不在链接里，不在信息流的足球卡片里）中
   * 面积最大的一个（一样大时取在窗口里露出面积大的，还一样取文档里靠前的），加上和它重叠一半以上的候选
   * （叠在上面的广告、第二路画面）。
   * 先在遮挡样式生效的情况下量（不额外排版）。有视频尺寸为空、又在我们 display:none 藏起的评论区/推荐区里
   * （规则可能误伤了主视频的外层），而且还没为它量过时，才临时停用遮挡样式量一次：这样量出来的视频还得在页面第一屏里，
   * 外面被藏起的元素也不能比它大太多（那是真的评论区、推荐区），比看得见的候选大才换成它。
   * 手机宽度（窗口窄于 640px）上不这样量：整宽的视频都够格，分不清误伤的播放器外层和评论区、推荐区里的视频。
   * 一个够格的都没有时，先前选出的主播放器还在页面上、还有尺寸就继续保护（滚动后缩成小窗、窗口变宽）
   */
  private pickPlayers(videos: Element[], frames: Element[]): PlayerPick {
    let pick = this.choose([...videos, ...frames], false);
    if (this.win.innerWidth >= PLAYER_WIDTH_CAP) {
      const hidden = this.hiddenByShield(videos, pick.boxes);
      if (hidden.length) {
        for (const video of hidden) this.examined.set(video, mediaSize(video));
        const alt = this.withoutShield(() => this.choose(videos, true));
        if (alt.main && alt.area > pick.area) pick = alt;
      }
    }
    return pick.main ? pick : this.keepMain(pick);
  }

  private choose(els: Element[], withoutShield: boolean): PlayerPick {
    const { innerWidth: vw, innerHeight: vh } = this.win;
    const scrollY = this.win.scrollY || 0;
    const minWidth = Math.max(
      PLAYER_MIN_WIDTH,
      Math.min(vw * PLAYER_VIEWPORT_SHARE, PLAYER_WIDTH_CAP),
    );
    const boxes = els.map((el) => el.getBoundingClientRect());
    const candidates: Candidate[] = [];
    els.forEach((el, i) => {
      const box = boxes[i]!;
      if (box.width < minWidth || box.height < PLAYER_MIN_HEIGHT) return;
      if (el.localName === 'iframe') {
        const aspect = box.height / box.width;
        if (aspect < FRAME_MIN_ASPECT || aspect > FRAME_MAX_ASPECT) return;
      }
      if (withoutShield && (box.top + scrollY >= vh || !this.fillsHidden(el, box))) return;
      if (this.isPreview(el, vw, vh)) return;
      candidates.push({ el, box, area: box.width * box.height });
    });
    const main = this.largest(candidates, vw, vh);
    if (!main) return { main: null, box: null, area: 0, members: [], boxes };
    const members = candidates
      .filter(
        (c) =>
          c === main ||
          overlapArea(c.box, main.box) >= PLAYER_OVERLAP * Math.min(c.area, main.area),
      )
      .map((c) => c.el);
    return { main: main.el, box: main.box, area: main.area, members, boxes };
  }

  /** 面积最大的候选；一样大（相差不到 2%）时取在窗口里露出面积大的，还一样就取文档里靠前的 */
  private largest(candidates: Candidate[], vw: number, vh: number): Candidate | null {
    const max = Math.max(0, ...candidates.map((c) => c.area));
    const view: Box = { left: 0, top: 0, right: vw, bottom: vh, width: vw, height: vh };
    let best: Candidate | null = null;
    let bestShown = -1;
    for (const c of candidates) {
      if (c.area < max * (1 - PLAYER_TIE)) continue;
      const shown = overlapArea(c.box, view);
      if (shown > bestShown) {
        best = c;
        bestShown = shown;
      }
    }
    return best;
  }

  /** 没有够格的候选：先前选出的主播放器还在页面上、还有尺寸、不在链接或信息流卡片里，就继续保护它 */
  private keepMain(pick: PlayerPick): PlayerPick {
    const prev = this.mainPlayer;
    if (!prev?.isConnected) return pick;
    const box = prev.getBoundingClientRect();
    const { innerWidth: vw, innerHeight: vh } = this.win;
    if (!box.width || !box.height || this.isPreview(prev, vw, vh)) return pick;
    return { main: prev, box, area: box.width * box.height, members: [prev], boxes: pick.boxes };
  }

  /** 预览而不是主播放器：在链接里（信息流、首页大图的预览都是链接），或者在信息流的足球卡片里 */
  private isPreview(el: Element, vw: number, vh: number): boolean {
    for (
      let cur = composedParent(el);
      cur && cur !== this.doc.body && cur !== this.doc.documentElement;
      cur = composedParent(cur)
    ) {
      if (cur.localName === 'a' && cur.hasAttribute('href')) return true;
      if (cur.hasAttribute(ATTR_CARD) && this.isFeedCard(cur, vw, vh)) return true;
    }
    return false;
  }

  /**
   * 足球卡片是不是信息流里的卡片（里面的视频是预览）：列表里重复的一项（有同样标签、同样 class 的兄弟元素）是，
   * 手机上整宽的卡片、首页的大图轮播也是；比窗口还高的不是（恰好匹配了卡片选择器的页面级容器）；
   * 页面有 <h1> 时，不含 <h1> 的是（首页大图卡片），含 <h1> 的不是（页面的主体）；
   * 页面没有 <h1>（咪咕）时，比窗口宽度的 60% 窄的是
   */
  private isFeedCard(card: Element, vw: number, vh: number): boolean {
    const cls = card.getAttribute('class');
    const parent = card.parentNode as ParentNode | null;
    for (let s = parent?.firstElementChild ?? null; s; s = s.nextElementSibling) {
      if (s !== card && s.localName === card.localName && s.getAttribute('class') === cls) {
        return true;
      }
    }
    const box = card.getBoundingClientRect();
    if (box.height >= vh) return false;
    if (this.doc.querySelector('h1')) return !card.querySelector('h1');
    return box.width < vw * FEED_CARD_SHARE;
  }

  /** el 外面被我们 display:none 藏起的元素（评论区、推荐区规则命中的）：遮挡样式只在文档里生效，带保护标记的不会被藏 */
  private hiddenAncestors(el: Element): Element[] {
    const selector = this.hiddenSelector;
    const out: Element[] = [];
    if (!selector) return out;
    for (
      let cur = composedParent(el);
      cur && cur !== this.doc.documentElement;
      cur = composedParent(cur)
    ) {
      if (cur.getRootNode() !== this.doc || cur.hasAttribute(ATTR_PLAYER)) continue;
      if (this.matches(cur, selector)) out.push(cur);
    }
    return out;
  }

  /** 足球页上尺寸为空、又在我们 display:none 藏起的元素（评论区、推荐区）里、还没停用样式量过的视频 */
  private hiddenByShield(videos: Element[], boxes: DOMRect[]): Element[] {
    if (!this.football || !this.hiddenSelector) return [];
    return videos.filter((video, i) => {
      const box = boxes[i]!;
      if (box.width || box.height || this.examined.has(video)) return false;
      return this.hiddenAncestors(video).length > 0;
    });
  }

  /**
   * 停用遮挡样式量的时候：视频外面被评论区、推荐区规则藏起的元素都不超过视频面积的 2 倍，才是被误伤的播放器外层
   * （咪咕的外层 1440×756 包着 1032×756 的视频）；更大的是真的评论区、推荐区
   */
  private fillsHidden(el: Element, box: DOMRect): boolean {
    const limit = box.width * box.height * WRAPPER_AREA_RATIO;
    return this.hiddenAncestors(el).every((hidden) => {
      const r = hidden.getBoundingClientRect();
      return r.width * r.height <= limit;
    });
  }

  /** 临时停用自己的遮挡样式执行 fn（量尺寸），在同一个任务里恢复：中间不会绘制，也不产生 DOM 变化 */
  private withoutShield<T>(fn: () => T): T {
    const sheet = (this.doc.getElementById(STYLE_ID) as HTMLStyleElement | null)?.sheet;
    if (!sheet || sheet.disabled) return fn();
    sheet.disabled = true;
    try {
      return fn();
    } finally {
      sheet.disabled = false;
    }
  }

  private matches(el: Element, selector: string): boolean {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }

  /**
   * 遮挡规则命中了主播放器的某一层外层（误伤的状态类，或者本来就该藏的容器恰好包着视频）时，
   * 这一层里和主视频不重叠的子元素（侧栏、上方的比分条）带上 data-sff-beside，照样按那条规则藏；
   * 盖在视频上的播放器界面（控制栏、弹幕层）和视频本身照常显示。只管播放器大小的外层（不超过视频面积的 2 倍）。
   * 返回标记有没有变
   */
  private markBesides(marked: Element[]): boolean {
    const next = new Set<Element>();
    const box = this.mainBox;
    const selector = this.hideSelector;
    if (box && selector) {
      const limit = box.width * box.height * WRAPPER_AREA_RATIO;
      for (const el of this.players) {
        if (el.getRootNode() !== this.doc || !this.matches(el, selector)) continue;
        const outer = el.getBoundingClientRect();
        if (outer.width * outer.height > limit) continue;
        for (const child of el.children) {
          if (this.players.has(child)) continue;
          // 已经按规则藏起来的（display:none 时量不出尺寸）接着藏
          if (this.besides.has(child)) {
            next.add(child);
            continue;
          }
          const r = child.getBoundingClientRect();
          if (r.width && r.height && !overlapArea(r, box)) next.add(child);
        }
      }
    }
    const changed = this.applyMarks(ATTR_BESIDE, this.besides, next, marked);
    this.besides = next;
    return changed;
  }

  /** 外层的 class 变了、外层里插进来新的子元素：重新量主视频，单独重新标记旁边的内容（没有外层被命中时不量） */
  private refreshBesides() {
    const main = this.mainPlayer;
    const selector = this.hideSelector;
    if (!main?.isConnected) return;
    const hit =
      selector &&
      [...this.players].some((el) => el.getRootNode() === this.doc && this.matches(el, selector));
    if (!hit && !this.besides.size) return;
    this.mainBox = main.getBoundingClientRect();
    if (this.markBesides([])) this.mainBox = main.getBoundingClientRect();
  }

  /**
   * 盖在主视频上的透明层：命中封面选择器、不是主播放器的外层、不是替换元素、和主视频重叠的部分至少是视频面积的一半、
   * 也至少是它自己面积的 85% 的元素加上 data-sff-overlay：它自己不刷中性底色（爱奇艺 XPlayer_cover、央视频直播的
   * div.con.poster 本来是透明的，刷成中性封面画面就全被挡住了），里面海报大小的图片、背景图照样换掉
   */
  private markOverlays(marked: Element[]) {
    const next = new Set<Element>();
    const target = this.mainBox;
    const area = target ? target.width * target.height : 0;
    if (this.mainPlayer && target && area > 0 && this.coverSelector) {
      let covers: Element[] = [];
      try {
        covers = [...this.doc.querySelectorAll(this.coverSelector)];
      } catch {
        /* 选择器无效时忽略 */
      }
      for (const el of covers) if (this.isOverlay(el, target, area)) next.add(el);
    }
    this.applyMarks(ATTR_OVERLAY, this.overlays, next, marked);
    this.overlays = next;
    // 透明层里的图片、背景图：标记了透明层之后再看（透明层里的背景图这时才不被封面规则去掉）
    const posters = new Set<Element>();
    const watch = new Set<Element>();
    const min = this.posterMin();
    if (min) {
      const found = new Set<Element>();
      for (const layer of next) for (const el of this.posterCandidates(layer)) found.add(el);
      for (const el of found) (this.isPosterSized(el, min) ? posters : watch).add(el);
    }
    this.applyMarks(ATTR_POSTER, this.posters, posters, marked);
    this.posters = posters;
    this.watchPosters(watch);
  }

  private isOverlay(el: Element, target: Box, area: number): boolean {
    if (REPLACED_TAGS.has(el.localName) || this.players.has(el)) return false;
    const box = el.getBoundingClientRect();
    const shared = overlapArea(box, target);
    return (
      shared > 0 &&
      shared >= area * OVERLAY_VIDEO_SHARE &&
      shared >= box.width * box.height * OVERLAY_LAYER_SHARE
    );
  }

  /** el 在我们标记的透明层里面 */
  private inOverlay(el: Element): boolean {
    if (!this.overlays.size) return false;
    for (let cur = el.parentElement; cur; cur = cur.parentElement) {
      if (this.overlays.has(cur)) return true;
    }
    return false;
  }

  /** 透明层里算海报大小的下限：160×90，视频小（手机）时按视频宽、高的 1/4 */
  private posterMin(): { w: number; h: number } | null {
    const box = this.mainBox;
    if (!box?.width || !box.height) return null;
    return {
      w: Math.min(POSTER_MIN_WIDTH, box.width * POSTER_VIDEO_SHARE),
      h: Math.min(POSTER_MIN_HEIGHT, box.height * POSTER_VIDEO_SHARE),
    };
  }

  private isPosterSized(el: Element, min: { w: number; h: number }): boolean {
    const box = el.getBoundingClientRect();
    return box.width >= min.w && box.height >= min.h;
  }

  /**
   * root（透明层或透明层里的元素）里可能是海报的元素：图片、视频、画布、带背景图的元素
   * （透明层自己的背景图由样式去掉）
   */
  private posterCandidates(root: Element): Element[] {
    const out: Element[] = [];
    const add = (el: Element) => {
      if (this.overlays.has(el) || this.players.has(el)) return;
      if (
        MEDIA_TAGS.has(el.localName) ||
        this.win.getComputedStyle(el).backgroundImage.includes('url(')
      ) {
        out.push(el);
      }
    };
    add(root);
    root.querySelectorAll('*').forEach(add);
    return out;
  }

  /** 透明层里新出现、变大了的图片、背景图：够海报大小的马上换掉（先量完再写），还不够的接着盯着尺寸 */
  private markPosters(els: Iterable<Element>) {
    const min = this.posterMin();
    if (!min || !this.overlays.size) return;
    const found = [...els].filter(
      (el) => el.isConnected && !this.posters.has(el) && this.inOverlay(el),
    );
    const big = found.filter((el) => this.isPosterSized(el, min));
    for (const el of big) {
      el.setAttribute(ATTR_POSTER, '');
      this.posters.add(el);
    }
    const watch = new Set(this.posterWatch);
    for (const el of found) {
      if (this.posters.has(el)) watch.delete(el);
      else watch.add(el);
    }
    this.watchPosters(watch);
  }

  /**
   * 主视频不变时单独判断后来出现的层（不整体重新判断）：后插进来、后加上 class 的命中封面选择器的元素是不是透明层，
   * 透明层里后插进来、后显示出来的内容有没有海报大小的。在这批变化绘制出来之前做完。
   * deep：连 els 里面命中封面选择器的元素一起看（后插进来的一整块）；class 变了时只看变了的元素本身
   */
  private checkLayers(els: Element[], deep: boolean) {
    const main = this.mainPlayer;
    const cover = this.coverSelector;
    if (!main?.isConnected || !cover) return;
    // 只在真有要量的层时才量主视频（弹幕之类的文字频繁插进透明层，不为它们提前排版）
    let target: DOMRect | null = null;
    const roots = new Set<Element>();
    for (const el of els) {
      if (!el.isConnected) continue;
      let layers: Element[] = [];
      try {
        layers = [...(el.matches(cover) ? [el] : []), ...(deep ? el.querySelectorAll(cover) : [])];
      } catch {
        /* 选择器无效时忽略 */
      }
      for (const layer of layers) {
        if (this.overlays.has(layer)) continue;
        target ??= main.getBoundingClientRect();
        if (!this.isOverlay(layer, target, target.width * target.height)) continue;
        layer.setAttribute(ATTR_OVERLAY, '');
        this.overlays.add(layer);
        roots.add(layer);
      }
      if (this.overlays.has(el) || this.inOverlay(el)) roots.add(el);
    }
    const found = new Set<Element>();
    for (const root of roots) for (const el of this.posterCandidates(root)) found.add(el);
    if (!target && !found.size) return;
    this.mainBox = target ?? main.getBoundingClientRect();
    if (found.size) this.markPosters(found);
  }

  /** 把 attr 写到 next 里的元素上，其他元素（上次标记的、页面复制出来的）去掉；返回有没有改动 */
  private applyMarks(
    attr: string,
    prev: Set<Element>,
    next: Set<Element>,
    marked: Element[],
    onAdd?: (el: Element) => void,
  ): boolean {
    let changed = false;
    for (const el of [...prev, ...marked]) {
      if (next.has(el) || !el.hasAttribute(attr)) continue;
      el.removeAttribute(attr);
      changed = true;
    }
    for (const el of next) {
      if (el.hasAttribute(attr)) continue;
      el.setAttribute(attr, '');
      changed = true;
      onAdd?.(el);
    }
    return changed;
  }

  /** 页面复制出来的带标记的元素（不在记下的集合里）：去掉标记，返回有没有 */
  private stripCopiedMarks(el: Element): boolean {
    let copied = false;
    const strip = (attr: string, set: Set<Element>) => {
      if (!el.hasAttribute(attr) || set.has(el)) return;
      el.removeAttribute(attr);
      copied = true;
    };
    strip(ATTR_PLAYER, this.players);
    strip(ATTR_BESIDE, this.besides);
    strip(ATTR_OVERLAY, this.overlays);
    strip(ATTR_POSTER, this.posters);
    return copied;
  }

  /** 文档和已在监听的 shadow root 里的某种元素 */
  private collect(tag: string): Element[] {
    const out: Element[] = [...this.doc.getElementsByTagName(tag)];
    for (const root of this.observedRoots) out.push(...root.querySelectorAll(tag));
    return out;
  }

  /** 带保护标记的元素（包括页面复制出来的） */
  private markedElements(): Element[] {
    const selector = MARKS.map((attr) => `[${attr}]`).join(',');
    const out: Element[] = [...this.doc.querySelectorAll(selector)];
    for (const root of this.observedRoots) out.push(...root.querySelectorAll(selector));
    return out;
  }

  /** 主视频往上 OVERLAY_WATCH_DEPTH 层（到 <body> 为止）的外层 */
  private watchTop(main: Element): Element {
    let top = main;
    for (let i = 0; i < OVERLAY_WATCH_DEPTH; i++) {
      const parent = composedParent(top);
      if (!parent || parent === this.doc.body || parent === this.doc.documentElement) break;
      top = parent;
    }
    return top;
  }

  /** 主视频往上几层以内命中封面选择器的元素（可能是还没显示出来的透明层） */
  private nearbyCovers(): Element[] {
    const main = this.mainPlayer;
    if (!main || !this.coverSelector) return [];
    try {
      return [...this.watchTop(main).querySelectorAll(this.coverSelector)].filter(
        (el) => !REPLACED_TAGS.has(el.localName) && !this.players.has(el),
      );
    } catch {
      return [];
    }
  }

  private resizeObserver(): ResizeObserver | null {
    if (typeof ResizeObserver !== 'function') return null;
    this.sizeObserver ??= new ResizeObserver((entries) => this.onResize(entries));
    return this.sizeObserver;
  }

  /**
   * 这些元素尺寸变了（播放器样式后加载、脚本后设尺寸、切换宽屏，藏着的层显示出来）也要重新判断；
   * 不再需要盯的不再盯。记下现在的尺寸：开始盯着时的第一次通知尺寸没变，不重新判断
   */
  private watchSizes(els: Element[]) {
    const ro = this.resizeObserver();
    if (!ro) return;
    const want = new Set(els);
    for (const el of this.sized.keys()) {
      if (want.has(el)) continue;
      this.sized.delete(el);
      if (!this.posterWatch.has(el)) ro.unobserve(el);
    }
    for (const el of want) {
      if (this.sized.has(el)) continue;
      this.sized.set(el, sizeKey(el.getBoundingClientRect()));
      if (!this.posterWatch.has(el)) ro.observe(el);
    }
  }

  /** 透明层里还不够海报大小的图片、背景图：盯着尺寸（藏着的显示出来、图片加载出来） */
  private watchPosters(want: Set<Element>) {
    const ro = this.resizeObserver();
    if (!ro) return;
    for (const el of this.posterWatch) {
      if (want.has(el)) continue;
      this.posterWatch.delete(el);
      if (!this.sized.has(el)) ro.unobserve(el);
    }
    for (const el of want) {
      if (this.posterWatch.has(el)) continue;
      this.posterWatch.add(el);
      if (!this.sized.has(el)) ro.observe(el);
    }
  }

  /**
   * 尺寸变了：透明层里的图片变成海报大小，马上换掉（ResizeObserver 的通知在绘制之前）；
   * 视频、iframe、附近的层尺寸真的变了才重新判断
   */
  private onResize(entries: readonly ResizeObserverEntry[]) {
    if (!this.started || this.paused) return;
    const posters: Element[] = [];
    let changed = false;
    for (const { target } of entries) {
      if (this.posterWatch.has(target)) posters.push(target);
      const before = this.sized.get(target);
      if (before === undefined) continue;
      const now = sizeKey(target.getBoundingClientRect());
      if (now === before) continue;
      this.sized.set(target, now);
      changed = true;
    }
    if (posters.length) this.markPosters(posters);
    if (changed) this.requestPlayers();
  }

  /**
   * 盯着 class 变化：主视频往上几层以内的整块（本来不命中封面选择器的层后来加上 class，透明层里的内容显示出来），
   * 以及更上面的各层外层本身（外层后来才被遮挡规则命中，旁边的内容要藏）
   */
  private watchClasses() {
    const main = this.mainPlayer;
    const top = main ? this.watchTop(main) : null;
    const targets = top ? [top, ...[...this.players].filter((el) => !top.contains(el))] : [];
    if (
      targets.length === this.classTargets.length &&
      targets.every((el, i) => el === this.classTargets[i])
    ) {
      return;
    }
    this.classObserver?.disconnect();
    this.classTargets = targets;
    if (!targets.length || typeof MutationObserver !== 'function') return;
    const observer = (this.classObserver ??= new MutationObserver((records) =>
      this.onClassChange(records),
    ));
    targets.forEach((el, i) =>
      observer.observe(el, { attributes: true, attributeFilter: ['class'], subtree: i === 0 }),
    );
  }

  private onClassChange(records: MutationRecord[]) {
    if (!this.started || this.paused || !this.mainPlayer) return;
    const targets = new Set<Element>();
    let chain = false;
    for (const rec of records) {
      const el = rec.target as Element;
      targets.add(el);
      if (this.players.has(el)) chain = true;
    }
    if (chain) this.refreshBesides();
    this.checkLayers([...targets], false);
  }

  /**
   * React 等把 "最终比分定格在{h}-{a}" 渲染成同一元素里相邻的多个文字节点
   * （服务端渲染时中间还夹着 <!-- -->），每个节点单独看都不是比分，所在段落又太长不能整块隐藏。
   * 把相邻文字节点拼起来识别，跨节点的比分只把其中的数字换成遮挡符。
   */
  private maskTextRuns(el: Element) {
    let run: Text[] = [];
    const check = () => {
      if (run.length > 1) this.maskTextRun(run, el);
      run = [];
    };
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) run.push(n as Text);
      else if (n.nodeType !== 8 /* 注释不打断 */) check();
    }
    check();
  }

  /** 返回这些文字拼起来有没有比分 */
  private maskTextRun(nodes: Text[], el: Element): boolean {
    // 已经遮过的节点按原文参与识别，这样其中一个节点后来被改写也能认出整体比分
    const origs = nodes.map((t) => {
      const rec = this.textRecs.get(t);
      return rec && t.data === rec.masked ? rec.orig : t.data;
    });
    const text = origs.join('');
    if (text.length > TEXT_RUN_MAX_LEN || !HAS_DIGIT.test(text)) return false;
    const spans = findSpoilers(text, this.detectOptions(this.contextFor(el))).filter(
      (s) => s.kind === 'score',
    );
    if (!spans.length) return false;
    let offset = 0;
    nodes.forEach((node, i) => {
      const orig = origs[i]!;
      const from = offset;
      const to = from + orig.length;
      offset = to;
      // 完全落在单个节点里的比分已由 processText 处理，这里只管跨节点的
      const ranges = spans
        .filter((s) => s.start < to && s.end > from && (s.start < from || s.end > to))
        .map((s) => [Math.max(s.start, from) - from, Math.min(s.end, to) - from] as const);
      if (!ranges.length) return;
      let digitsMasked = '';
      let pos = 0;
      for (const [a, b] of ranges) {
        digitsMasked += orig.slice(pos, a) + orig.slice(a, b).replace(NUMBER_RUN, MASK_CHAR);
        pos = b;
      }
      digitsMasked += orig.slice(pos);
      if (digitsMasked === orig) return;
      const masked = redact(digitsMasked, this.detectOptions(this.contextFor(el)));
      this.textRecs.set(node, { orig, masked });
      this.maskedTexts.add(node);
      if (node.data !== masked) node.data = masked;
      this.markCardOf(el);
    });
    return true;
  }

  private prune() {
    for (const node of this.maskedTexts) if (!node.isConnected) this.maskedTexts.delete(node);
    for (const el of this.maskedAttrEls) if (!el.isConnected) this.maskedAttrEls.delete(el);
    for (const el of this.hiddenBlocks) if (!el.isConnected) this.hiddenBlocks.delete(el);
    // 宿主已离开页面的 shadow root 不再持有；宿主插回来时 processSubtree 会重新登记
    for (const root of this.observedRoots) {
      if (!root.host.isConnected) this.observedRoots.delete(root);
    }
  }
}

/**
 * 在页面主环境（MAIN world）运行：attachShadow 之后发一个事件，
 * 让隔离环境里的遮挡脚本能处理新的 open shadow root（B 站评论区等）。
 */
export function installShadowHook(win: Window & typeof globalThis): void {
  const proto = win.Element.prototype as Element & { __sffHooked?: boolean };
  if (proto.__sffHooked) return;
  const original = proto.attachShadow;
  proto.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = original.call(this, init);
    win.queueMicrotask(() =>
      this.dispatchEvent(new win.CustomEvent('sff-shadow', { bubbles: true, composed: true })),
    );
    return root;
  };
  proto.__sffHooked = true;
}
