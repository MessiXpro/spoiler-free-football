import type { HideCategory, SiteRule } from '../rules/schema.ts';

export const CLASS_ON = 'sff-on';
export const CLASS_FOOTBALL = 'sff-fb';
export const CLASS_READY = 'sff-ready';
export const ATTR_HIDE = 'data-sff-hide';
export const ATTR_CARD = 'data-sff-card';
/**
 * 主播放器保护：页面的主视频和它的各层外层容器带这个属性（shield.ts 的 markPlayers 负责标记），
 * 所有遮挡样式都不作用在带它的元素上。站点规则都是宽泛的子串选择器，
 * 例如 [class*='barrage' i] 命中了咪咕播放器外层的状态类 is-barrage-hidden，把整个播放器藏成了黑屏；
 * 播放器里面的弹幕、比分、进度条等元素本身不带这个属性，照样遮挡。
 */
export const ATTR_PLAYER = 'data-sff-player';
/**
 * 遮挡规则命中了主播放器的某一层外层时，这一层里在视频旁边、和视频不重叠的子元素（侧栏、上方的比分条）
 * 带这个属性，照样按那条规则藏：保护的只是视频和盖在视频上的播放器界面，不是整块外层（shield.ts 的 markBesides 负责标记）
 */
export const ATTR_BESIDE = 'data-sff-beside';
/**
 * 盖在主视频上面的透明层：命中封面选择器、不是主视频的外层、本身不是图片/视频这类替换元素、
 * 和主视频重叠的部分至少是视频面积的一半、也至少是这一层自己面积的 85% 的元素带这个属性（shield.ts 的 markOverlays 负责标记）。
 * 播放器自己的控制层、默认封面层是透明的，刷成不透明的中性封面整个画面就看不见了
 * （爱奇艺的 XPlayer_cover、央视频直播的 div.con.poster）：它自己不刷底色，背景图照样去掉；
 * 里面的小图标照常显示，海报大小的图片、背景图另外带 data-sff-poster，照样换掉。
 * 遮挡类规则不受影响：盖在视频上的弹幕层、进度条、比分牌照样藏
 */
export const ATTR_OVERLAY = 'data-sff-overlay';
/** 透明层里海报大小的图片、视频、画布、带背景图的元素（片尾推荐的缩略图、海报层里的海报图）：照样换掉 */
export const ATTR_POSTER = 'data-sff-poster';
const NOT_PLAYER = `:not([${ATTR_PLAYER}])`;
const NOT_OVERLAY = `:not([${ATTR_OVERLAY}])`;

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

/**
 * 根据站点规则生成遮挡样式。所有规则都挂在 html.sff-on 下，暂停时去掉这个类即可整体失效。
 * 每条遮挡规则都以 :not([data-sff-player]) 结尾（接收声明的元素不能是主播放器或它的外层容器），
 * 只有两种例外：原生控件时间轴的伪元素规则（它只藏控件里的时间轴），
 * 以及去掉命中封面选择器的主播放器外层、透明层自己的背景图（外层的背景画在视频下面，挡不住画面）。
 * 遮挡类规则命中主播放器的外层时，外层里在视频旁边的子元素（data-sff-beside）照样按这条规则藏。
 * 封面规则里作为范围的封面元素带 :not([data-sff-overlay])（盖在主视频上的透明层不算封面）；
 * 范围不带主播放器条件：封面元素恰好包着主视频时，它自己不刷底色，里面别的缩略图照样换掉。
 * 透明层里海报大小的图片、背景图（data-sff-poster）照样换掉
 */
export function buildShieldCss(site: SiteRule | null, prefs: CssPrefs = DEFAULT_CSS_PREFS): string {
  const on = `html.${CLASS_ON}`;
  const fb = `html.${CLASS_ON}.${CLASS_FOOTBALL}`;
  const out: string[] = [
    `${on} [${ATTR_HIDE}]${NOT_PLAYER}{visibility:hidden!important;opacity:0!important}`,
  ];
  if (!site) return out.join('\n');

  // 命中的元素本身（不是主播放器的外层），以及命中的外层里在视频旁边的子元素
  const hideRule = (scope: string, selectors: string[], cat: HideCategory) =>
    `${scope} ${is(selectors)}${NOT_PLAYER},${scope} ${is(selectors)}[${ATTR_PLAYER}]>[${ATTR_BESIDE}]${NOT_PLAYER}{${HIDE_DECL[cat]}}`;
  for (const [cat, selectors] of Object.entries(site.hide ?? {}) as Array<
    [HideCategory, string[]]
  >) {
    if (!prefs.hide[cat] || !selectors?.length) continue;
    out.push(hideRule(fb, selectors, cat));
    // 非足球页面（例如首页信息流）里，单条足球视频卡片上的时长也要藏
    if (cat === 'duration') out.push(hideRule(`${on} [${ATTR_CARD}]`, selectors, cat));
  }

  if (prefs.covers && site.coverSelectors?.length) {
    const cover = is(site.coverSelectors);
    const scopes = [
      `${fb} ${cover}`,
      `${on} [${ATTR_CARD}] ${cover}`,
      `${on} [${ATTR_CARD}]${cover}`,
    ];
    const each = (f: (scope: string) => string) => scopes.map(f).join(',');
    // 封面元素自己换成中性底色：主播放器的外层、盖在主视频上的透明层除外
    out.push(
      `${each((s) => s + NOT_OVERLAY + NOT_PLAYER)}{background:#1f3d2b ${NEUTRAL_COVER_URL} center/contain no-repeat!important}`,
    );
    // 它们自己的背景图照样去掉：外层的背景（海报）画在视频下面，去掉也挡不住画面；透明层的背景图是盖在视频上的海报
    out.push(
      `${each((s) => `${s}:is([${ATTR_PLAYER}],[${ATTR_OVERLAY}])`)}{background-image:none!important}`,
    );
    // 封面里面的图片、视频透明，背景图去掉：范围只排除透明层（不排除主播放器的外层），主视频和它的外层本身不受影响
    const inner = (el: string) => each((s) => `${s}${NOT_OVERLAY} ${el}${NOT_PLAYER}`);
    out.push(
      `${inner('img')},${inner('picture')},${inner('video')},${inner('canvas')}{opacity:0!important}`,
    );
    out.push(`${inner('*')}{background-image:none!important}`);
    // 透明层里的小图标照常显示，海报大小的（data-sff-poster）照样换掉
    const poster = (el: string) =>
      each((s) => `${s}[${ATTR_OVERLAY}] ${el}[${ATTR_POSTER}]${NOT_PLAYER}`);
    out.push(`${poster(':is(img,picture,video,canvas)')}{opacity:0!important}`);
    out.push(`${poster('')}{background-image:none!important}`);
    // 封面选择器直接命中图片/视频本身（"[class*='news' i] img"、<img class="cover">）时上面只管后代：
    // 图片内容移出显示区域，露出自身的中性背景；视频、画布直接透明
    const self = (el: string) => each((s) => `${s}:is(${el})${NOT_PLAYER}`);
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
