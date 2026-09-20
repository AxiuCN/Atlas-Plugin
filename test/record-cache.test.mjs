// 记录缓存（loadRecord LRU + 签名自愈 + 冻结诊断）回归
//   ① 命中：同路径两次取得同一实例
//   ② reloadIndex() 后换新实例
//   ③ LRU 上限：超过上限后最早的一条被淘汰
//   ④ 签名自愈：文件 mtime 变化即重读（改完立刻还原 mtime，不动内容、不影响 git）
//   ⑤ 正确性：缓存实例 == 现读现套补丁的结果（含带补丁的条目）
//   ⑥ 冻结诊断：ATLAS_SCAN_FREEZE=1 时实例被冻结且写入抛错
import fs from 'node:fs'
import path from 'node:path'
import { mod, dataDir, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { loadRecord, loadRawRecord, reloadIndex, getPageRecords } = await import(mod('model/AtlasService.js'))
const { applyDataPatch, listDataPatchFiles } = await import(mod('components/patch.js'))
const { check, finish } = checker()

reloadIndex()
const weapons = getPageRecords('gi', 'weapon').map(e => e.filePath)
const chars = getPageRecords('gi', 'character').map(e => e.filePath)
const target = weapons[0]

console.log('=== ① 命中复用 ===')
const a1 = loadRecord(target)
const a2 = loadRecord(target)
check('同路径两次取得同一实例', a1 === a2 && Boolean(a1), target)

console.log('\n=== ② reloadIndex 后换新 ===')
reloadIndex()
const a3 = loadRecord(target)
check('reloadIndex 后换新实例', a3 !== a2)

console.log('\n=== ③ LRU 上限（300）===')
const paths = [...new Set([...weapons, ...chars])].slice(0, 320)
check('样本路径数足够验证淘汰', paths.length >= 301, `${paths.length} 条`)
const firstLoaded = loadRecord(paths[0])
for (const p of paths.slice(1, 320)) loadRecord(p)
const firstAgain = loadRecord(paths[0])
check('超过上限后最早一条被淘汰重读', firstAgain !== firstLoaded, paths[0])

console.log('\n=== ④ 签名自愈（mtime 变化即重读）===')
const sigTarget = paths[1]
const stat0 = fs.statSync(path.join(dataDir, sigTarget))
reloadIndex()
const b1 = loadRecord(sigTarget)
fs.utimesSync(path.join(dataDir, sigTarget), stat0.atime, new Date(stat0.mtimeMs + 2000))
const b2 = loadRecord(sigTarget)
fs.utimesSync(path.join(dataDir, sigTarget), stat0.atime, stat0.mtime)
const b3 = loadRecord(sigTarget)
check('mtime 变化后重读', b2 !== b1)
check('mtime 还原后再次重读（签名驱动，非一次性失效）', b3 !== b2)
const stat1 = fs.statSync(path.join(dataDir, sigTarget))
check('测试后 mtime 已还原', Math.abs(stat1.mtimeMs - stat0.mtimeMs) < 1500,
  `${new Date(stat0.mtimeMs).toISOString()} → ${new Date(stat1.mtimeMs).toISOString()}`)

console.log('\n=== ⑤ 正确性（缓存实例 == 现读现套补丁）===')
const patchedRel = listDataPatchFiles().find(p => weapons.includes(p) || chars.includes(p)) || listDataPatchFiles()[0]
for (const [label, rel] of [['无补丁条目', target], ['带补丁条目', patchedRel]]) {
  if (!rel) { check(`${label}（样本缺失，跳过）`, true); continue }
  const cached = loadRecord(rel)
  const fresh = loadRawRecord(rel)
  applyDataPatch(fresh, rel)
  check(`${label} 内容一致`, JSON.stringify(cached) === JSON.stringify(fresh), rel)
}

console.log('\n=== ⑥ 冻结诊断（ATLAS_SCAN_FREEZE=1）===')
delete process.env.ATLAS_SCAN_FREEZE
check('默认不冻结', !Object.isFrozen(loadRecord(paths[2])))
process.env.ATLAS_SCAN_FREEZE = '1'
const frozen = loadRecord(paths[3])
let threw = ''
try {
  frozen.__probe = 1
} catch (err) {
  threw = err.constructor.name
}
check('开启后实例被深冻结', Object.isFrozen(frozen) && Object.isFrozen(frozen.content?.list || {}))
check('对其写入抛错', threw === 'TypeError', threw || '未抛错')
delete process.env.ATLAS_SCAN_FREEZE

finish()
