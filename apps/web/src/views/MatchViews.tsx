import { useState } from 'react';
import {
  beijingDate,
  isFixtureLocked,
  isSubscribed,
  isWatched,
  liveStatus,
  matchesInWindow,
  nightWindow,
  unwatchedRecent,
  upcomingMatches,
  type PublicMatch,
  type UserState,
} from '@sff/core';
import { MatchCard } from '../components/MatchCard.tsx';
import type { AppData } from '../lib/data.ts';
import { href } from '../lib/router.ts';

interface ViewProps {
  data: AppData;
  state: UserState;
  now: Date;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dayLabel(ms: number): string {
  const d = new Date(ms + 8 * 3600 * 1000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`;
}

/**
 * "没看完"类列表：这次打开页面后在列表里出现过、之后被记为已看的比赛，先留在列表里（显示为已看）。
 * 否则点了"看完了，显示比分"后卡片立刻消失，比分也就看不到了。离开页面再回来时才移出列表。
 */
function useKeepRevealed(list: PublicMatch[], all: PublicMatch[], state: UserState): PublicMatch[] {
  const [seen] = useState(() => new Set<string>());
  for (const m of list) seen.add(m.id);
  const ids = new Set(list.map((m) => m.id));
  return all
    .filter((m) => ids.has(m.id) || (seen.has(m.id) && isWatched(state, m.id)))
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.id.localeCompare(b.id));
}

function MatchGrid({
  matches,
  all,
  state,
  now,
}: {
  matches: PublicMatch[];
  all: PublicMatch[];
  state: UserState;
  now: Date;
}) {
  return (
    <div className="match-grid">
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} all={all} state={state} now={now} />
      ))}
    </div>
  );
}

export function TonightView({ data, state, now, offset }: ViewProps & { offset: number }) {
  const w = nightWindow(now, offset);
  const list = matchesInWindow(data.matches, state, w);
  const inWindow = new Set(list.map((m) => m.id));
  // 北京时间中午到午夜开球的比赛要到午夜才进"昨夜今晨"的时间窗，进行中时单独列出来
  const live =
    offset === 0
      ? data.matches
          .filter(
            (m) => !inWindow.has(m.id) && liveStatus(m, now) === 'live' && isSubscribed(m, state),
          )
          .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))
      : [];
  const older = useKeepRevealed(
    offset === 0
      ? unwatchedRecent(data.matches, state, now, 7).filter((m) => !inWindow.has(m.id))
      : [],
    data.matches,
    state,
  ).filter((m) => !inWindow.has(m.id));
  const title = offset === 0 ? '昨夜今晨' : `往前第 ${-offset} 晚`;
  return (
    <section className="view" data-testid="view-today">
      <div className="view-head">
        <div>
          <h2>{title}</h2>
          <p className="muted" data-testid="night-range">
            {dayLabel(w.start)} 中午 至 {dayLabel(w.end - 1)} 中午 · 北京时间
          </p>
        </div>
        <nav className="day-nav" aria-label="切换日期">
          <a
            className="btn btn-small"
            href={href({ name: 'today', offset: offset - 1 })}
            data-testid="prev-night"
          >
            ← 前一晚
          </a>
          {offset < 0 && (
            <a
              className="btn btn-small"
              href={href({ name: 'today', offset: offset + 1 })}
              data-testid="next-night"
            >
              后一晚 →
            </a>
          )}
        </nav>
      </div>
      {live.length > 0 && (
        <div data-testid="live-now">
          <h2 className="section-title">进行中</h2>
          <MatchGrid matches={live} all={data.matches} state={state} now={now} />
        </div>
      )}
      {list.length ? (
        <MatchGrid matches={list} all={data.matches} state={state} now={now} />
      ) : (
        <p className="empty" data-testid="empty-night">
          这一晚没有你订阅的比赛。可以在
          <a href={href({ name: 'settings' })}>设置</a>里增减订阅的球队和赛事。
        </p>
      )}
      {older.length > 0 && (
        <>
          <h2 className="section-title">更早还没看完的</h2>
          <MatchGrid matches={older} all={data.matches} state={state} now={now} />
        </>
      )}
    </section>
  );
}

export function UnwatchedView({ data, state, now }: ViewProps) {
  const list = useKeepRevealed(unwatchedRecent(data.matches, state, now, 21), data.matches, state);
  return (
    <section className="view" data-testid="view-unwatched">
      <div className="view-head">
        <h2>还没看完</h2>
        <p className="muted">最近三周已结束、还没点「显示比分」的订阅比赛</p>
      </div>
      {list.length ? (
        <MatchGrid matches={list} all={data.matches} state={state} now={now} />
      ) : (
        <p className="empty">都看完了。</p>
      )}
    </section>
  );
}

export function UpcomingView({ data, state, now }: ViewProps) {
  const list = upcomingMatches(data.matches, state, now);
  const byDay = new Map<string, PublicMatch[]>();
  for (const m of list) {
    const d = beijingDate(m.kickoff);
    byDay.set(d, [...(byDay.get(d) ?? []), m]);
  }
  return (
    <section className="view" data-testid="view-upcoming">
      <div className="view-head">
        <h2>即将开始</h2>
        <p className="muted">
          未来 {state.settings.upcomingDays} 天 ·
          不显示积分榜；淘汰赛对阵在你看完上一轮之前会先藏起来
        </p>
      </div>
      {list.length === 0 && (
        <p className="empty">
          近期没有订阅的比赛。可以在<a href={href({ name: 'settings' })}>设置</a>
          里增减订阅的球队和赛事，或者调整「即将开始」显示的天数。
        </p>
      )}
      {[...byDay.entries()].map(([day, matches]) => (
        <div key={day}>
          <h3 className="day-title">{dayLabel(Date.parse(`${day}T12:00:00+08:00`))}</h3>
          <MatchGrid matches={matches} all={data.matches} state={state} now={now} />
        </div>
      ))}
    </section>
  );
}

export function MatchDetailView({ data, state, now, id }: ViewProps & { id: string }) {
  const match = data.matches.find((m) => m.id === id);
  if (!match) {
    return (
      <section className="view">
        <h2>找不到这场比赛</h2>
        <p className="muted">数据只保留最近三周和未来一个月的比赛。</p>
        <a className="btn" href={href({ name: 'today', offset: 0 })}>
          回到昨夜今晨
        </a>
      </section>
    );
  }
  // 比赛编号由两队名字拼成，对阵被锁定时不能显示
  const locked = isFixtureLocked(match, data.matches, state, now);
  return (
    <section className="view" data-testid="view-match">
      <MatchCard match={match} all={data.matches} state={state} now={now} expanded />
      {!locked && (
        <p className="muted small" data-testid="match-id">
          比赛编号：{match.id}（手工补充链接时用）
        </p>
      )}
    </section>
  );
}
