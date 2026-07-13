# Atlas-Plugin / 图鉴插件

TRSS-Yunzai v3 多游戏图鉴查询插件，支持原神、星穹铁道、绝区零的关键词搜索与详情/列表渲染。数据来源于 [nanoka.cc](https://nanoka.cc/)，通过 [nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend)（git 子模块）抓取为本地 JSON。

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/AxiuCN/Atlas-Plugin.git ./plugins/Atlas-Plugin/
pnpm install --filter=Atlas-Plugin

# 首次使用需在 Bot 内发送 #图鉴初始化，即可自动完成：
# 1. 拉取子模块（git submodule update --init）
# 2. 安装依赖（corepack yarn install）
# 3. 首次抓取数据及图片（耗时较长，请耐心等待）
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
| `#图鉴初始化` | master | 拉取子模块 → 安装依赖 → 首次抓取（两阶段，漫长） |
| `#图鉴更新` | master | 增量更新图鉴数据（异步后台执行，完成后通知主人） |
| `#图鉴状态` | 所有人 | 查看各游戏数据版本、条目数、图片下载统计 |
| `#图鉴帮助` | 所有人 | 显示全部可用指令（master 额外可见管理指令组） |

### 定时自动更新

默认每天 5:00 自动执行增量更新（仅已初始化时运行），完成后向 master 发送结果通知。可在配置中关闭或修改 cron。

## 配置

### 方式一：手动编辑

编辑 `config/config.yaml`：

```yaml
priority: 10000       # 优先级，数字越小越先执行
renderScale: 1.5      # 渲染缩放比例
autoUpdate:
  enabled: true       # 是否启用每日自动更新
  cron: '0 0 5 * * *' # 自动更新 cron（6字段：秒 分 时 日 月 周）
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
