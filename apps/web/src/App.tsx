import { useEffect } from 'react';
import { useNow } from './lib/clock.ts';
import { initBridge } from './lib/bridge.ts';
import { useAppData } from './lib/data.ts';
import { href, useRoute, type Route } from './lib/router.ts';
import { useUserState } from './lib/store.ts';
import { AboutView, ImportView } from './views/AboutView.tsx';
import { MatchDetailView, TonightView, UnwatchedView, UpcomingView } from './views/MatchViews.tsx';
import { ProgramsView } from './views/ProgramsView.tsx';
import { SettingsView } from './views/SettingsView.tsx';

const NAV: Array<{ route: Route; label: string; icon: string; match: Route['name'][] }> = [
  { route: { name: 'today', offset: 0 }, label: '昨夜今晨', icon: '🌙', match: ['today', 'match'] },
  { route: { name: 'unwatched' }, label: '没看完', icon: '⏳', match: ['unwatched'] },
  { route: { name: 'upcoming' }, label: '即将开始', icon: '📅', match: ['upcoming'] },
  { route: { name: 'programs' }, label: '节目', icon: '📺', match: ['programs'] },
  {
    route: { name: 'settings' },
    label: '设置',
    icon: '⚙️',
    match: ['settings', 'import', 'about'],
  },
];

/** 数据超过这么久没更新就提醒 */
const STALE_MS = 48 * 60 * 60 * 1000;

const TITLES: Record<Route['name'], string> = {
  today: '昨夜今晨',
  unwatched: '没看完',
  upcoming: '即将开始',
  programs: '足球节目',
  settings: '设置',
  about: '去哪看',
  match: '比赛',
  import: '导入同步码',
};

export function App() {
  const route = useRoute();
  const state = useUserState();
  const data = useAppData();
  const now = useNow();

  useEffect(() => initBridge(), []);
  useEffect(() => {
    // 标签页标题也保持中性：只有页面名
    document.title = `${TITLES[route.name]} · 防剧透看球`;
  }, [route.name]);

  let body: React.ReactNode;
  // 数据管线停了（例如仓库 60 天没有活动，GitHub 会自动停用定时任务）时提醒一下，提醒本身不带任何赛果
  const generatedAt = data.status === 'ready' ? Date.parse(data.data.meta?.generatedAt ?? '') : NaN;
  const stale = Number.isFinite(generatedAt) && now.getTime() - generatedAt > STALE_MS;
  if (route.name === 'import') {
    body = <ImportView code={route.code} state={state} />;
  } else if (route.name === 'settings') {
    body = <SettingsView state={state} />;
  } else if (data.status === 'loading') {
    body = <p className="empty">加载中…</p>;
  } else if (data.status === 'error') {
    body = (
      <div className="empty">
        <p>数据加载失败：{data.error}</p>
        <p className="muted">如果是刚部署，请确认数据管线已经跑过一次。</p>
      </div>
    );
  } else {
    const d = data.data;
    switch (route.name) {
      case 'today':
        // 换一晚就重新挂载，"刚看完先留在列表里"只在同一晚的页面里生效
        body = (
          <TonightView key={route.offset} data={d} state={state} now={now} offset={route.offset} />
        );
        break;
      case 'unwatched':
        body = <UnwatchedView data={d} state={state} now={now} />;
        break;
      case 'upcoming':
        body = <UpcomingView data={d} state={state} now={now} />;
        break;
      case 'programs':
        body = <ProgramsView data={d} state={state} now={now} />;
        break;
      case 'about':
        body = <AboutView data={d} />;
        break;
      case 'match':
        body = <MatchDetailView data={d} state={state} now={now} id={route.id} />;
        break;
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={href({ name: 'today', offset: 0 })}>
          <img src="./icons/icon.svg" alt="" width="28" height="28" />
          <span>防剧透看球</span>
        </a>
        <nav className="topnav" aria-label="主导航">
          {NAV.map((n) => (
            <a
              key={n.label}
              href={href(n.route)}
              className={n.match.includes(route.name) ? 'active' : ''}
              aria-current={n.match.includes(route.name) ? 'page' : undefined}
            >
              {n.label}
            </a>
          ))}
          <a href={href({ name: 'about' })} className={route.name === 'about' ? 'active' : ''}>
            去哪看
          </a>
        </nav>
      </header>
      <main className="main">
        {stale && route.name !== 'settings' && route.name !== 'import' ? (
          <p className="stale-banner" role="status" data-testid="stale-banner">
            数据已经超过两天没有更新，请检查 GitHub Actions 里的「数据更新与部署」是否被停用。
          </p>
        ) : null}
        {body}
      </main>
      <nav className="tabbar" aria-label="底部导航">
        {NAV.map((n) => (
          <a
            key={n.label}
            href={href(n.route)}
            className={n.match.includes(route.name) ? 'active' : ''}
          >
            <span aria-hidden="true">{n.icon}</span>
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      <footer className="footer">
        只链接正版平台，不托管、不转播任何视频 · <a href={href({ name: 'about' })}>去哪看</a>
      </footer>
    </div>
  );
}
