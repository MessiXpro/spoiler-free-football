import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'today'; offset: number }
  | { name: 'unwatched' }
  | { name: 'upcoming' }
  | { name: 'programs' }
  | { name: 'settings' }
  | { name: 'about' }
  | { name: 'match'; id: string }
  | { name: 'import'; code: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const [head = '', arg = ''] = parts;
  switch (head) {
    case 'unwatched':
    case 'upcoming':
    case 'programs':
    case 'settings':
    case 'about':
      return { name: head };
    case 'match': {
      if (!arg) return { name: 'today', offset: 0 };
      // 手改/截断的链接可能带不完整的 %xx，解码失败就按原样当编号（显示"找不到这场比赛"），不能让整页崩掉
      let id = arg;
      try {
        id = decodeURIComponent(arg);
      } catch {
        /* 保留原样 */
      }
      return { name: 'match', id };
    }
    case 'import':
      return { name: 'import', code: parts.slice(1).join('/') };
    case 'today': {
      const offset = Number(arg);
      return {
        name: 'today',
        offset: Number.isFinite(offset) ? Math.max(-30, Math.min(7, Math.round(offset))) : 0,
      };
    }
    default:
      return { name: 'today', offset: 0 };
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}

export function href(route: Route): string {
  switch (route.name) {
    case 'today':
      return route.offset ? `#/today/${route.offset}` : '#/today';
    case 'match':
      return `#/match/${encodeURIComponent(route.id)}`;
    case 'import':
      return `#/import/${route.code}`;
    default:
      return `#/${route.name}`;
  }
}
