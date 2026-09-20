// 补丁层回归：结构合法性 / upstream 快照是否与上游一致 / 覆盖率 / 是否误伤其他字段
// 与源脚本的差别：发现问题时以非 0 退出（源脚本只打印，永远 exit 0，不能当回归用）
import fs from 'node:fs'
import path from 'node:path'
import { mod, pluginRoot, requireAtlasData, installFrameworkStubs, logs } from './_helper.mjs'

installFrameworkStubs()
// 本套件要把 logger.warn 收集起来单独展示，故在通用桩之后覆写 warn
const warns = []
globalThis.logger.warn = (m) => { warns.push(String(m)); logs.push([m]) }
globalThis.logger.error = (m) => { warns.push('[err] ' + m); logs.push([m]) }

requireAtlasData()

const patchDataDir = path.join(pluginRoot, 'resources/patch/data')
const { loadMap } = await import(mod('model/itemIndex/mapLoader.js'))
const { loadRawRecord, loadRecord, loadMap: loadMapService, getPatchOverview } = await import(mod('model/AtlasService.js'))
const { getByPath } = await import(mod('components/patch.js'))

const problems = []

/* ============ 1. 遍历所有补丁文件：JSON 合法性 + _patch 结构 ============ */
function walk (dir, rel = '') {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(p, r))
    else if (e.name.endsWith('.json')) out.push({ rel: r, full: p })
  }
  return out
}
const files = fs.existsSync(patchDataDir) ? walk(patchDataDir) : []
console.log(`=== 1. 补丁文件总数：${files.length} ===`)

for (const f of files) {
  let obj
  try {
    obj = JSON.parse(fs.readFileSync(f.full, 'utf8'))
  } catch (err) {
    problems.push(`[JSON 非法] ${f.rel}: ${err.message}`)
    continue
  }
  const meta = obj._patch
  if (!meta) { problems.push(`[缺 _patch] ${f.rel}`); continue }
  if (!meta.note) problems.push(`[缺 note] ${f.rel}`)
  if (!meta.updatedAt) problems.push(`[缺 updatedAt] ${f.rel}`)
  if (!meta.upstream || !Object.keys(meta.upstream).length) problems.push(`[缺 upstream] ${f.rel}`)
  // note 幂等性：不应出现重复的星级说明
  const n = String(meta.note)
  const starHits = (n.match(/源站按最低星级分目录/g) || []).length + (n.match(/源站把本套装星级标为/g) || []).length
  if (starHits > 1) problems.push(`[note 重复追加] ${f.rel}（星级说明出现 ${starHits} 次）`)
  // upstream 每项都要与上游原始数据一致
  const rawRec = loadRawRecord(f.rel)
  if (!rawRec) { problems.push(`[上游条目不存在] ${f.rel}`); continue }
  for (const [dotPath, expect] of Object.entries(meta.upstream)) {
    const cur = getByPath(rawRec, dotPath)
    if (cur !== expect) problems.push(`[upstream 不符] ${f.rel} ${dotPath}: 期望 ${JSON.stringify(expect)} 实际 ${JSON.stringify(cur)}`)
  }
  // 补丁内容不能写成空对象（无实际作用）
  const contentKeys = Object.keys(obj).filter(k => k !== '_patch')
  if (!contentKeys.length) problems.push(`[空补丁] ${f.rel}`)
}

/* ============ 2. 圣遗物补丁专项 ============ */
console.log('\n=== 2. 原神圣遗物补丁专项 ===')
const artiPatches = files.filter(f => f.rel.includes('原神/圣遗物/'))
console.log(`  圣遗物补丁 ${artiPatches.length} 个`)

const EXPECT_RANK = {}
for (const id of ['14001', '14002', '14003', '14004', '15001', '15002', '15003', '15004', '15005', '15006', '15007', '15008', '15014', '15015', '15016', '15017', '15018']) EXPECT_RANK[id] = [4, 5]
for (const id of ['15009', '15010', '15011', '15012', '15013']) EXPECT_RANK[id] = [3, 4]
// 源站把这 16 套的部件 desc 抓成占位文本（「XX专用」/「待定」），补丁里必须补成官方描述
const EXPECT_DESC_FILLED = ['14001', '14004', '15001', '15002', '15005', '15006', '15007', '15008', '15014', '15015', '15016', '15017', '15018', '15019', '15020', '15021']

for (const f of artiPatches) {
  const obj = JSON.parse(fs.readFileSync(f.full, 'utf8'))
  const id = path.basename(f.rel, '.json')
  const rank = obj?.content?.detail?.rank
  const parts = obj?.content?.detail?.parts || {}

  if (EXPECT_RANK[id]) {
    if (JSON.stringify(rank) !== JSON.stringify(EXPECT_RANK[id])) problems.push(`[rank 不符] ${id}: ${JSON.stringify(rank)} 期望 ${JSON.stringify(EXPECT_RANK[id])}`)
  } else if (rank !== undefined) {
    problems.push(`[多余 rank 覆盖] ${id}: ${JSON.stringify(rank)}`)
  }

  if (EXPECT_DESC_FILLED.includes(id)) {
    const bad = Object.entries(parts).filter(([, p]) => typeof p?.desc !== 'string' || !p.desc.trim() || /专用|待定/.test(p.desc))
    if (!Object.keys(parts).length) problems.push(`[缺 desc 覆盖] ${id}`)
    if (bad.length) problems.push(`[desc 未补齐或残留占位] ${id}: ${bad.map(([k]) => k).join(',')}`)
  } else if (Object.keys(parts).length) {
    problems.push(`[多余的 parts 覆盖] ${id}`)
  }
}
// 覆盖面：三星目录 22 套应全部有补丁；四星目录只有 desc 占位那 3 套
const svcMap = loadMapService()
const threeStar = Object.entries(svcMap.games.gi.locales.zh.pages.artifact.records).filter(([, r]) => r.path.includes('/三星/')).map(([id]) => id)
const missing = threeStar.filter(id => !artiPatches.some(f => path.basename(f.rel, '.json') === id))
if (missing.length) problems.push(`[三星目录漏补] ${missing.join(', ')}`)
console.log(`  三星目录 ${threeStar.length} 套，全部有补丁：${missing.length === 0 ? '是' : '否 → ' + missing.join(',')}`)

/* ============ 3. map.json 索引补丁：只改 rarity，不误伤其他字段 ============ */
console.log('\n=== 3. map.json 索引补丁 ===')
const mapPatchPath = path.join(pluginRoot, 'resources/patch/map.json')
if (!fs.existsSync(mapPatchPath)) problems.push('[缺 map.json 补丁]')
else {
  const mp = JSON.parse(fs.readFileSync(mapPatchPath, 'utf8'))
  const recs = mp?.games?.gi?.locales?.zh?.pages?.artifact?.records || {}
  const ids = Object.keys(recs)
  console.log(`  覆盖 ${ids.length} 套：${ids.join(',')}`)
  // 逐条：补丁声明改 rarity，合并后应只剩 rarity 与上游不同
  const rawMap = loadMap()
  for (const [id, patchRec] of Object.entries(recs)) {
    const keys = Object.keys(patchRec)
    if (keys.length !== 1 || keys[0] !== 'rarity') problems.push(`[map 补丁字段多余] ${id}: ${keys.join(',')}`)
    const merged = svcMap.games.gi.locales.zh.pages.artifact.records[id]
    const origin = rawMap.games.gi.locales.zh.pages.artifact.records[id]
    if (!merged || !origin) { problems.push(`[map 记录缺失] ${id}`); continue }
    for (const k of Object.keys(origin)) {
      if (k === 'rarity') continue
      if (JSON.stringify(merged[k]) !== JSON.stringify(origin[k])) problems.push(`[map 误伤其他字段] ${id}.${k}`)
    }
    if (merged.rarity !== '四星') problems.push(`[map rarity 未生效] ${id} = ${merged.rarity}`)
  }
  // 未列出的条目不应被改动
  let unintended = 0
  for (const [id, rec] of Object.entries(svcMap.games.gi.locales.zh.pages.artifact.records)) {
    if (recs[id]) continue
    if (rec.rarity !== rawMap.games.gi.locales.zh.pages.artifact.records[id]?.rarity) { unintended++; problems.push(`[map 意外改动] ${id}`) }
  }
  console.log(`  未列入补丁的条目被改动数：${unintended}（应为 0）`)
}

/* ============ 4. 页面/索引一致性 ============ */
console.log('\n=== 4. 抽查三方一致（rank / meta.rarity / map.rarity） ===')
for (const id of ['14001', '15001', '15009', '15019', '15022', '10005']) {
  const r = svcMap.games.gi.locales.zh.pages.artifact.records[id]
  const mergedRec = loadRecord(r.path)
  console.log(`  ${id}: rank=${JSON.stringify(mergedRec?.content?.detail?.rank)} meta.rarity=${mergedRec?.meta?.rarity} map.rarity=${r.rarity}`)
}

/* ============ 5. 补丁总览 ============ */
console.log('\n=== 5. getPatchOverview ===')
const ov = getPatchOverview()
const stale = ov.dataPatches.filter(p => p.changed.length)
console.log(`  数据补丁 ${ov.dataPatches.length} 条 / 图片 ${ov.images.length} / map ${ov.mapPatch}；过期 ${stale.length}`)
for (const s of stale) console.log(`   ⚠ ${s.relPath}`)

/* ============ 6. logger.warn ============ */
console.log('\n=== 6. logger.warn ===')
console.log(warns.length ? warns.map(w => '  ' + w).join('\n') : '  （无）')

console.log(`\n结果：${problems.length === 0 ? '全部通过 ✅' : `发现 ${problems.length} 个问题 ❌`}`)
for (const p of problems) console.log('  ' + p)
console.log(`\n通过 ${problems.length === 0 ? 1 : 0} / 失败 ${problems.length}`)
process.exit(problems.length === 0 ? 0 : 1)
