import { useEffect, useState } from 'react';

/**
 * 当前时间。地址栏带 ?now=2026-09-21T01:00:00Z 时使用指定时间（演示示例数据用）。
 */
export function getNow(): Date {
  const p = new URLSearchParams(window.location.search).get('now');
  if (p) {
    const t = Date.parse(p);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return new Date();
}

/** 每分钟刷新一次的"现在"，用于更新比赛状态 */
export function useNow(): Date {
  const [now, setNow] = useState(getNow);
  useEffect(() => {
    const id = window.setInterval(() => setNow(getNow()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
