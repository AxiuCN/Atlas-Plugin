// reload 契约回归（需图鉴数据）
//   契约：reloadIndex() 返回后，所有「随图鉴数据变化」的进程内缓存都已作废，后续读取必然取到新数据。
//   本套件用**临时数据补丁**制造一次真实的数据变化，验证的是行为而不是对象身份：
//     ① 未 reload：补丁不生效（读到的是缓存里的旧数据）
//     ② reloadIndex() 后：补丁生效（新数据真的被读到，不只是换了对象）
//     ③ loadRawRecord 不受补丁影响（补丁不被过度应用）
//     ④ 删掉补丁但未 reload：仍读缓存；再 reload 才复原
//     ⑤ 消费侧不再返回上一代对象；连续两次 reload 结论一致（不该变的没变）
import fs from 'node:fs'
import path from 'node:path'
import { mod, pluginRoot, tmpDir, ensureTmpDir, hasCodexRepo, requireAtlasData, skip, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { reloadIndex, loadRecord, loadRawRecord, loadMap, getPageRecords, search } = await import(mod('model/AtlasService.js'))
const { PATCH_DATA_DIR, PATCH_MAP_FILE } = await import(mod('components/patch.js'))
const { listCodexGuides, getCharacterGuide, reloadCodexIndex } = await import(mod('model/codexIndex/index.js'))
const mapLoader = await import(mod('model/itemIndex/mapLoader.js'))
const monsterIndex = await import(mod('model/monsterIndex/index.js'))
const curve = await import(mod('model/monsterIndex/curve.js'))
const { check, finish } = checker()

/** 临时补丁写入的哨兵键/值（只新增字段，不覆盖任何真实数据） */
const KEY = '__reloadContractSentinel'
const SENTINEL = 'RELOAD-CONTRACT-SENTINEL'

/** 递归删掉上次异常退出可能残留的临时补丁 */
function sweepLeftovers (dir) {
  if (!fs.existsSync(dir)) return 0
  let removed = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { removed += sweepLeftovers(full); continue }
    if (!entry.name.endsWith('.json')) continue
    try {
      if (fs.readFileSync(full, 'utf8').includes(SENTINEL)) { fs.unlinkSync(full); removed++ }
    } catch { /* 读不了就跳过 */ }
  }
  return removed
}

const swept = sweepLeftovers(PATCH_DATA_DIR)
if (swept) console.log(`（清理上次残留的临时补丁 ${swept} 个）`)

/** H 节会临时改 resources/patch/map.json（入库文件）：先备份到 .test-tmp，跑崩了下次启动靠它字节级还原 */
const mapBackup = path.join(ensureTmpDir(), 'patch-map.backup.json')
if (fs.existsSync(mapBackup)) {
  fs.writeFileSync(PATCH_MAP_FILE, fs.readFileSync(mapBackup))
  fs.unlinkSync(mapBackup)
  console.log('（还原上次残留的索引补丁备份）')
}

/** 挑一个「真实存在 + 尚无补丁文件」的物品条目（补丁路径 = PATCH_DATA_DIR/<map 里的相对路径>） */
function pickTarget () {
  for (const game of Object.values(loadMap()?.games || {})) {
    const records = game?.locales?.zh?.pages?.item?.records || {}
    for (const rec of Object.values(records)) {
      const rel = rec?.path
      if (!rel?.endsWith('.json')) continue
      if (!loadRawRecord(rel)?.content) continue
      if (fs.existsSync(path.join(PATCH_DATA_DIR, rel))) continue
      return rel
    }
  }
  return ''
}

const target = pickTarget()
if (!target) skip('找不到「无补丁的物品条目」样本，无法做补丁驱动的契约验证')
const patchFile = path.join(PATCH_DATA_DIR, target)

/** 逐级创建补丁目录，返回本次新建的目录（浅→深），便于原样清理 */
function makeDirs (file) {
  const created = []
  let dir = path.dirname(file)
  while (!fs.existsSync(dir)) { created.unshift(dir); dir = path.dirname(dir) }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  return created
}

const createdDirs = makeDirs(patchFile)
const writePatch = () => fs.writeFileSync(patchFile, JSON.stringify({
  _patch: { note: 'reload-contract 套件临时补丁（跑完即删，勿提交）' },
  content: { [KEY]: SENTINEL }
}, null, 2), 'utf8')

/** 清理：删临时补丁、删本次新建的空目录、把索引恢复到无补丁状态 */
function cleanup () {
  try { if (fs.existsSync(patchFile)) fs.unlinkSync(patchFile) } catch { /* ignore */ }
  for (const dir of [...createdDirs].reverse()) {
    try { fs.rmdirSync(dir) } catch { /* 非空或已删则忽略 */ }
  }
  reloadIndex()
}

console.log(`样本条目：${target}`)

console.log('\n=== A. 预热：先建立缓存 ===')
reloadIndex()
const before = loadRecord(target)
check('记录可读', Boolean(before?.content))
check('预热实例不含哨兵', before?.content?.[KEY] === undefined)

console.log('\n=== B. 写入补丁但未 reload：必须看不到（读缓存旧数据）===')
writePatch()
const stillOld = loadRecord(target)
check('未 reload 时补丁不生效（值仍是旧数据）', stillOld?.content?.[KEY] === undefined)
check('未 reload 时返回同一缓存实例', stillOld === before)

console.log('\n=== C. reloadIndex()：必须真的读到新数据 ===')
reloadIndex()
const after = loadRecord(target)
check('reload 后读到补丁后的新值（行为级，不只是换对象）', after?.content?.[KEY] === SENTINEL, String(after?.content?.[KEY]))
check('reload 后实例换新', after !== before)
check('loadRawRecord 仍为上游原值（补丁不过度应用）', loadRawRecord(target)?.content?.[KEY] === undefined)

console.log('\n=== D. 删除补丁但不 reload：仍读缓存（复原只能靠 reload）===')
fs.unlinkSync(patchFile)
check('删补丁后未 reload 仍返回补丁实例', loadRecord(target)?.content?.[KEY] === SENTINEL)

console.log('\n=== E. 再 reload：回到上游原值 ===')
reloadIndex()
check('reload 后回到上游值（补丁已撤）', loadRecord(target)?.content?.[KEY] === undefined)
check('loadRawRecord 依旧原值', loadRawRecord(target)?.content?.[KEY] === undefined)

console.log('\n=== F. 消费侧不再返回上一代对象 ===')
const gen1 = {
  map: loadMap(),
  pages: getPageRecords('gi', 'character'),
  hit: search('gi', '胡桃')?.results?.[0],
  items: mapLoader.getItemRecords('gi'),
  monsters: monsterIndex.listMonsterEntries('zzz')
}
reloadIndex()
const gen2 = {
  map: loadMap(),
  pages: getPageRecords('gi', 'character'),
  hit: search('gi', '胡桃')?.results?.[0],
  items: mapLoader.getItemRecords('gi'),
  monsters: monsterIndex.listMonsterEntries('zzz')
}
check('map 对象换新', gen1.map !== gen2.map)
check('页面条目对象换新（旧索引条目不再被返回）', gen1.pages?.[0] !== gen2.pages?.[0])
check('搜索结果条目对象换新', Boolean(gen1.hit) && gen1.hit !== gen2.hit)
check('物品页投影换新', gen1.items !== gen2.items)
check('怪物条目数组换新', gen1.monsters !== gen2.monsters)

console.log('\n=== G. 幂等：连续两次 reload，结论必须一致 ===')
const probe = () => ({
  top: search('gi', '胡桃')?.results?.[0]?.name || '',
  monsters: monsterIndex.listMonsterEntries('zzz').length,
  items: Object.keys(mapLoader.getItemRecords('gi') || {}).length,
  curve: curve.giCurveValue('GROW_CURVE_HP')
})
reloadIndex()
const first = probe()
reloadIndex()
const second = probe()
check('搜索首条一致', first.top === second.top, first.top)
check('怪物条目数一致', first.monsters === second.monsters, String(first.monsters))
check('物品页条目数一致', first.items === second.items, String(first.items))
check('怪物曲线值一致（插件自有资源，不参与失效）', first.curve === second.curve, String(first.curve))

console.log('\n=== H. 图鉴换新后，攻略解析缓存必须按新索引重解析（新 index → 旧 cache）===')
if (!hasCodexRepo()) {
  console.log('  （攻略仓库未拉取，本节跳过）')
} else {
  /** 候选：能反查到角色、且「图鉴条目名 ≠ 攻略卡名」——只有这种会走反查缓存（路径②） */
  const candidates = []
  for (const gameId of ['gi', 'hsr', 'zzz']) {
    for (const g of listCodexGuides() || []) {
      if (g.game && g.game !== gameId) continue
      const res = search(gameId, g.name)
      const top = res?.results?.[0]
      if (res?.type === 'empty' || top?.pageKey !== 'character') continue
      if (top.name === g.name) continue
      if (!getCharacterGuide(gameId, top.name)) continue
      candidates.push({ gameId, card: g.name, entry: top.name, id: top.recordId })
    }
  }

  const nameOf = (g) => (g ? g.name : null)
  let discriminated = false
  for (const c of candidates.slice(0, 3)) {
    reloadCodexIndex()
    const g1 = getCharacterGuide(c.gameId, c.entry) // 在图鉴代际 G1 下建立解析缓存
    if (!g1) continue

    const originalBytes = fs.readFileSync(PATCH_MAP_FILE)
    fs.writeFileSync(mapBackup, originalBytes)
    let afterReload = null
    let truth = null
    try {
      // 图鉴侧改名（攻略仓库文件不动）：reloadIndex() 会让图鉴代际变化
      fs.writeFileSync(PATCH_MAP_FILE, JSON.stringify({
        _patch: { note: 'reload-contract 套件临时索引补丁（跑完还原）' },
        games: { [c.gameId]: { locales: { zh: { pages: { character: { records: { [c.id]: { name: '兹兹测试' } } } } } } } }
      }, null, 2), 'utf8')
      reloadIndex()
      afterReload = getCharacterGuide(c.gameId, c.entry) // 契约要求：此刻就该反映新图鉴
      reloadCodexIndex()
      truth = getCharacterGuide(c.gameId, c.entry) // 地面真值：完全重解析
    } finally {
      fs.writeFileSync(PATCH_MAP_FILE, originalBytes)
      fs.unlinkSync(mapBackup)
      reloadIndex()
      reloadCodexIndex()
    }

    if (nameOf(truth) === nameOf(g1)) {
      console.log(`  · 样本 ${c.gameId}/${c.entry} 改名后解析结果不变（走别名直配路径①），换下一个`)
      continue
    }

    console.log(`  · 样本 ${c.gameId}/${c.entry}（卡名 ${c.card}）：改名前 ${nameOf(g1)}｜reload 后 ${nameOf(afterReload)}｜地面真值 ${nameOf(truth)}`)
    check('reloadIndex() 后攻略解析已按新图鉴索引重建（不等地面真值即旧代际泄漏）', nameOf(afterReload) === nameOf(truth))
    check('还原索引补丁后该角色攻略恢复可查', Boolean(getCharacterGuide(c.gameId, c.entry)))
    check('索引补丁已字节级还原', Buffer.compare(fs.readFileSync(PATCH_MAP_FILE), originalBytes) === 0)
    discriminated = true
    break
  }
  if (!discriminated) console.log('  ⚠ 没找到可判别样本（攻略卡名与图鉴条目名全等，反查路径未被使用）——本节未产生断言')
}

cleanup()
console.log('\n清理：临时补丁已删除、新建目录已回收、索引已恢复')
finish()
