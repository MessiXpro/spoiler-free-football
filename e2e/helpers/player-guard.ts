import { inflateSync } from 'node:zlib';
import { expect, type Locator, type Page } from '@playwright/test';
import { DEFAULT_SITE_RULES_JSON, type SiteRulesDoc } from '../../packages/core/src/index.ts';
import { sitePage } from './flash.ts';

/** 咪咕直播/回放页（/p/live/<节目编号>，回放黑屏的就是这类页面；编号随便填一个） */
export const MIGU_LIVE_URL = 'https://www.miguvideo.com/p/live/120000000001';
/** 爱奇艺播放页、央视频直播详情页（编号随便填一个） */
export const IQIYI_URL = 'https://www.iqiyi.com/v_000000000001.html';
export const YANGSHIPIN_URL = 'https://www.yangshipin.cn/live/detail?pid=600000000001';

export const miguLivePage = () =>
  sitePage('migu-live.html', {
    __TITLE__: '英超 阿森纳 vs 切尔西 全场回放_咪咕视频',
    __H1__: '英超 阿森纳 vs 切尔西',
  });

export const miguPhonePage = () =>
  sitePage('migu-phone.html', {
    __TITLE__: '英超 曼联 vs 热刺 全场回放_咪咕视频',
    __H1__: '英超 曼联 vs 热刺',
  });

type Rgb = [number, number, number];
/** 视频画面（poster）用的颜色、中性封面的底色 */
const PICTURE: Rgb = [208, 0, 0];
const NEUTRAL: Rgb = [31, 61, 43];
const WHITE: Rgb = [255, 255, 255];
const svg = (w: number, h: number, fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='${w}' height='${h}' fill='${fill}'/></svg>`,
  )}`;

export const iqiyiPlayerPage = () =>
  sitePage('iqiyi-player.html', {
    __TITLE__: '欧冠联赛 皇家马德里vs利物浦 全场回放-体育-完整版视频在线观看-爱奇艺',
    __H1__: '欧冠联赛 皇家马德里vs利物浦 全场回放',
    __POSTER__: svg(1100, 836, '#d00000'),
    __ICON__: svg(32, 32, '#ffffff'),
    __THUMB__: svg(116, 65, '#0040d0'),
  });

export const yangshipinLivePage = () =>
  sitePage('yangshipin-live.html', {
    __TITLE__: '2026/27赛季英超第12轮 阿森纳vs切尔西_央视频',
    __H1__: '2026/27赛季英超第12轮 阿森纳vs切尔西',
    __POSTER__: svg(978, 550, '#d00000'),
    __ICON__: svg(32, 32, '#ffffff'),
    __THUMB__: svg(300, 170, '#0040d0'),
  });

/** 修正前的咪咕弹幕选择器：[class*='barrage' i] 会命中播放器外层的 is-barrage-hidden */
export const OLD_MIGU_DANMAKU = [
  "[class*='danmu' i]",
  "[class*='danmaku' i]",
  "[class*='barrage' i]",
  "[class*='bullet' i]",
];
/** 修正前（d8fb95b 之前）的爱奇艺、央视频封面选择器：会命中播放器盖在视频上的透明层 */
export const OLD_IQIYI_COVER = [
  "div[class^='video-list-item_'] [class*='img']",
  "div[class^='video-slide_'] [class*='img']",
  "[class*='cover' i]",
  '.qy-mod-link-wrap',
];
export const OLD_YANGSHIPIN_COVER = ["[class*='cover' i]", "[class*='poster' i]"];

/** 测试用规则：在内置规则上改几个站点。版本号足够大：内置规则和远程规则都不会把它替换掉 */
function rulesWith(patch: (sites: SiteRulesDoc['sites']) => void): SiteRulesDoc {
  const doc = structuredClone(DEFAULT_SITE_RULES_JSON) as SiteRulesDoc;
  doc.version = '9999-12-31';
  patch(doc.sites);
  return doc;
}
const site = (sites: SiteRulesDoc['sites'], id: string) => sites.find((s) => s.id === id)!;

/**
 * 咪咕的弹幕选择器换回修正前的写法，证明不让主播放器黑屏的是代码里的保护，而不是规则修正
 */
export const rulesWithOldMiguDanmaku = () =>
  rulesWith((sites) => {
    const migu = site(sites, 'miguvideo');
    migu.hide = { ...migu.hide, danmaku: [...OLD_MIGU_DANMAKU] };
  });

/**
 * 爱奇艺、央视频的封面选择器换回修正前的写法（会命中盖在视频上的透明层），
 * 证明画面不被刷成中性封面靠的是代码里的透明层保护
 */
export const rulesWithOldCovers = () =>
  rulesWith((sites) => {
    site(sites, 'iqiyi').coverSelectors = [...OLD_IQIYI_COVER];
    site(sites, 'yangshipin').coverSelectors = [...OLD_YANGSHIPIN_COVER];
  });

const visible = async (loc: Locator) => {
  await expect(loc).toBeVisible();
  await expect(loc).toHaveCSS('visibility', 'visible');
  await expect(loc).toHaveCSS('opacity', '1');
  expect(
    await loc.evaluate((el) =>
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    ),
  ).toBe(true);
};

/** 主播放器外层和视频本身看得见；里面的弹幕层、比分照样藏；足球卡片里的小预览视频照样透明 */
export async function expectMiguPlayerGuarded(page: Page) {
  await expect(page.locator('html')).toHaveClass(/\bsff-fb\b/);
  // 页面上生效的确实是修正前的弹幕选择器（不带 :not([class*='is-barrage' i])）
  const css = () => page.locator('#sff-shield-style').evaluate((el) => el.textContent ?? '');
  expect(await css()).toContain("[class*='barrage' i],");
  expect(await css()).not.toContain('is-barrage');

  const wrapper = page.getByTestId('wrapper');
  const video = page.locator('#m-player');
  await visible(wrapper);
  await visible(video);
  expect(await video.evaluate((v) => Math.round(v.getBoundingClientRect().width))).toBe(1032);
  await expect(wrapper).toHaveAttribute('data-sff-player', '');
  await expect(video).toHaveAttribute('data-sff-player', '');

  for (const id of ['barrage', 'score']) {
    const overlay = page.getByTestId(id);
    await expect(overlay).not.toHaveAttribute('data-sff-player', '');
    await expect(overlay).toBeHidden();
    await expect(overlay).toHaveCSS('visibility', 'hidden');
    await expect(overlay).toHaveCSS('opacity', '0');
  }
  await expect(page.getByTestId('score')).toHaveText('■-■');
  // 被弹幕规则命中的外层里、在视频旁边的右侧栏（集锦列表）照样按这条规则藏
  const right = page.getByTestId('right');
  await expect(right).toHaveAttribute('data-sff-beside', '');
  await expect(right).toHaveCSS('visibility', 'hidden');
  await expect(right).toHaveCSS('opacity', '0');

  await expect(page.getByTestId('card')).toHaveAttribute('data-sff-card', '');
  const preview = page.getByTestId('preview');
  await expect(preview).not.toHaveAttribute('data-sff-player', '');
  await expect(preview).toHaveCSS('opacity', '0');
  // 规则在测试期间没有被别的来源换掉
  expect(await css()).toContain("[class*='barrage' i],");
}

/** 解出截图（8 位 RGB/RGBA、不隔行的 PNG）里的像素 */
function decodePng(buf: Buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bpp = 4;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('只支持 8 位、不隔行的 PNG');
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp]! : 0;
      let v = line[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return {
    width,
    rgb: (x: number, y: number): Rgb => {
      const i = y * stride + x * bpp;
      return [out[i]!, out[i + 1]!, out[i + 2]!];
    },
  };
}

/** 截一张图，取页面上这些点（CSS 像素）的颜色 */
async function colorsAt(page: Page, points: Array<[number, number]>): Promise<Rgb[]> {
  const png = decodePng(await page.screenshot());
  const scale = png.width / page.viewportSize()!.width;
  return points.map(([x, y]) => png.rgb(Math.round(x * scale), Math.round(y * scale)));
}

const near = (rgb: Rgb, target: Rgb) => rgb.every((v, i) => Math.abs(v - target[i]!) <= 24);

/** 元素里这几处（相对位置）在屏幕上的颜色都是 color：等图片加载出来 */
async function expectShows(page: Page, loc: Locator, color: Rgb, spots: Array<[number, number]>) {
  await expect
    .poll(async () => {
      const box = (await loc.boundingBox())!;
      const got = await colorsAt(
        page,
        spots.map(([fx, fy]) => [box.x + box.width * fx, box.y + box.height * fy]),
      );
      return got.every((rgb) => near(rgb, color)) ? 'ok' : JSON.stringify(got);
    })
    .toBe('ok');
}
/** 画面中间和四个象限（避开底部的控制栏） */
const PICTURE_SPOTS: Array<[number, number]> = [
  [0.5, 0.5],
  [0.25, 0.3],
  [0.75, 0.3],
  [0.25, 0.7],
  [0.75, 0.7],
];

/**
 * 封面选择器命中盖在视频上的透明层（修正前的爱奇艺、央视频规则）：透明层带 data-sff-overlay、不刷成中性封面，
 * 屏幕上看得见视频画面（poster 的红色），层里的控制图标照常显示；别处的缩略图照样换成中性封面
 */
export async function expectPictureThroughOverlays(page: Page, cover: string[]) {
  await expect(page.locator('html')).toHaveClass(/\bsff-fb\b/);
  const css = () => page.locator('#sff-shield-style').evaluate((el) => el.textContent ?? '');
  // 页面上生效的确实是修正前的封面选择器
  expect(await css()).toContain(`:is(${cover.join(',')})`);

  const video = page.locator('video#main');
  await expect(video).toHaveAttribute('data-sff-player', '');
  await expect(video).toHaveCSS('opacity', '1');
  const layers = page.getByTestId('layer');
  expect(await layers.count()).toBeGreaterThan(0);
  for (const layer of await layers.all()) {
    await expect(layer).toHaveAttribute('data-sff-overlay', '');
    await expect(layer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(layer).toHaveCSS('background-image', 'none');
  }
  await expectShows(page, video, PICTURE, PICTURE_SPOTS);
  // 层里的控制图标照常显示
  await expectShows(page, page.getByTestId('icon'), WHITE, [[0.5, 0.5]]);
  // 层里后来才显示出来的、海报大小的推荐缩略图照样换掉：那里看到的是下面的视频画面
  const endThumb = page.getByTestId('end-thumb');
  await expect(endThumb).toHaveAttribute('data-sff-poster', '');
  await expect(endThumb).toHaveCSS('opacity', '0');
  await expectShows(page, endThumb, PICTURE, [
    [0.5, 0.5],
    [0.1, 0.1],
    [0.9, 0.9],
  ]);
  // 别处的缩略图照样换掉：图片看不见，露出中性封面的底色
  const thumb = page.getByTestId('thumb');
  await expect(thumb).not.toHaveAttribute('data-sff-overlay', '');
  await expectShows(page, thumb, NEUTRAL, [
    [0.04, 0.06],
    [0.96, 0.06],
  ]);
  // 规则在测试期间没有被别的来源换掉
  expect(await css()).toContain(`:is(${cover.join(',')})`);
}

/** 手机宽度：主视频看得见；评论区、猜你喜欢里同样整宽的视频不会让它们露出来 */
export async function expectPhoneCommentsHidden(page: Page) {
  await expect(page.locator('html')).toHaveClass(/\bsff-fb\b/);
  const video = page.locator('#m-player');
  await visible(video);
  await expect(video).toHaveAttribute('data-sff-player', '');
  expect(await video.evaluate((v) => Math.round(v.getBoundingClientRect().width))).toBe(390);
  for (const id of ['comments', 'guess']) {
    const box = page.getByTestId(id);
    await expect(box).not.toHaveAttribute('data-sff-player', '');
    await expect(box).toHaveCSS('display', 'none');
  }
}
