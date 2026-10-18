/**
 * 对外公开的数据结构。公开数据（matches.json 等）里绝不能出现比分、胜负、
 * 是否加时/点球、录像时长等任何能推断结果的信息；比分只放在 scores/<id>.json。
 */

export type Stage =
  | 'regular'
  | 'league-phase'
  | 'group'
  | 'qualifying'
  | 'playoff'
  | 'round-1'
  | 'round-2'
  | 'round-3'
  | 'round-4'
  | 'round-5'
  | 'round-6'
  | 'round-of-64'
  | 'round-of-32'
  | 'round-of-16'
  | 'quarter-final'
  | 'semi-final'
  | 'third-place'
  | 'final'
  | 'friendly';

export interface TeamRef {
  /** 目录里的球队 id；目录外球队为 "x-<slug>" */
  id: string;
  /** 显示名（中文优先） */
  name: string;
}

/** 只表示"非正常进行"的状态；未开始/进行中/已结束由开球时间推算，避免泄露加时或点球 */
export type ScheduleStatus = 'scheduled' | 'postponed' | 'cancelled';

export type LinkKind = 'replay' | 'highlights' | 'live' | 'hub';

export interface MatchLink {
  kind: LinkKind;
  /** platforms.ts 里的平台 id */
  platform: string;
  /** 跳转地址（正版/官方平台） */
  url: string;
  /** 中性说明，例如"咪咕视频 · 全场回放" */
  label: string;
  /** 可以在页面内嵌播放（目前只有 B 站） */
  embed?: { provider: 'bilibili'; bvid: string; page?: number };
  /** 是否需要会员 */
  vip?: boolean;
  /** 深链（直达本场）还是入口页 */
  deep?: boolean;
  /** 版权信息可信度；unverified 会在页面上标「待核实」 */
  confidence?: 'high' | 'medium' | 'low' | 'unverified';
}

export interface PublicMatch {
  id: string;
  competition: string;
  season: string;
  stage: Stage;
  matchday?: number;
  group?: string;
  leg?: 1 | 2;
  /** 开球时间（UTC ISO） */
  kickoff: string;
  /** 只知道日期、不知道具体时间 */
  timeTbd?: boolean;
  home: TeamRef;
  away: TeamRef;
  status: ScheduleStatus;
  links: MatchLink[];
  /** 数据来源 adapter id */
  sources: string[];
}

export interface ScoreRecord {
  id: string;
  /** 比赛结束时的比分（含加时，不含点球大战） */
  home: number;
  away: number;
  halfTime?: [number, number];
  /** 打了加时：这里是 90 分钟时的比分（数据源提供时） */
  regularTime?: [number, number];
  extraTime?: boolean;
  penalties?: [number, number];
  /** 两回合总比分（次回合才有） */
  aggregate?: [number, number];
  note?: string;
  source: string;
  updatedAt: string;
}

export interface ProgramPlatform {
  name: string;
  url: string;
  kind: 'full' | 'clips';
  access: 'free' | 'vip' | 'login';
  verified: boolean;
}

export interface Program {
  id: string;
  nameZh: string;
  nameEn?: string;
  channel: string;
  schedule: string;
  description: string;
  platforms: ProgramPlatform[];
  /** 剧透风险：高 = 必须看完相关比赛才解锁 */
  spoilerRisk: 'high' | 'medium' | 'low';
  /** 关联赛事：这些赛事最近 N 天有没看完的订阅比赛时，节目被锁定 */
  relatedCompetitions: string[];
  /** 节目覆盖最近几天的比赛 */
  coverageDays: number;
  /** 收录状态 */
  availability: 'available' | 'limited' | 'unavailable-in-china' | 'ended';
  note?: string;
}

export interface ProgramEpisode {
  programId: string;
  /** 播出时间（UTC ISO） */
  airTime: string;
  url: string;
  /** 中性标题，例如"天下足球 · 10月13日" */
  label: string;
}

export interface DataMeta {
  generatedAt: string;
  season: string;
  windowStart: string;
  windowEnd: string;
  sources: Array<{ id: string; name: string; ok: boolean; count: number; note?: string }>;
  version: number;
}
