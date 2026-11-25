# Atlas-Plugin / 图鉴插件

TRSS-Yunzai v3 多游戏图鉴查询插件，支持原神、星穹铁道、绝区零的关键词搜索与详情/列表渲染。数据由 [Hesperides](https://github.com/AxiuCN/Hesperides)（git 子模块）从 nanoka.cc、玉璃 alioth.wiki、月亮网 lunaris.moe、强度研究院 gensri.wiki 多源采集后转成本地 JSON，运行期纯文件读取。

> 角色攻略模块已迁移至独立插件 [Meta-Plugin](https://github.com/Hyposelenia-Moon/Meta-Plugin)。本插件同时承担**别名基础设施**角色，向其它插件提供只读别名 API（见下文）。

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/AxiuCN/Atlas-Plugin.git ./plugins/Atlas-Plugin/
pnpm install --filter=Atlas-Plugin
```

装好后在 Bot 内发送 **`#图鉴初始化`**（master），自动同步子模块并全量抓取数据与图片（后台异步，完成后通知主人）。需要 Node.js 20+。

## 使用

三款游戏用不同前缀：

| 前缀 | 游戏 | 示例 |
|------|------|------|
| `#` | 原神 | `#钟离`、`#和璞鸢`、`#绝缘之旗印` |
| `*` | 星穹铁道 | `*流萤`、`*但战斗还未结束` |
| `%` | 绝区零 | `%艾莲`、`%硫磺石` |

- **子视图**：角色可加 `天赋` / `命座` / `资料` / `养成素材` 等后缀；`专武`（可简写 `专`）落在对应武器页；`套` 落在当前游戏的套装页。
- **特殊页面**：`#成就`、`#深渊`、`#剧诗`、`*混沌`、`*末日`、`*虚构`、`%式舆`、`%危局` 直接出当前进行中的一期。
- **指定期数**：前缀可加 `本期` / `上期` / `下期`，或按月份（`#202606剧诗图鉴`）、按版本（`#7.1a深渊图鉴`）。`#深渊` 这类词被战绩插件占用，查图鉴时加「图鉴」。

## 管理指令

| 命令 | 权限 | 说明 |
|------|------|------|
| `#图鉴初始化` | master | 同步子模块并全量抓取（后台异步，完成后通知主人） |
| `#图鉴强制初始化` | master | 跳过完整性检查，强制重新全量抓取 |
| `#图鉴更新` | master | 增量更新（后台异步），完成后发一张带「本次更新」卡片的状态图 |
| `#图鉴状态` / `#图鉴版本` | 所有人 | 各游戏版本（含测试服解析）、引擎与数据库状态、条目数与图片统计 |
| `#图鉴帮助` | 所有人 | 可用指令一览 |
| `#图鉴别名设置` / `删除` / `列表` | 可配 | 自定义别名管理 |

## 配置

`config/config.yaml`（首次启动自动从 `.example` 复制）：

```yaml
priority: 10000       # 优先级，数字越小越先执行
renderScale: 1.5      # 渲染缩放比例
autoUpdate:
  enabled: true       # 每日自动增量更新
  cron: '0 0 5 * * *'
notifyGroups: []      # 更新完成通知的群号，留空只通知主人
notifyMode: 'all'     # all / master_only / first_master / first_master_groups
```

也可在锅巴面板可视化修改。抓取重试与超时、全量兜底、图片去重、别名权限等高级项见 `config/config.yaml.example`；`config/blacklist.yaml` 可追加不接管的消息正则（内建 `面板`、`sl`、`napcat`）。

## 数据

数据存在 `tool/Hesperides/Hesperides/data/`，子模块随启动自动同步到插件记录的版本。需要手动抓时可进入该目录：

```bash
node src/cli.mjs --all --no-textmap --with-details            # 只抓 JSON
node src/cli.mjs --all --no-textmap --with-details --images   # 记录 + 图片
node src/cli.mjs --export                                     # 只重建 index.json / periods.json
```

## 别名基础设施（对外 API）

除了图鉴查询，本插件也向其它插件提供**别名基础设施**：把四层别名来源合并成一张表（共同维护、统一归一化），以只读门面 `modules/aliasApi.js` 开放。接入后不必再自己解析上游别名文件、各建一份表、各挂一套热更新。：

| 函数 | 用途 |
|------|------|
| `getAliasMap(gameId?)` | 整表只读视图（按版本缓存） |
| `resolveAlias(name, gameId?)` | 名字 → 候选 `{ key, candidates, primary }` |
| `expandKeyword(keyword, gameId?)` | 关键词 → 检索变体 |
| `getAliasVersion()` / `getAliasStatus()` | 表版本号 / 统计 |

```js
// 动态 import + 降级：Atlas 是可选依赖，静态 import 会让未安装它的机器整插件加载失败
let aliasApi = null
try {
  aliasApi = await import('../../Atlas-Plugin/modules/aliasApi.js')
} catch {
  logger?.warn('[YourPlugin] Atlas 别名门面不可用，使用本地兜底')
}

const hit = aliasApi?.resolveAlias(userInput, gameId)   // 未命中 / 不可用时 primary 为 null
const target = hit?.primary || userInput
```

## 文档索引

| 想了解 | 文档 |
|---|---|
| 命令与后缀全集、期数规则、special 触发 | [docs/功能与命令.md](docs/功能与命令.md) |
| 数据引擎、抓取范围、图片策略 | [docs/数据源与后端.md](docs/数据源与后端.md) |
| 搜索评分、角色页 / 素材口径 | [docs/数据-搜索与角色.md](docs/数据-搜索与角色.md) |
| 武器 / 圣遗物 / 怪物 / 邦布口径 | [docs/数据-装备与敌人.md](docs/数据-装备与敌人.md) |
| 本地补丁层、版本更新记录 | [docs/数据-路由补丁与别名.md](docs/数据-路由补丁与别名.md) |
| 别名 API 与接入示例 | [docs/别名接入文档.md](docs/别名接入文档.md) |
| 目录分层、数据流、模板路由 | [docs/架构.md](docs/架构.md) |
| 回归套件与贡献流程 | [docs/测试.md](docs/测试.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| 待办与已知问题 | [docs/待办与规划.md](docs/待办与规划.md) |

## 交流与讨论

如有问题，请加入 QQ 群 **[965272093](https://qm.qq.com/q/dfJxRWhZgk)** 交流反馈。

## 鸣谢

- [赫斯珀里得斯 Hesperides](https://github.com/AxiuCN/Hesperides) — 数据抓取引擎（多源：nanoka.cc 、玉璃 alioth.wiki 、月亮网 lunaris.moe 、强度研究院 gensri.wiki），以子模块引入
- [nanoka.cc](https://nanoka.cc/) — 数据源之一，覆盖原神 / 星铁 / 绝区零全部页面
- [玉璃 alioth.wiki](https://alioth.wiki/) — 数据源之一，提供原神 / 星铁终局期与期时间
- [月亮网 lunaris.moe](https://lunaris.moe/) — 数据源之一，提供原神深境螺旋、幻想真境剧诗数据
- [强度研究院 gensri.wiki](https://www.gensri.wiki/) — 数据源之一，提供原神幽境危战期表、详情和图片。[幽境危战](https://www.gensri.wiki/985/)
- [nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend) — 上一代数据引擎（已归档，`tool/nanoka-atlas-backend/README.md` 保留了迁移记录）
- [Lotus-ReFactor](https://github.com/MOPELotus/Lotus-ReFactor) — 搜索评分系统与别名机制参考

## 许可

[![GPLv3](https://www.gnu.org/graphics/gplv3-127x51.png)](https://www.gnu.org/licenses/gpl-3.0.html)

本项目采用 [GPL-3.0-only](./LICENSE) 许可证。