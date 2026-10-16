# 测试用的真实接口样本（fixtures）

这些文件用于 adapter 的离线测试和示例数据生成。来源与真实程度：

| 文件 | 来源 | 真实程度 |
|---|---|---|
| `openfootball/en.1-2026-27.json`、`es.1-2026-27.json` | 2026-10-16 在云端直接下载 `raw.githubusercontent.com/openfootball/football.json/master/2026-27/` | 原样（byte-for-byte） |
| `openfootball/worldcup-2026.subset.json` | `openfootball/worldcup.json/master/2026/worldcup.json` | 真实数据，只保留 3 场 |
| `football-data/matches-2026-10-13.json`、`edgecases.json`、`pl-matches.json` | 公开 GitHub 仓库里用免费 Key 定时抓取并提交的 football-data.org v4 响应（2026-10-16） | 真实数值，记录者删掉了 area/season/odds/referees 等字段 |
| `football-data/match-330299.docs.json` | football-data.org 官方文档示例 | 官方示例 |
| `thesportsdb/*.json`（不带 subset） | 公开 GitHub 仓库里用免费 Key `123` 录制的 TheSportsDB v1 响应（2026-10-05） | 原样 |
| `thesportsdb/eventsday-2026-10-04-edgecases.subset.json` | 同上 | 真实数据，只保留部分条目 |
| `api-football/fixtures-bl1.json` | 公开 GitHub 仓库里录制的 API-Football `/fixtures` 响应 | 真实数值，部分字段被记录者删减 |
| `api-football/fixtures-live.docs.json` | API-Football 官方 OpenAPI 文档示例 | 官方示例 |

云端环境只能访问 GitHub，所以 football-data.org、TheSportsDB、API-Football 的样本是别人录下的真实响应，
不是在本仓库里直接请求得到的；这三个来源需要在 GitHub Actions（或用户本地）里用真实 Key 做一次实际验证。
