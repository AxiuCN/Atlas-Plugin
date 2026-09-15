# Character-Codex-Data

本目录用于存放**角色攻略数据**，由插件在 `#图鉴初始化` / `#图鉴更新` / 每日自动更新的最后一个步骤，以 `git clone` 方式从 [Hyposelenia-Moon/Character-Codex-Data](https://github.com/Hyposelenia-Moon/Character-Codex-Data) 拉取到 `Character-Codex-Data/` 子目录（感谢作者维护）。

与 `tool/nanoka-atlas-backend/` 不同，这里**不使用 git 子模块**——插件仓库不记录 gitlink，攻略仓库的日常更新不需要插件仓库跟着推送。克隆出来的 `Character-Codex-Data/` 已在 `.gitignore` 中忽略，本 README 会正常入库。

- 同步逻辑：`model/AtlasUpdater.js` 的 `syncCodexRepo()`（目录不存在则 clone，已存在则 `git pull --ff-only`）
- 数据读取：`model/codexIndex/index.js`（攻略数据的唯一入口，页面与编排层不直接读文件）
- 页面接入：`#角色攻略` / `#角色指南` → `modules/codexQuery.js` → `resources/atlas/codex.html`
