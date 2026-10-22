import { describe, expect, it } from 'vitest';
import { findSpoilers, hasSpoiler, isFootballText, redact, MASK_CHAR } from '../src/index.ts';

/** 遮挡后不应再残留任何比分写法和结果词 */
function expectClean(masked: string) {
  expect(hasSpoiler(masked, { football: true }), `残留剧透：${masked}`).toBe(false);
}

/** 收集本文件里所有测试字符串，最后统一做幂等性检查 */
const ALL_STRINGS: string[] = [];
function track(cases: string[]): string[] {
  ALL_STRINGS.push(...cases);
  return cases;
}

describe('比分写法（中文标题）', () => {
  const cases = track([
    '阿森纳2-1切尔西',
    '曼城 3:0 伊普斯维奇',
    '皇马2：1巴萨',
    '利物浦2比1埃弗顿',
    '热刺二比零富勒姆',
    '热刺 两比一 富勒姆',
    '切尔西(4)1-1(3)阿森纳',
    '切尔西（4）1-1（3）阿森纳',
    '巴萨1(4)-(3)1皇马',
    '点球大战4-3',
    '点球 5:4',
    '总比分3-2',
    '总比分 5：4',
    '曼联 1－0 热刺',
    '曼城 2—1 利物浦',
    '曼城 2–1 利物浦',
    '曼城２－１利物浦',
    '【英超】阿森纳 2-1 切尔西 全场集锦',
    '英超-阿森纳2-1切尔西',
    '比分 10-0',
    '最终比分：3-3',
    '曼城2-1领先进入下半场',
    '0-0',
    '1:1 战平',
    '马竞 1-1 皇马（点球4-3）',
    '巴萨两球领先',
    '一球小胜',
    '1球惜败',
    '净胜三球',
    '打进2球',
    '全场7粒进球',
    '上演7球大战',
    '点球大战PK4-3',
    '4-3PK',
  ]);
  it.each(cases)('遮挡：%s', (text) => {
    const spans = findSpoilers(text);
    expect(spans.length, text).toBeGreaterThan(0);
    expect(
      spans.some((s) => s.kind === 'score'),
      text,
    ).toBe(true);
    const masked = redact(text);
    expect(masked).toContain(MASK_CHAR);
    expectClean(masked);
  });
});

describe('比分写法（英文标题）', () => {
  const cases = track([
    'Arsenal 2-1 Chelsea',
    'Arsenal 2 Chelsea 1',
    'Real Madrid 3, Barcelona 1',
    'Man City 3-0 Ipswich: Haaland hat-trick',
    'Liverpool beat Everton 2-1',
    'Real Madrid win 4-3 on penalties',
    'Barcelona 1-1 Real Madrid (4-3 pens)',
    'Barcelona 1-1 Real Madrid (4-3 p)',
    'Arsenal win 3-2 on aggregate',
    'agg 3-2',
    'Real Madrid 2-1 Barcelona AET',
    'Real Madrid 2-1 Barcelona (a.e.t.)',
    'FT: Spurs 2-2 Chelsea',
    'Spurs 2 - 2 Chelsea.',
    'Chelsea won 1-0.',
  ]);
  it.each(cases)('遮挡：%s', (text) => {
    expect(
      findSpoilers(text).some((s) => s.kind === 'score'),
      text,
    ).toBe(true);
    expectClean(redact(text));
  });

  it('BBC 写法只遮数字、保留队名', () => {
    expect(redact('Arsenal 2 Chelsea 1')).toBe(`Arsenal ${MASK_CHAR} Chelsea ${MASK_CHAR}`);
  });

  it('基本比分统一遮成 ■-■', () => {
    expect(redact('阿森纳2-1切尔西')).toBe(`阿森纳${MASK_CHAR}-${MASK_CHAR}切尔西`);
    expect(redact('曼城 3:0 伊普斯维奇')).toBe(`曼城 ${MASK_CHAR}-${MASK_CHAR} 伊普斯维奇`);
  });

  it('点球括号写法整体遮住，不残留括号里的数字', () => {
    const masked = redact('切尔西(4)1-1(3)阿森纳');
    expect(masked).not.toMatch(/\d/);
  });
});

describe('结果词（中文）', () => {
  const cases = track([
    '哈兰德梅开二度',
    '萨卡上演帽子戏法',
    '凯恩破门',
    '亚马尔建功',
    '贝林厄姆补时绝杀',
    '阿森纳逆转切尔西',
    '马竞爆冷出局',
    '利物浦惨败',
    '曼城大胜',
    '皇马晋级决赛',
    '曼联被逼平',
    '热刺闷平富勒姆',
    '切尔西零封对手',
    '维尼修斯染红',
    '补时第90+3分钟',
    '萨拉赫第89分钟破门',
    '巴萨卫冕',
    '皇马夺冠',
    '双方互交白卷',
    '阿森纳扳平比分',
    '曼城客场力克切尔西',
    '利物浦主场不敌水晶宫',
    '热刺险胜',
    '曼联憾负',
    '国米点球大战胜出',
    '这是一场进球大战',
    '巴萨击败皇马',
    '曼城战胜阿森纳',
    '切尔西淘汰阿森纳',
    '阿森纳领先',
    '利物浦落后两球',
    '英格兰点球大战',
    '加时赛',
    '自摆乌龙',
    '世界波',
  ]);
  it.each(cases)('遮挡：%s', (text) => {
    expect(findSpoilers(text).length, text).toBeGreaterThan(0);
    expectClean(redact(text));
  });
});

describe('结果词（英文）', () => {
  const cases = track([
    'Chelsea knocked out of FA Cup',
    'Spurs crash out of the Europa League',
    'Saka scores late winner',
    'Haaland nets brace as City thrash Ipswich',
    'Palmer equaliser rescues Chelsea',
    'Man United held to a goalless draw',
    'Atletico Madrid stunned by Getafe',
    'Arsenal beat Chelsea',
    'Chelsea lost to Arsenal',
    'Liverpool victory at Anfield',
    'Real Madrid crowned champions',
    'Barcelona win the Copa del Rey',
    "Bayern Munich: Kane 23', 67'",
    'Vinicius sent off',
    'Own goal gifts Arsenal the points',
    'Tottenham relegated',
    'Comeback win for Liverpool',
    'Wolves clinch survival',
  ]);
  it.each(cases)('遮挡：%s', (text) => {
    expect(findSpoilers(text).length, text).toBeGreaterThan(0);
    expectClean(redact(text));
  });
});

describe('不误伤：中性写法', () => {
  const cases = track([
    '2026 赛季',
    '2025-26 赛季',
    '2025/26赛季英超',
    '2026-27 英超',
    '第 3 轮',
    '英超第3轮',
    'U21',
    'U-21 欧洲杯',
    'U23亚洲杯',
    '4-3-3 阵型',
    '4-2-3-1',
    '3-5-2 体系',
    '4 - 3 - 3',
    '阿森纳 vs 切尔西 · 英超 · 第7轮 · 10月17日 周六 19:30',
    '10月18日 03:00 开球',
    '19:30',
    '19：30',
    '北京时间 3:45',
    '时长 1:30:00',
    '01:45:12',
    '伤缺 2-3 周',
    '1-3 月',
    '第1-3轮',
    '前2-3名',
    '2026-10-17',
    '10-17 英超第8轮',
    '10.17',
    '欧冠淘汰赛抽签前瞻',
    '欧洲冠军联赛 联赛阶段 第3轮',
    '全场回放',
    '进球集锦',
    '英超第七轮进球集锦',
    '阿森纳vs切尔西进球集锦',
    '首发阵容',
    '赛前发布会',
    'Arsenal vs Chelsea | Premier League Matchday 7 | Full Match Replay',
    'Extended Highlights',
    'Match of the Day',
    'Monday Night Football',
    'UEFA Champions League League Phase MD3',
    'Premier League 2026/27',
    '16:9 高清',
    '1080P 60帧',
    '天下足球',
    '冠军欧洲',
    'Champions League',
    '电话 010-12345678',
    '比尔森胜利 vs 阿森纳',
    'PSV埃因霍温',
    '首回合',
    '1/8决赛 首回合',
    '欧冠1/4决赛',
    'Copa del Rey Round of 32',
    'AC米兰 vs 国际米兰',
    '本场比赛将于北京时间 03:00 开始',
    '气温 5-8 度',
    '价格 3-5 元',
    '1:1 还原手办',
    '1比1复刻',
    '曼城 vs 利物浦 前瞻',
    '利物浦 vs 曼城 · 英超 · 第8轮 · 10月25日 周日 23:30',
    '皇马 vs 巴萨 · 西甲 · 第10轮 · 10月26日 周一 03:00',
    '欧冠 联赛阶段第3轮 皇马 vs 尤文图斯',
    '足总杯第三轮 阿森纳 vs 伯恩茅斯',
    '英格兰 vs 西班牙 · 欧国联 · 小组赛第2轮',
    'Episode 1-2',
    'v1.2-3',
    '2026世界杯',
    'FIFA 26',
    '电脑：Chrome / Edge / Firefox 安装插件',
    'Microsoft Edge 加载已解压的扩展',
  ]);
  it.each(cases)('不遮挡：%s', (text) => {
    expect(findSpoilers(text), text).toEqual([]);
    expect(redact(text)).toBe(text);
  });
});

describe('语境词只在足球语境中遮挡', () => {
  it.each(
    track([
      'We won the hackathon',
      'Weight loss tips',
      '今天天气很好，我们领先一步',
      'Lewis Hamilton takes the title',
      'Best header images for your blog',
    ]),
  )('非足球文字不遮：%s', (text) => {
    expect(findSpoilers(text)).toEqual([]);
  });

  it('足球语境下同样的词会被遮', () => {
    expect(hasSpoiler('We won', { football: true })).toBe(true);
    expect(hasSpoiler('曼城领先', {})).toBe(true);
  });

  it('isFootballText', () => {
    expect(isFootballText('阿森纳训练营')).toBe(true);
    expect(isFootballText('Arsenal training')).toBe(true);
    expect(isFootballText('英超联赛')).toBe(true);
    expect(isFootballText('今天吃什么')).toBe(false);
    expect(isFootballText('This is a nice lens')).toBe(false);
  });
});

describe('配置项', () => {
  it('额外的强结果词', () => {
    expect(hasSpoiler('今天出了个大新闻', { extraWords: ['大新闻'] })).toBe(true);
  });
  it('额外的保护词', () => {
    expect(hasSpoiler('完胜游戏', { safePhrases: ['完胜游戏'] })).toBe(false);
  });
});

describe('一段话里多处剧透', () => {
  it('全部遮挡，中性部分保留', () => {
    const [text = ''] = track(['英超第7轮：阿森纳 2-1 切尔西，萨卡破门，阿森纳逆转取胜']);
    const masked = redact(text);
    expect(masked.startsWith('英超第7轮：阿森纳')).toBe(true);
    expect(masked).toContain('切尔西');
    expectClean(masked);
  });
});

const M = MASK_CHAR;
const FB = { football: true } as const;

/** 必须遮住、且遮挡后不残留（两种语境都检查） */
function expectMasked(text: string, options: { football?: boolean } = {}) {
  const masked = redact(text, options);
  expect(masked, text).not.toBe(text);
  expectClean(masked);
}

/** 两种语境下都不遮 */
function expectNeutral(text: string) {
  expect(findSpoilers(text), text).toEqual([]);
  expect(findSpoilers(text, FB), text).toEqual([]);
}

describe('回归：比分紧挨中文冒号', () => {
  it('冒号后面紧跟比分', () => {
    expect(redact('终场：2-1')).toBe(`终场：${M}-${M}`);
    expect(redact('阿森纳vs切尔西：2-1')).toBe(`阿森纳vs切尔西：${M}-${M}`);
    expect(redact('阿森纳vs切尔西:2-1')).toBe(`阿森纳vs切尔西:${M}-${M}`);
  });
  it('比分后面紧跟冒号', () => {
    expect(redact('阿森纳 2-1：萨卡破门')).toBe(`阿森纳 ${M}-${M}：${M}${M}${M}`);
  });
  it('B站标签页标题：比分后面紧跟 "_哔哩哔哩_bilibili"', () => {
    for (const options of [{}, FB]) {
      expect(redact('英超第8轮 阿森纳vs切尔西：2-1_哔哩哔哩_bilibili', options)).toBe(
        `英超第8轮 阿森纳vs切尔西：${M}-${M}_哔哩哔哩_bilibili`,
      );
      expect(redact('Arsenal vs Chelsea 2-1_哔哩哔哩_bilibili', options)).toBe(
        `Arsenal vs Chelsea ${M}-${M}_哔哩哔哩_bilibili`,
      );
    }
  });
  it.each(
    track([
      '英超第8轮 阿森纳vs切尔西：2-1',
      '赛果：2-1',
      '结果：2-1',
      '全场战罢：2-1',
      '曼城：3-0',
      '终场：2-1 阿森纳主场',
      '终场：4-3PK',
    ]),
  )('遮挡：%s', (text) => {
    expectMasked(text);
    expectMasked(text, FB);
  });
  it.each(
    track([
      '开球时间：19:30',
      '19:30：开球',
      '时长：1:30:00',
      '1:30:00：回放',
      '阵型：4-3-3',
      '4-3-3：阵型',
      '比例 16:9：',
      '画面比例：4:3',
      '第1-3轮：',
      '12:3:4',
      '3:2:1',
      '比赛日：10-17',
      '10:30：直播',
      '时间：2:30',
      'http://a.com:8080/1-2',
      // 冒号后面的开球时间带 PK/ft 也不是比分
      '时间：19:30 PK',
      '开球：20:00 ft',
      '今晚 19:30 PK',
      '19:30PK',
      // 下划线后缀（B站标题）不影响中性写法
      '第1-3集_哔哩哔哩_bilibili',
      'P1-2_哔哩哔哩',
      '4-3-3_阵型',
      '19:30_直播',
      '1:30:00_回放',
      '2025-26_赛季',
    ]),
  )('不遮挡：%s', expectNeutral);
});

describe('回归：比分后面的队名/词语不当成单位', () => {
  it('精确输出', () => {
    expect(redact('国米2-0米兰')).toBe(`国米${M}-${M}米兰`);
    expect(redact('国足0-7日本')).toBe(`国足${M}-${M}日本`);
    expect(redact('Hamburg 2-1 St. Pauli')).toBe(`Hamburg ${M}-${M} St. Pauli`);
    expect(redact('阿森纳 vs 切尔西 2-1 集锦')).toBe(`阿森纳 vs 切尔西 ${M}-${M} 集锦`);
    expect(redact('利兹联2-1米堡')).toBe(`利兹联${M}-${M}米堡`);
  });
  it.each(
    track([
      '米兰德比：国米2-0米兰',
      '那不勒斯 2-1 米兰',
      '【意甲】国米2-0米兰 全场集锦_哔哩哔哩_bilibili',
      '中国队0-3日本队',
      '韩国1-1日本',
      '山东泰山2-1天津津门虎',
      '泰山2-0名古屋鲸八',
      '曼城4-0年轻人',
      '曼城2-1米德尔斯堡',
      '桑德兰1-0米尔沃尔',
      '阿森纳2-1千叶',
      '曼城2-1 米特罗维奇破门',
      '阿森纳2-1米内罗竞技',
      'Celtic 3-0 St Mirren',
      '【英超】阿森纳 vs 切尔西 2-1 集锦',
      '阿森纳3-0强势',
      'Arsenal vs Chelsea 2-1 player ratings',
      '2-1位列榜首',
      '阿森纳2-1名列第一',
      '1-0度过难关',
    ]),
  )('遮挡：%s', (text) => {
    expectMasked(text);
    expectMasked(text, FB);
  });
  it.each(
    track([
      '1-3天',
      '3-5个月',
      '前2-3名',
      '伤缺2-3周',
      '跳远2-3米',
      '距离球门1-2米远',
      '距离球门2-3米以内',
      '2-3米开外',
      '2-3米范围',
      '2-3米范围内',
      '2-3米距离',
      '离门1-2米射门',
      '禁区2-3米内',
      '2-3米之内',
      '1-2米左右',
      '2-3米的距离',
      '伤缺1-3天才能复出',
      '最近2-3场比赛',
      '气温 5-8 度',
    ]),
  )('范围仍不遮：%s', expectNeutral);
});

describe('回归："后""前"和英文前缀不再误当范围', () => {
  it('落后0-2：比分和"落后"都遮住，且再遮一次不变', () => {
    const once = redact('阿森纳一度落后0-2');
    expect(once).toBe(`阿森纳一度${M}${M}${M}-${M}`);
    expect(redact(once)).toBe(once);
    expect(redact('阿森纳先落后0-1后2-1逆转')).not.toMatch(/\d/);
  });
  it.each(
    track([
      '最后2-1',
      '随后1-1',
      '然后2-1',
      '此后2-1',
      '之后2-1',
      '阿森纳之后2-1取胜',
      '切尔西先丢一球，随后2-1反超',
      '巴萨半场落后0-1，最终3-1',
      '阿森纳目前2-1领先',
      '此前2-1击败对手',
      '绝杀前2-1',
      'Torino 1-0 Genoa',
      'Lugano 2-1 Chelsea',
      'Rayo Vallecano 2-1 Real Madrid',
      'San Marino 0-5 England',
      'Inter Milano 3-1 Juventus',
      'Juventus vs Torino 2-0',
      'Real Madrid beat Rayo Vallecano 2-1',
      // 单独的 week 不算范围前缀
      'this week 2-1 win over Chelsea',
      'Last week 2-1 victory over Chelsea',
      'Week 2-1 win',
    ]),
  )('遮挡：%s', (text) => {
    expectMasked(text);
    expect(redact(text, FB)).not.toMatch(/\d-\d/);
  });
  it.each(
    track([
      'Vol. 1-3',
      'No.1-2',
      'EP 3-4',
      'Part 1-2',
      'Episode 1-2',
      '前1-3',
      '后1-3',
      '（前1-3）',
      '排名前1-3的球队',
      '积分榜后2-3',
      'Matchday 1-2',
      'Matchweek 1-2 fixtures',
      'Gameweek 1-2',
      'GW1-3赛程',
      'FPL GW1-3 推荐',
      'TOP1-3球员',
    ]),
  )('范围仍不遮：%s', expectNeutral);
});

describe('回归：比分紧贴拉丁字母队名缩写', () => {
  it('精确输出', () => {
    expect(redact('曼城3-1AC米兰')).toBe(`曼城${M}-${M}AC米兰`);
    expect(redact('蔚山HD2-1阿森纳')).toBe(`蔚山HD${M}-${M}阿森纳`);
    expect(redact('曼城3-1米兰')).toBe(`曼城${M}-${M}米兰`);
  });
  it.each(
    track([
      '国际米兰2-1AC米兰',
      '拜仁3-0RB莱比锡',
      '利物浦4-1PSV埃因霍温',
      '阿森纳2-1PSV',
      '皇马3-1PSG',
      'PSG3-0拜仁',
      '洛杉矶FC2-1迈阿密国际',
      '欧冠：曼城3-1AC米兰',
      '英超 第3轮 曼城3-1AC米兰',
      '欧冠 曼城3-1AC米兰 哈兰德梅开二度',
    ]),
  )('遮挡：%s', (text) => {
    expectMasked(text, FB);
    expect(redact(text, FB)).not.toMatch(/\d-\d/);
  });
  it.each(
    track([
      'U21-3',
      'U21-3号',
      'MD3-1',
      'A1-2',
      'B2-1',
      'GW3-4',
      'GW3-4周',
      'MD1-2轮',
      'HD1-2集',
      '4-3-3阵型AC米兰',
      '1:30:00PSG',
      '第3-4轮AC米兰',
      '内存2-4GB',
    ]),
  )('不遮挡：%s', expectNeutral);
});

describe('回归：常见中文/英文结果词', () => {
  it.each(
    track([
      '阿森纳主场失利',
      '曼联客场失利',
      '阿森纳遭遇赛季首场失利',
      '英超：阿森纳客场失利',
      '阿森纳全取三分',
      '英超第8轮 阿森纳全取三分',
      '阿森纳带走三分',
      '阿森纳收获开门红',
      '阿森纳逆袭',
      '欧冠：拜仁逆袭巴萨杀入决赛',
      '阿森纳杀入决赛',
      '阿森纳无缘决赛',
      '阿森纳双杀切尔西',
      '萨卡助攻',
      '萨卡送出助攻',
      '萨卡一传一射',
      '英超-萨卡一传一射 阿森纳全取三分',
      '萨卡收获处子球',
      '哈兰德独中四元',
      '哈兰德独中四元 曼城大胜',
      '哈兰德独进4球',
      '双方平分秋色',
      '阿森纳功亏一篑',
      'Saka goal vs Chelsea',
      'Arsenal reach the Champions League final',
      'Arsenal out of the Champions League',
      'Arsenal go top of the Premier League',
    ]),
  )('足球语境遮挡：%s', (text) => expectMasked(text, FB));
  it('足球专用词不需要语境', () => {
    expect(redact('阿森纳全取三分')).toBe(`阿森纳${M}${M}`);
    expect(redact('哈兰德独中四元')).toBe(`${M}${M}${M}`);
  });
  it.each(track(['助攻榜', '英超助攻榜', '萨卡无缘出战', 'Saka ruled out of the derby']))(
    '不遮挡：%s',
    expectNeutral,
  );
});

describe('回归：C罗/B费/J罗 这类昵称的进球提示', () => {
  it.each(
    track([
      'C罗进球',
      'C罗打进',
      'C罗头球',
      'C罗远射',
      'C罗任意球',
      'C罗攻入',
      'B费进球',
      'J罗进球',
      'J罗任意球',
    ]),
  )('整体遮住：%s', (text) => {
    expect(redact(text)).toBe(`${M}${M}${M}`);
  });
  it.each(track(['C罗进球了', 'C罗进球！', 'C罗打进第950球', '葡萄牙队C罗进球']))(
    '遮挡：%s',
    (text) => expectMasked(text),
  );
  it.each(track(['A组进球', 'B站进球集锦', 'U21进球', '小组赛A组 第2轮']))(
    '不遮挡：%s',
    expectNeutral,
  );
});

describe('回归：队名里的"胜利"', () => {
  it.each(
    track([
      '利雅得胜利 vs 利雅得新月',
      'C罗 利雅得胜利',
      '神户胜利船',
      '亚冠精英联赛：上海申花 vs 神户胜利船',
      '墨尔本胜利 vs 悉尼FC',
      'Melbourne Victory vs Sydney FC',
    ]),
  )('不遮挡：%s', expectNeutral);
  it('队名之外的"胜利"照样遮', () => {
    expect(redact('利雅得胜利 取得胜利', FB)).toBe(`利雅得胜利 取得${M}${M}`);
  });
});

describe('回归：保护词/额外词按归一化后的文字匹配', () => {
  it.each(
    track([
      'CONMEBOL–UEFA Cup of Champions',
      'CONMEBOL-UEFA Cup of Champions',
      'Finalissima: CONMEBOL–UEFA Cup of Champions',
    ]),
  )('目录里带全角/破折号的名字受保护：%s', expectNeutral);
  it('额外保护词里带破折号', () => {
    const opts = { football: true, safePhrases: ['A–B Cup Champions'] };
    expect(redact('A–B Cup Champions', opts)).toBe('A–B Cup Champions');
    expect(redact('A-B Cup Champions', opts)).toBe('A-B Cup Champions');
  });
  it('额外结果词里带全角括号', () => {
    expect(hasSpoiler('今天出了个大新闻（独家）', { extraWords: ['大新闻（独家）'] })).toBe(true);
  });
});

describe('回归：抽签新闻里的 draw', () => {
  it.each(
    track([
      'The draw for the last 16 takes place on Monday',
      'FA Cup third round draw ceremony',
      'FA Cup draw ceremony: Arsenal face Chelsea',
      'Champions League draw pots confirmed',
      'Carabao Cup quarter-final draw date confirmed',
      'Europa League draw takes place on Friday',
      'FA Cup third round draw took place on Sunday',
      'The draw for the quarter-finals',
    ]),
  )('不遮挡：%s', expectNeutral);
  it.each(
    track([
      'Arsenal draw for the third game running',
      'Liverpool salvage Champions League draw in Madrid',
      'Arsenal settle for Premier League draw at Villa',
      // 保护词要有右边界："draw in full-blooded" "draw potentially" 不是抽签
      'Arsenal and Chelsea draw in full-blooded derby',
      'Spurs and Arsenal draw in full-throttle derby',
      'Arsenal and Chelsea draw in fully deserved stalemate',
      "Arsenal's draw potentially costly in title race",
      // "the draw for the" 后面不是轮次/阶段时就是赛果
      'The draw for the Gunners means they drop to second',
      'Arsenal 1-1 Chelsea: the draw for the Gunners means they drop to second',
      // "draw in full" 也可能是整场回放，不保护
      "Watch Arsenal's 2-2 draw in full",
      'Champions League draw in full',
      // "took place" 前面是比分/德比，不是抽签
      'The 0-0 draw took place on a bitterly cold night at Anfield',
      "Sunday's 1-1 draw took place behind closed doors",
      "Arsenal and Chelsea's 2-2 draw took place in torrential rain",
      'The derby draw took place in front of 60,000 fans',
      'Arsenal 2-2 Chelsea: draw takes place amid protests',
      'Arsenal earn the draw for the third round in a row',
      'Celtic earn the draw for the group stage opener',
    ]),
  )('赛果里的 draw 照样遮：%s', (text) => {
    expectMasked(text, FB);
    expect(redact(text, FB)).not.toMatch(/draw/i);
  });
});

describe('redact 幂等：遮过的文字再遮一次不变', () => {
  it('遮掉紧贴的结果词后才露出的比分也一并遮住', () => {
    // 比分紧贴英文字母时，基本写法的边界不成立；结果词遮掉后比分才成立
    for (const text of ['切尔西0-2reach the final', '阿森纳3:1go top', 'Spurs 0-2out of the cup']) {
      const masked = redact(text, FB);
      expect(masked, text).not.toMatch(/\d/);
      expect(redact(masked, FB)).toBe(masked);
    }
    expect(redact('Liverpool go top 2-1', FB)).toBe(`Liverpool ${M}${M} ${M}-${M}`);
  });
  it.each(ALL_STRINGS)('%s', (text) => {
    for (const options of [{}, FB]) {
      const once = redact(text, options);
      expect(redact(once, options), text).toBe(once);
    }
  });
});

describe('回归：常见赛果写法补充（审计发现的漏网）', () => {
  it('带队名就有足球语境：两个队名夹着胜/负/平，以及队名 + 赛后常用词', () => {
    for (const text of track([
      '阿森纳胜切尔西',
      '曼城负利物浦',
      '热刺平维拉',
      '拜仁告捷',
      '多特蒙德败北',
      '曼联出线',
      '利物浦拿到三分',
      '阿森纳收获三分',
      '凯恩进2球',
      'Arsenal see off Chelsea',
      'Aston Villa hold Liverpool',
      'Man City ease past Burnley',
    ])) {
      expectMasked(text);
    }
    // 只遮中间的字，对阵保留
    expect(redact('阿森纳胜切尔西')).toBe(`阿森纳${M}${M}切尔西`);
    expect(redact('Arsenal see off Chelsea')).toBe(`Arsenal ${M}${M} Chelsea`);
  });

  it('需要足球语境的说法（财经、电商、篮球页面上同样的词不遮）', () => {
    for (const text of track([
      '哈兰德两球',
      '狼队垫底',
      '双方平手',
      '萨卡失点',
      '巴萨一轮游',
      '先拔头筹',
      '全场5球',
      '两队合计四球',
      '一球之差',
      '十人应战',
      'Liverpool take all three points',
      'Saka opens the scoring',
      'Rice sees red',
    ])) {
      expectMasked(text, FB);
    }
    // 没有语境时这些词不遮（"告捷"也用于销售，"出线"也用于选秀，"三分"是篮球）
    for (const text of [
      '双十一首日告捷',
      '海选出线名单',
      '先拔头筹的是国产品牌',
      '全场5球',
      '一轮游',
    ]) {
      expect(findSpoilers(text), text).toEqual([]);
    }
  });

  it('不误伤：赛前的出线形势、篮球三分、博彩玩法名、日常用法', () => {
    for (const text of track([
      '小组出线形势分析',
      '三分球命中率',
      '买了两球衣',
      '本轮两球',
      '胜平负玩法说明',
      '主胜 1.85 平 3.40 客胜 4.20',
      '阿森纳 vs 切尔西 前瞻',
      '新赛季出线名额增加到 8 个',
    ])) {
      expectNeutral(text);
    }
    // 足球页面上也不遮：三分钟、体检过关、退出按钮、转会竞争领先
    for (const text of [
      '开场三分钟',
      '牛排三分熟',
      '赛前三分之一',
      '体检过关',
      'Exit',
      'Arsenal take the lead in the race to sign him',
    ]) {
      expect(findSpoilers(text, FB), text).toEqual([]);
    }
    // 两个国家名夹着"胜"，没有足球语境时不遮（历史、政治文章）
    expect(findSpoilers('法国胜德国的那场战役')).toEqual([]);
    expect(findSpoilers('三分球命中率', FB)).toEqual([]);
    expect(findSpoilers('小组出线形势分析', FB)).toEqual([]);
    expect(findSpoilers('买了两球衣', FB)).toEqual([]);
  });
});
