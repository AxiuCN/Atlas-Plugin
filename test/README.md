# 回归套件（test/）

图鉴插件的回归套件。**不需要启动 bot**，直接跑真实生产代码路径（搜索、索引、缓存、渲染、命令编排）。

## 怎么跑

```bash
node test/run.mjs                 # 全部
node test/run.mjs --filter=cache  # 只跑文件名含 cache 的
node test/run.mjs --list          # 只列清单
pnpm test                         # 等价于 node test/run.mjs
node test/variant-family.test.mjs # 单个（任意 cwd 都行）
```

## 前置与「跳过」

套件依赖本机数据，**缺前置时打印「⏭ 跳过：原因」并以 0 退出**（不算失败）：

| 前置 | 何时缺 | 怎么补 |
|------|--------|--------|
| 图鉴数据（`tool/nanoka-atlas-backend/.../data/map.json`） | 未初始化 | `#图鉴初始化` / `#图鉴更新` |
| 角色攻略仓库（`tool/Character-Codex-Data/Character-Codex-Data/.git`） | 未拉取 | 同上（同步链路独立于图鉴抓取） |
| 浏览器（Edge / Chromium） | 没装或非 Windows | 设 `ATLAS_TEST_BROWSER=<可执行文件路径>`，或跳过渲染类套件 |
| git 替身（`test/.test-tmp/fake-git/git.exe`） | 首次运行 | 套件会自动执行 `test/fixtures/fake-git/build.ps1` 编译；编不出则跳过 |

## 约定

1. **任意 cwd 可跑**：路径一律经 `test/_helper.mjs` 推导，不写裸相对字面量、不写盘符绝对路径。
2. **不改动源数据**：临时产物写 `test/.test-tmp/`（gitignore）；确需临时改 `config/config.yaml` 的套件必须按原字节还原。
3. **只走公开 API**：套件不 import 生产代码的私有函数；需要桩时只用 `_helper.mjs` 的框架全局桩（logger/redis/cfg/segment）。
4. **文件名 `<主题>.test.mjs`**：主题写被测行为（`variant-family`、`cache-reload`…），不用 `check-`/`stage` 这类历史前缀；数据口径类用 `data-<游戏><页面>`。
5. **断言风格**：`_helper.mjs` 的 `checker()` 计数 + 末尾 `finish()` 按失败数退出。

## 目录

```
test/
├── _helper.mjs            公共设施（路径 / 前置 / 计数 / 框架全局桩）
├── run.mjs                运行器（顺序跑 + 汇总）
├── fixtures/fake-git/     git 替身源码与编译脚本（产物在 .test-tmp/，不入库）
└── *.test.mjs             套件
```

一次性排查脚本（`gi-relic-*`、`zzz-*`、`monster-facts*`、`dump-*`）与生成脚本（`gen-*`）**不入库**，留在开发机的 `.dsh/explore/`。
