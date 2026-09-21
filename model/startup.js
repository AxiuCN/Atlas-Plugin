/**
 * startup — 插件启动编排
 *
 * index.js 载入时的真实顺序：
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
import { reloadIndex } from './AtlasService.js'
import { syncSubmodule } from './AtlasUpdater.js'

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
