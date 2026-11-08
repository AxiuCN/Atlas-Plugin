# nanoka-atlas-backend

> [!IMPORTANT]
> **本项目已停止维护并归档，Atlas-Plugin 1.5.0 起不再使用它。**
>
> 数据引擎已换成 [Hesperides](https://github.com/AxiuCN/Hesperides)，本子模块已从 Atlas-Plugin 的 `.gitmodules` 移除；本目录只保留这份说明，不再随插件更新。

本目录原是 [nanoka-atlas-backend](https://github.com/AxiuCN/nanoka-atlas-backend) 子模块的挂载点
（fork 自 [MOPELotus/nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend)，感谢原作者开源）。
nanoka-atlas-backend 用于将 nanoka.cc 的图鉴数据导出为本地 JSON 文件与本地图片图库。导出结果按语言、游戏、页面、分类和条目分层保存，适合作为后续图鉴前端或数据浏览工具的数据源。

## 为什么换掉

| 旧引擎的问题 | 新引擎（Hesperides）的做法 |
|---|---|
| 只有一个数据源（nanoka），终局玩法缺期与条目 | 多源：玉璃 alioth.wiki（原神/星铁终局 + 全量）+ nanoka（绝区零全部、原神/星铁全部） |
| 网络一波动就整轮重抓，没有断点续跑 | 每频道独立写 manifest，中断可续跑；上游 304 按「未变」跳过 |
| JSON 与图片耦合在一起，图库与数据一荣俱荣 | JSON（记录 + 期表）与图片引用分离，图片按资源名去重、失败候选单独记账 |
| 产物路径按 `items/<语言>/<游戏>/…` 组合，条目定位靠目录名 | 产物按 `<game>/<source>/<page>/<id>` 组织，记录按 id 定位、补丁层可平移 |

## 老用户升级须知（1.4.x → 1.5.0）

1. `git pull` **不会**删除子模块的工作目录（它带自己的 `.git`，对主仓库是未跟踪内容），旧代码与
   旧数据（`data/`、`gallery/`，几百 MB）会留在磁盘上。
2. Atlas-Plugin 启动时会自动清理：删掉 `tool/nanoka-atlas-backend/nanoka-atlas-backend/` 工作目录、
   从 `.git/config` 摘掉残留的 `submodule.tool/nanoka-atlas-backend/…` 段、并删除
   `.git/modules/tool/nanoka-atlas-backend/`（旧仓库对象）。**只处理这个退役路径**，不动 `.gitmodules`
   里仍在使用的子模块。
3. 该清理是**临时机制**（1.5.0 引入，计划 2026-12-31 后删除），逻辑在
   `model/Submodules.js` 的 `pruneRetiredSubmodules()`。
4. 数据需要重新抓一次：`#图鉴初始化`（首次全量，含图片）。新产物落在
   `tool/Hesperides/Hesperides/data/`。
5. 外层目录 `tool/nanoka-atlas-backend/` 里若还有你自己的东西（例如 gitignore 的 `.dsh/`），清理**不会**动它。

## 鸣谢

- [MOPELotus/nanoka-atlas-backend](https://github.com/MOPELotus/nanoka-atlas-backend)：原始实现
  （抓取、图库、分类目录方案都由它打底）
- [nanoka.cc](https://nanoka.cc/)：数据来源
