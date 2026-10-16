import { findSpoilers, isFootballText, MASK_CHAR, redact } from '../text/detect.ts';
import type { SiteRule } from '../rules/schema.ts';
import {
  ATTR_CARD,
  ATTR_HIDE,
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

const IGNORE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE', 'CODE', 'PRE']);
const ATTRS = ['title', 'alt', 'aria-label', 'placeholder', 'data-title'];
const STYLE_ID = 'sff-shield-style';
const CLOAK_ID = 'sff-cloak';
const FRAME_MSG = 'sff-football-context';
/** 跨元素拼出来的比分（<span>2</span>-<span>1</span>）只在短文字里找 */
const SPLIT_SCORE_MAX_LEN = 60;

interface Rec {
  orig: string;
  masked: string;
}

const isIgnored = (el: Element) => IGNORE_TAGS.has(el.tagName) || el.hasAttribute('data-sff-ui');

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
  private readonly onShadow = (e: Event) => {
    const host = e.target as Element | null;
    if (host?.shadowRoot && !host.closest(`[${ATTR_UI}]`)) this.attachShadowRoot(host.shadowRoot);
  };
  private readonly onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string; football?: boolean } | null;
    if (
      data?.type === FRAME_MSG &&
      e.source === this.win.parent &&
      data.football &&
      !this.football
    ) {
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
    this.cardSelector = site?.cardSelectors?.length ? `:is(${site.cardSelectors.join(',')})` : null;
    const ctx = [...(site?.contextSelectors ?? []), 'h1'];
    this.contextSelector = `:is(${ctx.join(',')})`;
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
    this.flush();
    this.observe();
    this.doc.addEventListener('sff-shadow', this.onShadow, true);
    this.win.addEventListener('message', this.onMessage);
    if (this.doc.readyState === 'loading') {
      this.doc.addEventListener('DOMContentLoaded', () => this.evaluatePage(true), { once: true });
    }
    this.emit();
  }

  /** 更新站点规则或偏好（例如远程规则下载完成） */
  update(options: Partial<ShieldOptions>): void {
    this.opts = { ...this.opts, ...options };
    this.prefs = { ...DEFAULT_SHIELD_PREFS, ...this.opts.prefs };
    this.computeSelectors();
    if (!this.started || this.paused) return;
    this.injectStyle();
    this.evaluatePage(true);
  }

  stop(): void {
    this.pause();
    this.doc.removeEventListener('sff-shadow', this.onShadow, true);
    this.win.removeEventListener('message', this.onMessage);
    this.doc.getElementById(STYLE_ID)?.remove();
    this.started = false;
  }

  /** 一键临时显示：恢复所有原文、去掉遮挡样式 */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.observer?.disconnect();
    this.observer = null;
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
    this.processSubtree(this.doc.documentElement);
    this.observedRoots.forEach((r) => this.processSubtree(r));
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
    this.flush();
    this.observeRoot(root);
  }

  private onMutations(records: MutationRecord[]) {
    if (this.paused) return;
    let contextDirty = false;
    for (const rec of records) {
      if (rec.type === 'childList') {
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
          } else if (node.nodeType === 3) {
            this.processText(node as Text);
            if (node.parentElement?.tagName === 'TITLE') contextDirty = true;
          }
        });
      } else if (rec.type === 'characterData') {
        this.processText(rec.target as Text);
        if (rec.target.parentElement?.tagName === 'TITLE') contextDirty = true;
      } else if (rec.type === 'attributes' && rec.attributeName) {
        this.processAttr(rec.target as Element, rec.attributeName);
      }
    }
    if (this.win.location.href !== this.lastUrl) contextDirty = true;
    this.flush();
    if (contextDirty) this.evaluatePage(true);
    this.emit();
  }

  private matchesOrContains(el: Element, selector: string): boolean {
    try {
      return el.matches(selector) || Boolean(el.querySelector(selector));
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
      // 语境变成足球后，"领先""击败"这类语境词也要遮
      this.processSubtree(this.doc.documentElement);
      this.flush();
    }
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
    if (isCard && this.cardIsFootball(el)) el.setAttribute(ATTR_CARD, '');
  }

  private markCardOf(el: Element) {
    const card = this.cardOf(el);
    if (card && !card.hasAttribute(ATTR_CARD) && this.cardIsFootball(card)) {
      card.setAttribute(ATTR_CARD, '');
    }
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
    if (rec && data === rec.masked) return;
    if (data.length < 2 || !/[0-9A-Za-z一-鿿]/.test(data)) {
      if (rec) this.forgetText(node);
      if (/\d/.test(data)) this.pendingScoreCheck.add(parent);
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
    if (/\d/.test(masked)) this.pendingScoreCheck.add(parent);
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
    if (value === null || (rec && value === rec.masked)) return;
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
      let el: Element | null = start;
      for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
        if (el === this.doc.body || el === this.doc.documentElement) break;
        if (el.hasAttribute(ATTR_HIDE)) break;
        const text = el.textContent ?? '';
        if (text.length > SPLIT_SCORE_MAX_LEN) break;
        if (!/\d/.test(text)) continue;
        const spans = findSpoilers(text, this.detectOptions(this.contextFor(el)));
        if (spans.some((s) => s.kind === 'score')) {
          el.setAttribute(ATTR_HIDE, 'score');
          this.hiddenBlocks.add(el);
          break;
        }
      }
    }
  }

  private prune() {
    for (const node of this.maskedTexts) if (!node.isConnected) this.maskedTexts.delete(node);
    for (const el of this.maskedAttrEls) if (!el.isConnected) this.maskedAttrEls.delete(el);
    for (const el of this.hiddenBlocks) if (!el.isConnected) this.hiddenBlocks.delete(el);
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
