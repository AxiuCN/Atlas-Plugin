# Atlas-Plugin / 图鉴插件

TRSS-Yunzai v3 多游戏图鉴查询插件，支持原神、星穹铁道、绝区零的关键词搜索与详情/列表渲染。数据来源于 [nanoka.cc](https://nanoka.cc/)，通过 [nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend)（git 子模块）抓取为本地 JSON。

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

武器/光锥/音擎/邦布页同样展示各自的升级/养成素材栏。

### 特殊页面

触发词直接跳转对应游戏的特殊页面：

| 触发词 | 游戏 | 效果 |
|--------|------|------|
| `#成就` / `*成就` / `%成就` | 全部 | 显示全部成就列表 |
| `#深渊` / `#深境螺旋` | 原神 | 最新一期深境螺旋详情 |
| `#剧诗` / `#幻想真境剧诗` | 原神 | 最新一期幻想真境剧诗详情 |
| `*混沌` / `*混沌回忆` | 星铁 | 最新一期混沌回忆详情 |
| `*末日` / `*末日幻影` | 星铁 | 最新一期末日幻影详情 |
| `*虚构` / `*虚构叙事` | 星铁 | 最新一期虚构叙事详情 |
| `%危局` / `%危局强袭战` | 绝区零 | 最新一期危局强袭战详情 |
| `%式舆` / `%式舆防卫战` | 绝区零 | 最新一期式舆防卫战详情 |

### 管理指令

| 命令 | 权限 | 说明 |
|------|------|------|
| `#图鉴初始化` | master | 拉取子模块 → 安装依赖 → 全量抓取（后台异步，完成后通知主人）。自动检测上次异常中断的半成品数据 |
| `#图鉴强制初始化` | master | 跳过完整性检查，强制重新全量抓取（用于数据损坏后重建） |
| `#图鉴更新` | master | 增量更新图鉴数据（后台异步执行，完成后通知主人） |
| `#图鉴状态` | 所有人 | 查看各游戏数据版本、条目数、图片下载统计 |
| `#图鉴帮助` | 所有人 | 显示全部可用指令（master 额外可见管理指令组） |
| `#图鉴别名设置 <标准名> <别名>` | master/all（可配） | 为角色/武器添加自定义别名（自动判断游戏） |
| `#图鉴别名删除 <别名>` | master/all（可配） | 删除自定义别名 |
| `#图鉴别名列表` | 所有人 | 查看当前游戏自定义别名 |

### 定时自动更新

默认每天 5:00 自动执行增量更新（仅已初始化时运行），完成后向 master 发送结果通知。包含并发锁和冷却保护，不会与手动抓取冲突。可在配置中关闭或修改 cron。

### 子模块自动同步

图鉴引擎 `nanoka-atlas-backend` 以 git 子模块引入。插件启动时会自动将子模块同步到插件仓库记录的版本（gitlink），保证引擎代码与插件版本匹配：

- 更新插件（锅巴面板更新 / `git pull`）后重启 Bot，即自动完成子模块同步，无需手动执行 `git submodule update`
- 首次安装即使未运行 `#图鉴初始化`，启动时也会自动拉取子模块
- 同步失败不影响插件使用，下次启动自动重试
- 仅同步代码，数据目录 `data/` 不受影响

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

### 方式二：锅巴后台

在锅巴面板中可直接可视化配置优先级、渲染缩放、自动更新开关及 cron 表达式，保存后即时生效。

## 数据维护

图鉴数据存储在 `tool/nanoka-atlas-backend/nanoka-atlas-backend/data/`，可通过子模块手动管理：

```bash
cd plugins/Atlas-Plugin/tool/nanoka-atlas-backend/nanoka-atlas-backend

# 仅更新 JSON（不含图片，快速）
node src/scrape.mjs --game gi,hsr,zzz --locales zh --no-images

# 全量抓取（含图片，耗时）
node src/scrape.mjs --game gi,hsr,zzz --locales zh

# 查看可用版本
corepack yarn versions
```

## 交流与讨论

如有问题，请加入 QQ 群 **965272093** 交流反馈。

## 鸣谢

- [nanoka.cc](https://nanoka.cc/) — 图鉴数据源
- [nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend) — 数据抓取引擎，以子模块引入
- [Lotus-ReFactor](https://github.com/MOPELotus/Lotus-ReFactor) — 搜索评分系统与别名机制参考

## 许可

本项目是 [AxiuCN/Atlas-Plugin](https://github.com/AxiuCN/Atlas-Plugin) 的 **fork**，
遵循上游的 **GNU 通用公共许可证第 3 版（GPL-3.0）**。

- **上游协议事实**：上游仓库 `AxiuCN/Atlas-Plugin` 的 `LICENSE` 是 GPL-3.0 全文（674 行），
  随上游初始提交（`0d65738`）引入，位于上游 `master` 分支：`git show upstream/master:LICENSE`。
  上游 `package.json` 没有 `license` 字段，上游 README 也没有许可章节。
- 本仓库根目录的 [`LICENSE`](LICENSE) 与上游 `LICENSE` **逐字节一致**
  （git blob 同为 `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7`），未做任何改动。
  本仓库仅按该文件在 `package.json` 中补记 `"license": "GPL-3.0-only"`。
- 上游的 `LICENSE` 是标准 GPLv3 文本，且未声明「or any later version」，
  因此按 **GPL-3.0（仅第 3 版）** 理解与再分发。

### 本 fork 相对上游的修改

- 新增「角色攻略」页面：读取配套数据仓库
  [Character-Codex-Data](https://github.com/Hyposelenia-Moon/Character-Codex-Data)，
  支持 `#角色攻略` / `#角色指南` 查询，单列长图排版，并接入结构化 v2 数据（用图鉴图标取图、文本行回退）
- 数据同步：`#图鉴初始化` / `#图鉴更新` 中并入攻略仓库的初始化 / 更新步骤，并明确提示同步结果
- 渲染调整：配队成员改用角色头像（不显示名字）、攻略页接入图鉴图标、可选行与空栏位不渲染、
  米三家武器精炼合并为一段显示等
- 完整的修改清单与日期见本仓库 git 提交历史（GPL-3.0 第 5(a) 条要求的修改声明）

以上修改同样以 GPL-3.0 授权。上游版权归上游作者 **阿修Axiu（AxiuCN）** 所有；
本 fork 修改部分的版权归本仓库维护者所有。

> 本项目为非官方第三方插件，与 米哈游 / HoYoverse 无隶属或合作关系；
> 《原神》《崩坏：星穹铁道》《绝区零》等游戏的相关名称、图标与数据版权归其权利人所有。
> 图鉴数据来源于 [nanoka.cc](https://nanoka.cc/)，相关权利归原数据提供方。
> 若本 README 与 [`LICENSE`](LICENSE) 有任何冲突，以 `LICENSE` 为准。
