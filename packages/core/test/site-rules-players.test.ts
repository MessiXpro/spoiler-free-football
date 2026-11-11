// @vitest-environment jsdom
/**
 * 真实播放页的结构（类名、层级照抄线上页面）对内置站点规则的回归测试：
 * 规则不能盖住播放器本身，也不能把盖在视频上面的透明层刷成不透明的中性封面。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildShieldCss } from '../src/dom/index.ts';
import { CLASS_FOOTBALL, CLASS_ON } from '../src/dom/css.ts';
import { DEFAULT_SITE_RULES_JSON, matchSite, validateSiteRules } from '../src/index.ts';

const rules = validateSiteRules(DEFAULT_SITE_RULES_JSON)!;
const cssFor = (host: string) => buildShieldCss(matchSite(rules, host)!);

function page(body: string) {
  document.documentElement.className = `${CLASS_ON} ${CLASS_FOOTBALL}`;
  document.body.innerHTML = body;
}
afterEach(() => {
  document.documentElement.className = '';
  document.body.innerHTML = '';
});

const $ = (sel: string) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`fixture 里没有 ${sel}`);
  return el;
};

/** 生成的样式里，选择器能匹配 el 的那些规则 */
function rulesOn(css: string, el: Element): string[] {
  return css.split('\n').filter((line) => {
    try {
      return el.matches(line.slice(0, line.indexOf('{')));
    } catch {
      return false;
    }
  });
}
const decl = (rule: string) => rule.slice(rule.indexOf('{'));
/** 会让元素自己（或它显示的图像）看不见的规则 */
const hidingRules = (css: string, el: Element) =>
  rulesOn(css, el).filter((r) =>
    /display:none|visibility:hidden|opacity:0|background:#1f3d2b|object-position/.test(decl(r)),
  );
const has = (css: string, el: Element, what: string) =>
  rulesOn(css, el).some((r) => decl(r).includes(what));

describe('咪咕 /p/live/ 回放页', () => {
  const MIGU = `
<div id="app"><div class="sport-live-page"><main class="sport-live-main"><section class="sport-live-layout">
  <section class="live-player-cont is-normal is-barrage-hidden">
    <div class="live-player-area"><div id="sport-live" class="live-player-mount">
      <section id="mod-player" class="mod-player">
        <div class="video-wrapper"><div class="mg_player_wrapper"><video id="m-player" class="m-player"></video></div></div>
        <div class="control-btn time-txt"><span class="txt start-time">00:12</span><span class="txt end-time">01:45:33</span></div>
        <div class="mg-cover mg-cover-shadow">
          <p class="mg-end-main-title">很抱歉，因版权限制，请前往咪咕视频APP继续观看</p>
          <div class="mg-end-app-qrcode-container"><img class="mg-end-app-qrcode" src="qr.png"></div>
        </div>
      </section>
    </div></div>
    <aside class="live-player-right"><div class="right-tab">
      <div class="right-title-pk"><div class="title-pk-scores"><div class="pk-center-score"></div></div></div>
      <div class="right-tab-body">
        <div class="tabColumn"><li class="newColor">精彩集锦</li><li>数据</li><li>事件</li><li>评论</li></div>
        <div class="tab-content">
          <div class="tab-pane"><div class="live-review"><div class="review review-room"><div class="review-content">
            <div class="review-list-wrapper"><div class="review-list">
              <div class="review-list-item"><div class="img"><img src="t.jpg"><div class="timer">01:16</div></div>
                <div class="introduce">【进球】天王盖地虎</div></div>
            </div></div>
          </div></div></div></div>
          <div class="federation-tab"><div class="match-event-container"><div class="event-row">进球</div></div></div>
        </div>
      </div>
    </div></aside>
  </section>
  <div class="tapIfame has-content"><section class="match-review"><div class="match-review__list">
    <button type="button" class="match-review__slide is-active"><img alt="全场集锦" src="h.webp">
      <span class="match-review__mask"></span>
      <span class="match-review__title"><span class="match-review__title-text">全场集锦</span></span></button>
    <button type="button" class="match-review__slide"><img alt="全场回放" src="r.webp">
      <span class="match-review__title"><span class="match-review__title-text">全场回放（解说甲）</span></span></button>
  </div></section></div>
</section></main></div></div>`;

  it('播放器和它的每一层外框都不被藏、不被刷成封面', () => {
    page(MIGU);
    const css = cssFor('www.miguvideo.com');
    for (
      let el: Element | null = $('#m-player');
      el && el !== document.body;
      el = el.parentElement
    ) {
      expect(hidingRules(css, el), el.className || el.id).toEqual([]);
    }
  });

  it('版权/出错提示层不刷成中性封面，二维码照常显示', () => {
    page(MIGU);
    const css = cssFor('www.miguvideo.com');
    expect(hidingRules(css, $('.mg-cover'))).toEqual([]);
    expect(hidingRules(css, $('.mg-end-app-qrcode'))).toEqual([]);
  });

  it('右侧「精彩集锦」「事件」整块藏起，播放器总时长藏起，当前时间不藏', () => {
    page(MIGU);
    const css = cssFor('www.miguvideo.com');
    expect(has(css, $('.live-review'), 'display:none')).toBe(true);
    expect(has(css, $('.match-event-container'), 'display:none')).toBe(true);
    expect(has(css, $('.review-list .timer'), 'visibility:hidden')).toBe(true);
    expect(has(css, $('.time-txt .end-time'), 'visibility:hidden')).toBe(true);
    expect(hidingRules(css, $('.time-txt .start-time'))).toEqual([]);
    // 顶部比分照旧藏
    expect(has(css, $('.title-pk-scores'), 'visibility:hidden')).toBe(true);
  });

  it('下方「本场」条：集锦/回放的海报图换成中性封面，按钮和标题照常可点可读', () => {
    page(MIGU);
    const css = cssFor('www.miguvideo.com');
    for (const img of document.querySelectorAll('.match-review__slide img')) {
      expect(has(css, img, 'object-position')).toBe(true);
    }
    for (const sel of ['.match-review', '.match-review__slide', '.match-review__title-text']) {
      expect(hidingRules(css, $(sel)), sel).toEqual([]);
    }
  });
});

describe('爱奇艺 XPlayer 播放页', () => {
  const IQIYI = `
<div id="areaLeftContainer">
  <div class="player-slot"><video class="fast-play"></video></div>
  <div class="XPlayer_root__eWzab"><div id="content" class="XPlayer_content__1"><div id="video" class="XPlayer_ivgH5Cover__4uAE-">
    <div id="videoContent"><div class="Video_container__jfBSy"></div>
      <div id="videoCoverComp" class="XPlayer_defaultCover__JY37H"></div></div>
    <div class="XPlayer_defaultCover__JY37H"><div id="xplayerCover" class="XPlayer_cover__nATh2">
      <img class="ctrl-icon" src="play.png"><span class="ctrl-bg"></span></div></div>
    <div id="videoCover" class="XPlayer_staticCoverLayer__dIxPM"></div>
  </div></div></div>
</div>
<div id="tvg"><div class="videoListItem_coverContainer__8ZmbJ"><img class="ep" src="ep.jpg"></div></div>
<div class="popwin_fullCover__M7yY6"></div>`;

  it('盖在视频上的透明层（控制层、默认封面层）不刷成中性封面，里面的图标照常显示', () => {
    page(IQIYI);
    const css = cssFor('www.iqiyi.com');
    for (const sel of [
      '#video',
      '#videoCoverComp',
      '.XPlayer_defaultCover__JY37H',
      '#xplayerCover',
      '#videoCover',
      '.ctrl-icon',
      '.ctrl-bg',
      '.fast-play',
    ]) {
      expect(hidingRules(css, $(sel)), sel).toEqual([]);
    }
  });

  it('选集列表的缩略图照旧换成中性封面；全屏弹窗层不刷', () => {
    page(IQIYI);
    const css = cssFor('www.iqiyi.com');
    expect(has(css, $('.videoListItem_coverContainer__8ZmbJ'), 'background:#1f3d2b')).toBe(true);
    expect(has(css, $('#tvg img.ep'), 'opacity:0')).toBe(true);
    expect(hidingRules(css, $('.popwin_fullCover__M7yY6'))).toEqual([]);
  });
});

describe('央视频直播播放器（live-player）', () => {
  const YSP = `
<div class="live-main-l-player play-div-div"><div class="play-div-div-content">
  <div id="vodbox1" class="c-container img">
    <div class="video-con"><video id="myvideo1" class="video-js vjs-default-skin"></video></div>
    <div class="con poster"><div class="container"><span class="play play2"></span></div>
      <div class="poster-con"><img class="poster-con-cover" src="p.jpg"><img class="playBtn" src="b.png"></div>
    </div>
  </div>
</div></div>`;

  it('盖在视频上的 div.con.poster 不刷成中性封面，控制按钮照常显示', () => {
    page(YSP);
    const css = cssFor('www.yangshipin.cn');
    for (const sel of [
      '.con.poster',
      '.poster-con',
      '.play2',
      '.playBtn',
      '#myvideo1',
      '.c-container',
    ]) {
      expect(hidingRules(css, $(sel)), sel).toEqual([]);
      expect(has(css, $(sel), 'background-image:none'), sel).toBe(false);
    }
  });

  it('播放前的海报图本身照旧被替换', () => {
    page(YSP);
    const css = cssFor('www.yangshipin.cn');
    expect(has(css, $('img.poster-con-cover'), 'object-position')).toBe(true);
  });
});

describe('懂球帝文章页', () => {
  it('「本文话题」(topic) 不因含 pic 被当成封面；真正的图片框照旧', () => {
    page(`<div class="topic-chips"><a class="topic-chip"><span class="topic-chip__name">曼联</span></a></div>
      <div class="match-pic"><img src="m.jpg"></div>`);
    const css = cssFor('www.dongqiudi.com');
    for (const sel of ['.topic-chips', '.topic-chip', '.topic-chip__name']) {
      expect(hidingRules(css, $(sel)), sel).toEqual([]);
    }
    expect(has(css, $('.match-pic'), 'background:#1f3d2b')).toBe(true);
  });
});
