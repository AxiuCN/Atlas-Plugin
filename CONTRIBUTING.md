# 贡献指南（Contributing to Atlas-Plugin）

感谢愿意为本插件出力。本文覆盖环境准备、目录分层、代码约定、已知坑、测试规范与 PR 流程。

- 有问题先来 QQ 群 **965272093**，或在 GitHub 开 Issue。
- 提交即表示同意以 **GPL-3.0-only** 许可发布你的贡献。

---

## 1. 环境准备

| 项 | 要求 |
|----|------|
| Node.js | **18+**（本项目在 Node 24 上开发） |
| 包管理 | pnpm（机器人框架用 pnpm workspace 管理插件）；子模块抓取用 corepack + yarn 4 |
| corepack | `corepack enable` |
| 系统 | Windows / Linux 均可（本插件主要在 Windows 下开发） |

```bash
# 在 Yunzai 根目录
git clone --depth=1 https://github.com/AxiuCN/Atlas-Plugin.git ./plugins/Atlas-Plugin/
pnpm install --filter=Atlas-Plugin
```

**数据不是仓库的一部分**：图鉴数据来自 git 子模块 `tool/nanoka-atlas-backend/nanoka-atlas-backend`，条目 JSON 与图片都由抓取产生。首次使用：

- 在 Bot 内发 `#图鉴初始化`（自动：拉子模块 → 装依赖 → 全量抓取，后台异步）；或
- 手动抓（只要 JSON 最快）：

```bash
cd plugins/Atlas-Plugin/tool/nanoka-atlas-backend/nanoka-atlas-backend
node src/scrape.mjs --game gi,hsr,zzz --locales zh --no-images   # 仅 JSON
node src/scrape.mjs --game gi,hsr,zzz --locales zh              # 含图片（耗时）
corepack yarn versions                                          # 查看可用版本
```

> 测试套件在**缺少前置时自动跳过**（打印 `⏭ 跳过：原因` 并 exit 0）。若你看到大量「跳过」，说明图鉴数据 / 攻略仓库 / 浏览器还没就绪——**跳过不等于通过**，请先把数据准备好再判断自己的改动。

---

## 2. 目录结构与分层

```
Atlas-Plugin/
├── index.js          # 单入口：配置 → 子模块同步 + 预加载索引 → Promise.allSettled 载入 apps/*.js
├── apps/             # 事件绑定（命令注册处）：atlasShortcut / atlas / admin / alias / status / help / updateLog
├── modules/          # 业务编排：atlasQuery（查询主流程）· codexQuery（角色攻略页）
├── model/            # 数据访问：AtlasService（搜索/索引/记录读取）· AtlasRepository（记录与缓存）
│                     # AliasLoader · CustomAlias · LinkResolver · MiaoParams · AtlasUpdater · VersionDiff
│                     # itemIndex/ · monsterIndex/ · codexIndex/
├── components/       # 可复用件：config · constants · render · queryUtils · protagonist · patch · util
│   └── sections/     # 页面数据构建器：character | weapon | relic | monster | bangboo | item
├── resources/        # 模板与静态资源：atlas/*.html（15 个模板）· common/*.css + font/ + image/
│                     #   · alias/ · patch/ · data/ · help/
├── config/           # config.yaml.example（入库）+ config.yaml / alias/（运行时，git-ignored）
├── defSet/ + guoba/  # 锅巴配置模板与 schema
├── test/             # 回归套件（入库）
└── tool/             # nanoka-atlas-backend（子模块）· Character-Codex-Data（攻略数据 clone，git-ignored）
```

### 新文件放哪里：四步判据

1. **看 import**：import 了 `../../model/` → 放 `modules/` 或 `apps/`；只用 node 内置模块和常量 → 放 `model/`
2. **一句话描述**：说「读 X 返回 Y」就够了 → `model/`；要说「先…再…」→ `modules/`
3. **谁发请求**：自己发且不做别的 → `model/`；自己不发而是调别人 → `modules/`
4. **有无可变状态**：管理锁、定时器、跨操作配置 → `modules/`；最多持有缓存或超时 → `model/`

其它约定：

- `apps/` 每个文件导出**一个** class（注册命令/定时任务），业务逻辑不写在这里
- `components/` 是给各层共用的（渲染、配置读取、常量、工具）；页面段构建器一律放 `components/sections/`
- **import 路径**：同目录 `./`、同层 `../`、跨层 `../../<dir>/`

### 样式与组件准入（先查共享词汇，再决定是否新造）

页面里"再新造一套"的成本远高于复用，留下的平行件又很难再收口。动手前做三件事：

1. **先查共享词汇表**——下面这些各页面已经在用，能套就别新写（完整清单直接搜那四个共享 CSS 文件）：

   | 需求 | 用哪个 | 定义处 |
   |------|--------|--------|
   | 标签 + 值两列 | `.detail-table`（`.label` / `.value`） | `components.css` |
   | 数值格（属性 / 等级面板） | `.stat-grid` / `.stat-cell`（`.stat-label` / `.stat-value`） | `components.css` |
   | 键值元信息行 | `.meta-row` / `.meta-item`（`.mlabel`） | `components.css` |
   | 段落标题 | `.section-title`（`.section-title-text`） | `components.css` |
   | 白底卡片容器 | `.white-card` | `components.css` |
   | 技能卡与参数表 | `.skill-card` / `.skill-header` / `.skill-tag` / `.skill-params` | `components.css` |
   | 描述正文块 | `.desc-block` | `components.css` |
   | 数据标注（`<u>` / `<i>`） | `.kw` / `.note` | `components.css` |
   | 素材格 | `.material-grid` / `.material-card` | `detail.css` |
   | 页头（大图 / 立绘 / 遮罩 / 标题 / 小方框） | `.hero` 框架 | `hero.css` |

2. **页面专属样式只进该页的 CSS**：`resources/common/<页面>.css`，且**只被该页模板 `<link>`**（模板与样式一对一，不要交叉引用）。这类文件**不得定义共享 CSS 已有的类**——同一个类名在两处各有一套值，谁生效只看模板引用的顺序，排查起来毫无线索。
   - 现有白名单（唯一例外）：`codex.css` 对 `.hero-game` / `.hero-subtitle` / `.hero-info-item` 的 **3 条定向覆盖**（名刺图上小字对比度不足，2026-09-20 定稿）；**待换成共享件后从白名单删除**。
   - 边界由 `test/style-scope.test.mjs` 守住：页面 CSS 定义共享类即失败（白名单除外），被非同名前缀的模板引用也失败，引用的 CSS 与 `url()` 资源不存在同样失败。

3. **外部仓库的镜像文件要登记来源，且不得手改**：`model/codexIndex/display.js` 是攻略仓库 [Character-Codex-Data](https://github.com/Hyposelenia-Moon/Character-Codex-Data) 里 `scripts/lib/guide-display.mjs` 的**逐字节副本**（面板与网页版的措辞靠两份一致）。改规则去上游改，再用上游 `node scripts/check-display-sync.mjs --write` 同步；本地手改会同时挂掉上游校验与 `test/codex-display-sync.test.mjs`。

### 配置三层（自研插件统一模式）

```
defSet/config.yaml          锅巴模板（含 ${变量} 占位与注释）——不加新配置项就不用动
config/config.yaml.example  入库的参考默认值——**加配置项必须同步这里**
config/config.yaml          运行时（git-ignored）——不要提交
```

读取统一走 `components/config.js` 的 `getPluginConfig()`（逐级兜底并合并默认值）。锅巴 field 用**点分路径**（`codex.enabled`），模板变量用**下划线**（`${atlas_codex_enabled}`）。

---

## 3. 代码约定

- **ESM**：全部 `import` / `export`，不用 `require`
- **日志**：`logger?.info/warn/error`，标签统一 `[Atlas]` 前缀（如 `[Atlas][Updater]`）。**没有** `logger?.debug`
- **中文**：注释、`name`、`dsc`、用户可见文案一律简体中文
- **注释写什么**：每个函数写明**功能 / 输入 / 输出**（JSDoc）；对边界条件与设计决策写注释，对「调了什么 API」不写。注释服务于长期理解，不记录单次修复过程
- **不写死环境**：路径从 `pluginPath`/`backendRoot`/`dataDir` 推导，不写盘符绝对路径
- **错误不回显内部细节**：查询链路异常只回通用文案（`modules/atlasQuery.js` 的 `QUERY_ERROR_REPLY`），异常名 / 绝对路径 / 堆栈只进日志
- **优先级**（数值越小越先执行）：`atlasShortcut -99999` < `alias 8000` < `updateLog 9000` < `atlas ~10000`。新命令请避开既有区间
- **未匹配要放行**：返回 `false`，不回复、不影响其他插件。典型例子：`#胡桃圣遗物` 这类要被 miao-plugin 接管的查询，图鉴必须原样放行
- **需要同步登记的地方**（漏一处就会出现「有的后缀能用、有的不能」）：
  - `components/constants.js`：`SUB_VIEW_SUFFIXES` / `PAGE_TYPE_SUFFIXES` / `SHORTCUT_SUFFIXES` / `SPECIAL_TRIGGERS` / `PAGE_PRIORITY`
  - `resources/help/help-cfg.js`：`#图鉴帮助` 的文案
  - `README.md` 与文档站：命令或行为变更
  - `config/config.yaml.example` + `defSet/config.yaml` + 锅巴 schema：新增配置项

---

## 4. 数据修正：优先用本地补丁层

子模块内容会在 `#图鉴更新` 时被整体覆盖，所以**不要直接改 `tool/nanoka-atlas-backend/**` 里的数据**，也不要为了改数据去动子模块指针。仓库内提供了补丁层，在**读取时**叠加：

| 目录 | 用途 |
|------|------|
| `resources/patch/data/<与 data/ 相同的相对路径>.json` | 条目补丁（对象递归合并、数组整体替换、标量覆盖） |
| `resources/patch/gallery/<game>/<资源名>.webp` | 图片补丁（按 `meta.images[].originalValue` 匹配，补缺图或覆盖错图） |
| `resources/patch/map.json` | 索引补丁（改条目名 / 稀有度等索引层字段） |

```jsonc
{
  "_patch": {
    "note": "源站把翠绿之影 5 个部件的 desc 抓成「砂糖专用」",   // 供人读：为什么打补丁
    "upstream": { "content.detail.parts.equip_ring.desc": "砂糖专用" }, // 上游原值快照，用于比对上游是否已改
    "updatedAt": "2026-09-13"
  },
  "content": { "detail": { "parts": { "equip_ring": { "desc": "…" } } } }
}
```

- 一文件一条目，便于 diff 与回退
- `_patch.upstream` 与上游当前值不一致时，`#图鉴补丁` 会列 ⚠（补丁仍然生效，需要人工复核）
- **改名 / 改索引字段**（如套装星级）需要同时改 `resources/patch/map.json`
- 补丁改动在 `#图鉴更新` 或重启后生效（缓存按数据版本失效）

---

## 5. 已知坑（踩过的，别再踩）

1. **art-template 4.x 没有注释语法**。在 `resources/atlas/*.html` 里写 `{{* 注释 *}}` 会让模板 **编译失败**——曾因此把 `#角色攻略` 整条链路打挂（修复见提交 `5d7ab3b`）。要写说明就用 HTML 注释或直接删掉。
2. **模板必须保留 `<body style="zoom:{{renderScale}}">`**。渲染缩放靠它实现（框架渲染后端不暴露 DPR 旋钮），删掉会让 `renderScale` 配置静默失效。
3. **行尾**：`.gitattributes` 是 `* text=auto eol=lf`，Windows 工作副本会显示 CRLF。**不要整文件重写/格式化**（会产出全文件 diff）；只改必要的行。
4. **渲染链按 cwd 解析**：框架的 `lib/renderer/loader.js` 用 cwd 找 `renderers/` 与 `temp/`。所以渲染相关代码在测试里需要 cwd = Bot 根——`test/_helper.mjs` 已经处理，**不要**在套件里自己去 `chdir`。
5. **子模块指针**：除非你确实要升级数据引擎版本，否则别把 `tool/nanoka-atlas-backend/nanoka-atlas-backend` 的 gitlink 改动混进 PR。
6. **`tool/Character-Codex-Data/Character-Codex-Data/`** 是攻略数据的 git clone（**不是子模块**，本体被 gitignore）。攻略**正文**改这个仓库，不要提到本插件仓库。
7. **`test/.test-tmp/`** 是套件临时产物目录（gitignore）。别把里面的文件提交上来。
8. **别写死数据**：套件里不要硬编码角色名/条目数（图鉴与攻略仓库都在增长）。攻略相关用例要**运行时取样**「有攻略 / 无攻略」的角色。
9. **别为了跑绿改测试**：断言失败先假设实现有问题。只有确认契约本身变了，才改测试，并在 PR 里说明为什么旧契约不再成立。

---

## 6. 测试

回归套件在 `test/`（**入库**），不启动 Bot、直接跑真实生产代码路径。

```bash
cd plugins/Atlas-Plugin
pnpm test                 # = node test/run.mjs，任意 cwd 可跑
pnpm test -- --list       # 只列套件
pnpm test -- --filter=cache   # 只跑文件名含 cache 的
```

- 当前 **21 个套件**；每套末尾输出 `结果：通过 N / 失败 N`，运行器最后给汇总
- **缺前置打印「跳过」并 exit 0**：图鉴数据 / 攻略仓库 / 浏览器 / git 替身四类
- 需要浏览器时用系统 Edge/Chrome（可用 `ATLAS_TEST_BROWSER` 指定）；Windows 下 git 替身会编译成真 `.exe`（`.cmd`/`.ps1` 不行）

### 新增套件的规范

| 要求 | 说明 |
|------|------|
| 命名 | `<主题>.test.mjs`（写被测行为，不用 `check-` / `stage` 之类历史前缀；数据口径类用 `data-<游戏><页面>`） |
| 路径 | 一律经 `test/_helper.mjs` 推导（`pluginRoot` / `appRoot` / `dataDir` / `codexDir` / `tmpDir` / `mod()`），**禁止裸相对路径与盘符** |
| 前置 | 用 `requireAtlasData()` / `requireCodexRepo()` 等，缺前置就 `skip('原因')`（exit 0） |
| 断言 | 用 `checker()`（`check(名称, 条件, 附加信息)` + `finish()`）；数量不必多，但要能真的失败 |
| 临时产物 | 只写 `test/.test-tmp/`；**确需临时改 `config/config.yaml` 的必须按原字节/原 MD5 还原** |
| 桩 | 框架全局桩（`logger`/`redis`/`cfg`/`segment`）已收敛在 `_helper.mjs`，套件内不要重复实现 |

```js
// test/<主题>.test.mjs 骨架
import { mod, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { search } = await import(mod('model/AtlasService.js'))
const { check, finish } = checker()

check('关键词能搜到角色', search('gi', '胡桃')?.results?.[0]?.name === '胡桃')
finish()   // 有失败即 exit 1
```

改模板 / 改渲染链时，**至少跑** `codex-template`（模板可编译 + 合成数据渲染）与 `render-scale`（输出尺寸随 `renderScale` 成比例）。

---

## 7. 提交与 Pull Request

### 分支与粒度

一个 PR 只做一件事。不要把「功能 + 重构 + 格式化」混在一起；也不要顺手重命名文件或调整无关代码——这会让 Review 无法进行。

### Commit 信息

```
prefix: 中文描述（单行，覆盖本次全部改动，≤50 字符）

- 文件或模块: 具体改动
- 文件或模块: 具体改动
```

- 每条 ` - ` 明细**必须单行**，不要手动折行（便于从 GitHub Desktop 等界面直接复制）
- 常用前缀：`feat` / `fix` / `perf` / `refactor` / `docs` / `test` / `style` / `chore` / `merge`
- 不写与代码逻辑无关的内容（如本地笔记、注释修正）

### PR 要点

仓库已配置 PR 模板，创建 PR 时会自动出现。请**如实**填写，尤其是：

- **测试结果**：写出「通过 N｜跳过 N｜失败 N」与跳过原因。有失败就别写「全部通过」
- **渲染类改动**：附截图，或说明跑了哪些渲染套件
- **数据类改动**：说明走的是补丁层还是子模块
- **行为/命令变更**：确认已同步 `README.md`、`#图鉴帮助`、`config.yaml.example`

Review 会关注：是否放行了本不该接管的查询、是否破坏既有页面口径、是否误改测试断言、是否夹带无关改动。

---

## 8. 分工边界：改动该提到哪个仓库

| 你想改的东西 | 提到哪里 |
|-------------|---------|
| 插件代码、模板、样式、补丁层、测试、文档 | **本仓库** |
| 图鉴抓取逻辑、条目 JSON 结构（引擎侧） | [`nanoka-atlas-backend`](https://github.com/AxiuCN/nanoka-atlas-backend)（本插件的子模块） |
| 图鉴数据本身抓错了 | 先用本仓库的 `resources/patch/**` 打补丁；数据源问题可反馈给上游 [nanoka.cc](https://nanoka.cc/) |
| 角色攻略**正文**（武器/圣遗物/配队等内容） | [`Character-Codex-Data`](https://github.com/Hyposelenia-Moon/Character-Codex-Data) |
| 攻略页的**展示逻辑**（段类型、图标、hero） | **本仓库**（`modules/codexQuery.js` / `model/codexIndex/` / `resources/atlas/codex.html`） |

> 维护者本地还有 `CLAUDE.md`、`AGENTS.md`、`.dsh/` 等**不入库**的开发笔记；贡献者不需要创建或提交它们。

---

## 9. 许可

本项目采用 [GPL-3.0-only](./LICENSE)。提交 PR 即表示你同意以该许可发布你的贡献，并确认你有权这样做（例如内容不是从其他插件直接搬运的）。
