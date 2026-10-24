# 别名来源交接：Atlas-Plugin → ProfileImg-Plugin

> 交接文档，不是规范。Atlas 侧已交付对外门面 `modules/aliasApi.js`（契约见 [`数据-路由补丁与别名.md`](./数据-路由补丁与别名.md) 的「对外公共面」）。
> **Atlas 不会修改 ProfileImg 的任何文件**；下文是 ProfileImg 侧自行施工的清单与注意事项。
> 施工完成前，两边各读各的文件、各挂各的 watcher，不会冲突。

## 一、目标

| 项 | 现状 | 目标 |
|---|---|---|
| 别名来源 | ProfileImg `modules/alias.js` 自建（解析 miao `meta-{gs,sr}/character/alias.js` + 两个 cfg） | **Atlas 门面为主**；本地实现**保留但不维护**，仅作 Atlas 缺失时的兜底 |
| 常驻表 | ProfileImg 1895 条 + Atlas 3077 键 | 只剩 Atlas 一份 |
| watcher | ProfileImg 2 套（`fs.watch` 目录 + `fs.watchFile` 兜底）+ Atlas 1 套 | **二选一**，不要同时挂 |

## 二、施工清单（ProfileImg 侧）

1. **动态 import，不要静态 import**
   `modules/alias.js` 顶层用 `try { await import('../../Atlas-Plugin/modules/aliasApi.js') } catch {}` 拿 provider（Atlas 的 `AliasLoader` 模块顶层无副作用，import 本身安全）。静态 import 在 Atlas 未装/被禁用时会让 ProfileImg **整个插件加载失败**，兜底就没机会了。
2. **调用形状**
   - `resolveAlias(name, gameId)` → `{ key, candidates: string[], primary: string|null }`：`candidates` 是**对侧名称、不含方向**（别名表双向注册），ProfileImg 是单值语义 → 用 `primary`，并**必须传 game**（`#预览` 支持 `*` 星铁）。
   - `expandKeyword(kw, gameId)` → `{ raw, key, alias }[]`：若要做多候选检索用它。
   - `getAliasVersion()` → 版本号；`getAliasStatus()` → 排障摘要。
   - 所有函数**永不抛错**，异常返回空结构（`primary: null`）→ 空结果请按"未命中"处理并落兜底。
3. **保留自己的目录能力**
   `roleDirExists()` / `getAllCharDirs()` / 精确、大小写、模糊三级回退都是**图库目录**语义，门面不提供也不该提供。顺序建议：`resolveAlias` → 校验目标目录存在（现状的 `roleDirExists(official)` 闸门）→ 目录精确 → 大小写 → 模糊。
4. **watcher 二选一**
   Atlas 可用时 **不要**调用 `watchCustomAliasFiles()`：Atlas 首次 `loadAliasMap()` 会自己挂 watcher（`model/AliasLoader.js` 的 `initAliasWatcher`），同时挂会导致同一批 cfg 被监听两次、每次保存重建两次。Atlas 不可用时才启用本地那套。
5. **本地实现保留并冻结**
   `modules/alias.js`（`buildAliasMap` / `resolveRoleName` / `watchCustomAliasFiles`）**不删除、不改语义**；顶部加一段注释说明「别名来源已移交 Atlas，本文件仅作兜底、不再维护」。建议补一个 `alias-fallback` 套件把现有行为钉住（表非空、大小写、坏行跳过、cfg 覆盖预设、不依赖 Atlas）——**由 ProfileImg 侧写**，Atlas 不代写。
6. **两条路径不等价（写进 ProfileImg 文档）**
   兜底表 1895 条（仅角色，gs+sr 两个文件）vs Atlas 3077 键（含武器/圣遗物/ZZZ、多值、去六种间隔号）。所以"装了 Atlas / 没装 Atlas"同一命令可能解析不同：Atlas 路径对 `•`/`·`/无分隔号三种写法等价，兜底路径只认表里字面写法。这是降级的固有代价。
7. **启动打一行来源日志**
   `[ProfileImg-Plugin] 别名来源：Atlas（v<version> / <keys> 键）` 或 `别名来源：本地兜底（Atlas 不可用）`。没有这行，日后"某台机器解析不到"无法一眼判断走的是哪条路。

## 三、按 Atlas 门面替换时的等价性核对

| 关注点 | 兜底（现状） | Atlas 门面 | 影响 |
|---|---|---|---|
| 表规模 | 1895 条（仅 gs/sr 角色） | 3077 键（含武器/圣遗物/ZZZ） | 命中面变大；非角色名会被 `roleDirExists` 闸门挡掉，行为不变 |
| 分隔号 | 键只 `toLowerCase`，`•`/`·` 不互通 | 六种间隔号统一去掉 | **变宽**：`知更鸟·晴歌` 与 `知更鸟•晴歌` 等价（兜底只能靠短别名 `晴歌` 命中） |
| 多值 | 单值（后写覆盖） | 多值（同一键可挂多个候选，实测 22 例跨游戏） | 取 `primary` + 传 game 即可，不要拿整个数组当官方名 |
| 覆盖语义 | 后写覆盖预设 | 四层来源严格覆盖（外部预设 < miao 自定义 < Atlas 预设 < Atlas 自定义） | Atlas 预设层（`resources/alias/**`）会一并生效；目前只有 artifact 的几条，对角色解析无实质影响 |
| 热更新 | 自己的 2 套 watcher | Atlas 的 watcher（目录树 + cfg 文件） | 删除自己那套即可 |

## 四、验证（ProfileImg 侧施工后自行执行）

```bash
cd plugins/ProfileImg-Plugin && pnpm test
```

手工对照（同一台机器、同一图库）：

| 命令 | 期望 |
|---|---|
| `#预览胡桃面板图1` | 有图、与施工前同图 |
| `#胡桃面板图列表` | 条数与施工前一致 |
| `#预览知更鸟·晴歌面板图1`（星铁） | 走 Atlas 时能解析（兜底路径下会失败，属预期差异） |
| 临时把 Atlas 目录改名（模拟未装） | 启动日志应为"本地兜底"，命令仍可用 |
| 恢复目录后重启 | 启动日志应为"Atlas（v…）" |

## 五、"不做"清单

- 不删 `ProfileImg-Plugin/modules/alias.js`、不改其语义（冻结兜底）
- 不把 ProfileImg 的目录判定逻辑搬进 Atlas
- 不新增 `alias.source` 之类的配置开关（要对照就临时改一行再还原）
- Atlas 侧不替 ProfileImg 改任何文件、不代写它的测试
