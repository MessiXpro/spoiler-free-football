import type { ScheduleStatus, ScoreRecord, Stage, TeamRef } from '@sff/core';
import type { Fetcher } from './http.ts';

/** adapter 输出的统一格式（比分单独放，最后只写进 scores/<id>.json） */
export interface RawFixture {
  source: string;
  /** 数据源自己的比赛 id */
  sourceId: string;
  competition: string;
  season: string;
  stage: Stage;
  matchday?: number;
  group?: string;
  leg?: 1 | 2;
  /** UTC ISO */
  kickoff: string;
  timeTbd?: boolean;
  home: TeamRef;
  away: TeamRef;
  status: ScheduleStatus;
  /** 数据源确认已完赛（只用于决定是否生成比分文件，不进入公开数据） */
  finished: boolean;
  score?: Omit<ScoreRecord, 'id' | 'source' | 'updatedAt'>;
}

export interface AdapterContext {
  fetcher: Fetcher;
  now: Date;
  env: Record<string, string | undefined>;
  /** 只拉这个时间窗内的比赛 */
  windowStart: Date;
  windowEnd: Date;
  log: (msg: string) => void;
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
