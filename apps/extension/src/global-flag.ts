// 全网防剧透模式注入时先运行：告诉 content.js 这里没有站点规则，只做通用文字识别
(globalThis as unknown as { __sffGlobal?: boolean }).__sffGlobal = true;
