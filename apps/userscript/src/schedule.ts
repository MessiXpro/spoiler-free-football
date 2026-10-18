/** 全网防剧透时段的输入解析："06:00-12:00"、"6:00 到 12:00"、"22：00~08：00" → { start, end } */
export function parseTimeWindow(input: string): { start: string; end: string } | null {
  const m = input
    .replace(/：/g, ':')
    .match(/^\s*(\d{1,2}):(\d{2})\s*(?:-|–|—|~|～|至|到)\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number) as [number, number, number, number];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const fmt = (h: number, min: number) =>
    `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return { start: fmt(h1, m1), end: fmt(h2, m2) };
}

/** <input type="time"> 的值是否合法（HH:MM） */
export const isTimeValue = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
