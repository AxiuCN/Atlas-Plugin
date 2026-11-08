/**
 * 版本新增内容：读 nanoka 根 manifest 的 `new` 字段，按实体分组并补出名称
 *
 * 上游 `manifest.json` 对每个游戏给 `latest`（数据版本）、`live`（线上版本）与
 * `new: { character: [id…], weapon: [id…], … }`——即「本版本新增」的条目 id。
 * 名称从 Hesperides 索引的 `entries` 取（同一 id 在对应页的 `name`），取不到就显示 id。
 *
 * 纯函数 + 两个薄读取器：`buildNewContentModel()` 可单测，`loadNewContent()` 供命令层用。
 */
import { getHesperidesUpstreamManifest, getHesperidesIndex, INDEX_SOURCE } from './Hesperides.js'
import { loadRecord } from './AtlasRepository.js'
import { syntheticPath } from './HesperidesRepository.js'

/** 分组展示顺序（未列出的实体按上游顺序追加在后） */
const ENTITY_ORDER = [
  'character',
  'weapon',
  'lightcone',
  'artifact',
  'relicset',
  'equipment',
  'bangboo',
  'monster',
  'item',
  'gcg',
  'furniture',
  'suite',
  'beyond_costume',
  'beyond_costume_suit',
  'beyond_item'
]

/** 实体 → 中文标签 */
const ENTITY_LABELS = {
  character: '角色',
  weapon: '武器',
  lightcone: '光锥',
  artifact: '圣遗物',
  relicset: '遗器',
  equipment: '驱动盘',
  bangboo: '邦布',
  monster: '敌人',
  item: '物品',
  gcg: '七圣召唤',
  furniture: '摆设',
  suite: '摆设套装',
  beyond_costume: '时装',
  beyond_costume_suit: '时装套装',
  beyond_item: '千星奇域物品',
  echo: '声骸',
  console: '装置'
}

/**
 * 实体 → 索引页目录（同一实体在不同游戏可能落在不同页，如武器：gi/zzz 是 weapon、hsr 是 lightcone）
 */
const ENTITY_PAGE = {
  character: 'character',
  weapon: { gi: 'weapon', hsr: 'lightcone', zzz: 'weapon' },
  lightcone: 'lightcone',
  artifact: 'artifact',
  relicset: 'relicset',
  equipment: 'equipment',
  bangboo: 'bangboo',
  monster: 'monster',
  item: 'item',
  gcg: 'gcg',
  furniture: 'furniture',
  suite: 'suite',
  beyond_costume: 'beyond-costume',
  beyond_costume_suit: 'beyond-costume_suit',
  beyond_item: 'beyond-item'
}

/**
 * 实体对应的页目录
 * @param {string} gameId
 * @param {string} entity
 * @returns {string} 未知实体返回空串
 */
export function pageOfEntity (gameId, entity) {
  const page = ENTITY_PAGE[entity]
  if (!page) return ''
  return typeof page === 'string' ? page : (page[gameId] || '')
}

/** 实体排序：已知顺序优先，其余按出现顺序追加 */
function sortEntities (entities) {
  const known = ENTITY_ORDER.filter((entity) => entities.includes(entity))
  const rest = entities.filter((entity) => !ENTITY_ORDER.includes(entity))
  return [...known, ...rest]
}

/**
 * 组装某游戏的「版本新增内容」
 * @param {string} gameId
 * @param {{games: object}|null} manifest - `getHesperidesUpstreamManifest()` 的返回值
 * @param {object|null} index - `getHesperidesIndex()` 的返回值
 * @returns {{gameId: string, latest: string, live: string, groups: object[], total: number}|null}
 *          上游没有该游戏或没有新增时返回 null
 */
export function buildNewContentModel (gameId, manifest, index) {
  const game = manifest?.games?.[gameId]
  if (!game) return null
  const created = game.new && typeof game.new === 'object' ? game.new : {}
  const entities = Object.keys(created).filter((entity) => Array.isArray(created[entity]) && created[entity].length)
  if (!entities.length) return null

  // index 就是 getHesperidesIndex() 返回的 games 对象（keys = gameId）
  const pages = index?.[gameId]?.sources?.[INDEX_SOURCE]?.pages || {}
  const groups = []
  for (const entity of sortEntities(entities)) {
    const page = pageOfEntity(gameId, entity)
    const entries = (page && pages[page]?.entries) || {}
    const names = []
    for (const id of created[entity]) {
      const name = resolveName(gameId, page, entity, id, entries)
      // 同一实体里多个 id 可能共用一个名字（时装的配色变体），展示时去重但计数保留
      if (!names.includes(name)) names.push(name)
    }
    groups.push({
      entity,
      label: ENTITY_LABELS[entity] || entity,
      count: created[entity].length,
      names
    })
  }

  return {
    gameId,
    latest: game.latest || '',
    live: game.live || '',
    groups,
    total: groups.reduce((sum, group) => sum + group.count, 0)
  }
}

/**
 * 解析一条新增记录的名字
 *
 * 优先用索引 entries 的 name；但原神圣遗物页的 name 就是数字 id，这时读记录取套装名
 * （`content.list.set[].name.zh`）。都取不到才退回 id。
 * @param {string} gameId
 * @param {string} page - 该实体对应的页目录
 * @param {string} entity
 * @param {string|number} id
 * @param {object} entries - 该页的 entries
 * @returns {string}
 */
function resolveName (gameId, page, entity, id, entries) {
  const key = String(id)
  const label = entries[key]?.name ? String(entries[key].name) : ''
  if (label && label !== key) return label
  if (entity === 'artifact' && page) {
    const record = loadRecord(syntheticPath(gameId, INDEX_SOURCE, page, key))
    const setName = Object.values(record?.content?.list?.set || {})[0]?.name?.zh
    if (setName) return String(setName)
  }
  return label || key
}

/**
 * 读真实产物组装
 * @param {string} gameId
 * @returns {object|null}
 */
export function loadNewContent (gameId) {
  return buildNewContentModel(gameId, getHesperidesUpstreamManifest(), getHesperidesIndex())
}

/**
 * 渲染成回复文本
 * @param {object} data - `buildNewContentModel()` 的返回值
 * @param {object} [options]
 * @param {number} [options.maxNames] - 每组最多列几个名字（超出用「等 N 个」）
 * @param {string} [options.gameName]
 * @returns {string}
 */
export function formatNewContent (data, options = {}) {
  const { maxNames = 10, gameName = '' } = options
  if (!data) return ''
  const versionLine = [data.latest && `数据版本 ${data.latest}`, data.live && `线上 ${data.live}`]
    .filter(Boolean).join('｜')
  const lines = [`${gameName ? gameName + ' ' : ''}版本新增内容${versionLine ? `（${versionLine}）` : ''}：共 ${data.total} 项`]
  for (const group of data.groups) {
    const shown = group.names.slice(0, maxNames)
    const notes = []
    if (group.names.length > shown.length) notes.push(`等 ${group.count} 项`)
    // 多个条目共用名字（时装配色变体）时说明「共 N 项 / M 个名称」
    else if (group.names.length < group.count) notes.push(`共 ${group.count} 项 / ${group.names.length} 个名称`)
    lines.push(`· ${group.label}（${group.count}）：${shown.join('、')}${notes.length ? `（${notes.join('；')}）` : ''}`)
  }
  return lines.join('\n')
}
