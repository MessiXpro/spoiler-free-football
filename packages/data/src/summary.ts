import { competitionName, type PublicMatch } from '@sff/core';
import type { BuildOutput } from './build.ts';

/**
 * 数据源状态：off = 没启用或整个出错；warn = 有请求失败，或者一场都没拿到；ok = 正常。
 * 各数据源自己吞掉单次请求的错误、写进说明（都带"失败"），所以不能只看 ok
 */
export function sourceStatus(s: {
  id?: string;
  ok: boolean;
  count: number;
  note?: string;
}): 'ok' | 'warn' | 'off' {
  const note = s.note ?? '';
  // 整个数据源出错（note 以「失败」开头）要显示 ⚠️；没设 Key 跳过的才是 —
  if (!s.ok) return /失败/.test(note) ? 'warn' : 'off';
  if (/失败/.test(note)) return 'warn';
  // 手工补充平时就是空的；夏天 openfootball 退回上赛季文件、窗口里没比赛也不算有问题
  if (s.count === 0 && s.id !== 'manual' && !/还没发布/.test(note)) return 'warn';
  return 'ok';
}

/** 各赛事的公开比赛场数，按场数从多到少（只有赛事名和数字：哪项赛事几乎没拿到数据，一眼就能看出来） */
export function competitionCounts(
  matches: Array<Pick<PublicMatch, 'competition'>>,
): Array<{ id: string; name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.competition, (counts.get(m.competition) ?? 0) + 1);
  return [...counts]
    .map(([id, count]) => ({ id, name: competitionName(id), count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** GitHub Actions 运行页上的中文小结（只有场数和队名，淘汰赛队名隐藏，没有比分） */
export function stepSummary(output: BuildOutput, scores: number): string {
  const cell = (v: string) => v.replace(/\|/g, '／').replace(/\n/g, ' ');
  const lines = [
    '## 数据管线结果',
    '',
    `公开比赛 ${output.matches.length} 场，比分文件 ${scores} 个（这里不显示比分，淘汰赛的队名也会隐藏）。`,
    '',
    '| 数据源 | 状态 | 场数 | 说明 |',
    '|---|---|---|---|',
    ...output.meta.sources.map(
      (s) =>
        `| ${cell(s.name)} | ${{ ok: '✅', warn: '⚠️', off: '—' }[sourceStatus(s)]} | ${s.count} | ${cell(s.note ?? '')} |`,
    ),
    '',
  ];
  // 每项赛事一行：数据源总数正常、某项赛事却只有一两场时（数据源没给、或者我们问错了轮次），在这里能看出来
  const perCompetition = competitionCounts(output.matches);
  if (perCompetition.length) {
    lines.push(
      '### 各赛事场数',
      '',
      '| 赛事 | 场数 |',
      '|---|---|',
      ...perCompetition.map((c) => `| ${cell(c.name)} | ${c.count} |`),
      '',
    );
  }
  const { unknownTeams, possibleDuplicates, hiddenKnockoutTeams } = output.diagnostics;
  if (possibleDuplicates.length) {
    lines.push(`### ⚠️ 可能重复的比赛（${possibleDuplicates.length} 组）`, '');
    for (const d of possibleDuplicates.slice(0, 50))
      lines.push(`- [${d.competition}] ${d.a} ／ ${d.b}`);
    lines.push('');
  }
  if (unknownTeams.length) {
    lines.push(
      `### 目录里没有的球队（${unknownTeams.length} 个，网页上显示英文原名）`,
      '',
      ...unknownTeams.slice(0, 80).map((t) => `- [${t.competition}] ${t.name}（${t.source}）`),
      ...(unknownTeams.length > 80 ? [`- ……另外 ${unknownTeams.length - 80} 个见运行日志`] : []),
      '',
    );
  }
  if (hiddenKnockoutTeams) {
    lines.push(
      `淘汰赛里还有 ${hiddenKnockoutTeams} 个目录外的球队名，为了不暴露晋级情况没有列出。`,
      '',
    );
  }
  // 提示里可能带比赛编号（淘汰赛的编号含两队名字），只给条数，详情看运行日志
  if (output.warnings.length) {
    lines.push(`另有 ${output.warnings.length} 条配置提示，见「运行数据管线」步骤的日志。`, '');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 一场比赛都没拿到、而且至少有一个数据源是因为出错才没拿到：返回中文原因，调用方应当让这次运行失败、不部署，
 * 网页上保留上一次的数据。淡季各数据源正常返回 0 场时返回 null，照常发布（这时网页显示「最近没有比赛」是对的）
 */
export function emptyDataReason(output: Pick<BuildOutput, 'matches' | 'meta'>): string | null {
  if (output.matches.length > 0) return null;
  const used = output.meta.sources.filter((s) => s.id !== 'manual' && !/跳过/.test(s.note ?? ''));
  const failed = used.filter((s) => !s.ok || /失败/.test(s.note ?? ''));
  // 有数据源正常跑完、确实是 0 场（深度淡季）：照常发布。
  // 夏天 openfootball 退回上赛季文件（「还没发布」）的 0 场不算：这时主要靠 TheSportsDB，它出错就不发布
  const healthy = used.filter((s) => s.ok && !/失败|还没发布/.test(s.note ?? ''));
  if (!failed.length || healthy.length > 0) return null;
  const detail = failed.map((s) => `${s.name}：${s.note ?? '出错'}`).join('；');
  return `${failed.map((s) => s.name).join('、')} 出错，一场比赛也没拿到，这次不发布（网页保留上一次的数据）。${detail}`;
}

/**
 * GitHub Actions 注解（运行页顶部的黄色提示），让部分失败不至于藏在小结最下面。
 * 每次最多一条；内容和小结表格相同（说明已经过 redact，不含比分；淘汰赛队名不会出现在数据源说明里）
 */
export function actionsAnnotations(output: Pick<BuildOutput, 'meta'>): string[] {
  const esc = (v: string) => v.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const escTitle = (v: string) => esc(v).replace(/:/g, '%3A').replace(/,/g, '%2C');
  const bad = output.meta.sources.filter((s) => sourceStatus(s) === 'warn');
  if (!bad.length) return [];
  const title = `${bad.length} 个数据源有问题：${bad.map((s) => s.name).join('、')}`;
  const body = bad.map((s) => `${s.name}（${s.count} 场）：${s.note ?? '一场都没拿到'}`).join('；');
  return [`::warning title=${escTitle(title)}::${esc(body)}`];
}
