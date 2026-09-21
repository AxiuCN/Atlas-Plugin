// 启动生命周期回归（**数据无关**：注入假 sync / reload，新克隆的仓库也能跑）
//   钉住 model/startup.js 的编排契约：
//     ① sync 先起、立即 reload —— 第一次查询就有索引
//     ② sync 报告「确实切换了子模块」→ 再 reload 一次（否则可能把同步前的 map.json 固化到进程结束）
//     ③ sync 失败 / 抛异常 / reload 抛异常，都不得让 initAtlas 抛出，也不得丢掉首次 reload
import { mod, checker, installFrameworkStubs, logs } from './_helper.mjs'

installFrameworkStubs()
const { initAtlas } = await import(mod('model/startup.js'))
const { check, finish } = checker()

/**
 * 造一组带调用记录与标志位的假依赖
 * @param {object} [opts]
 * @param {object} [opts.syncResult] - sync 返回值
 * @param {boolean} [opts.syncThrow] - sync 同步抛出
 * @param {boolean} [opts.syncReject] - sync 返回 rejected promise
 * @param {number} [opts.syncDelay] - sync resolve 延迟（ms）
 * @param {boolean} [opts.reloadThrow] - reload 抛出
 */
function fakeDeps (opts = {}) {
  const { syncResult = { ok: true, skipped: true }, syncThrow = false, syncReject = false, syncDelay = 0, reloadThrow = false } = opts
  const order = []
  const flags = { syncFinished: false, secondReloadSawSyncFinished: null }
  let reloads = 0

  const deps = {
    sync () {
      order.push('sync')
      if (syncThrow) throw new Error('sync boom')
      if (syncReject) return Promise.reject(new Error('sync reject'))
      if (syncDelay) {
        return new Promise((resolve) => {
          setTimeout(() => {
            flags.syncFinished = true
            order.push('sync-done')
            resolve(syncResult)
          }, syncDelay)
        })
      }
      flags.syncFinished = true
      order.push('sync-done')
      return syncResult
    },
    reload () {
      reloads++
      order.push('reload')
      if (reloads === 2) flags.secondReloadSawSyncFinished = flags.syncFinished
      if (reloadThrow) throw new Error('reload boom')
    },
    log: { info: () => {}, warn: (...args) => logs.push(args) }
  }
  return { deps, order, flags, reloadCount: () => reloads }
}

console.log('=== A. 已同步（skipped）：只 reload 一次，sync 先于 reload ===')
{
  const f = fakeDeps({ syncResult: { ok: true, skipped: true } })
  const ret = await initAtlas(f.deps)
  check('顺序 sync → sync-done → reload', f.order.join('>') === 'sync>sync-done>reload', f.order.join('>'))
  check('reload 恰好 1 次', f.reloadCount() === 1, String(f.reloadCount()))
  check('reloadedAfterSync = false（skipped 不重建）', ret.reloadedAfterSync === false)
  check('返回值 reloads 与实际调用次数一致', ret.reloads === 1, String(ret.reloads))
}

console.log('\n=== B. 子模块确实切换：reload 两次，第二次在 sync 完成之后 ===')
{
  const f = fakeDeps({ syncResult: { ok: true }, syncDelay: 5 })
  const ret = await initAtlas(f.deps)
  check('顺序 sync → reload → sync-done → reload', f.order.join('>') === 'sync>reload>sync-done>reload', f.order.join('>'))
  check('reload 恰好 2 次', f.reloadCount() === 2, String(f.reloadCount()))
  check('第二次 reload 发生在 sync resolve 之后', f.flags.secondReloadSawSyncFinished === true)
  check('reloadedAfterSync = true', ret.reloadedAfterSync === true)
  check('sync 结果透传', ret.sync?.ok === true)
}

console.log('\n=== C. sync 返回失败：不重建，但仍完成首次 reload ===')
{
  const f = fakeDeps({ syncResult: { ok: false, error: 'git 挂了' } })
  const ret = await initAtlas(f.deps)
  check('reload 恰好 1 次', f.reloadCount() === 1, String(f.reloadCount()))
  check('reloadedAfterSync = false', ret.reloadedAfterSync === false)
  check('sync 失败结果透传', ret.sync?.error === 'git 挂了')
}

console.log('\n=== D. sync 抛异常 / reject：不抛出、不丢首次 reload ===')
{
  const before = logs.length
  const f = fakeDeps({ syncThrow: true })
  const ret = await initAtlas(f.deps)
  check('initAtlas 未抛出（同步异常）', true)
  check('reload 仍执行 1 次', f.reloadCount() === 1, String(f.reloadCount()))
  check('sync = null', ret.sync === null)
  check('已记 warn 日志', logs.length > before)

  const g = fakeDeps({ syncReject: true })
  const ret2 = await initAtlas(g.deps)
  check('initAtlas 未抛出（reject）', true)
  check('reload 仍执行 1 次', g.reloadCount() === 1, String(g.reloadCount()))
  check('sync = null', ret2.sync === null)
}

console.log('\n=== E. reload 抛异常：不抛出，只告警（首次查询仍可惰性重建）===')
{
  const before = logs.length
  const f = fakeDeps({ reloadThrow: true })
  const ret = await initAtlas(f.deps)
  check('initAtlas 未抛出', true)
  check('reload 被调用（异常被吞）', f.reloadCount() === 1, String(f.reloadCount()))
  check('已记 warn 日志', logs.length > before)
  check('返回值仍完整', typeof ret.reloads === 'number' && ret.reloadedAfterSync === false)
}

console.log('\n=== F. 连续两次启动互不串扰 ===')
{
  const a = fakeDeps({ syncResult: { ok: true } })
  const b = fakeDeps({ syncResult: { ok: true, skipped: true } })
  await initAtlas(a.deps)
  await initAtlas(b.deps)
  check('第一次（切换）reload 2 次', a.reloadCount() === 2, String(a.reloadCount()))
  check('第二次（skipped）reload 1 次', b.reloadCount() === 1, String(b.reloadCount()))
  check('两次的调用序列独立', a.order.join('>') !== b.order.join('>'))
}

finish()
