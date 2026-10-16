import { getCompetition, getTeam } from '../catalog/index.ts';
import type { PublicMatch, Stage, TeamRef } from './types.ts';

export const BEIJING_TZ = 'Asia/Shanghai';

const STAGE_LABELS: Record<Stage, string> = {
  regular: '',
  'league-phase': '联赛阶段',
  group: '小组赛',
  qualifying: '资格赛',
  playoff: '附加赛',
  'round-1': '第一轮',
  'round-2': '第二轮',
  'round-3': '第三轮',
  'round-4': '第四轮',
  'round-5': '第五轮',
  'round-6': '第六轮',
  'round-of-64': '1/32决赛',
  'round-of-32': '1/16决赛',
  'round-of-16': '1/8决赛',
  'quarter-final': '1/4决赛',
  'semi-final': '半决赛',
  'third-place': '三四名决赛',
  final: '决赛',
  friendly: '',
};

/** 淘汰赛阶段的先后，用于"下一轮对阵会暴露晋级者"的锁定判断 */
const STAGE_ORDER: Record<Stage, number> = {
  qualifying: 0,
  playoff: 1,
  regular: 1,
  'league-phase': 1,
  group: 1,
  friendly: 1,
  'round-1': 2,
  'round-2': 3,
  'round-3': 4,
  'round-4': 5,
  'round-5': 6,
  'round-6': 7,
  'round-of-64': 8,
  'round-of-32': 9,
  'round-of-16': 10,
  'quarter-final': 11,
  'semi-final': 12,
  'third-place': 13,
  final: 13,
};

export function stageOrder(stage: Stage): number {
  return STAGE_ORDER[stage] ?? 0;
}

/** 淘汰赛（对阵由前一轮结果决定） */
export function isKnockoutStage(stage: Stage): boolean {
  return STAGE_ORDER[stage] >= 2 || stage === 'playoff';
}

export function stageLabel(
  match: Pick<PublicMatch, 'stage' | 'matchday' | 'group' | 'leg'>,
): string {
  const parts: string[] = [];
  const base = STAGE_LABELS[match.stage] ?? '';
  if (match.stage === 'regular') {
    if (match.matchday) parts.push(`第${match.matchday}轮`);
  } else if (match.stage === 'league-phase' || match.stage === 'group') {
    parts.push(match.group ? `${base}${match.group}组` : base);
    if (match.matchday) parts.push(`第${match.matchday}轮`);
  } else if (base) {
    parts.push(base);
  }
  if (match.leg === 1) parts.push('首回合');
  if (match.leg === 2) parts.push('次回合');
  return parts.join(' ');
}

export function teamName(ref: TeamRef): string {
  return getTeam(ref.id)?.zh ?? ref.name;
}

export function competitionName(id: string): string {
  return getCompetition(id)?.zh ?? id;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function beijingParts(iso: string) {
  const date = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    parts.weekday ?? '',
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour ?? '00',
    minute: parts.minute ?? '00',
    weekday: WEEKDAYS[weekdayIndex] ?? '',
  };
}

/** "10月17日 周六 19:30"（北京时间） */
export function formatKickoff(iso: string, timeTbd = false): string {
  const p = beijingParts(iso);
  const time = timeTbd ? '时间待定' : `${p.hour}:${p.minute}`;
  return `${p.month}月${p.day}日 ${p.weekday} ${time}`;
}

/** 北京时间的日期 "2026-10-17" */
export function beijingDate(iso: string | Date): string {
  const p = beijingParts(typeof iso === 'string' ? iso : iso.toISOString());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export interface NeutralTitleOptions {
  /** 对阵被锁定时（前一轮还没看），用这个代替队名 */
  lockedTeams?: boolean;
  withKickoff?: boolean;
}

/** 中性标题："阿森纳 vs 切尔西 · 英超 · 第7轮 · 10月17日 周六 19:30" */
export function neutralTitle(match: PublicMatch, options: NeutralTitleOptions = {}): string {
  const vs = options.lockedTeams
    ? '对阵待揭晓 vs 对阵待揭晓'
    : `${teamName(match.home)} vs ${teamName(match.away)}`;
  const parts = [vs, competitionName(match.competition)];
  const stage = stageLabel(match);
  if (stage) parts.push(stage);
  if (options.withKickoff !== false) parts.push(formatKickoff(match.kickoff, match.timeTbd));
  return parts.join(' · ');
}

export type LiveStatus = 'upcoming' | 'live' | 'finished' | 'postponed';

/**
 * 比赛状态只由开球时间推算：开球后 3 小时内一律"进行中"。
 * 这样状态切换的时刻不会暴露是否进入加时或点球。
 */
export const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

export function liveStatus(match: Pick<PublicMatch, 'kickoff' | 'status'>, now: Date): LiveStatus {
  if (match.status !== 'scheduled') return 'postponed';
  const kickoff = Date.parse(match.kickoff);
  const t = now.getTime();
  if (t < kickoff) return 'upcoming';
  if (t < kickoff + LIVE_WINDOW_MS) return 'live';
  return 'finished';
}

export const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  upcoming: '未开始',
  live: '进行中',
  finished: '已结束',
  postponed: '延期/取消',
};
