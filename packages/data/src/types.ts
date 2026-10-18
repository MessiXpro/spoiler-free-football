import type { ScheduleStatus, ScoreRecord, Stage, TeamRef } from '@sff/core';
import type { Fetcher } from './http.ts';

/** adapter 输出的统一格式（比分单独放，最后只写进 scores/<id>.json） */
export interface RawFixture {
  source: string;
  /** 数据源自己的比赛 id */
  sourceId: string;
  competition: string;
  /** 赛季/阶段/状态：手工补充条目没写时留空，合并时取其他来源的，都没有再用默认值 */
  season?: string;
  stage?: Stage;
  matchday?: number;
  group?: string;
  leg?: 1 | 2;
  /** UTC ISO */
  kickoff: string;
  timeTbd?: boolean;
  home: TeamRef;
  away: TeamRef;
  status?: ScheduleStatus;
  /** 数据源确认已完赛（只用于决定是否生成比分文件，不进入公开数据） */
  finished: boolean;
  score?: Omit<ScoreRecord, 'id' | 'source' | 'updatedAt'>;
  /** 比分里含点球大战进球（数据源没给点球比分，没法扣掉）：合并时排在其他来源后面 */
  scoreIncludesShootout?: boolean;
  /** 数据源说是点球大战决出胜负（不一定给了点球比分）。没有点球比分的看不出谁晋级，合并时排在完整的比分后面 */
  penaltyShootout?: boolean;
}

export interface AdapterContext {
  fetcher: Fetcher;
  now: Date;
  env: Record<string, string | undefined>;
  /** 只拉这个时间窗内的比赛 */
  windowStart: Date;
  windowEnd: Date;
  log: (msg: string) => void;
  /**
   * 用时上限（返回毫秒时间戳的时钟上的截止时间）：要发很多请求的数据源过了这个时间就停下，
   * 已经拿到的照常用，免得一个慢的数据源占满 GitHub Actions 的额度
   */
  deadline?: number;
  /** 当前时间（毫秒），默认 Date.now；测试里可以换掉 */
  clock?: () => number;
}

export interface AdapterResult {
  fixtures: RawFixture[];
  /** 说明（例如缺少 API Key 而跳过） */
  notes: string[];
}

export interface FixtureAdapter {
  id: string;
  name: string;
  /** 越大越优先（合并时用它的开球时间/阶段） */
  priority: number;
  /** 不满足条件（缺 Key）时返回原因，管线会跳过它 */
  unavailableReason?(env: AdapterContext['env']): string | null;
  fetch(ctx: AdapterContext): Promise<AdapterResult>;
}
