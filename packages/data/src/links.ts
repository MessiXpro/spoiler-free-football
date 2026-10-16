import type { LinkKind, MatchLink, PublicMatch } from '@sff/core';

export type Confidence = 'high' | 'medium' | 'low' | 'unverified';

export interface PlatformInfo {
  name: string;
  url: string;
  note?: string;
}

export interface RightInfo {
  platform: string;
  kinds: LinkKind[];
  vip?: boolean;
  confidence: Confidence;
  url?: string;
  note?: string;
}

export interface BroadcastConfig {
  checkedAt: string;
  platforms: Record<string, PlatformInfo>;
  competitions: Record<string, { rights: RightInfo[] }>;
  teamChannels: Record<
    string,
    { platform: string; url: string; name: string; confidence: Confidence } | string
  >;
}

export interface ManualLink {
  kind: LinkKind;
  platform: string;
  url?: string;
  label?: string;
  bvid?: string;
  page?: number;
  vip?: boolean;
}

export interface LinksConfig {
  links: Record<string, ManualLink[]>;
}

/** 只允许跳转到这些正版/官方平台的域名 */
export const OFFICIAL_HOSTS = [
  'miguvideo.com',
  'migu.cn',
  'iqiyi.com',
  'cctv.com',
  'cctv.cn',
  'cntv.cn',
  'yangshipin.cn',
  'bilibili.com',
  'b23.tv',
  'douyin.com',
  'apps.apple.com',
  'v.qq.com',
  'sports.qq.com',
];

export function isOfficialUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return OFFICIAL_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const BVID_RE = /^BV[0-9A-Za-z]{10}$/;

const KIND_LABEL: Record<LinkKind, string> = {
  replay: '全场回放',
  highlights: '集锦',
  live: '直播',
  hub: '入口',
};

/** 给比赛加上观看入口：手工深链 > 赛事版权方入口 > 球队官方号 */
export function buildLinks(
  match: Omit<PublicMatch, 'links'>,
  broadcast: BroadcastConfig,
  manual: LinksConfig,
  warn: (msg: string) => void,
): MatchLink[] {
  const links: MatchLink[] = [];
  for (const m of manual.links[match.id] ?? []) {
    const platform = broadcast.platforms[m.platform];
    if (m.bvid && !BVID_RE.test(m.bvid)) {
      warn(`links.json ${match.id}：bvid 格式不对（${m.bvid}）`);
      continue;
    }
    const url =
      m.url ??
      (m.bvid ? `https://www.bilibili.com/video/${m.bvid}${m.page ? `?p=${m.page}` : ''}` : '');
    if (!isOfficialUrl(url)) {
      warn(`links.json ${match.id}：不是正版/官方平台链接，已忽略（${url}）`);
      continue;
    }
    links.push({
      kind: m.kind,
      platform: m.platform,
      url,
      label: m.label ?? `${platform?.name ?? m.platform} · ${KIND_LABEL[m.kind]}`,
      ...(m.bvid
        ? {
            embed: {
              provider: 'bilibili' as const,
              bvid: m.bvid,
              ...(m.page ? { page: m.page } : {}),
            },
          }
        : {}),
      ...(m.vip ? { vip: true } : {}),
      deep: true,
      confidence: 'high',
    });
  }

  for (const right of broadcast.competitions[match.competition]?.rights ?? []) {
    const platform = broadcast.platforms[right.platform];
    if (!platform) continue;
    const kind: LinkKind = right.kinds.includes('replay')
      ? 'replay'
      : right.kinds.includes('highlights')
        ? 'highlights'
        : 'hub';
    const what = right.kinds
      .filter((k) => k === 'replay' || k === 'highlights')
      .map((k) => KIND_LABEL[k])
      .join(' / ');
    const url = right.url ?? platform.url;
    if (!isOfficialUrl(url)) continue;
    links.push({
      kind,
      platform: right.platform,
      url,
      label: `${platform.name} · ${what || '观看'}（入口页）`,
      ...(right.vip ? { vip: true } : {}),
      deep: false,
      confidence: right.confidence,
    });
  }

  for (const teamId of [match.home.id, match.away.id]) {
    const ch = broadcast.teamChannels[teamId];
    if (!ch || typeof ch === 'string' || !isOfficialUrl(ch.url)) continue;
    links.push({
      kind: 'highlights',
      platform: ch.platform,
      url: ch.url,
      label: `${ch.name} · 集锦`,
      deep: false,
      confidence: ch.confidence,
    });
  }
  return links;
}
