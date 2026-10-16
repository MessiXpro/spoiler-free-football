/**
 * 环境变量读取。
 * GitHub Actions 里没设置的 vars/secrets 展开后是空字符串（变量存在但为空），
 * 这里统一把空字符串和纯空白当作"未设置"，否则 `??` 默认值不会生效。
 */
export type Env = Record<string, string | undefined>;

export function envValue(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/** 去掉空值，交给 adapter 之前统一处理一次 */
export function cleanEnv(env: Env): Env {
  const out: Env = {};
  for (const name of Object.keys(env)) {
    const v = envValue(env, name);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/**
 * 逗号分隔的列表（赛事代码、联赛 id）：未设置、为空、或者一个能识别的都没有时用默认列表。
 */
export function envList(
  env: Env,
  name: string,
  defaults: readonly string[],
  isKnown: (item: string) => boolean,
  normalize: (item: string) => string = (x) => x,
): string[] {
  const picked = (envValue(env, name) ?? '')
    .split(',')
    .map((x) => normalize(x.trim()))
    .filter((x) => x && isKnown(x));
  return picked.length ? picked : [...defaults];
}
