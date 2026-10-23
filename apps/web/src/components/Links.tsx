import { useState } from 'react';
import type { MatchLink, PublicMatch } from '@sff/core';
import { detectShield, notifyOpenMatch } from '../lib/bridge.ts';
import { ConfirmDialog } from './Dialog.tsx';

const KIND_TEXT: Record<MatchLink['kind'], string> = {
  replay: '全场录像',
  highlights: '集锦',
  live: '直播',
  hub: '入口',
};

/** 跳转正版平台的按钮。没装插件/脚本时先提醒一句，因为平台页面上到处是比分 */
export function ExternalLink({
  match,
  link,
  liveMode = false,
  hideExtras = false,
}: {
  match: PublicMatch;
  link: MatchLink;
  liveMode?: boolean;
  /** 插件/脚本显示比分时不带加时/点球/总比分（次回合、首回合没看） */
  hideExtras?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const go = () => {
    notifyOpenMatch(match, link.url, liveMode, hideExtras);
    window.open(link.url, '_blank', 'noopener');
  };
  return (
    <>
      <a
        className={`link-chip link-${link.kind}`}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="external-link"
        onClick={(e) => {
          e.preventDefault();
          if (detectShield()) go();
          else setAsking(true);
        }}
      >
        <span className="link-kind">{KIND_TEXT[link.kind]}</span>
        <span className="link-label">{link.label}</span>
        {link.vip && <span className="tag tag-vip">会员</span>}
        {link.deep === false && <span className="tag">入口页</span>}
        {(link.confidence === 'unverified' || link.confidence === 'low') && (
          <span className="tag tag-warn">待核实</span>
        )}
      </a>
      {asking && (
        <ConfirmDialog
          title="还没有开启防剧透插件或脚本"
          confirmText="仍然打开"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            go();
          }}
        >
          <p>
            视频平台的标题、封面、进度条和评论里常常带比分。建议先安装浏览器插件或用户脚本（见「设置
            → 安装插件/脚本」）。
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

export function LinkList({
  match,
  links,
  hideExtras = false,
}: {
  match: PublicMatch;
  links: MatchLink[];
  hideExtras?: boolean;
}) {
  if (!links.length) return <p className="muted">暂无观看入口</p>;
  return (
    <div className="link-list">
      {links.map((l, i) => (
        <ExternalLink key={`${l.url}-${i}`} match={match} link={l} hideExtras={hideExtras} />
      ))}
    </div>
  );
}
