import type { HideCategory, SiteRule } from '../rules/schema.ts';

export const CLASS_ON = 'sff-on';
export const CLASS_FOOTBALL = 'sff-fb';
export const CLASS_READY = 'sff-ready';
export const ATTR_HIDE = 'data-sff-hide';
export const ATTR_CARD = 'data-sff-card';

/**
 * 页面加载初期先整页透明，处理完文字再显示，避免比分闪现。
 * 4 秒兜底动画：万一脚本出错也不会让页面一直空白。
 * （插件通过 manifest 的 css 注入同样内容，见 apps/extension/static/cloak.css）
 */
export const CLOAK_CSS = `html:not(.${CLASS_READY}){opacity:0;animation:sff-failsafe 1ms linear 4s forwards}
@keyframes sff-failsafe{to{opacity:1}}`;

/** 中性封面：深绿底 + 足球图案 + "防剧透" */
const NEUTRAL_COVER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'><rect width='160' height='90' fill='#1f3d2b'/><circle cx='80' cy='38' r='17' fill='none' stroke='#9fd3b0' stroke-width='3'/><path d='M80 27l8 6-3 9h-10l-3-9z' fill='#9fd3b0'/><text x='80' y='76' font-size='12' text-anchor='middle' fill='#cfe9d8' font-family='sans-serif'>防剧透</text></svg>`;
export const NEUTRAL_COVER_URL = `url("data:image/svg+xml,${encodeURIComponent(NEUTRAL_COVER_SVG)}")`;

export interface CssPrefs {
  hide: Record<HideCategory, boolean>;
  covers: boolean;
}

export const DEFAULT_CSS_PREFS: CssPrefs = {
  hide: {
    duration: true,
    progress: true,
    danmaku: true,
    comments: true,
    recommend: true,
    scoreboard: true,
  },
  covers: true,
};

const is = (list: string[]) => `:is(${list.join(',')})`;

const HIDE_DECL: Record<HideCategory, string> = {
  duration: 'visibility:hidden!important',
  // 进度条只是变透明，仍可点击/拖动
  progress: 'opacity:0!important',
  danmaku: 'visibility:hidden!important;opacity:0!important',
  comments: 'display:none!important',
  recommend: 'display:none!important',
  scoreboard: 'visibility:hidden!important;opacity:0!important',
};

/** 根据站点规则生成遮挡样式。所有规则都挂在 html.sff-on 下，暂停时去掉这个类即可整体失效 */
export function buildShieldCss(site: SiteRule | null, prefs: CssPrefs = DEFAULT_CSS_PREFS): string {
  const on = `html.${CLASS_ON}`;
  const fb = `html.${CLASS_ON}.${CLASS_FOOTBALL}`;
  const out: string[] = [`${on} [${ATTR_HIDE}]{visibility:hidden!important;opacity:0!important}`];
  if (!site) return out.join('\n');

  for (const [cat, selectors] of Object.entries(site.hide ?? {}) as Array<
    [HideCategory, string[]]
  >) {
    if (!prefs.hide[cat] || !selectors?.length) continue;
    out.push(`${fb} ${is(selectors)}{${HIDE_DECL[cat]}}`);
    // 非足球页面（例如首页信息流）里，单条足球视频卡片上的时长也要藏
    if (cat === 'duration') out.push(`${on} [${ATTR_CARD}] ${is(selectors)}{${HIDE_DECL[cat]}}`);
  }

  if (prefs.covers && site.coverSelectors?.length) {
    const cover = is(site.coverSelectors);
    const scopes = [
      `${fb} ${cover}`,
      `${on} [${ATTR_CARD}] ${cover}`,
      `${on} [${ATTR_CARD}]${cover}`,
    ];
    out.push(
      `${scopes.join(',')}{background:#1f3d2b ${NEUTRAL_COVER_URL} center/contain no-repeat!important}`,
    );
    const inner = (s: string) => scopes.map((scope) => `${scope} ${s}`).join(',');
    out.push(
      `${inner('img')},${inner('picture')},${inner('video')},${inner('canvas')}{opacity:0!important}`,
    );
    out.push(`${inner('*')}{background-image:none!important}`);
    // 封面选择器直接命中图片/视频本身（"[class*='news' i] img"、<img class="cover">）时上面只管后代：
    // 图片内容移出显示区域，露出自身的中性背景；视频、画布直接透明
    const self = (s: string) => scopes.map((scope) => `${scope}:is(${s})`).join(',');
    out.push(`${self('img')}{object-position:-99999px -99999px!important}`);
    out.push(`${self('video,canvas')}{opacity:0!important}`);
  }

  if (prefs.hide.duration || prefs.hide.progress) {
    // 原生 <video> 控件的时间轴和时长（只有 Chromium 支持，每条单独写，避免整条规则失效）
    for (const pseudo of [
      '-webkit-media-controls-timeline',
      '-webkit-media-controls-time-remaining-display',
      '-webkit-media-controls-current-time-display',
    ]) {
      out.push(`${fb} video::${pseudo}{display:none!important}`);
    }
  }
  return out.join('\n');
}
