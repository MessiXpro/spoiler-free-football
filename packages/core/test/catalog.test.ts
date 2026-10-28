import { describe, expect, it } from 'vitest';
import { TEAMS, findTeam, getTeam, type TeamGroup } from '../src/index.ts';

/**
 * 球队目录的健全性。README「补充球队中文名 / 别名」教非程序员直接改 teams.ts，
 * 数据管线用 tsx 运行、不做类型检查，所以编号重复、分组拼错这类笔误要靠这里兜住
 */
const GROUPS: TeamGroup[] = [
  'epl',
  'laliga',
  'eng-other',
  'esp-other',
  'europe',
  'world-club',
  'national',
];

describe('球队目录', () => {
  it('编号唯一、只用小写英文数字和短横线，国家队以 nt- 开头，按编号能找回', () => {
    const seen = new Set<string>();
    for (const team of TEAMS) {
      expect(team.id, team.en).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(team.id), `编号重复：${team.id}`).toBe(false);
      seen.add(team.id);
      expect(team.id.startsWith('nt-'), team.id).toBe(Boolean(team.national));
      expect(getTeam(team.id)).toBe(team);
      expect(team.zh, team.id).not.toBe('');
      expect(team.en, team.id).not.toBe('');
    }
  });

  it('分组只能是订阅页面认识的那几个，国家队都在 national 组', () => {
    for (const team of TEAMS) {
      expect(GROUPS, `${team.id} 的分组 ${team.group}`).toContain(team.group);
      expect(team.group === 'national', team.id).toBe(Boolean(team.national));
    }
  });

  it('每个英文名、别名、中文名都能找回它自己（别名不能撞到别的球队）', () => {
    for (const team of TEAMS) {
      const names = [team.en, ...(team.aliases ?? []), team.zh, ...(team.zhAliases ?? [])];
      if (team.zhFull) names.push(team.zhFull);
      for (const name of names) {
        expect(findTeam(name, Boolean(team.national))?.id, `${team.id} 的「${name}」`).toBe(
          team.id,
        );
      }
    }
  });
});
