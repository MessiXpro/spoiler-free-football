// 全网防剧透模式注入时先运行：告诉 content.js 这是后台注入的全网脚本（没有站点规则时只做通用文字识别；下载来的规则里已有本站时仍按站点模式）
(globalThis as unknown as { __sffGlobal?: boolean }).__sffGlobal = true;
