/**
 * 站点遮挡规则（纯数据）。插件和用户脚本内置一份默认规则，
 * 也可以定期从网页部署地址下载新版 JSON。规则里只有 CSS 选择器和词表，
 * 不包含任何可执行代码，符合扩展商店"禁止远程代码"的政策。
 */

export type HideCategory =
  'duration' | 'progress' | 'danmaku' | 'comments' | 'recommend' | 'scoreboard';

export const HIDE_CATEGORIES: HideCategory[] = [
  'duration',
  'progress',
  'danmaku',
  'comments',
  'recommend',
  'scoreboard',
];

export const HIDE_CATEGORY_LABELS: Record<HideCategory, string> = {
  duration: '视频时长',
  progress: '进度条与预览缩略图',
  danmaku: '弹幕',
  comments: '评论区',
  recommend: '相关推荐',
  scoreboard: '比分牌',
};

export interface SiteRule {
  id: string;
  name: string;
  /** 域名后缀，例如 "bilibili.com" 同时匹配 www.bilibili.com、m.bilibili.com */
  hosts: string[];
  /**
   * always：整站视为足球站点（懂球帝、直播吧）
   * detect：根据页面标题/标签判断当前页面是否与足球相关（B 站、爱奇艺等综合视频站）
   */
  context: 'always' | 'detect';
  /** 判断足球语境时额外读取的元素（标题、标签） */
  contextSelectors?: string[];
  /** URL 里包含这些片段时直接视为足球页面 */
  footballUrlParts?: string[];
  /** 标题类元素：里面的文字一律按足球语境处理 */
  titleSelectors?: string[];
  /** 列表里的"卡片"（一个视频/一篇文章），用于逐条判断要不要换封面、藏时长 */
  cardSelectors?: string[];
  /** 封面图（图片、背景图、预览视频） */
  coverSelectors?: string[];
  hide?: Partial<Record<HideCategory, string[]>>;
  /** 规则可信度：high 已对照真实页面结构；low 为推测，需要本地验证 */
  confidence?: 'high' | 'medium' | 'low';
}

export interface SiteRulesDoc {
  /** 数据格式版本，插件只接受自己认识的版本 */
  schema: 1;
  /** 规则内容版本（日期），用于判断是否更新 */
  version: string;
  sites: SiteRule[];
  /** 通用识别额外的强结果词 */
  extraWords?: string[];
  /** 通用识别额外的保护词 */
  safePhrases?: string[];
}

/** 不允许出现在选择器里的字符：防止借选择器注入额外 CSS 规则或加载外部资源 */
const FORBIDDEN_IN_SELECTOR = /[{};@<\\]|\/\*|url\s*\(|expression\s*\(|import/i;
const MAX_SELECTOR_LENGTH = 300;
const MAX_LIST = 120;

export function isSafeSelector(selector: unknown): selector is string {
  return (
    typeof selector === 'string' &&
    selector.trim().length > 0 &&
    selector.length <= MAX_SELECTOR_LENGTH &&
    !FORBIDDEN_IN_SELECTOR.test(selector)
  );
}

function cleanList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isSafeSelector).slice(0, MAX_LIST);
  return out.length ? out : undefined;
}

function cleanWords(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((w): w is string => typeof w === 'string' && w.trim().length >= 2 && w.length <= 30)
    .slice(0, 500);
  return out.length ? out : undefined;
}

const HOST_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

/**
 * 校验并清洗规则文档。不合格的字段被丢弃，整份文档不合格返回 null。
 * 远程下载的规则必须先经过这里。
 */
export function validateSiteRules(input: unknown): SiteRulesDoc | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (raw.schema !== 1 || typeof raw.version !== 'string' || !Array.isArray(raw.sites)) return null;
  const sites: SiteRule[] = [];
  for (const s of raw.sites.slice(0, 100)) {
    if (!s || typeof s !== 'object') continue;
    const site = s as Record<string, unknown>;
    if (typeof site.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(site.id)) continue;
    const hosts = Array.isArray(site.hosts)
      ? site.hosts.filter((h): h is string => typeof h === 'string' && HOST_RE.test(h))
      : [];
    if (!hosts.length) continue;
    const hide: Partial<Record<HideCategory, string[]>> = {};
    if (site.hide && typeof site.hide === 'object') {
      for (const cat of HIDE_CATEGORIES) {
        const list = cleanList((site.hide as Record<string, unknown>)[cat]);
        if (list) hide[cat] = list;
      }
    }
    const footballUrlParts = Array.isArray(site.footballUrlParts)
      ? site.footballUrlParts.filter((p): p is string => typeof p === 'string' && p.length <= 80)
      : undefined;
    const rule: SiteRule = {
      id: site.id,
      name: typeof site.name === 'string' ? site.name.slice(0, 40) : site.id,
      hosts,
      context: site.context === 'always' ? 'always' : 'detect',
      hide,
    };
    const optional = {
      contextSelectors: cleanList(site.contextSelectors),
      titleSelectors: cleanList(site.titleSelectors),
      cardSelectors: cleanList(site.cardSelectors),
      coverSelectors: cleanList(site.coverSelectors),
      footballUrlParts: footballUrlParts?.length ? footballUrlParts : undefined,
    };
    for (const [k, v] of Object.entries(optional)) {
      if (v) (rule as unknown as Record<string, unknown>)[k] = v;
    }
    if (site.confidence === 'high' || site.confidence === 'medium' || site.confidence === 'low') {
      rule.confidence = site.confidence;
    }
    sites.push(rule);
  }
  const doc: SiteRulesDoc = { schema: 1, version: raw.version.slice(0, 40), sites };
  const extraWords = cleanWords(raw.extraWords);
  const safePhrases = cleanWords(raw.safePhrases);
  if (extraWords) doc.extraWords = extraWords;
  if (safePhrases) doc.safePhrases = safePhrases;
  return doc;
}

/** 根据域名找规则："www.bilibili.com" 命中 hosts 里的 "bilibili.com" */
export function matchSite(doc: SiteRulesDoc, hostname: string): SiteRule | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  let best: { rule: SiteRule; len: number } | null = null;
  for (const rule of doc.sites) {
    for (const h of rule.hosts) {
      const suffix = h.toLowerCase();
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        if (!best || suffix.length > best.len) best = { rule, len: suffix.length };
      }
    }
  }
  return best?.rule ?? null;
}

/** 比较规则版本（"2026-10-16" 或 "2026-10-16.2"） */
export function isNewerRules(candidate: string, current: string): boolean {
  return candidate.localeCompare(current, 'en', { numeric: true }) > 0;
}
