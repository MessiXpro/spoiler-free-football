export type CompetitionKind =
  'league' | 'domestic-cup' | 'super-cup' | 'continental' | 'international';

export interface Competition {
  id: string;
  zh: string;
  zhFull?: string;
  en: string;
  aliases?: string[];
  zhAliases?: string[];
  kind: CompetitionKind;
  /** 是否国家队赛事 */
  national?: boolean;
  /** 本地开球时间所在时区（openfootball 等数据源给的是当地时间） */
  timeZone?: string;
  /** 两回合淘汰赛 */
  twoLegged?: boolean;
}

export const COMPETITIONS: Competition[] = [
  {
    id: 'epl',
    zh: '英超',
    zhFull: '英格兰足球超级联赛',
    en: 'Premier League',
    aliases: ['English Premier League', 'EPL', 'Premiership'],
    kind: 'league',
    timeZone: 'Europe/London',
  },
  {
    id: 'laliga',
    zh: '西甲',
    zhFull: '西班牙足球甲级联赛',
    en: 'LaLiga',
    aliases: [
      'La Liga',
      'Primera División',
      'Primera Division',
      'Spanish La Liga',
      'LaLiga EA Sports',
    ],
    kind: 'league',
    timeZone: 'Europe/Madrid',
  },
  {
    id: 'ucl',
    zh: '欧冠',
    zhFull: '欧洲冠军联赛',
    en: 'UEFA Champions League',
    aliases: ['Champions League', 'UCL'],
    kind: 'continental',
    twoLegged: true,
  },
  {
    id: 'uel',
    zh: '欧联',
    zhFull: '欧洲联赛',
    en: 'UEFA Europa League',
    aliases: ['Europa League', 'UEL'],
    zhAliases: ['欧罗巴联赛'],
    kind: 'continental',
    twoLegged: true,
  },
  {
    id: 'uecl',
    zh: '欧协联',
    zhFull: '欧洲协会联赛',
    en: 'UEFA Conference League',
    aliases: ['Conference League', 'UEFA Europa Conference League', 'UECL'],
    kind: 'continental',
    twoLegged: true,
  },
  {
    id: 'uefa-super-cup',
    zh: '欧洲超级杯',
    en: 'UEFA Super Cup',
    zhAliases: ['欧超杯'],
    kind: 'super-cup',
  },
  {
    id: 'fa-cup',
    zh: '足总杯',
    zhFull: '英格兰足总杯',
    en: 'FA Cup',
    aliases: ['The FA Cup', 'Emirates FA Cup', 'English FA Cup'],
    kind: 'domestic-cup',
    timeZone: 'Europe/London',
  },
  {
    id: 'efl-cup',
    zh: '联赛杯',
    zhFull: '英格兰联赛杯',
    en: 'EFL Cup',
    aliases: ['Carabao Cup', 'League Cup', 'English League Cup'],
    zhAliases: ['卡拉宝杯'],
    kind: 'domestic-cup',
    timeZone: 'Europe/London',
    twoLegged: true,
  },
  {
    id: 'community-shield',
    zh: '社区盾',
    zhFull: '英格兰社区盾',
    en: 'FA Community Shield',
    aliases: ['Community Shield'],
    kind: 'super-cup',
    timeZone: 'Europe/London',
  },
  {
    id: 'copa-del-rey',
    zh: '国王杯',
    zhFull: '西班牙国王杯',
    en: 'Copa del Rey',
    aliases: ['Spanish Copa del Rey', 'King’s Cup'],
    kind: 'domestic-cup',
    timeZone: 'Europe/Madrid',
    twoLegged: true,
  },
  {
    id: 'supercopa',
    zh: '西班牙超级杯',
    en: 'Supercopa de España',
    aliases: ['Spanish Super Cup', 'Supercopa de Espana', 'Supercopa'],
    zhAliases: ['西超杯'],
    kind: 'super-cup',
  },
  {
    id: 'club-world-cup',
    zh: '世俱杯',
    zhFull: '国际足联世界俱乐部杯',
    en: 'FIFA Club World Cup',
    aliases: ['Club World Cup'],
    kind: 'continental',
  },
  {
    id: 'intercontinental-cup',
    zh: '洲际杯',
    zhFull: '国际足联洲际杯',
    en: 'FIFA Intercontinental Cup',
    aliases: ['Intercontinental Cup'],
    kind: 'continental',
  },
  {
    id: 'world-cup',
    zh: '世界杯',
    zhFull: '国际足联世界杯',
    en: 'FIFA World Cup',
    aliases: ['World Cup'],
    kind: 'international',
    national: true,
  },
  {
    id: 'euro',
    zh: '欧洲杯',
    zhFull: '欧洲足球锦标赛',
    en: 'UEFA European Championship',
    aliases: ['European Championship', 'EURO', 'UEFA Euro'],
    kind: 'international',
    national: true,
  },
  {
    id: 'copa-america',
    zh: '美洲杯',
    en: 'Copa América',
    aliases: ['Copa América', 'CONMEBOL Copa America'],
    kind: 'international',
    national: true,
  },
  {
    id: 'nations-league',
    zh: '欧国联',
    zhFull: '欧洲国家联赛',
    en: 'UEFA Nations League',
    aliases: ['Nations League', 'UNL'],
    kind: 'international',
    national: true,
    twoLegged: true,
  },
  {
    id: 'wc-qualifiers',
    zh: '世预赛',
    zhFull: '世界杯预选赛',
    en: 'World Cup Qualifiers',
    aliases: [
      'FIFA World Cup qualification',
      'World Cup Qualifying',
      'WC Qualification Europe',
      'WC Qualification South America',
      'World Cup Qualification UEFA',
      'World Cup Qualification CONMEBOL',
    ],
    kind: 'international',
    national: true,
  },
  {
    id: 'euro-qualifiers',
    zh: '欧预赛',
    zhFull: '欧洲杯预选赛',
    en: 'European Qualifiers',
    aliases: ['UEFA Euro Qualifying', 'Euro Qualification', 'European Championship Qualifiers'],
    kind: 'international',
    national: true,
  },
  {
    id: 'finalissima',
    zh: '欧美杯',
    zhFull: '欧美冠军杯',
    en: 'Finalissima',
    aliases: ['CONMEBOL–UEFA Cup of Champions'],
    kind: 'international',
    national: true,
  },
  {
    id: 'friendlies',
    zh: '国际友谊赛',
    en: 'International Friendlies',
    aliases: ['Friendlies', 'International Friendly', 'Friendly International'],
    zhAliases: ['友谊赛', '热身赛'],
    kind: 'international',
    national: true,
  },
];

export const COMPETITION_KIND_LABELS: Record<CompetitionKind, string> = {
  league: '联赛',
  'domestic-cup': '国内杯赛',
  'super-cup': '超级杯',
  continental: '洲际/世界俱乐部赛事',
  international: '国家队赛事',
};
