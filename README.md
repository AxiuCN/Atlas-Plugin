# Atlas-Plugin / 图鉴插件

TRSS-Yunzai v3 多游戏图鉴查询插件，支持原神、星穹铁道、绝区零的关键词搜索与详情/列表渲染。数据来源于 [nanoka.cc](https://nanoka.cc/)，通过 [nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend)（git 子模块）抓取为本地 JSON。

> 角色攻略模块已迁移至独立插件 [Meta-Plugin](https://github.com/Hyposelenia-Moon/Meta-Plugin)。

> 本插件同时承担**别名基础设施**角色：合并四层别名来源（miao-plugin / ZZZ-Plugin 预设、miao 自定义、Atlas 预设、Atlas 自定义）并以只读 API 开放，其它插件可按需接入 —— 见下文「别名基础设施（对外 API）」与 [别名接入文档](docs/别名接入文档.md)。

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/AxiuCN/Atlas-Plugin.git ./plugins/Atlas-Plugin/
pnpm install --filter=Atlas-Plugin

# 首次使用需在 Bot 内发送 #图鉴初始化，自动完成：
# 1. 拉取子模块（git submodule update --init）
# 2. 安装依赖（corepack yarn install）
# 3. 全量抓取数据及图片（后台异步执行，完成后通知主人）
```

> 需要 Node.js 18+ 且启用 corepack（`corepack enable`）。

## 功能

### 图鉴查询

三款游戏通过不同前缀区分，输入关键词即可搜索：

| 前缀 | 游戏 | 示例 |
|------|------|------|
| `#` | 原神 | `#钟离`、`#和璞鸢`、`#绝缘之旗印` |
| `*` | 星穹铁道 | `*流萤`、`*但战斗还未结束` |
| `%` | 绝区零 | `%艾莲`、`%硫磺石` |

**匹配逻辑**：精确匹配 → 详情页 / 多条包含匹配 → 结果列表 / 模糊匹配（逐字）→ 结果列表。

### 子视图查询

角色可通过后缀查看专项内容（技能/命座/资料/故事/养成素材等）：

| 后缀 | 效果 | 示例 |
|------|------|------|
| `天赋` / `技能` | 角色技能详情（含参数表） | `#胡桃天赋`、`*符玄技能` |
| `命座` | 命之座 / 星魂 / 影画 | `#胡桃命座`、`%雅命座` |
| `资料` / `故事` / `语音` | 角色资料与故事语音 | `#胡桃资料` |
| `养成` / `素材` / `材料` / `升级`（含 `养成素材`/`升级素材`/`升级材料` 组合词） | 角色养成与升级素材 | `#胡桃养成素材`、`*符玄升级材料`、`%雅素材` |
| `专武` / `专`（可加修饰 `新专武` / `新专`） | 角色专武 → 对应武器/光锥/音擎页；简称与全名互通，`#温迪专武` 与 `#风神专` 都认 | `#胡桃专武`、`#丝柯克专`、`#温迪新专` |

武器/光锥/音擎/邦布页同样展示各自的升级/养成素材栏。

另有**套装后缀** `套`：`#如雷套` → 圣遗物页、`*铁卫套` → 遗器套装页、`%啄木鸟套` → 驱动盘页（按当前游戏自动选页面类型）；套装简称与常见错字别名也生效（`#翠绿套`、`#海染车磲`）。

> 专武关系来自别名表登记（miao 的 `X专武`），不是"计算"出来的：没登记的角色会回「暂未收录」；`#X专武` 取不带修饰的那把，要新的写 `#X新专武`。

### 特殊页面

触发词直接跳转对应游戏的特殊页面：

| 触发词 | 游戏 | 效果 |
|--------|------|------|
| `#成就` / `*成就` / `%成就` | 全部 | 显示全部成就列表 |
| `#深渊` / `#深境螺旋` | 原神 | 当前进行中的深境螺旋（未开放时提示） |
| `#剧诗` / `#幻想真境剧诗` | 原神 | 当前进行中的幻想真境剧诗 |
| `*混沌` / `*混沌回忆` | 星铁 | 当前进行中的混沌回忆 |
| `*末日` / `*末日幻影` | 星铁 | 当前进行中的末日幻影 |
| `*虚构` / `*虚构叙事` | 星铁 | 当前进行中的虚构叙事 |
| `%危局` / `%危局强袭战` | 绝区零 | 当前进行中的危局强袭战 |
| `%式舆` / `%式舆防卫战` | 绝区零 | 当前进行中的式舆防卫战 |

### 指定哪一期

挑战类触发词前面可以加「期修饰」，语序是 `<期修饰><挑战名>[图鉴]`：

| 写法 | 含义 |
|------|------|
| `#深渊` / `#深渊图鉴` | 当前进行中的一期 |
| `#本期深渊图鉴` / `#上期深渊图鉴` / `#下期深渊图鉴` | 相对期；**本期未开放时，上期 = 最近结束的那一期**、下期 = 最早未开的那一期 |
| `#202606剧诗图鉴` | 按**开启月份**（期在哪个月开就算哪个月） |
| `#7.1a深渊图鉴` / `#7.1深渊图鉴` | 按**开启版本** + 该版本内第几期（`a` 可省；该版本只有一期时查 `b` 会回落 `a`） |

注意：`#深渊` / `*末日` / `%危局` 这类词已被 Axiu-Plugin / ZZZ-Plugin 的战绩查询占用，**要查图鉴需加「图鉴」后缀**；纯数字开头的写法（`#202606剧诗`、`#7.1a深渊`）不会与它们冲突。

没有期覆盖当前时间时回「本期未开放」；如果连数据都停在更早的期，会补上「数据截至 YYYY-MM-DD」，跑一次 `#图鉴更新` 即可恢复。

出图的标题下方会标出这一期的身份：`第 25 期 · 7.0 版本 · 2026-08-25 → 2026-09-16`；星铁四个玩法的期没有原始日期，用锚点推算出来的会额外标「（推定）」。

### 管理指令

| 命令 | 权限 | 说明 |
|------|------|------|
| `#图鉴初始化` | master | 拉取子模块 → 安装依赖 → 全量抓取（后台异步，完成后通知主人）。自动检测上次异常中断的半成品数据 |
| `#图鉴强制初始化` | master | 跳过完整性检查，强制重新全量抓取（用于数据损坏后重建） |
| `#图鉴更新` | master | 增量更新图鉴数据（后台异步执行，完成后通知主人）。**完成通知的状态图带「本次更新」卡片**：逐游戏 `旧版本 → 新版本` + 条目增减，未变化的标「无变化」；进度/结果消息不引用原命令，一次更新只发一条结果 |
| `#图鉴状态` | 所有人 | 查看各游戏数据版本、条目数、图片下载统计 |
| `#图鉴帮助` | 所有人 | 显示全部可用指令（master 额外可见管理指令组） |
| `#图鉴别名设置 <标准名> <别名>` | master/all（可配） | 为角色/武器添加自定义别名（自动判断游戏） |
| `#图鉴别名删除 <别名>` | master/all（可配） | 删除自定义别名 |
| `#图鉴别名列表` | 所有人 | 查看当前游戏自定义别名 |

### 定时自动更新

默认每天 5:00 自动执行增量更新（仅已初始化时运行），完成后向 master 发送结果通知。包含并发锁和冷却保护，不会与手动抓取冲突。可在配置中关闭或修改 cron。

### 子模块自动同步

图鉴引擎 **Hesperides** 以 git 子模块引入（`tool/Hesperides/Hesperides`，多源采集：玉璃 alioth.wiki + nanoka）。插件启动时会自动把子模块同步到插件仓库记录的版本（gitlink），保证引擎代码与插件版本匹配：

- 更新插件（锅巴面板更新 / `git pull`）后重启 Bot，即自动完成子模块同步，无需手动执行 `git submodule update`
- 首次安装即使未运行 `#图鉴初始化`，启动时也会自动拉取子模块
- 同步失败不影响插件使用，下次启动自动重试
- 仅同步代码，数据目录 `data/` 不受影响
- 旧引擎 `nanoka-atlas-backend` 已退役：若你的插件目录里还残留它的子模块（`tool/nanoka-atlas-backend/nanoka-atlas-backend/`），启动时会连同 `.git/config` 残留段与 `.git/modules` 对象一起清掉（临时机制，计划 2026-12-31 后删除）

## 别名基础设施（对外 API）

除了图鉴查询，本插件也向其它插件提供**别名基础设施**：把四层别名来源合并成一张表（共同维护、统一归一化），以只读门面 `modules/aliasApi.js` 开放。接入后不必再自己解析上游别名文件、各建一份表、各挂一套热更新。

| 函数 | 用途 |
|------|------|
| `getAliasMap(gameId?)` | 取整表的**只读视图**（`set`/`delete`/`clear` 抛错；按版本缓存；要可变副本用 `new Map(...)`；`gameId` = `gi` / `hsr` / `zzz`） |
| `resolveAlias(name, gameId?)` | 名字 → 候选 `{ key, candidates, primary }` |
| `expandKeyword(keyword, gameId?)` | 关键词 → 检索变体（原词 + 别名） |
| `getAliasVersion()` | 表版本号，派生缓存据此失效 |
| `getAliasStatus()` | 版本 / 键数 / 条目数 / 各游戏条目数 |

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

接入约定（完整版见 [docs/别名接入文档.md](docs/别名接入文档.md)）：

1. **动态 import** 并保留降级路径；
2. **传 `gameId`**，否则跨游戏同名别名会混在一起；
3. **不要缓存副本** —— 需要长期派生数据时用 `getAliasVersion()` 判断失效；
4. **不要挂自己的别名 watcher** —— Atlas 已在监听，同时挂会重复重建。

已接入：ProfileImg-Plugin（面板图插件；门面优先 + 本地冻结兜底，见其 `docs/模块-别名.md`）。

## 配置

### 方式一：手动编辑

编辑 `config/config.yaml`：

```yaml
priority: 10000       # 优先级，数字越小越先执行
renderScale: 1.5      # 渲染缩放比例
autoUpdate:
  enabled: true       # 是否启用每日自动更新
  cron: '0 0 5 * * *' # 自动更新 cron（6字段：秒 分 时 日 月 周）
notifyGroups: []      # 更新完成后通知的群号列表，留空仅通知主人
notifyMode: 'all'     # all=全部主人+群聊 / master_only=全部主人 / first_master=第一位主人 / first_master_groups=第一位主人+群聊
```

> 首次启动时自动从 `config/config.yaml.example` 复制默认配置。

### 黑名单（可选）

`config/blacklist.yaml` 的 `patterns` 是正则列表，命中**完整消息**时图鉴完全不接管（不回复、放行给其它插件）。代码内建了 `面板`（miao 的 `#丝柯克面板 换千织专武` 这类以 `专武`/`专`/`套` 结尾的面板指令），不需要也不建议在配置里重复；该文件只放**额外**规则。首次启动会自动从 `config/blacklist.yaml.example` 复制。

### 方式二：锅巴后台

在锅巴面板中可直接可视化配置优先级、渲染缩放、自动更新开关及 cron 表达式，保存后即时生效。

## 数据维护

图鉴数据存储在 `tool/Hesperides/Hesperides/data/`（`index.json` / `periods.json` / `records/` / `imagerefs/` / `images/`），也可在子模块里手动抓取：

```bash
cd plugins/Atlas-Plugin/tool/Hesperides/Hesperides

# 只抓记录（快速，不带图片）
node src/cli.mjs --all --no-textmap --with-details

# 记录 + 图片（与 #图鉴更新 同一口径：nanoka 全量 + 玉璃终局）
node src/cli.mjs --all --no-textmap --with-details --images

# 只重建 index.json / periods.json
node src/cli.mjs --export
```

## 交流与讨论

如有问题，请加入 QQ 群 **965272093** 交流反馈。

## 鸣谢

- [nanoka.cc](https://nanoka.cc/) — 图鉴数据源
- [Hesperides](https://github.com/AxiuCN/Hesperides) — 数据抓取引擎（多源：玉璃 alioth.wiki + nanoka），以子模块引入
- [nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend) — 上一代数据引擎（已归档，`tool/nanoka-atlas-backend/README.md` 保留了迁移记录）
- [Lotus-ReFactor](https://github.com/MOPELotus/Lotus-ReFactor) — 搜索评分系统与别名机制参考

## 许可

[![GPLv3](https://www.gnu.org/graphics/gplv3-127x51.png)](https://www.gnu.org/licenses/gpl-3.0.html)

本项目采用 [GPL-3.0](./LICENSE) 许可证。
