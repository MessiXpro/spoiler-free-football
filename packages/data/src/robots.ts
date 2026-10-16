/** 极简 robots.txt 解析：支持 User-agent 分组、Allow/Disallow、* 与 $ 通配 */
export interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

export type RobotsRules = RobotsGroup[];

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      if (field === 'disallow' && value === '') continue;
      current.rules.push({ allow: field === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegex(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function isAllowedByRobots(rules: RobotsRules, path: string, agent: string): boolean {
  const ua = agent.toLowerCase();
  const specific = rules.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const groups = specific.length ? specific : rules.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (patternToRegex(rule.path).test(path)) {
        const len = rule.path.length;
        if (!best || len > best.len || (len === best.len && rule.allow))
          best = { allow: rule.allow, len };
      }
    }
  }
  return best ? best.allow : true;
}
