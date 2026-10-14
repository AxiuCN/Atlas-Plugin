/**
 * startup — 插件启动编排
 *
 * index.js 载入时的真实顺序：
 *   ⓪ cleanupLegacyCodexDir() —— 同步执行，清除攻略模块剥离前遗留的 `tool/Character-Codex-Data/`（**临时机制**，见下）
 *   ① syncSubmodule() —— 同步起（**不 await**：git 可能拉到 120 s，而框架 plugin_load_timeout 只有 60 s，
 *                         await 会让「首次安装」直接判插件加载超时）
 *   ② reloadIndex()   —— 立即用当前磁盘数据建索引，第一次查询就能用；失败只告警（首次查询会惰性重建）
 *   ③ sync 报告「确实切换了子模块」（ok 且非 skipped）→ 再 reloadIndex() 一次
 *
 * ③ 是必需的：②有可能在 git checkout 期间读到**同步前**的 map.json，而 ensureIndex() 只判
 * `if (mapCache) return`（AtlasService.js），那份旧索引会被固化到进程结束——只能靠 #图鉴更新 或重启恢复。
 *
 * 本模块只做编排、不含业务：sync / reload / log 都可注入，因此在**没有图鉴数据**的环境也能完整测试
 * （见 test/startup-lifecycle.test.mjs）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reloadIndex } from './AtlasService.js'
import { syncSubmodule } from './AtlasUpdater.js'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 攻略模块剥离前遗留的数据目录（相对插件根）
 *
 * 只删这一个固定相对路径，调用方无法指定任意路径 —— 避免把清理逻辑变成通用的递归删除入口。
 */
const LEGACY_CODEX_SUBPATH = 'tool/Character-Codex-Data'

/**
 * 清除攻略模块剥离前遗留的攻略数据目录（**临时机制**：1.1.0 引入，计划 2026-12-14 后删除）
 *
 * 背景：1.1.0 把角色攻略剥离为独立插件（Meta-Plugin），本仓库不再收录 `tool/Character-Codex-Data/`。
 * 但外层说明被删除、内层 clone（约 15 MB）是本插件 `.gitignore` 的、**不在版本控制里**，
 * `git pull` 不会删它 —— 用户磁盘上会一直留着。故启动时检测一次，存在就整目录删除。
 *
 * 安全约束：
 * - 目标固定为 `<root>/tool/Character-Codex-Data`（root 仅供测试注入，默认插件根）
 * - 符号链接 / 目录联接只摘链接本身，不跟进目标（否则 recursive rm 可能删掉链接指向的内容）
 * - 不存在 → 空操作、不打日志（常规情况，每次启动都会走到）；失败只告警，不影响插件加载
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
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(target)
    } else {
      fs.rmSync(target, { recursive: true, force: true })
    }
    log?.info?.(`[Atlas] 已清除攻略模块剥离前的遗留目录: ${LEGACY_CODEX_SUBPATH}/（该清理为临时机制，见 AGENTS.md 待办）`)
    return { removed: true }
  } catch (err) {
    log?.warn?.(`[Atlas] 遗留攻略目录清除失败（不影响使用，可手动删除 ${LEGACY_CODEX_SUBPATH}/）: ${err.message}`)
    return { removed: false, reason: err.message }
  }
}

/**
 * 启动 Atlas：先起子模块同步 → 立即建索引 → 同步确实改了数据则重建
 * @param {object} [deps] - 依赖（供测试注入）
 * @param {Function} [deps.sync] - 子模块同步，默认 syncSubmodule，返回 { ok, skipped?, error? }
 * @param {Function} [deps.reload] - 索引重建，默认 reloadIndex
 * @param {object} [deps.log] - 日志对象，默认全局 logger
 * @returns {Promise<{ sync: object|null, reloads: number, reloadedAfterSync: boolean }>}
 *          sync = 同步结果（失败/异常为 null）；reloads = 实际重建次数；reloadedAfterSync = 是否因同步而重建
 */
export async function initAtlas (deps = {}) {
  const { sync = syncSubmodule, reload = reloadIndex, log = logger } = deps

  let reloads = 0
  const tryReload = () => {
    reloads++
    try {
      reload()
      return true
    } catch (err) {
      // 与改动前 index.js 的行为一致：建索引失败只告警，由首次查询惰性重建兜底
      log?.warn?.(`[Atlas] 索引加载失败: ${err.message}`)
      log?.warn?.('[Atlas] 请确保已执行 nanoka-atlas-backend 数据抓取')
      return false
    }
  }

  // ① 同步调用：保持改动前「syncSubmodule 的同步前缀先跑，随后才建索引」的顺序
  let syncing
  try {
    syncing = Promise.resolve(sync())
  } catch (err) {
    log?.warn?.(`[Atlas] 子模块同步未完成: ${err?.message || err}`)
    syncing = Promise.resolve(null)
  }

  // ② 先用当前磁盘数据建索引
  tryReload()

  // ③ 只有真的切换了子模块才重建（常规启动 skipped → 零额外开销；失败不重建，交给惰性兜底）
  const result = await syncing.catch((err) => {
    log?.warn?.(`[Atlas] 子模块同步未完成: ${err?.message || err}`)
    return null
  })
  const changed = Boolean(result?.ok && !result.skipped)
  if (changed) {
    log?.info?.('[Atlas] 子模块已更新，重建索引')
    tryReload()
  }

  return { sync: result, reloads, reloadedAfterSync: changed }
}
