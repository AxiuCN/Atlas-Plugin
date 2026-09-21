<!--
创建 PR 后请按下面的结构填写。不适用的条目写「不适用」并简述原因，不要删除小节。
完整约定见 CONTRIBUTING.md。
-->

## 改了什么

<!-- 一到三句：改了哪些文件 / 模块，做了什么 -->

## 为什么

<!-- 动机：修复的问题、Issue 编号（如 Fixes #123）、要新增的能力 -->

## 影响面

- 页面 / 指令：<!-- 如 #胡桃天赋 / %雅影画 / #图鉴补丁 / 不涉及 -->
- 涉及游戏：<!-- 原神 / 星铁 / 绝区零 / 全部 / 不涉及 -->
- 是否改变既有输出：<!-- 否 / 是（说明差异，例如渲染结果或搜索排序变化） -->

## 测试

- `pnpm test` 结果：**通过 __ ｜ 跳过 __ ｜ 失败 __**
- 跳过的套件与原因：<!-- 缺图鉴数据 / 缺攻略仓库 / 缺浏览器 / 缺 git 替身；没有就写「无」 -->
- 未跑全量时，说明跑了哪些：<!-- 如仅 codex-template + render-scale -->

<!-- 渲染 / 模板类改动请附截图，或列出跑过的渲染套件。有失败请如实写出，不要写「全部通过」 -->

## 数据类改动（如涉及）

- [ ] 走 `resources/patch/**` 补丁层（附 `_patch.note` 与 `_patch.upstream`）
- [ ] 同时改了 `resources/patch/map.json`（条目名 / 稀有度等索引层字段）
- [ ] 涉及子模块版本升级（已在「为什么」里说明必要性）
- [ ] 不涉及

## 自检

- [ ] 上面的测试数字是我本地跑出来的真实结果（有失败就写失败）
- [ ] 没有为了跑绿而修改或削弱测试断言（若确认契约变化，已说明旧契约为何不再成立）
- [ ] 没有提交 `test/.test-tmp/` 下的临时产物
- [ ] 没有改动 `tool/Character-Codex-Data/Character-Codex-Data/`（攻略仓库本体，git-ignored）
- [ ] 没有误改子模块指针 `tool/nanoka-atlas-backend/nanoka-atlas-backend`
- [ ] 模板中**没有** `{{* … *}}`（art-template 4.x 无注释语法，会导致模板编译失败）
- [ ] 模板保留了 `<body style="zoom:{{renderScale}}">`
- [ ] 没有整文件重写 / 无关重命名 / 改动行尾（`.gitattributes` 为 `* text=auto eol=lf`）
- [ ] 新增或修改配置项已同步 `config/config.yaml.example` 与 `defSet/config.yaml`
- [ ] 命令或行为变更已同步 `README.md` 与 `resources/help/help-cfg.js`
- [ ] 新增后缀 / 触发词已在 `components/constants.js` 的对应集合里登记
- [ ] 代码里没有盘符绝对路径；新增测试的路径经 `test/_helper.mjs` 推导

## 备注

<!-- 需要 Review 特别关注的点、已知限制、后续计划 -->
