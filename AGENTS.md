# AGENTS.md

This file provides project-level guidance to AI coding agents (DSH / Claude Code) when working with code in this repository.

## 项目概况

Atlas-Plugin — TRSS-Yunzai v3 多游戏图鉴查询插件（原神 `#` / 星铁 `*` / 绝区零 `%`），ESM（`"type": "module"`），GPL-3.0-only。数据引擎是 git 子模块 `tool/nanoka-atlas-backend/`（fork），把 nanoka.cc 抓成本地 JSON + 图库，运行期**纯文件读取**：不走网络、不依赖 Redis。

- **单入口**：`index.js` → 配置初始化 → 启动编排（`model/startup.js`）→ `Promise.allSettled` 载入 `apps/*.js`
- **分层**：`apps/`（事件绑定）→ `modules/`（业务编排）→ `model/`（数据访问）→ `components/`（共享件与 sections builder）→ `resources/`（模板与样式）；细节见 [`docs/架构.md`](docs/架构.md)
- **回归套件**：`pnpm test`（= `node test/run.mjs`，任意 cwd 可跑，缺前置打印「跳过」并 exit 0），当前 17 套件
- **别名基础设施**：`modules/aliasApi.js` 对其它插件提供只读别名查询（四层来源合并 + 统一归一化 + 版本号），接入方见 [`docs/别名接入文档.md`](docs/别名接入文档.md)（已接入：ProfileImg-Plugin）
- **Bot 侧命令**：`cd app && node .`（前台）/ `node . dev`（开发模式）/ `node . stop`
- **数据准备**：`#图鉴初始化`（拉子模块 → 装依赖 → 全量抓取，后台异步）；只想抓 JSON 见 [`docs/数据源与后端.md`](docs/数据源与后端.md)

> **迁移说明**：角色攻略模块已剥离至独立插件 [Meta-Plugin](https://github.com/Hyposelenia-Moon/Meta-Plugin)（1.1.0）——本插件不再收录攻略页、攻略数据仓库同步与 `codex.enabled` 配置。

### 快速参考

| 功能 | 入口（优先级） | 触发 | 说明 |
|------|---------------|------|------|
| 关键词查询 | `apps/atlas.js`（~10000） | `#` / `*` / `%` + 关键词 | 搜索 → 加载条目 → builder → 模板 → 出图 |
| 后缀抢占 | `apps/atlasShortcut.js`（-99999） | 子视图 / 页面类型后缀 | 先于 miao 拦截 `#xxx图鉴` 类查询 |
| 别名管理 | `apps/alias.js`（8000） | `#图鉴别名设置` / `#图鉴别名删除` / `#图鉴别名列表` | 双闸权限（rule master + `config.yaml → alias.*`） |
| 版本更新记录 | `apps/updateLog.js`（9000） | `#版本更新记录` / `#变更项目` / `#新版本改动` | 必须早于常规查询 |
| 状态 / 帮助 / 管理 | `apps/status.js` · `apps/help.js` · `apps/admin.js` | `#图鉴状态` / `#图鉴帮助` / `#图鉴初始化` / `#图鉴强制初始化` / `#图鉴更新` / `#图鉴补丁` | 管理指令 master |
| 定时任务 | `apps/admin.js` | 每日 5:00 | 版本检查 → 增量 → 重试 → 全量兜底 → diff 抓取 |

子视图（7 种）、页面类型后缀（3 种）、special 触发与怪物页后缀的完整清单见 [`docs/功能与命令.md`](docs/功能与命令.md)。

## 文档索引（按需阅读，别一次全读）

| 想了解 / 要改的东西 | 先读 |
|---|---|
| 目录结构、分层职责、模板路由、数据流、配置三层、启动编排 | [`docs/架构.md`](docs/架构.md) |
| 命令与后缀全集、子视图、special 触发、支持范围与数据完整性 | [`docs/功能与命令.md`](docs/功能与命令.md) |
| 数据引擎：子模块路径、抓取命令、图片策略、抓取锁 | [`docs/数据源与后端.md`](docs/数据源与后端.md) |
| 搜索评分与索引、进程内缓存契约、角色页口径、技能参数表、素材口径与排序 | [`docs/数据-搜索与角色.md`](docs/数据-搜索与角色.md) |
| 武器 / 圣遗物 / 怪物 / 邦布 四类页面的数据口径 | [`docs/数据-装备与敌人.md`](docs/数据-装备与敌人.md) |
| 本地补丁层、别名系统、版本更新记录 | [`docs/数据-路由补丁与别名.md`](docs/数据-路由补丁与别名.md) |
| 别名对外 API 与其它插件接入指南（本插件即别名基础设施） | [`docs/别名接入文档.md`](docs/别名接入文档.md) |
| 回归套件的命令、前置、规范 | [`docs/测试.md`](docs/测试.md) |
| 套件清单与逐套覆盖 | [`test/AGENTS.md`](test/AGENTS.md)（进入 `test/` 时自动加载）、[`test/README.md`](test/README.md) |
| 待办、ATLAS 审计登记、长期观察项 | [`docs/待办与规划.md`](docs/待办与规划.md) |
| 盘符、部署机、本机工作区（**不入库**） | `docs/private/`（新克隆上不存在） |

## 约定

1. **ESM** — 全部 `import` / `export`，不用 `require`
2. **日志** — `logger?.info/warn/error`，标签统一 `[Atlas]`（模块内可加 `[Atlas][Updater]` 这类）；**没有 `logger?.debug`**（框架等级是 info，debug 等于不输出）；调试日志排查时临时加、**验证完必须还原**
3. **中文** — 注释、`name` / `dsc`、用户可见文案一律简体中文
4. **优先级**（数值越小越先执行）— `atlasShortcut -99999` < `alias 8000` < `updateLog 9000` < `atlas ~10000`
5. **未匹配必须放行** — 返回 `false`，不回复、不影响其他插件（`#胡桃圣遗物` 这类要原样交给 miao-plugin）
6. **容错与配置** — `index.js` 用 `Promise.allSettled` 容错加载；配置一律走 `components/config.js` 的 `getPluginConfig()`（三层兜底 + `deepMerge`）；锅巴 field 用点分路径、defSet 用下划线变量
7. **import 路径** — 同目录 `./`、同层 `../`、跨层 `../../<dir>/`；不写盘符绝对路径
8. **文档入库范围** — `AGENTS.md` 与 `docs/`（除 `docs/private/`）**入库**，与代码一同评审提交；`docs/private/` 放盘符、部署机与本机工作区，**不入库**，因此入库文档只写占位（`<插件根>` / `<bot根>` / `<文档站根>`）且**不得依赖**它（新克隆上没有）；`CLAUDE.md` / `.claude/` / `.dsh/` 仍忽略
9. **文档必须同步** — 功能 / 命令 / 配置变更时同批更新：`docs/` 对应册、`README.md`（面向使用者）、本文件（快速参考）、`test/AGENTS.md`（套件表）、文档站 `guide/yunzai/plugins/Atlas-Plugin.md`
10. **不擅自扩大改动** — 数据口径与契约类改动先给方案再动手；[`docs/待办与规划.md`](docs/待办与规划.md) 里标 **DEFERRED / 不得重开** 的条目按原结论执行

## 硬约束速查（改前必读；细节见各册）

1. **行尾** — `.gitattributes` 是 `* text=auto eol=lf`，Windows 工作副本显示 CRLF：**不要整文件重写/格式化**（会产出全文件 diff），只改必要的行
2. **art-template 4.x 没有注释语法** — `resources/atlas/*.html` 里写 `{{* 注释 *}}` 会让模板**编译失败**（用户只看到一句「渲染失败」）；要写说明就用 HTML 注释
3. **模板必须保留 `<body style="zoom:{{renderScale}}">`** — 删掉会让 `renderScale` 静默失效（输出尺寸不再缩放）
4. **子模块不可手改** — `tool/nanoka-atlas-backend/**` 会在 `#图鉴更新` 时整体覆盖；数据修正一律走 `resources/patch/**`（条目 / 图片 / 索引三层）
5. **缓存只在 `reloadIndex()` 或重启后失效** — 改补丁、改数据、改 `resources/data/*` 后，进程内缓存不会自己更新
6. **抓取锁是原子创建** — `data/_scraping.lock` 用 `flag: 'wx'`；不要退回 `existsSync → writeFileSync` 两步（有并发双进窗口）
7. **entry shape 不是公开契约**（ATLAS-026 / 决策 D1）— 消费侧只读自己需要的字段，别把 `{...entry}` 当稳定接口
8. **渲染尺寸随 `renderScale`** — 改它会直接改变所有图的像素尺寸与体积（默认 1.5 → 900×4340 / 639 KB）
9. **攻略后缀已移除** — `#<角色>攻略` / `指南` 不再由图鉴接管；未安装 Meta-Plugin 时这类查询会按普通关键词落到角色页
10. **断言必须能真的失败** — 新增套件应临时还原被修的代码确认转红，再恢复后入库

## 测试

回归套件在 `test/`（**入仓库**）：`pnpm test`（= `node test/run.mjs`，任意 cwd 可跑，缺前置打印「跳过」并 exit 0），当前 **17 套件**。

```bash
cd plugins/Atlas-Plugin
pnpm test                     # 全量
pnpm test -- --list           # 只列套件
pnpm test -- --filter=cache   # 只跑文件名含 cache 的
```

约定：命名 `<主题>.test.mjs`（写被测行为，不用 `check-` / `stage` 历史前缀）；路径一律经 `test/_helper.mjs` 推导（**任意 cwd 可跑**，禁止裸相对字面量与盘符）；**缺前置打印「跳过」并 exit 0**（图鉴数据 / 浏览器 / git 替身三类）；临时产物只写 `test/.test-tmp/`（gitignore），确需临时改 `config/config.yaml` 的**必须按原字节还原**。

套件清单与逐套覆盖见 [`test/AGENTS.md`](test/AGENTS.md)（进入 `test/` 时自动加载）；工程侧细节见 [`docs/测试.md`](docs/测试.md) 与 [`test/README.md`](test/README.md)。

## 待办（摘要）

- **临时机制到期清理（2026-12-14）**：`model/startup.js` 的 `cleanupLegacyCodexDir()` 与 `index.js` 里的调用 —— 启动时清除攻略剥离前遗留的 `tool/Character-Codex-Data/`，**保留两个月后连同调用点与 `test/startup-lifecycle.test.mjs` 的 G 节一起删除**
- 数据缺口与增强项（素材经验口径、武器 / 圣遗物故事正文不在数据源内、怪物数据缺口 …）、ATLAS 架构审计登记（`ATLAS-015`/`023`/`025`/`026`/`027`）与长期观察项（`OBS-J2`/`OBS-J3`）：见 [`docs/待办与规划.md`](docs/待办与规划.md)
