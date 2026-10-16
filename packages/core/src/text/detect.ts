import { TEAMS, COMPETITIONS } from '../catalog/index.ts';
import { normalizeText } from './normalize.ts';
import {
  CONTEXT_NAME_DENY,
  EN_CONTEXTUAL,
  EN_FOOTBALL_HINTS,
  EN_SCORER_VERBS,
  EN_STRONG,
  ZH_CONTEXTUAL,
  ZH_FOOTBALL_HINTS,
  ZH_SAFE,
  ZH_SCORER_SUFFIX,
  ZH_STRONG,
} from './words.ts';

export type SpoilerKind = 'score' | 'result' | 'scorer' | 'event';

export interface SpoilerSpan {
  start: number;
  end: number;
  kind: SpoilerKind;
  /** 原文中被识别出的片段 */
  text: string;
  /** 只遮数字、保留队名（"Arsenal 2 Chelsea 1"） */
  digitsOnly?: boolean;
}

export interface DetectOptions {
  /** 已知这段文字处在足球语境（足球站点、足球视频页），"语境词"也会被遮挡 */
  football?: boolean;
  /** 额外的强结果词（来自站点规则配置） */
  extraWords?: string[];
  /** 额外的保护词组 */
  safePhrases?: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byLengthDesc = (a: string, b: string) => b.length - a.length;
const alt = (words: Iterable<string>) =>
  [...new Set(words)].filter(Boolean).sort(byLengthDesc).map(escapeRe).join('|');

const CN_NUM = '[零〇一二两三四五六七八九十]';
const NUM_ANY = `(?:\\d{1,2}|${CN_NUM}{1,3})`;

/** 跟在 "a-b" 后面就说明这是范围/数量，而不是比分 */
const RANGE_UNIT = new RegExp(
  '^\\s*(?:个?月|日|号|天|周|星期|年|岁|人|名|个|场|轮|分钟|小时|秒|期|集|章|节|话|倍|次|位|座|届|强|级|档|层|楼|款|种|套|件|元|块|万|亿|千|百|米|公里|公斤|斤|码|%|‰|' +
    'weeks?\\b|days?\\b|months?\\b|years?\\b|yrs?\\b|mins?\\b|minutes?\\b|hours?\\b|hrs?\\b|seconds?\\b|games?\\b|matches\\b|points?\\b|pts\\b|players?\\b|times\\b|' +
    '度|℃|°|km\\b|kg\\b|cm\\b|mm\\b|st\\b|nd\\b|rd\\b|th\\b|阵型|阵容|体系|站位|打法|formation)',
  'i',
);
/** 跟在 "1比1" "1:1" 后面说明是比例，不是比分 */
const RATIO_FOLLOW =
  /^\s*(?:还原|复刻|复原|比例|尺寸|模型|大小|等比|兑换|配比|打造|重现|再现|高仿|手办)/;
/** 紧挨在前面说明是范围："第1-3轮" */
const RANGE_PRECEDE =
  /(?:第|前|后|共|约|近|每|vol\.?|ep\.?|no\.?|chapter|part|episode|season)\s*$/i;
/** 双位数比分（10-0 这种）需要的语境 */
const SCORE_CONTEXT = /(?:比分|总比分|score|agg|ft|全场|半场|ht|最终)\s*[:：]?\s*$/i;

interface Rule {
  re: RegExp;
  kind: SpoilerKind;
  /** 返回 false 表示这是误报 */
  validate?: (m: RegExpExecArray, norm: string) => boolean;
  /** 需要足球语境 */
  contextual?: boolean;
  /** 只取某个捕获组作为遮挡范围 */
  group?: number;
  digitsOnly?: boolean;
}

const isLeadingZeroPair = (a: string) => a.length === 2 && a.startsWith('0');

function validateNumericScore(m: RegExpExecArray, norm: string): boolean {
  const [, a = '', sep = '', b = ''] = m;
  const before = norm.slice(Math.max(0, m.index - 12), m.index);
  const after = norm.slice(m.index + m[0].length, m.index + m[0].length + 12);
  // 时间/时长：右边两位数，例如 9:30、3:05、20:00
  if (sep === ':' && b.length === 2) return false;
  if (isLeadingZeroPair(a) || isLeadingZeroPair(b)) return false;
  if (RANGE_PRECEDE.test(before)) return false;
  if (RANGE_UNIT.test(after)) return false;
  if (sep === ':' && RATIO_FOLLOW.test(after)) return false;
  if (Number(a) > 9 || Number(b) > 9) {
    // 两位数比分少见，日期（10-17）、时间（20:00）多见，必须有明确的比分语境
    return SCORE_CONTEXT.test(before);
  }
  return true;
}

function validateRatio(m: RegExpExecArray, norm: string): boolean {
  const after = norm.slice(m.index + m[0].length, m.index + m[0].length + 8);
  return !RATIO_FOLLOW.test(after);
}

/** "进球集锦""第7轮进球"不是进球者提示 */
function validateZhScorer(m: RegExpExecArray, norm: string): boolean {
  const text = m[0];
  if (/^(?:全场|全部|精彩|本场|所有|赛季|本赛季|进球|最佳|十佳|本轮|上轮|历史|生涯)/.test(text)) {
    return false;
  }
  if (/进球$|头球$|远射$|任意球$/.test(text)) {
    const after = norm.slice(m.index + text.length, m.index + text.length + 4);
    const prevChar = text.at(-3) ?? '';
    if (/^(?:集锦|合集|盘点|回顾|瞬间|TOP|top|大全|数据|榜|锦集|视角)/.test(after)) return false;
    if (/[轮场赛周季杯部有佳彩]/.test(prevChar)) return false;
  }
  return true;
}

type Cache = { rules: Rule[]; contextRe: RegExp; safeRe: RegExp };
let cached: Cache | null = null;

function teamNames(): string[] {
  const names = new Set<string>();
  for (const team of TEAMS) {
    for (const name of [team.zh, team.zhFull, team.en, ...(team.aliases ?? [])]) {
      if (!name) continue;
      if (/^[A-Za-z]/.test(name) && name.length < 4) continue;
      names.add(name);
    }
  }
  return [...names];
}

function contextPattern(): RegExp {
  const zh = new Set<string>(ZH_FOOTBALL_HINTS);
  const en = new Set<string>(EN_FOOTBALL_HINTS);
  const add = (name: string | undefined) => {
    if (!name || CONTEXT_NAME_DENY.has(name)) return;
    if (/[一-鿿]/.test(name)) {
      if (name.length >= 2) zh.add(name);
    } else if (name.length >= 4) {
      en.add(name);
    }
  };
  for (const team of TEAMS) {
    // 国家名在新闻里太常见，不作为足球语境
    if (team.national) continue;
    [team.zh, team.zhFull, team.en, ...(team.aliases ?? [])].forEach(add);
  }
  for (const comp of COMPETITIONS) {
    [comp.zh, comp.zhFull, comp.en, ...(comp.aliases ?? []), ...(comp.zhAliases ?? [])].forEach(
      add,
    );
  }
  // 英文名区分大小写以减少误判（"nice" 不算，"Arsenal" 算）
  return new RegExp(`(?:${alt(zh)})|(?<![A-Za-z])(?:${alt(en)})(?![A-Za-z])`);
}

function safePattern(): RegExp {
  const names = new Set<string>(ZH_SAFE);
  for (const team of TEAMS) {
    [team.zh, team.zhFull, team.en, ...(team.aliases ?? []), ...(team.zhAliases ?? [])]
      .filter((n): n is string => Boolean(n) && (n as string).length >= 2)
      .forEach((n) => names.add(n));
  }
  for (const comp of COMPETITIONS) {
    [comp.zh, comp.zhFull, comp.en, ...(comp.aliases ?? []), ...(comp.zhAliases ?? [])]
      .filter((n): n is string => Boolean(n) && (n as string).length >= 2)
      .forEach((n) => names.add(n));
  }
  return new RegExp(alt(names), 'gi');
}

const ZH_MARGIN_SUFFIX = [
  '小胜',
  '大胜',
  '完胜',
  '获胜',
  '取胜',
  '战胜',
  '击败',
  '领先',
  '落后',
  '不敌',
  '告负',
  '狂胜',
  '血洗',
  '轻取',
  '力克',
  '险胜',
  '大败',
  '惨败',
  '完败',
  '惜败',
  '憾负',
  '小负',
  '落败',
  '淘汰',
  '晋级',
  '出局',
  '逆转',
  '翻盘',
  '大战',
  '狂欢',
  '盛宴',
  '优势',
  '胜',
  '负',
  '输',
  '赢',
];

function buildRules(): Rule[] {
  const teams = alt(teamNames());
  const rules: Rule[] = [
    // (4)1-1(3)：点球写在两侧括号里
    { re: /\(\s*\d{1,2}\s*\)\s*\d{1,2}\s*[-:]\s*\d{1,2}\s*\(\s*\d{1,2}\s*\)/g, kind: 'score' },
    // 1(4)-(3)1
    { re: /\d{1,2}\s*\(\s*\d{1,2}\s*\)\s*[-:]\s*\(\s*\d{1,2}\s*\)\s*\d{1,2}/g, kind: 'score' },
    // 点球 4-3 / 总比分 3-2 / agg 3-2 / PK4-3：带明确语境时允许两位数
    {
      re: /(?:点球大战|点球|互射点球|总比分|最终比分|全场比分|半场比分|比分|(?<![A-Za-z])(?:aggregate|agg\.?|pens?\.?|penalties|ft|ht|pk|pso))\s*[:：]?\s*\(?\s*(\d{1,2}\s*[-:]\s*\d{1,2})\s*\)?/gi,
      kind: 'score',
      group: 1,
      validate: (m) => !/^\d{1,2}:\d{2}$/.test((m[1] ?? '').replace(/\s/g, '')),
    },
    // 4-3 PK / 2-1 aet：数字后面紧跟英文标记
    {
      re: /(?<![\w\-:/+.])(\d{1,2}\s*[-:]\s*\d{1,2})\s*(?:pk|pso|pens?|aet|a\.e\.t\.?|ft)(?![A-Za-z])/gi,
      kind: 'score',
    },
    // 基本写法：2-1、2:1、2 - 1（排除阵型 4-3-3、赛季 2025-26、日期、时间、范围）
    {
      re: /(?<![\w\-:/+.]|\d\.|\d\s*[-:]\s*)(\d{1,2})\s*([-:])\s*(\d{1,2})(?![\w\-:/%+]|\.\d|\s*[-:]\s*\d)/g,
      kind: 'score',
      validate: validateNumericScore,
    },
    // 2比1、二比零
    {
      re: new RegExp(`(?<!\\d)${NUM_ANY}\\s*比\\s*${NUM_ANY}(?!\\d)`, 'g'),
      kind: 'score',
      validate: validateRatio,
    },
    // BBC 写法：Arsenal 2 Chelsea 1 / 阿森纳 2 切尔西 1
    {
      re: new RegExp(
        `(?:${teams})\\s+(\\d{1,2})\\s*,?\\s+(?:${teams})\\s+(\\d{1,2})(?![\\d\\-:])`,
        'g',
      ),
      kind: 'score',
      digitsOnly: true,
    },
    // 进球数：3球大胜、两球领先、7球大战
    {
      re: new RegExp(`${NUM_ANY}\\s*(?:个|粒)?\\s*球\\s*(?:${alt(ZH_MARGIN_SUFFIX)})`, 'g'),
      kind: 'score',
    },
    // 净胜两球、打进2球、丢了3球
    {
      re: new RegExp(
        `(?:净胜|领先|落后|狂灌|狂轰|攻入|打进|打入|攻进|轰入|射入|灌进|连进|连入|连扳|扳回|丢了?|失|狂进|连丢|进了|再进|又进|共进|合计)\\s*${NUM_ANY}\\s*(?:个|粒)?\\s*(?:球|粒进球)`,
        'g',
      ),
      kind: 'score',
    },
    // 5粒进球
    { re: new RegExp(`${NUM_ANY}\\s*(?:粒|个)\\s*进球`, 'g'), kind: 'score' },
    // 进球者提示：XX 破门 / XX 建功（人名 2~6 个汉字）
    {
      re: new RegExp(`[\\u4e00-\\u9fff·・]{2,6}(?:${alt(ZH_SCORER_SUFFIX)})`, 'g'),
      kind: 'scorer',
      validate: validateZhScorer,
    },
    // 拉丁字母人名 + 中文进球词："Haaland破门"
    {
      re: new RegExp(
        `[A-Z][A-Za-z'\\-.]+(?:\\s[A-Z][A-Za-z'\\-.]+)?\\s*(?:${alt(ZH_SCORER_SUFFIX.filter((w) => w !== '进球'))})`,
        'g',
      ),
      kind: 'scorer',
    },
    // 英文：Haaland scores / Saka nets / Kane brace
    {
      re: new RegExp(
        `(?<![A-Za-z])[A-Z][a-zà-ÿA-Z'\\-]+(?:\\s(?:de |van |di )?[A-Z][a-zà-ÿA-Z'\\-]+){0,2}(?:'s)?\\s+(?:${alt(EN_SCORER_VERBS)})(?![A-Za-z])`,
        'g',
      ),
      kind: 'scorer',
      validate: (m) =>
        !/^(?:Watch|Full|Extended|All|Every|Best|Top|Match|Premier|League|Champions|The|Who|When|How|Will|Can|Live|Preview|Highlights|Team|Goal|Goals)\b/.test(
          m[0],
        ),
    },
    // 补时进球：90+3 分钟
    { re: /\d{1,3}\s*\+\s*\d{1,2}\s*分钟/g, kind: 'event' },
    // 结果词
    { re: new RegExp(alt(ZH_STRONG), 'g'), kind: 'result' },
    { re: new RegExp(`(?<![A-Za-z])(?:${alt(EN_STRONG)})(?![A-Za-z])`, 'gi'), kind: 'result' },

    // ↓ 以下需要足球语境
    // 比赛分钟：Haaland 23'、90+3'、第89分钟
    {
      re: /(?<![\w.])\d{1,3}(?:\s*\+\s*\d{1,2})?\s*'(?![\w'])/g,
      kind: 'event',
      contextual: true,
    },
    { re: /第\s*\d{1,3}(?:\s*\+\s*\d{1,2})?\s*分钟/g, kind: 'event', contextual: true },
    { re: new RegExp(alt(ZH_CONTEXTUAL), 'g'), kind: 'result', contextual: true },
    {
      re: new RegExp(`(?<![A-Za-z])(?:${alt(EN_CONTEXTUAL)})(?![A-Za-z])`, 'gi'),
      kind: 'result',
      contextual: true,
    },
  ];
  return rules;
}

function getCache(): Cache {
  if (!cached) {
    cached = { rules: buildRules(), contextRe: contextPattern(), safeRe: safePattern() };
  }
  return cached;
}

/** 这段文字是否和足球相关（出现球队名、赛事名或足球通用词） */
export function isFootballText(text: string): boolean {
  if (!text) return false;
  return getCache().contextRe.test(normalizeText(text));
}

function protectedRanges(norm: string, extraSafe: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const { safeRe } = getCache();
  safeRe.lastIndex = 0;
  for (let m = safeRe.exec(norm); m; m = safeRe.exec(norm)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  for (const phrase of extraSafe) {
    if (!phrase) continue;
    for (
      let idx = norm.indexOf(phrase);
      idx >= 0;
      idx = norm.indexOf(phrase, idx + phrase.length)
    ) {
      ranges.push([idx, idx + phrase.length]);
    }
  }
  return ranges;
}

/** 找出文字中所有剧透片段（按位置排序、已合并重叠） */
export function findSpoilers(text: string, options: DetectOptions = {}): SpoilerSpan[] {
  if (!text || text.length < 2) return [];
  const norm = normalizeText(text);
  const { rules } = getCache();
  const safe = protectedRanges(norm, options.safePhrases ?? []);
  const spans: SpoilerSpan[] = [];
  let football: boolean | undefined = options.football ? true : undefined;

  const extraRules: Rule[] = (options.extraWords ?? [])
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => ({ re: new RegExp(escapeRe(w), 'gi'), kind: 'result' as const }));

  for (const rule of [...extraRules, ...rules]) {
    if (rule.contextual) {
      // 已经找到比分/强结果词时，这段文字必然是赛果描述
      football ??= spans.length > 0 || isFootballText(norm);
      if (!football) continue;
    }
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(norm); m; m = rule.re.exec(norm)) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      if (rule.validate && !rule.validate(m, norm)) {
        rule.re.lastIndex = m.index + 1;
        continue;
      }
      let start = m.index;
      let end = m.index + m[0].length;
      if (rule.group !== undefined && m[rule.group]) {
        const inner = m[rule.group] as string;
        start = m.index + m[0].indexOf(inner);
        end = start + inner.length;
      }
      // 完全落在球队名/赛事名/保护词里的命中是误报（"欧洲冠军联赛"里的"冠军"）
      if (safe.some(([s, e]) => start >= s && end <= e)) continue;
      spans.push({
        start,
        end,
        kind: rule.kind,
        text: text.slice(start, end),
        ...(rule.digitsOnly ? { digitsOnly: true } : {}),
      });
    }
  }
  return mergeSpans(spans, text);
}

const KIND_PRIORITY: Record<SpoilerKind, number> = { score: 3, scorer: 2, result: 1, event: 0 };

function mergeSpans(spans: SpoilerSpan[], text: string): SpoilerSpan[] {
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: SpoilerSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && span.start < last.end) {
      if (span.end > last.end) last.end = span.end;
      if (KIND_PRIORITY[span.kind] > KIND_PRIORITY[last.kind]) last.kind = span.kind;
      if (!span.digitsOnly) delete last.digitsOnly;
      last.text = text.slice(last.start, last.end);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

export function hasSpoiler(text: string, options: DetectOptions = {}): boolean {
  return findSpoilers(text, options).length > 0;
}

export const MASK_CHAR = '■';

function maskFor(span: SpoilerSpan): string {
  if (span.digitsOnly) return span.text.replace(/\d{1,2}/g, MASK_CHAR);
  if (span.kind === 'score') {
    return /[-:比]/.test(normalizeText(span.text))
      ? `${MASK_CHAR}-${MASK_CHAR}`
      : MASK_CHAR.repeat(2);
  }
  if (span.kind === 'scorer') return MASK_CHAR.repeat(3);
  return MASK_CHAR.repeat(2);
}

/** 把剧透片段替换成遮挡符，返回新文字；没有剧透时原样返回 */
export function redact(text: string, options: DetectOptions = {}): string {
  const spans = findSpoilers(text, options);
  if (!spans.length) return text;
  let out = '';
  let pos = 0;
  for (const span of spans) {
    out += text.slice(pos, span.start) + maskFor(span);
    pos = span.end;
  }
  return out + text.slice(pos);
}
