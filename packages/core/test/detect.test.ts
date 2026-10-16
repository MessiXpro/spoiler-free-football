import { describe, expect, it } from 'vitest';
import { findSpoilers, hasSpoiler, isFootballText, redact, MASK_CHAR } from '../src/index.ts';

/** 遮挡后不应再残留任何比分写法和结果词 */
function expectClean(masked: string) {
  expect(hasSpoiler(masked, { football: true }), `残留剧透：${masked}`).toBe(false);
}

describe('比分写法（中文标题）', () => {
  const cases = [
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
  ];
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
  const cases = [
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
  ];
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
  const cases = [
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
  ];
  it.each(cases)('遮挡：%s', (text) => {
    expect(findSpoilers(text).length, text).toBeGreaterThan(0);
    expectClean(redact(text));
  });
});

describe('结果词（英文）', () => {
  const cases = [
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
  ];
  it.each(cases)('遮挡：%s', (text) => {
    expect(findSpoilers(text).length, text).toBeGreaterThan(0);
    expectClean(redact(text));
  });
});

describe('不误伤：中性写法', () => {
  const cases = [
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
  ];
  it.each(cases)('不遮挡：%s', (text) => {
    expect(findSpoilers(text), text).toEqual([]);
    expect(redact(text)).toBe(text);
  });
});

describe('语境词只在足球语境中遮挡', () => {
  it.each([
    'We won the hackathon',
    'Weight loss tips',
    '今天天气很好，我们领先一步',
    'Lewis Hamilton takes the title',
    'Best header images for your blog',
  ])('非足球文字不遮：%s', (text) => {
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
    const text = '英超第7轮：阿森纳 2-1 切尔西，萨卡破门，阿森纳逆转取胜';
    const masked = redact(text);
    expect(masked.startsWith('英超第7轮：阿森纳')).toBe(true);
    expect(masked).toContain('切尔西');
    expectClean(masked);
  });
});
