import type { Program, ProgramEpisode } from '@sff/core';
import { zonedToUtc } from './time.ts';

export interface ProgramConfigItem extends Program {
  /** 每周固定播出：weekday 0=周日…6=周六（北京时间） */
  weekly?: { weekday: number; time: string };
}

export interface ProgramsConfig {
  programs: ProgramConfigItem[];
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function beijingYmd(t: number): { y: number; m: number; d: number; weekday: number } {
  const bj = new Date(t + 8 * 60 * 60 * 1000);
  return {
    y: bj.getUTCFullYear(),
    m: bj.getUTCMonth() + 1,
    d: bj.getUTCDate(),
    weekday: bj.getUTCDay(),
  };
}

/**
 * 按固定播出时间生成"最近两期 + 下一期"的中性条目。
 * 只有日期和栏目页链接，不抓取单期标题（单期标题经常包含赛果）。
 */
export function scheduledEpisodes(programs: ProgramConfigItem[], now: Date): ProgramEpisode[] {
  const out: ProgramEpisode[] = [];
  for (const p of programs) {
    if (!p.weekly || (p.availability !== 'available' && p.availability !== 'limited')) continue;
    const url = p.platforms[0]?.url;
    if (!url) continue;
    const today = beijingYmd(now.getTime());
    const back = (today.weekday - p.weekly.weekday + 7) % 7;
    const anchorMs = now.getTime() - back * 24 * 60 * 60 * 1000;
    for (const weeks of [-1, 0, 1]) {
      const day = beijingYmd(anchorMs + weeks * 7 * 24 * 60 * 60 * 1000);
      const date = `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
      const airTime = zonedToUtc(date, p.weekly.time, 'Asia/Shanghai');
      out.push({
        programId: p.id,
        airTime,
        url,
        label: `${p.nameZh} · ${day.m}月${day.d}日（${WEEKDAYS[day.weekday]}）`,
      });
    }
  }
  return out.sort((a, b) => Date.parse(a.airTime) - Date.parse(b.airTime));
}

/** 公开数据里不需要 weekly 这种内部字段 */
export function publicProgram(p: ProgramConfigItem): Program {
  const { weekly: _weekly, ...rest } = p;
  return rest;
}
