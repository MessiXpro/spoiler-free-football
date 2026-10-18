import { COMPETITIONS, type Competition } from './competitions.ts';
import { TEAMS, type Team } from './teams.ts';

export * from './competitions.ts';
export * from './teams.ts';

/** 匹配时忽略的俱乐部前后缀 */
const NOISE_TOKENS = new Set([
  'fc',
  'afc',
  'cf',
  'sc',
  'cd',
  'ud',
  'rc',
  'rcd',
  'ca',
  'sd',
  'sad',
  'ac',
  'as',
  'ss',
  'ssc',
  'club',
  'de',
  'del',
  'la',
  'futbol',
  'balompie',
  'calcio',
  'the',
]);

/** 去重音、转小写、去掉标点，"Club Atlético de Madrid" → "club atletico de madrid" */
export function foldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** 再去掉 FC/CF 等噪声词，"club atletico de madrid" → "atletico madrid" */
export function stripName(name: string): string {
  const folded = foldName(name);
  const tokens = folded.split(' ').filter((tok) => !NOISE_TOKENS.has(tok));
  return tokens.length ? tokens.join(' ') : folded;
}

const teamById = new Map<string, Team>();
const teamByKey = new Map<string, Team>();
const teamByStripped = new Map<string, Team>();

function addKey(map: Map<string, Team>, key: string, team: Team) {
  if (!key) return;
  const existing = map.get(key);
  // 国家队与俱乐部同名时（极少）俱乐部优先，因为数据源会单独标注国家队赛事
  if (existing && existing !== team) return;
  map.set(key, team);
}

for (const team of TEAMS) {
  teamById.set(team.id, team);
  const names = [team.en, ...(team.aliases ?? []), team.zh, ...(team.zhAliases ?? [])];
  if (team.zhFull) names.push(team.zhFull);
  for (const name of names) {
    addKey(teamByKey, foldName(name), team);
    addKey(teamByStripped, stripName(name), team);
  }
}

export function getTeam(id: string): Team | undefined {
  return teamById.get(id);
}

/**
 * 根据数据源里的球队名查找目录中的球队。
 * @param national 已知是国家队比赛时传 true，只匹配国家队；传 false 只匹配俱乐部
 */
export function findTeam(name: string, national?: boolean): Team | undefined {
  const accept = (team: Team | undefined) =>
    team && (national === undefined || Boolean(team.national) === national) ? team : undefined;
  const direct =
    accept(teamByKey.get(foldName(name))) ?? accept(teamByStripped.get(stripName(name)));
  if (direct) return direct;
  if (national !== undefined) {
    // 同名冲突时再按类型找一遍
    const wanted = stripName(name);
    return TEAMS.find(
      (team) =>
        Boolean(team.national) === national &&
        [team.en, ...(team.aliases ?? [])].some((alias) => stripName(alias) === wanted),
    );
  }
  return undefined;
}

/** 目录外球队的稳定 id，例如 "Wycombe Wanderers" → "x-wycombe-wanderers" */
export function slugTeamId(name: string): string {
  const slug = stripName(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `x-${slug || 'unknown'}`;
}

const compById = new Map<string, Competition>();
const compByKey = new Map<string, Competition>();
for (const comp of COMPETITIONS) {
  compById.set(comp.id, comp);
  for (const name of [comp.en, comp.zh, ...(comp.aliases ?? []), ...(comp.zhAliases ?? [])]) {
    compByKey.set(foldName(name), comp);
  }
  if (comp.zhFull) compByKey.set(foldName(comp.zhFull), comp);
}

export function getCompetition(id: string): Competition | undefined {
  return compById.get(id);
}

export function findCompetition(name: string): Competition | undefined {
  return compByKey.get(foldName(name));
}

/** 所有可能出现在标题里的球队/赛事名（中英文），用于判断一段文字是否与足球相关 */
export function allFootballNames(): { zh: string[]; en: string[] } {
  const zh = new Set<string>();
  const en = new Set<string>();
  const push = (name: string) => {
    if (/[一-鿿]/.test(name)) {
      if (name.length >= 2) zh.add(name);
    } else if (name.length >= 4) {
      en.add(name);
    }
  };
  for (const team of TEAMS) {
    [team.zh, team.zhFull, team.en, ...(team.aliases ?? []), ...(team.zhAliases ?? [])]
      .filter((n): n is string => Boolean(n))
      .forEach(push);
  }
  for (const comp of COMPETITIONS) {
    [comp.zh, comp.zhFull, comp.en, ...(comp.aliases ?? []), ...(comp.zhAliases ?? [])]
      .filter((n): n is string => Boolean(n))
      .forEach(push);
  }
  return { zh: [...zh], en: [...en] };
}
