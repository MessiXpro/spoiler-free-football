/**
 * 一条已看记录（秒）是否属于「这一次安排的」比赛。
 * 比赛 id 里没有日期，改期重赛的那场还是同一个 id；而合法的「看完」一定发生在开球之后，
 * 所以已看时间早于开球时间的记录（比分缺失时记下、之后比赛改期）不算：改期后的那场照常算没看。
 * 网页（state.ts 的 isWatched）和插件弹窗 / 用户脚本面板都用这一条规则。
 */
export function watchedAfterKickoff(t: number | undefined, kickoff: string): boolean {
  return typeof t === 'number' && t * 1000 >= Date.parse(kickoff);
}
