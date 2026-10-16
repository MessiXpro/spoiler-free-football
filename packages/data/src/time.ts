/** 某个时区在某一时刻相对 UTC 的偏移（分钟） */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/**
 * 当地时间 → UTC ISO。
 * zonedToUtc('2026-10-17', '20:00', 'Europe/London') → '2026-10-17T19:00:00.000Z'（英国夏令时）
 */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // 两次迭代可以正确处理夏令时切换
  let utc = guess - offsetMinutes(guess, timeZone) * 60000;
  utc = guess - offsetMinutes(utc, timeZone) * 60000;
  return new Date(utc).toISOString();
}

/** "16:30 UTC-4" / "20:00 UTC+1" → UTC ISO */
export function offsetTimeToUtc(date: string, time: string): string | null {
  const m = time.match(/^(\d{1,2}):(\d{2})(?:\s*UTC\s*([+-]\d{1,2})(?::?(\d{2}))?)?$/);
  if (!m) return null;
  const [, hh = '0', mm = '0', off = '0', offMin = '0'] = m;
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const sign = off.startsWith('-') ? -1 : 1;
  const offset = Number(off) * 60 + sign * Number(offMin);
  return new Date(Date.UTC(y, mo - 1, d, Number(hh), Number(mm)) - offset * 60000).toISOString();
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-27" 赛季字符串，按 7 月切换 */
export function seasonOf(date: Date): string {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
