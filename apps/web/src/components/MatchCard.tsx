import { useState } from 'react';
import {
  competitionName,
  formatKickoff,
  isFixtureLocked,
  isPostponedCleared,
  isWatched,
  LIVE_STATUS_LABELS,
  liveStatus,
  neutralTitle,
  postponedClearKey,
  stageLabel,
  teamName,
  type PublicMatch,
  type UserState,
} from '@sff/core';
import { href } from '../lib/router.ts';
import { actions } from '../lib/store.ts';
import { ConfirmDialog } from './Dialog.tsx';
import { Embed } from './Embed.tsx';
import { ExternalLink, LinkList } from './Links.tsx';
import { RevealScore } from './RevealScore.tsx';

interface Props {
  match: PublicMatch;
  all: PublicMatch[];
  state: UserState;
  now: Date;
  /** 在详情页里默认展开 */
  expanded?: boolean;
}

export function MatchCard({ match, all, state, now, expanded = false }: Props) {
  const status = liveStatus(match, now);
  const watched = isWatched(state, match.id);
  // 延期/取消的比赛手动标记过（按原定开球时间记，改期后的那场不算）
  const cleared = isPostponedCleared(state, match);
  const locked = isFixtureLocked(match, all, state, now);
  const [open, setOpen] = useState(expanded);
  const [askUnlock, setAskUnlock] = useState(false);
  const [askMark, setAskMark] = useState(false);
  const [player, setPlayer] = useState<'none' | 'highlights' | 'live'>('none');
  const [liveOpen, setLiveOpen] = useState(false);

  const replays = match.links.filter((l) => l.kind === 'replay' || l.kind === 'live');
  const highlights = match.links.filter((l) => l.kind === 'highlights');
  const embeddable = highlights.find((l) => l.embed);
  const embeddableReplay = replays.find((l) => l.embed);
  const stage = stageLabel(match);

  return (
    <article
      className={`match-card status-${status}${watched || cleared ? ' is-watched' : ''}`}
      data-testid="match-card"
      data-match-id={match.id}
      aria-label={neutralTitle(match, { lockedTeams: locked })}
    >
      <header className="match-head">
        <span className="comp">{competitionName(match.competition)}</span>
        {stage && <span className="stage">{stage}</span>}
        <span className={`status status-${status}`} data-testid="match-status">
          {LIVE_STATUS_LABELS[status]}
        </span>
        {(watched || cleared) && (
          <span className="tag tag-watched" data-testid="watched-badge">
            已看
          </span>
        )}
      </header>

      <h3 className="teams">
        {locked ? (
          <span className="locked-teams" data-testid="locked-teams">
            对阵待揭晓
          </span>
        ) : (
          <a href={href({ name: 'match', id: match.id })}>
            <span className="team home">{teamName(match.home)}</span>
            <span className="vs">vs</span>
            <span className="team away">{teamName(match.away)}</span>
          </a>
        )}
      </h3>
      <p className="kickoff">北京时间 {formatKickoff(match.kickoff, match.timeTbd)}</p>

      {locked ? (
        <div className="locked-note">
          <p>这是淘汰赛，对阵会透露上一轮的结果。你还有上一轮的订阅比赛没看完。</p>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setAskUnlock(true)}
            data-testid="unlock-fixture"
          >
            显示对阵
          </button>
        </div>
      ) : (
        <>
          <div className="actions">
            {status !== 'upcoming' && embeddable && (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="play-highlights"
                onClick={() => setPlayer(player === 'highlights' ? 'none' : 'highlights')}
              >
                ▶ 页内播放集锦
              </button>
            )}
            {status !== 'upcoming' && (
              <button
                type="button"
                className="btn"
                data-testid="live-mode"
                onClick={() => setLiveOpen(true)}
              >
                直播模式
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open ? '收起入口' : '录像 / 集锦入口'}
            </button>
          </div>

          {player === 'highlights' && embeddable && (
            <Embed
              match={match}
              link={embeddable}
              mask={state.settings.embedMask}
              onClose={() => setPlayer('none')}
            />
          )}
          {player === 'live' && embeddableReplay && (
            <Embed
              match={match}
              link={embeddableReplay}
              mask
              liveMode
              onClose={() => setPlayer('none')}
            />
          )}

          {open && (
            <div className="links" data-testid="match-links">
              {replays.length > 0 && (
                <section>
                  <h4>全场录像</h4>
                  <LinkList match={match} links={replays} />
                </section>
              )}
              {highlights.length > 0 && (
                <section>
                  <h4>集锦</h4>
                  <LinkList match={match} links={highlights} />
                </section>
              )}
              {!replays.length && !highlights.length && <p className="muted">暂无观看入口</p>}
            </div>
          )}

          {status === 'finished' && <RevealScore match={match} watched={watched} />}
          {status === 'live' && <p className="muted">比赛进行中，结束后可以在这里显示比分。</p>}
          {/*
            延期/取消的比赛没有"显示比分"，开球时间过后让用户手动标记，解除相关节目和下一轮对阵的折叠。
            不记进 watched：id 不含日期，改期后重新安排的那场会被当成已看。
          */}
          {status === 'postponed' && Date.parse(match.kickoff) <= now.getTime() && (
            <div className="reveal">
              {cleared ? (
                <button
                  type="button"
                  className="btn btn-small"
                  data-testid="unmark-watched"
                  onClick={() => actions.relock(postponedClearKey(match))}
                >
                  改回没看
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-small"
                  data-testid="mark-watched"
                  onClick={() => setAskMark(true)}
                >
                  标记为已看
                </button>
              )}
            </div>
          )}
        </>
      )}

      {liveOpen && (
        <div className="dialog-backdrop" onClick={() => setLiveOpen(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            data-testid="live-mode-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>直播模式</h2>
            <p>
              从开球前开始看全场录像，像看直播一样。总时长和进度条会被遮住，看不出这场比赛一共打了多久。
            </p>
            <ul className="tips">
              <li>页内播放：遮挡条盖住播放器底部的时间和进度条，点画面暂停/继续。</li>
              <li>
                跳转到平台播放：需要已安装防剧透插件或脚本，它会隐藏平台播放器的时长、进度条预览、弹幕和评论。
              </li>
              <li>拖进度条前想一想：进度条的位置也会暴露总时长。</li>
            </ul>
            <div className="link-list">
              {embeddableReplay && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setPlayer('live');
                    setLiveOpen(false);
                  }}
                >
                  ▶ 页内从头播放
                </button>
              )}
              {replays.map((l, i) => (
                <ExternalLink key={`${l.url}-${i}`} match={match} link={l} liveMode />
              ))}
              {!replays.length && !embeddableReplay && (
                <p className="muted">这场暂无全场录像入口。</p>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setLiveOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {askMark && (
        <ConfirmDialog
          title="把这场标记为已看？"
          confirmText="标记为已看"
          onCancel={() => setAskMark(false)}
          onConfirm={() => {
            actions.unlock(postponedClearKey(match));
            setAskMark(false);
          }}
        >
          <p>相关的节目和下一轮对阵不会再因为这场先折叠起来。改期重赛的那场还是按没看处理。</p>
        </ConfirmDialog>
      )}

      {askUnlock && (
        <ConfirmDialog
          title="显示这场的对阵？"
          confirmText="显示对阵"
          onCancel={() => setAskUnlock(false)}
          onConfirm={() => {
            actions.unlock(`fixture:${match.id}`);
            setAskUnlock(false);
          }}
        >
          <p>看到对阵就会知道上一轮是谁走到了这一轮。</p>
        </ConfirmDialog>
      )}
    </article>
  );
}
