# AGENTS.md — Atlas-Plugin / test

本目录是 Atlas-Plugin 的回归套件（**入仓库**）。本文件是插件根 `AGENTS.md` 测试章节的就近分册：套件清单在这里维护，进入 `test/` 工作时随嵌套级指令自动加载；工程侧规范（前置、跳过、临时产物）见 [`docs/测试.md`](../docs/测试.md)。

## 运行

- `pnpm test`（= `node test/run.mjs`）——**任意 cwd 可跑**（插件根、bot 根都行），支持 `--filter=<关键字>` / `--list`
- 不启动 bot：直接跑真实生产代码路径；**缺前置打印「跳过」并 exit 0**，断言失败 exit 1
- 细节见 `test/README.md`；工程侧约定见 [`docs/测试.md`](../docs/测试.md)（主文件 `AGENTS.md` 只留测试命令与摘要）

## 公共设施（`test/_helper.mjs`）

路径推导（`pluginRoot` / `appRoot` / `dataDir` / `tmpDir` / `mod()`）、前置检查（`requireAtlasData()` / `findBrowser()` / `ensureFakeGit()`）、断言计数（`checker()`）、框架全局桩（`installFrameworkStubs()`：redis / cfg / segment / logger）、`skip()`、`logs`。

- 桩与前置都收敛在这里，套件自身不重复实现
- **渲染链套件会让进程 chdir 到 `appRoot`**（框架 `lib/renderer/loader.js` 按 cwd 解析 `renderers/` / `temp/`），运行器给子进程也钉了 cwd
- git 替身：`fixtures/fake-git/` 的 C# 桩按需编译进 `.test-tmp/`（Windows 下 `spawn('git')` 需要真 `.exe`）

## 规范

- 命名 `<主题>.test.mjs`（写被测行为，不用 `check-` / `stage` 历史前缀；数据口径类用 `data-<游戏><页面>`）
- 路径一律经 `_helper.mjs` 推导，**禁止裸相对字面量与盘符绝对路径**
- 临时产物只写 `test/.test-tmp/`（gitignore）；确需临时改 `config/config.yaml` 的必须按原字节还原（`render-scale` 会改写后按字节比对还原）
- `patches.test.mjs` 发现问题时**故意 exit 1**（与它的来源脚本行为不同）
- 数据依赖要运行时取样，不写死角色名与条目数（图鉴数据在持续增长）

## 套件

| 套件 | 覆盖 | 前置 |
|------|------|------|
| `alias-loader.test.mjs` | 别名层（**数据无关**）：`normalizeForMatch` 六种间隔号归一、键幂等、`{value,game,source}` 形状、按游戏过滤与过滤缓存、`buildKeywordVariants` 双向展开、高来源覆盖低来源（临时自定义 YAML 后回退）、reload 换新与 watcher 幂等、`aliasVersion` 与缓存失效一致性、对外门面 `modules/aliasApi.js` 的返回形状与只读契约、**专武索引**（官名/别名/全名闭包、修饰词过滤、未登记为空、按游戏过滤）、**套装别名补读**（gs `setAlias` 错字/非子串/带「套」别名、sr `aliasCfg` 属性套与简称、跨游戏同名隔离） | 无（只读文件） |
| `variant-family.test.mjs` | 形态族（旅行者/奇偶/开拓者/三月七）、同名折叠、重名条目 id 别名合并、`resolveEntryPageKey` | 图鉴数据 |
| `suffix-routing.test.mjs` | 子视图 / 页面类型 / 泛用「套」/ 专武后缀的消费与放行（82 例，含 miao 面板换装放行、专武落点渲染比对与别名+修饰词、未命中文案区分、套装别名落点） | 图鉴数据 |
| `style-scope.test.mjs` | 样式归属：页面 CSS 不得定义共享词汇、页面 CSS 只被同前缀模板引用、模板 link 与 CSS `url()` 的资源必须存在 | 无（只读文件） |
| `record-cache.test.mjs` | `loadRecord` LRU 上限、签名自愈、冻结诊断、缓存实例与现读现套补丁逐字一致 | 图鉴数据 |
| `text-cache.test.mjs` | 全文兜底文本缓存：二次查询 0 读盘、`reloadIndex` 作废、单条 mtime 自愈、结果不变 | 图鉴数据 |
| `cache-reload.test.mjs` | `reloadIndex()` 后各模块派生缓存（itemIndex / monsterIndex / LinkResolver / mapLoader）全部换新 | 图鉴数据 |
| `startup-lifecycle.test.mjs` | 启动编排契约：已同步只重建一次 / 子模块切换后重建 / sync 与 reload 异常都不阻断（注入假依赖）+ 启动清理遗留攻略目录（临时机制，2026-12-14 后随该机制一起删） | 无（数据无关） |
| `reload-contract.test.mjs` | reload 契约：临时补丁驱动的行为级验证（未 reload 不生效 → reload 后生效 → 可逆）+ 消费侧换新 + 幂等 | 图鉴数据 |
| `scrape-lock.test.mjs` | 抓取锁：活跃锁拒绝 / 僵尸锁与过期锁清理 / 8 进程竞争下「`wx` 原子创建」恰好 1 个成功 | 图鉴数据 |
| `render-scale.test.mjs` | `renderScale` 端到端：模板 zoom 注入 + 1 与 1.5 输出尺寸成比例 + 配置按原字节还原 | 图鉴数据 + 浏览器 |
| `weapon-refine.test.mjs` | 精炼/叠影/音擎天赋合并的合成用例 + 全量 512 条往返无损 | 图鉴数据 |
| `patches.test.mjs` | 补丁结构 / `_patch.upstream` 与上游一致 / 圣遗物补丁覆盖与误伤 / map 索引补丁 | 图鉴数据 |
| `status-page.test.mjs` | `#图鉴状态` 状态页：真实 `buildStatusData()` + art-template 渲染一次，各游戏版本行齐全 | 图鉴数据 |
| `error-reply.test.mjs` | 查询异常只回通用文案、细节只进日志、正常查询不误报 | 图鉴数据 |
| `patch-paths.test.mjs` | 公开命令（`#图鉴补丁` / `#图鉴状态`）不回显服务器绝对路径 | 图鉴数据 |
| `smoke-imports.test.mjs` | 18 个模块加载无环、导出面齐全 | 图鉴数据 |

## 不入库

留在开发机 `.dsh/explore/`：一次性排查脚本（`gi-relic-*` / `zzz-*` / `monster-facts*` / `dump-*` / `audit-*`）、生成脚本（`gen-*`），以及只打印不判定的 `stage1~7` / `monster*.test` / `check-weapon-refine` / `check-hero-*` / `check-relic-need` 等核查脚本——它们没有断言与退出码，作为回归只会“永远通过”。
