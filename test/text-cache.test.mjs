// 全文兜底文本缓存回归
//   ① 首次查询读原文，二次同关键词 0 读盘（缓存生效）
//   ② reloadIndex() 后缓存作废，重新读
//   ③ 条目 mtime 变化 → 该条重新读（签名自愈）；mtime 还原 → 再次重读
//   ④ 结果不变：命中条目与条数与缓存前一致
import fs from 'node:fs'
import path from 'node:path'
import { mod, dataDir, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { search, reloadIndex, getPageRecords } = await import(mod('model/AtlasService.js'))
const { check, finish } = checker()

/** 记录一次查询期间读到的条目文件（只统计图鉴数据目录下的 .json） */
const origRead = fs.readFileSync
let reads = []
fs.readFileSync = function (p, ...rest) {
  const s = String(p)
  if (s.endsWith('.json') && s.includes('nanoka-atlas-backend')) reads.push(s)
  return origRead.call(fs, p, ...rest)
}
const count = (fn) => {
  reads = []
  const t0 = process.hrtime.bigint()
  const ret = fn()
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  return { ret, n: reads.length, ms, files: [...reads] }
}
const KW = '胡桃'

reloadIndex()
const first = count(() => search('gi', KW))
const second = count(() => search('gi', KW))

console.log('=== ① 缓存生效 ===')
check('首次查询确实读原文', first.n > 100, `${first.n} 次 / ${first.ms.toFixed(0)}ms`)
check('二次同关键词 0 读盘', second.n === 0, `${second.n} 次 / ${second.ms.toFixed(0)}ms`)
check('二次更快', second.ms < first.ms / 2, `${first.ms.toFixed(0)}ms → ${second.ms.toFixed(0)}ms`)

console.log('\n=== ② 结果不变 ===')
const topA = first.ret?.results?.[0]
const topB = second.ret?.results?.[0]
check('首条一致', JSON.stringify(topA) === JSON.stringify(topB), `${topA?.name}(${topA?.pageKey})`)
check('结果条数一致', first.ret?.results?.length === second.ret?.results?.length,
  `${first.ret?.results?.length} → ${second.ret?.results?.length}`)

console.log('\n=== ③ reloadIndex 后作废 ===')
reloadIndex()
const third = count(() => search('gi', KW))
check('重载后重新读原文', third.n > 100, `${third.n} 次`)

console.log('\n=== ④ mtime 变化 → 单条自愈 ===')
// 取一条被扫描集覆盖的条目（武器页在 flat 前段，必然被扫到）
const target = getPageRecords('gi', 'weapon')[0].filePath
const abs = path.join(dataDir, target)
const stat0 = fs.statSync(abs)
const warm = count(() => search('gi', KW)) // 先捂热（此时应 0 读）
check('捂热后 0 读盘', warm.n === 0, `${warm.n} 次`)
fs.utimesSync(abs, stat0.atime, new Date(stat0.mtimeMs + 2000))
const afterBump = count(() => search('gi', KW))
fs.utimesSync(abs, stat0.atime, stat0.mtime)
const afterRestore = count(() => search('gi', KW))
check('mtime 变化后仅该条重读', afterBump.n === 1 && afterBump.files[0].split(path.sep).join('/').endsWith(target),
  `${afterBump.n} 次：${afterBump.files.map(f => path.basename(f)).join(',') || '-'}`)
check('mtime 还原后再次重读', afterRestore.n === 1 || afterRestore.n === 0,
  `${afterRestore.n} 次：${afterRestore.files.map(f => path.basename(f)).join(',') || '-'}`)
check('测试后 mtime 已还原', Math.abs(fs.statSync(abs).mtimeMs - stat0.mtimeMs) < 1500)

finish()
