/**
 * LegacyCleanup — 历史遗留清理（**整份文件都是临时机制**）
 *
 * 本模块收纳两处一次性的磁盘清理，都在插件启动时跑一次：
 *   ① `cleanupLegacyCodexDir()` —— 攻略模块剥离前遗留的 `tool/Character-Codex-Data/`
 *      （1.1.0 引入，计划 **2026-12-14** 后删除）
 *   ② `pruneRetiredSubmodules()` —— 旧数据引擎 nanoka-atlas-backend 的三处子模块残留
 *      （1.5.0 引入，计划 **2026-12-31** 后删除）
 *
 * 为什么单独成文件：这两处都是「到期就该整块消失」的代码，混在 `model/Submodules.js`（子模块同步，
 * 长期需求）或 `model/startup.js`（启动编排）里，会让到期时要在长期模块里挖洞。到期处理方式统一为：
 * **删本文件 + `index.js` 一行调用 + `test/legacy-cleanup.test.mjs` + 各册里的对应段落**。
 *
 * 共同安全边界：
 * - 目标路径全部是写死的常量，调用方无法指定任意路径（避免变成通用递归删除入口）
 * - 符号链接 / 目录联接只摘链接本身，不跟进目标
 * - 不存在 → 空操作、不打日志；失败只告警，绝不影响插件加载
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitmodulePaths, runGit } from './Submodules.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** 攻略模块剥离前遗留的数据目录（相对插件根） */
const LEGACY_CODEX_SUBPATH = 'tool/Character-Codex-Data'

/**
 * 已退役的子模块（相对插件根）
 *
 * 只列在这里的路径会被清理；清理时会跳过仍登记在 `.gitmodules` 里的路径。
 */
export const RETIRED_SUBMODULES = ['tool/nanoka-atlas-backend/nanoka-atlas-backend']

/**
 * 清除攻略模块剥离前遗留的攻略数据目录（**临时机制**：1.1.0 引入，计划 2026-12-14 后删除）
 *
 * 背景：1.1.0 把角色攻略剥离为独立插件（Meta-Plugin），本仓库不再收录 `tool/Character-Codex-Data/`。
 * 但外层说明被删除、内层 clone（约 15 MB）是本插件 `.gitignore` 的、**不在版本控制里**，
 * `git pull` 不会删它 —— 用户磁盘上会一直留着。故启动时检测一次，存在就整目录删除。
 * @param {object} [deps] - 依赖（供测试注入）
 * @param {string} [deps.root] - 插件根目录，默认本文件推导出的插件根
 * @param {object} [deps.log] - 日志对象，默认全局 logger
 * @returns {{ removed: boolean, reason?: string }}
 */
export function cleanupLegacyCodexDir (deps = {}) {
  const { root = pluginRoot, log = logger } = deps
  const target = path.join(path.resolve(root), LEGACY_CODEX_SUBPATH)

  let stat
  try {
    stat = fs.lstatSync(target)
  } catch {
    return { removed: false, reason: 'absent' }
  }

  try {
    removePath(target, stat)
    log?.info?.(`[Atlas] 已清除攻略模块剥离前的遗留目录: ${LEGACY_CODEX_SUBPATH}/（该清理为临时机制，见 AGENTS.md 待办）`)
    return { removed: true }
  } catch (err) {
    log?.warn?.(`[Atlas] 遗留攻略目录清除失败（不影响使用，可手动删除 ${LEGACY_CODEX_SUBPATH}/）: ${err.message}`)
    return { removed: false, reason: err.message }
  }
}

/**
 * 清理退役子模块的三处残留（工作目录 / `.git/config` 段 / `.git/modules` 对象）
 *
 * 背景：`git` 只在索引里维护 gitlink，**删掉 `.gitmodules` 条目不会清理任何东西**——
 * 退役子模块的三处残留都会留在磁盘上，其中工作目录带自己的 `.git`，对主仓库是未跟踪内容，
 * `git status` 都看不到。故启动时检测一次。
 *
 * 幂等：任何一步不存在就跳过；失败只收集到 `failed`，由调用方打日志。
 * @param {object} [deps]
 * @param {string} [deps.root] - 仓库根（默认插件根，测试可注入临时目录）
 * @param {Function} [deps.runner] - 注入 git 执行器（测试用）
 * @param {string[]} [deps.retired] - 默认 RETIRED_SUBMODULES
 * @param {boolean} [deps.dryRun] - 只返回计划、不真删
 * @returns {Promise<{pruned: {path: string, actions: string[]}[], failed: {path: string, error: string}[]}>}
 */
export async function pruneRetiredSubmodules (deps = {}) {
  const {
    root = pluginRoot,
    runner = runGit,
    retired = RETIRED_SUBMODULES,
    dryRun = false
  } = deps

  const gitDir = path.join(root, '.git')
  const configPath = path.join(gitDir, 'config')
  const registered = gitmodulePaths(root)
  const pruned = []
  const failed = []

  for (const subPath of retired) {
    // 仍在 .gitmodules 里的路径绝对不碰（防止误删仍在用的子模块）
    if (registered.includes(subPath)) continue

    const actions = []
    try {
      if (configHasSection(configPath, subPath)) {
        actions.push('config')
        if (!dryRun) {
          const result = await runner(['config', '--remove-section', `submodule.${subPath}`], { cwd: root })
          if (!result.ok) {
            // 段不存在或已被删掉都算成功；其它错误上报
            const message = String(result.stderr || '')
            if (!/No such section|not found/i.test(message)) throw new Error(message.trim().slice(0, 300))
          }
        }
      }

      const workDir = path.join(root, subPath)
      if (exists(workDir)) {
        actions.push('workdir')
        if (!dryRun) removePath(workDir)
      }

      const modulesDir = path.join(gitDir, 'modules', ...subPath.split('/'))
      if (exists(modulesDir)) {
        actions.push('gitmodules-dir')
        if (!dryRun) removePath(modulesDir)
      }

      if (actions.length) pruned.push({ path: subPath, actions })
    } catch (err) {
      failed.push({ path: subPath, error: String(err?.message || err) })
    }
  }

  return { pruned, failed }
}

/**
 * 启动时跑一遍全部遗留清理（两处机制合一个入口）
 *
 * 顺序固定：先删攻略遗留目录（纯本地、无 git），再清退役子模块（要写 `.git/config`）。
 * 调用方必须**在子模块同步之前** await 本函数——两者都会写 `.git/config`，
 * 并发会撞上 git 的 `config.lock`（见 `index.js`）。
 * @param {object} [deps]
 * @param {string} [deps.root] - 插件根（测试可注入）
 * @param {object} [deps.log] - 日志对象（测试可注入）
 * @param {Function} [deps.runner] - git 执行器（测试可注入）
 * @returns {Promise<{codex: object, submodules: {pruned: object[], failed: object[]}}>}
 */
export async function runLegacyCleanup (deps = {}) {
  const { root = pluginRoot, log = logger } = deps
  const codex = cleanupLegacyCodexDir({ root, log })
  const submodules = await pruneRetiredSubmodules({ ...deps, root })
  for (const item of submodules.pruned) {
    log?.info?.(`[Atlas] 已清理退役子模块 ${item.path}/（${item.actions.join(' / ')}；临时机制，见 AGENTS.md 待办）`)
  }
  for (const item of submodules.failed) {
    log?.warn?.(`[Atlas] 退役子模块清理失败（不影响使用，可手动删除 ${item.path}/）: ${item.error}`)
  }
  return { codex, submodules }
}

/** `.git/config` 里是否有某子模块段 */
function configHasSection (configPath, subPath) {
  try {
    const text = fs.readFileSync(configPath, 'utf8')
    return text.includes(`[submodule "${subPath}"]`)
  } catch {
    return false
  }
}

/** 路径存在（含符号链接） */
function exists (target) {
  try {
    fs.lstatSync(target)
    return true
  } catch {
    return false
  }
}

/** 删除路径：符号链接只摘链接本身，目录整棵删 */
function removePath (target, stat) {
  const info = stat || fs.lstatSync(target)
  if (info.isSymbolicLink()) {
    fs.unlinkSync(target)
    return
  }
  fs.rmSync(target, { recursive: true, force: true })
}