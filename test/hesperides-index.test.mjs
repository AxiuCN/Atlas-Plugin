/**
 * Hesperides 索引：`index.json` 的页记录 → 搜索索引，以及合成路径的记录读取
 *
 * 覆盖：
 * - 页目录名 ↔ 插件 pageKey（只索引 `PAGE_LABELS` 里认识的页，终局页目录名不参与）
 * - 记录合成（合成路径 / 名字退化 / 稀有度透传 / ids 与 entries 的取序 / 可选字段退化）
 * - 索引对象形状（`games.<game>.locales.zh.pages`）与小计，空产物返回 null
 * - 单一数据源：`getHesperidesMap()` 的结果里每页、每条记录都来自 Hesperides
 * - `AtlasRepository` 的合成路径分发（真实产物：适配成旧结构、签名可判活、缺失返回 null）
 *
 * 前半段是纯函数（数据无关）；后半段需要 Hesperides 产物，缺失则跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  mod,
  checker,
  installFrameworkStubs,
  pluginRoot,
  hesperidesDir
} from './_helper.mjs'

installFrameworkStubs()

const { check, finish } = checker()

const {
  PAGE_KEY_BY_DIR,
  pageKeyOfDir,
  pageToMapRecords,
  buildMapPages,
  buildHesperidesMap,
  getHesperidesMap,
  countIndex
} = await import(mod('model/HesperidesIndex.js'))
const { PAGE_LABELS } = await import(mod('components/constants.js'))
const { syntheticPath, parseSyntheticPath } = await import(mod('model/HesperidesRepository.js'))
const { hasHesperidesData, getHesperidesIndex } = await import(mod('model/Hesperides.js'))
const { loadRecord, loadRawRecord, recordSignature, isHesperidesPath, resetRecordCache } = await import(mod('model/AtlasRepository.js'))

/* ============================================================
 *  ① 页目录名 ↔ pageKey
 * ============================================================ */
console.log('=== ① 页目录名映射 ===')
check('普通页同名', pageKeyOfDir('character') === 'character' && pageKeyOfDir('weapon') === 'weapon')
check('带斜杠的页由 PAGE_LABELS 反推', pageKeyOfDir('achievement-achievement') === 'achievement/achievement')
check('下划线旧页名不被误映射', pageKeyOfDir('item-all') === '' && pageKeyOfDir('currency-augment') === '')
check('终局页目录名不参与索引', ['abyss', 'theater', 'stygian', 'chaos', 'as', 'fiction', 'arbitration'].every(d => pageKeyOfDir(d) === ''))
check('空值容错', pageKeyOfDir('') === '' && pageKeyOfDir(null) === '')
check('映射表与 PAGE_LABELS 一一对应', PAGE_KEY_BY_DIR.size === Object.keys(PAGE_LABELS).length)

/* ============================================================
 *  ② 记录合成
 * ============================================================ */
console.log('=== ② 记录合成 ===')
const fixturePage = {
  ids: ['10000002', '10000003'],
  records: 2,
  entries: {
    10000002: { name: '神里绫华', rarity: 5 },
    10000003: {},
    // entries 里有但 ids 里没有的（产物不一致时不入索引）
    stale: { name: '幽灵条目', rarity: 4 }
  }
}
const records = pageToMapRecords('gi', 'character', fixturePage)
check('只按 ids 生成', Object.keys(records).sort().join(',') === '10000002,10000003')
check('合成路径', records['10000002'].path === syntheticPath('gi', 'character', '10000002'))
check('合成路径可反向解析', parseSyntheticPath(records['10000002'].path)?.id === '10000002')
check('名字与稀有度透传', records['10000002'].name === '神里绫华' && records['10000002'].rarity === 5)
check('缺名字退化到 id', records['10000003'].name === '10000003')
check('缺 hasDetail/imageCount 退化为 false/0', records['10000003'].hasDetail === false && records['10000003'].imageCount === 0)
check('labels 带 hasDetail/imageCount 时透传', (() => {
  const one = pageToMapRecords('gi', 'monster', { ids: ['1'], entries: { 1: { name: '史莱姆', rarity: 1, hasDetail: true, imageCount: 3 } } })
  return one['1'].hasDetail === true && one['1'].imageCount === 3
})())
check('ids 缺失时以 entries 的键为准', (() => {
  const one = pageToMapRecords('gi', 'character', { entries: { a: { name: '甲' }, b: { name: '乙' } } })
  return Object.keys(one).sort().join(',') === 'a,b'
})())
check('空页返回空表', Object.keys(pageToMapRecords('gi', 'character', {})).length === 0
  && Object.keys(pageToMapRecords('gi', 'character', null)).length === 0)

/* ============================================================
 *  ③ buildMapPages
 * ============================================================ */
console.log('=== ③ buildMapPages ===')
const FIXTURE_GAMES = {
  gi: {
    pages: {
      character: { ids: ['1'], entries: { 1: { name: '甲' } } },
      abyss: { ids: ['9'], entries: { 9: { name: '' } } },
      'item-all': { ids: ['7'], entries: { 7: { name: '物品' } } }
    }
  },
  zzz: { pages: { boss: { ids: ['69001'], entries: {} }, 'hollow-tpp': { ids: ['1'], entries: {} } } },
  hsr: { pages: {} }
}
const built = buildMapPages(FIXTURE_GAMES)
check('只保留插件认识的页', Object.keys(built.gi || {}).join(',') === 'character')
check('绝区零同名页被索引、非常规页被排除', Object.keys(built.zzz || {}).join(',') === 'boss' && !('hollow-tpp' in built.zzz))
check('没有可索引页的游戏不出现在结果里', !('hsr' in built))
check('终局页目录名被排除', !('abyss' in (built.gi || {})))
check('空 games 容错', Object.keys(buildMapPages(null)).length === 0 && Object.keys(buildMapPages({})).length === 0)

/* ============================================================
 *  ④ 索引对象与小计
 * ============================================================ */
console.log('=== ④ 索引对象 ===')
const builtIndex = buildHesperidesMap(FIXTURE_GAMES)
check('索引对象形状与 ensureIndex 消费的一致',
  builtIndex?.games?.gi?.locales?.zh?.pages?.character?.records?.['1']?.name === '甲')
check('页标题留空由 PAGE_LABELS 兜底', builtIndex.games.gi.locales.zh.pages.character.title === '')
check('记录数是 ids 条数', Object.keys(builtIndex.games.gi.locales.zh.pages.character.records).length === 1)
check('只有终局页时索引为 null', buildHesperidesMap({ gi: { pages: { abyss: { ids: ['1'], entries: { 1: { name: '' } } } } } }) === null)
check('空产物为 null', buildHesperidesMap(null) === null && buildHesperidesMap({}) === null)
check('小计页数与记录数', (() => {
  const counted = countIndex(builtIndex)
  return counted.pages === 2 && counted.records === 2
})())
check('空索引小计为 0', (() => {
  const counted = countIndex(null)
  return counted.pages === 0 && counted.records === 0
})())

/* ============================================================
 *  ⑤ 合成路径分发（真实产物，缺失则跳过）
 * ============================================================ */
console.log('=== ⑤ 合成路径分发 ===')
check('合成路径识别', isHesperidesPath('hes/gi/character/1.json') === true)
check('非合成路径不识别', isHesperidesPath('map.json') === false && isHesperidesPath('') === false)

if (!hasHesperidesData()) {
  console.log('⏭ Hesperides 产物缺失，跳过真实数据部分')
  finish()
}

const realMap = getHesperidesMap()
if (realMap) {
  const pages = Object.entries(realMap.games).flatMap(([gameId, game]) =>
    Object.entries(game.locales.zh.pages).map(([pageKey, page]) => ({ gameId, pageKey, page }))
  )
  check('索引页都落在 PAGE_LABELS 内', pages.every(p => p.pageKey in PAGE_LABELS))
  check('索引记录都是合成路径', pages.every(p => Object.values(p.page.records).every(r => isHesperidesPath(r.path))))
  check('小计与索引内容一致', (() => {
    const counted = countIndex(realMap)
    const expected = pages.reduce((sum, p) => sum + Object.keys(p.page.records).length, 0)
    return counted.pages === pages.length && counted.records === expected
  })())
} else {
  check('真实产物里暂无插件可索引的页（只抓了终局频道）', true)
}

// 取样一条真实记录：适配、签名、缺失路径
const index = getHesperidesIndex()
const sample = (() => {
  for (const [gameId, game] of Object.entries(index || {})) {
    for (const [dir, page] of Object.entries(game?.pages || {})) {
      const id = Array.isArray(page?.ids) ? page.ids[0] : undefined
      if (id !== undefined && page?.records > 0) return { gameId, dir, id: String(id) }
    }
  }
  return null
})()
check('产物里有可取样记录', Boolean(sample))

if (sample) {
  const filePath = syntheticPath(sample.gameId, sample.dir, sample.id)
  check('签名可判活', Boolean(recordSignature(filePath)))
  const adapted = loadRawRecord(filePath)
  check('适配成旧结构（meta + content.list/detail）',
    Boolean(adapted?.meta) && typeof adapted.content?.list === 'object' && typeof adapted.content?.detail === 'object')
  check('meta 带游戏/页/id', adapted.meta.gameId === sample.gameId && adapted.meta.pageId === sample.dir && adapted.meta.id === sample.id)
  check('记录里没有 detail 字段残留', !('detail' in adapted.content.list))

  resetRecordCache()
  const read = loadRecord(filePath)
  check('loadRecord 返回适配后的记录', Boolean(read?.content?.list))
  check('无补丁时与 loadRawRecord 一致', JSON.stringify(read) === JSON.stringify(adapted))

  const rawFile = path.join(hesperidesDir, 'records', sample.gameId, sample.dir, `${sample.id}.json`)
  check('原始记录确实来自 Hesperides 数据目录', fs.existsSync(rawFile))
}

check('不存在的合成路径返回 null', loadRecord('hes/gi/__none__/0.json') === null && loadRecord('hes/__none__/abyss/0.json') === null)

// 旧路径不再有读取通路（单一数据源）
check('旧数据路径读不出记录', loadRecord('items/简体中文/原神/角色/甲.json') === null)

finish()
