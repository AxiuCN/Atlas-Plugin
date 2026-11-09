# AGENTS.md — Atlas-Plugin / test

本目录是 Atlas-Plugin 的回归套件（**入仓库**）。本文件是插件根 `AGENTS.md` 测试章节的就近分册：套件清单在这里维护，进入 `test/` 工作时随嵌套级指令自动加载；工程侧规范（前置、跳过、临时产物）见 [`docs/测试.md`](../docs/测试.md)。

## 运行

- `pnpm test`（= `node test/run.mjs`）——**任意 cwd 可跑**（插件根、bot 根都行），支持 `--filter=<关键字>` / `--list`
- 不启动 bot：直接跑真实生产代码路径；**缺前置打印「跳过」并 exit 0**，断言失败 exit 1
- 细节见 `test/README.md`；工程侧约定见 [`docs/测试.md`](../docs/测试.md)（主文件 `AGENTS.md` 只留测试命令与摘要）

## 公共设施（`test/_helper.mjs`）

路径推导（`pluginRoot` / `appRoot` / `dataDir` / `tmpDir` / `mod()`）、前置检查（`requireAtlasData()` = Hesperides 三游戏角色页都已抓到 / `requireHesperidesProducts()` = 产物存在 / `findBrowser()` / `ensureFakeGit()`）、断言计数（`checker()`）、框架全局桩（`installFrameworkStubs()`：redis / cfg / segment / logger）、`skip()`、`logs`。

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
| `alias-loader.test.mjs` | 别名层（**数据无关**）：`normalizeForMatch` 六种间隔号归一、键幂等、`{value,game,source}` 形状、按游戏过滤与过滤缓存、`buildKeywordVariants` 双向展开、高来源覆盖低来源（临时自定义 YAML 后回退）、reload 换新与 watcher 幂等、`aliasVersion` 与缓存失效一致性、对外门面 `modules/aliasApi.js` 的返回形状与只读契约、**专武索引**（官名/别名/全名闭包、修饰词过滤、简写「专」补全、未登记为空、按游戏过滤）、**专武简写派生**（`X专武`→`X专` 兄弟键不变量、对外 API 可解析）、**套装别名补读**（gs `setAlias` 错字/非子串/带「套」别名、sr `aliasCfg` 属性套与简称、跨游戏同名隔离） | 无（只读文件） |
| `variant-family.test.mjs` | 形态族（旅行者/奇偶/开拓者/三月七）、同名折叠、重名条目 id 别名合并、`resolveEntryPageKey` | 图鉴数据 |
| `suffix-routing.test.mjs` | 子视图 / 页面类型 / 泛用「套」/ 专武（含简写「专」）后缀的消费与放行、面板黑名单放行（93 例，含 miao 面板换装放行、专武落点渲染比对与别名+修饰词、未命中文案区分、套装别名落点） | 图鉴数据 |
| `style-scope.test.mjs` | 样式归属：页面 CSS 不得定义共享词汇、页面 CSS 只被同前缀模板引用、模板 link 与 CSS `url()` 的资源必须存在 | 无（只读文件） |
| `record-cache.test.mjs` | `loadRecord` LRU 上限、签名自愈、冻结诊断、缓存实例与现读现套补丁逐字一致 | 图鉴数据 |
| `text-cache.test.mjs` | 全文兜底文本缓存：二次查询 0 读盘、`reloadIndex` 作废、单条 mtime 自愈、结果不变 | 图鉴数据 |
| `cache-reload.test.mjs` | `reloadIndex()` 后各模块派生缓存（itemIndex / monsterIndex / LinkResolver / mapLoader）全部换新 | 图鉴数据 |
| `startup-lifecycle.test.mjs` | 启动编排契约：已同步只重建一次 / 子模块切换后重建 / sync 与 reload 异常都不阻断（注入假依赖） | 无（数据无关） |
| `reload-contract.test.mjs` | reload 契约：临时补丁驱动的行为级验证（未 reload 不生效 → reload 后生效 → 可逆）+ 消费侧换新 + 幂等 | 图鉴数据 |
| `scrape-lock.test.mjs` | 抓取锁（Hesperides `data/_scraping.lock`）：活跃锁拒绝 / 僵尸锁与过期锁清理 / 8 进程竞争下「`wx` 原子创建」恰好 1 个成功 | 图鉴数据 |
| `render-scale.test.mjs` | `renderScale` 端到端：模板 zoom 注入 + 1 与 1.5 输出尺寸成比例 + 配置按原字节还原 | 图鉴数据 + 浏览器 |
| `weapon-refine.test.mjs` | 精炼/叠影/音擎天赋合并的合成用例 + 全量 512 条往返无损 | 图鉴数据 |
| `patches.test.mjs` | 补丁结构 / `_patch.upstream` 与上游一致 / 圣遗物补丁覆盖与误伤 / map 索引补丁 | 图鉴数据 |
| `status-page.test.mjs` | `#图鉴状态` 状态页：真实 `buildStatusData()` + art-template 渲染一次，各游戏版本行齐全 | 图鉴数据 |
| `challenge-spec.test.mjs` | 期修饰（**`parsePeriodSpec` 纯函数 + 真实 `handleQuery` 端到端**）：月份/版本（含 `a`/`b` 与缺 `b` 回落 `a`）/本期·上期·下期的前缀解析、非法前缀不误判（`202613`、`2026`、`4星武器`）、选期（月份命中与未命中文案、本期未开放时上期=最近已开期/下期=最早未开期、无更晚期回 `no-next`、未知版本与空版本区间的文案）、端到端 `#202001深渊`（未命中）/`#99.9深渊`（不支持）/`#7.0深渊` 与 `#7.0b深渊`（出图）/`#本期深渊`（出图或未开放）/`#深渊`（无期修饰行为不变）、**期标识**（`formatPeriodLabel` 含期号/版本/起止、估算标推定、空期空串）与模板渲染（`challenge.html` 把 `periodLine` 渲染进 hero 且无残留 `{{`） | 图鉴数据 |
| `submodules.test.mjs` | 子模块同步（`model/Submodules.js`，注入 runner）：`.gitmodules` 路径解析（url 不误当 path）、登记校验（未登记的子模块不同步、没有 `.gitmodules` 不跑 git）、提交未变回 skipped 且 `updated` 为空、提交变化时指出变化路径、失败透传 stderr、HEAD 读取容错 | 无（只读文件） |
| `legacy-cleanup.test.mjs` | 历史遗留清理（`model/LegacyCleanup.js`，**整套对应临时机制**）：攻略目录整目录删除 / 同级目录不受影响 / 幂等 / 符号链接只摘链接、退役子模块三处残留清理 / 外层目录保留 / 幂等 / `dryRun` 只报计划、仍登记在 `.gitmodules` 时跳过、统一入口两处都跑 | 无（只读文件） |
| `new-content.test.mjs` | 版本新增内容（`model/NewContent.js`，**数据无关**）：实体→页目录映射（hsr 武器走光锥页）、按 manifest `new` 组装分组（固定顺序 / 空组丢弃 / 未知实体追加）、名称从索引补出与退回 id、边界（无该游戏 / 无 new / 无索引）、文案（首行版本与总数、每组一行、超长「等 N 个」截断） | 无（真实产物存在时补一条端到端） |
| `hesperides-source.test.mjs` | Hesperides 数据源：通用挑战渲染器（增益/列表/数字/数组/截断/空记录/标题）、真实产物的期表映射（gi tower→alioth abyss、zzz boss→nanoka、未知页 null）、期对象带 Date、按 id 读记录与缺失返回 null、频道状态 | Hesperides 产物（缺失则跳真实数据部分） |
| `hesperides-index.test.mjs` | Hesperides 索引适配（`model/HesperidesIndex.js`）：页目录名 ↔ pageKey（`achievement-achievement` 反推、`item-all`/`hollow-tpp` 不误映射、终局页目录名不进索引）、记录合成（合成路径 / 名字退化 id / 稀有度透传 / 只按 `ids` / `ids` 缺失退 `entries` / `hasDetail`·`imageCount` 退化）、索引对象形状与小计（空产物为 null、只有终局页时也为 null、`countIndex` 页数/记录数）、`AtlasRepository` 合成路径分发（签名可判活、适配成 `{meta,content:{list,detail}}`、无补丁时与 `loadRawRecord` 一致、缺失返回 null、旧数据路径读不出记录） | Hesperides 产物（缺失则跳真实数据部分） |
| `challenge-index.test.mjs` | 挑战期表选期（`model/ChallengePeriod.js`）：时间解析按本地时区（04:00 日切不错天）、本期判定（时间窗命中优先、**未来期不得当本期**、`closed` 时最近已开期与最早未开期分开给、全无日期回落最后一期、空表）、期标识格式（期号/版本/起止、估算标推定）、期修饰选期（月份/版本命中与未命中、本期·上期·下期、空表），以及**真实 Hesperides 期表**下 9 个玩法的期序号连续 / 带 Date / 按序递增 / 本期状态合法 / 期→版本非递减 / 各游戏期表来源（gi·hsr → alioth、zzz → nanoka） | 图鉴数据 |
| `challenge-version.test.mjs` | 版本时间轴（`model/ChallengeVersion.js`，**数据无关**）：序列按 `minorMaxByMajor` 正确进位（gi 5.8→6.0、hsr 3.8→4.0、zzz 2.7→3.0，且不生成 5.9/3.9/2.8）、日期→版本（锚点当日命中锚点版本、早于序列起点与非法日期返回 null）、版本→区间（开启日 = 锚点 + N 周期、区间到下一版本前 1 秒、未知版本 null）、版本距离（跨代按实际版本数、反向为负） | 无（只读常量） |
| `error-reply.test.mjs` | 查询异常只回通用文案、细节只进日志、正常查询不误报 | 图鉴数据 |
| `patch-paths.test.mjs` | 公开命令（`#图鉴补丁` / `#图鉴状态`）不回显服务器绝对路径 | 图鉴数据 |
| `custom-alias-edit.test.mjs` | 自定义别名写入与权限裁决（**在临时副本里跑真实模块**）：含标点的别名写后仍可解析且旧别名保留、后续设置不丢已有项、配置损坏时拒绝覆盖原文件、并发 set 与 set+del 均不丢更新、rule 权限交给 `checkPerm`（all 允许普通成员 / group_admin 允许管理员 / 缺省 master 只允许主人） | 无（临时副本） |
| `hesperides-period-end.test.mjs` | 挑战期日粒度结束值：`YYYY-MM-DD` 的 end 补到当天 23:59:59.999（月末最后一天中午仍属本期、次月零点不再是），上游显式给时刻的保持原语义（4:00 前后边界） | 无（打桩 periods.json） |
| `admin-messages.test.mjs` | 初始化/更新的结果判定与群消息（**数据无关**）：`classifyScrapeResult` 先看产物可用性（产物可用 → `failed:false` + 告警，超时与「有条目未抓到」文案分开）、初始化与更新共用同一分类且完成消息带告警、进度消息不得出现 `nanoka`/`玉璃`/`子模块`/`全量模式`/`含图片`/`完整性检查` 等内部实现、不含「完成后将通知」承诺 | 无（只读源码） |
| `config-schema.test.mjs` | 配置项一致性（**数据无关**）：锅巴 field → `defSet` 模板变量、反向无多余变量、`config.yaml.example` 里可见、`defaultConfig` 覆盖全部分组、**锅巴运行时三处映射**（`TEMPLATE_VARS` / `DEFAULTS` / `getConfigData` 都必须接上；缺一处保存就会把字面量 `${atlas_xxx}` 写进 YAML，配置读出来是字符串）。`blacklist.patterns` 走独立文件，豁免 | 无（只读源码） |
| `submodule-independence.test.mjs` | 加载不依赖子模块（**数据无关**）：生产代码不得静态 import `tool/Hesperides`（只允许动态 `import()`）、读子模块的四个模块在子模块缺失时仍可加载、频道表按运行时口径（nanoka 全量 + 玉璃终局 7 个，不含玉璃非终局页）、按游戏过滤与 diff 频道筛选 | 无（只读源码与模块） |
| `smoke-imports.test.mjs` | 26 个模块加载无环、导出面齐全（**数据无关**：import 不触发索引构建） | 无（只 import） |

## 不入库

留在开发机 `.dsh/explore/`：一次性排查脚本（`gi-relic-*` / `zzz-*` / `monster-facts*` / `dump-*` / `audit-*`）、生成脚本（`gen-*`），以及只打印不判定的 `stage1~7` / `monster*.test` / `check-weapon-refine` / `check-hero-*` / `check-relic-need` 等核查脚本——它们没有断言与退出码，作为回归只会“永远通过”。
