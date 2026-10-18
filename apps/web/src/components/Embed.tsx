import { useRef, useState } from 'react';
import type { MatchLink, PublicMatch } from '@sff/core';
import { NeutralCover } from './NeutralCover.tsx';

/**
 * B 站内嵌播放器参数：关闭弹幕（danmaku=0）、从头播放（t=0）。
 * 嵌入版播放器不显示评论区和推荐列表；播放结束后的推荐画面无法关闭，所以加了遮挡条和提醒。
 */
export function bilibiliEmbedUrl(bvid: string, page = 1, autoplay = true): string {
  const u = new URL('https://player.bilibili.com/player.html');
  u.searchParams.set('bvid', bvid);
  u.searchParams.set('page', String(page));
  u.searchParams.set('autoplay', autoplay ? '1' : '0');
  u.searchParams.set('danmaku', '0');
  u.searchParams.set('high_quality', '1');
  u.searchParams.set('as_wide', '1');
  u.searchParams.set('t', '0');
  return u.href;
}

interface Props {
  match: PublicMatch;
  link: MatchLink;
  /** 底部遮挡条：盖住时长和进度条 */
  mask: boolean;
  liveMode?: boolean;
  onClose?: () => void;
}

export function Embed({ match, link, mask, liveMode, onClose }: Props) {
  const [playing, setPlaying] = useState(false);
  const [maskOn, setMaskOn] = useState(mask || Boolean(liveMode));
  const wrapRef = useRef<HTMLDivElement>(null);
  if (!link.embed) return null;
  // iPhone 的 Safari 不支持让普通元素全屏，没有就不显示「全屏」按钮
  const canFullscreen =
    typeof document !== 'undefined' &&
    document.fullscreenEnabled === true &&
    typeof HTMLElement.prototype.requestFullscreen === 'function';

  const fullscreen = () => {
    // 全屏的是外层容器，所以遮挡条在全屏时仍然有效
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div className="embed" ref={wrapRef} data-testid="embed">
      {!playing ? (
        <button
          type="button"
          className="embed-cover"
          onClick={() => setPlaying(true)}
          data-testid="embed-play"
        >
          <NeutralCover match={match} label={liveMode ? '直播模式 · 从头播放' : '点击播放集锦'} />
        </button>
      ) : (
        <div className="embed-frame">
          <iframe
            title={`${match.home.name} vs ${match.away.name}`}
            src={bilibiliEmbedUrl(link.embed.bvid, link.embed.page ?? 1)}
            // 不允许播放器自己全屏（双击画面、快捷键）：那样全屏的只有 iframe，遮挡条盖不住，
            // 时长和进度条会露出来。全屏只走下面的「全屏」按钮（全屏外层容器，遮挡条仍然有效）
            allow="autoplay; encrypted-media; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            referrerPolicy="strict-origin-when-cross-origin"
            data-testid="embed-iframe"
          />
          {maskOn && (
            <div className="embed-mask" data-testid="embed-mask">
              <span>时长与进度条已遮住 · 点画面暂停/播放</span>
            </div>
          )}
        </div>
      )}
      <div className="embed-toolbar">
        {playing && (
          <>
            {canFullscreen && (
              <button
                type="button"
                className="btn btn-small"
                onClick={fullscreen}
                data-testid="embed-fullscreen"
              >
                全屏
              </button>
            )}
            <button type="button" className="btn btn-small" onClick={() => setMaskOn((v) => !v)}>
              {maskOn ? '移开遮挡条' : '加回遮挡条'}
            </button>
          </>
        )}
        {onClose && (
          <button type="button" className="btn btn-small" onClick={onClose}>
            关闭播放器
          </button>
        )}
        <span className="hint">播完后 B 站可能显示推荐视频，请及时关闭</span>
      </div>
    </div>
  );
}
