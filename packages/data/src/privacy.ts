import { findSpoilers } from '@sff/core';

/**
 * 公开数据（页面初始加载的 JSON）防泄露检查：
 * 1. 不允许出现跟比分/结果/时长相关的字段名
 * 2. 所有文字都不能被识别出比分写法或结果词（按足球语境，最严格）
 * 3. 链接里不能带 "2-1" 这种比分片段
 */
const FORBIDDEN_KEYS =
  /^(?:score|scores|goals?|winner|result|fulltime|full_time|halftime|half_time|penalt(?:y|ies)|aggregate|duration|length|extratime|extra_time|regulartime|aet|outcome|minute)$/i;

/**
 * 球队名来自数据源，不是赛果描述，不做结果词检查（比如 "Melbourne Victory"）；
 * 比赛 id 和球队 id 由赛事、赛季、阶段、日期和球队名生成（目录外球队就是 x-melbourne-victory），同样不查结果词。
 * 这几类只查数字比分写法，比分仍然进不了公开数据。
 */
const NAME_PATHS = /\.(?:home|away)\.(?:name|id)$|\.matches\[\d+\]\.id$/;
/** 去掉日期、赛季后再找 "2-1" / "2:1" / "2比1" */
const NAME_DATE = /\d{4}-\d{2}-\d{2}|\d{4}-\d{2}(?!\d)/g;
const NAME_SCORE = /(?<!\d)\d{1,2}\s*[-–—:：比]\s*\d{1,2}(?!\d)/;

const URL_SCORE = /(?:^|[-_/])\d{1,2}[-_:]\d{1,2}(?:[-_/.]|$)/;
const URL_DATE = /\d{4}[-_]\d{2}[-_]\d{2}|\d{8}/g;

export function findPublicDataLeaks(value: unknown, path = '$'): string[] {
  const leaks: string[] = [];
  const visit = (v: unknown, p: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (/^https?:\/\//.test(v)) {
        let decoded = v;
        try {
          decoded = decodeURIComponent(v);
        } catch {
          /* 保持原样 */
        }
        let urlPath = '';
        try {
          urlPath = decodeURIComponent(new URL(v).pathname).replace(URL_DATE, '');
        } catch {
          urlPath = v;
        }
        if (URL_SCORE.test(urlPath) || findSpoilers(urlPath).length) {
          leaks.push(`${p}: 链接疑似含比分 ${decoded}`);
        }
        return;
      }
      if (NAME_PATHS.test(p)) {
        const hit = v.replace(NAME_DATE, ' ').match(NAME_SCORE);
        if (hit) leaks.push(`${p}: "${v}" 含 ${hit[0]}`);
        return;
      }
      const spans = findSpoilers(v, { football: true });
      if (spans.length) leaks.push(`${p}: "${v}" 含 ${spans.map((s) => s.text).join('、')}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${p}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (FORBIDDEN_KEYS.test(k)) leaks.push(`${p}.${k}: 不允许的字段名`);
        visit(child, `${p}.${k}`);
      }
    }
  };
  visit(value, path);
  return leaks;
}

export class PublicDataLeakError extends Error {
  constructor(readonly leaks: string[]) {
    super(`公开数据可能泄露比分/结果（${leaks.length} 处）：\n${leaks.slice(0, 20).join('\n')}`);
  }
}

export function assertNoLeaks(value: unknown, path = '$'): void {
  const leaks = findPublicDataLeaks(value, path);
  if (leaks.length) throw new PublicDataLeakError(leaks);
}
