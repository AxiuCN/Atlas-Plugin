/**
 * 怪物索引统一入口（三游戏共用）
 *
 * 定位：页面 builder（components/sections/monster）与未来的终局模块共用同一层，
 * 避免各自解析「怪物 id → 名称/图标/变体」的口径漂移。
 *
 * 两级索引（都惰性、进程内缓存）：
 * - 浅索引：直接取 map.json 的 monster 页 record 键。三游戏的 record 键都是有效主 id
 *   （GI 是代表 child id、HSR/ZZZ 是 detail.id），零文件读取即可覆盖终局绝大多数引用。
 * - 深索引：读条目 JSON 收集全部变体 id（GI 无 detail.id，只有 child 键；ZZZ 还有 monster_info 键），
 *   仅在浅索引查不到时按需构建。
 */
import { loadMap } from '../itemIndex/mapLoader.js'
import { loadRecord } from '../AtlasService.js'
import { HSR_MONSTER_CAMP_LABEL } from '../../components/constants.js'
import { giIndexIds, giVariants } from './gi.js'
import { hsrIndexIds, hsrVariants } from './hsr.js'
import { zzzIndexIds, zzzVariants } from './zzz.js'

/** 浅索引缓存：gameId → Map<id, { recordId, name, filePath }> */
const shallowCache = new Map()

/** 深索引缓存：gameId → Map<id, { recordId, name, filePath }> */
const deepCache = new Map()

/** 变体缓存：filePath → 变体数组（同一条目可能被页面与终局重复取用） */
const variantCache = new Map()

/** 已告警过的「未登记阵营」id，避免重复刷日志 */
const warnedCamps = new Set()

/** 各游戏的 id 收集 / 变体归一化实现 */
const GAMES = {
  gi: { ids: giIndexIds, variants: giVariants },
  hsr: { ids: hsrIndexIds, variants: hsrVariants },
  zzz: { ids: zzzIndexIds, variants: zzzVariants }
}

/** 取某游戏 monster 页的 map records（不存在返回 {}） */
function monsterRecords (gameId) {
  return loadMap()?.games?.[gameId]?.locales?.zh?.pages?.monster?.records || {}
}

/**
 * 浅索引：map.json record 键 → 条目
 * @param {string} gameId
 * @returns {Map<string, {recordId:string,name:string,filePath:string}>}
 */
function shallowIndex (gameId) {
  if (!shallowCache.has(gameId)) {
    const map = new Map()
    for (const [recordId, rec] of Object.entries(monsterRecords(gameId))) {
      if (!rec?.path) continue
      map.set(String(recordId), { recordId: String(recordId), name: rec.name || '', filePath: rec.path })
    }
    shallowCache.set(gameId, map)
  }
  return shallowCache.get(gameId)
}

/**
 * 深索引：读条目 JSON 收集全部变体 id（首次调用按游戏构建一次）
 * @param {string} gameId
 * @returns {Map<string, {recordId:string,name:string,filePath:string}>}
 */
function deepIndex (gameId) {
  if (deepCache.has(gameId)) return deepCache.get(gameId)
  const map = shallowIndex(gameId)
  const ids = GAMES[gameId]?.ids
  if (ids) {
    for (const [recordId, rec] of Object.entries(monsterRecords(gameId))) {
      if (!rec?.path) continue
      let detail
      try {
        detail = loadRecord(rec.path)?.content?.detail
      } catch {
        continue
      }
      for (const id of ids(detail)) {
        const key = String(id)
        if (!map.has(key)) map.set(key, { recordId: String(recordId), name: rec.name || '', filePath: rec.path })
      }
    }
  }
  deepCache.set(gameId, map)
  return map
}

/**
 * 全部怪物条目（折叠后的索引条目，供终局模块做敌人列表）
 * @param {string} gameId
 * @returns {Array<{recordId:string,name:string,filePath:string}>}
 */
export function listMonsterEntries (gameId) {
  return [...shallowIndex(gameId).values()]
}

/**
 * 按任意 id 查怪物条目（先浅索引，再深索引）
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {string|number} id
 * @returns {{recordId:string,name:string,filePath:string}|null}
 */
export function getMonsterEntry (gameId, id) {
  if (id == null || id === '') return null
  const key = String(id)
  return shallowIndex(gameId).get(key) || deepIndex(gameId).get(key) || null
}

/**
 * 终局引用 id 归一：直接命中，否则按游戏规则换算
 * 星铁末日幻影的 `boss_monster_id` 形如 `100401401`，实为「怪物 id × 100 + 变体序号」——
 * 已用全部 68 个引用核对：`floor(id / 100)` 100% 命中 monster detail.id
 * @param {string} gameId
 * @param {string|number} rawId
 * @returns {string|null} 归一后的 id；无法解析返回 null
 */
export function resolveMonsterId (gameId, rawId) {
  if (rawId == null || rawId === '') return null
  const key = String(rawId)
  if (shallowIndex(gameId).has(key) || deepIndex(gameId).has(key)) return key
  if (gameId === 'hsr' && /^\d+$/.test(key) && key.length > 7) {
    const guess = String(Math.floor(Number(key) / 100))
    if (shallowIndex(gameId).has(guess) || deepIndex(gameId).has(guess)) return guess
  }
  return null
}

/**
 * 条目变体归一化（结果按 filePath 缓存）
 * @param {string} gameId
 * @param {string} filePath - record.path（相对 data/）
 * @returns {Array<object>} 变体数组，字段见各游戏模块
 */
export function getMonsterVariants (gameId, filePath) {
  const cacheKey = `${gameId}|${filePath}`
  if (variantCache.has(cacheKey)) return variantCache.get(cacheKey)
  let variants = []
  try {
    const record = loadRecord(filePath)
    const impl = GAMES[gameId]
    if (impl) variants = impl.variants(record?.content?.list || {}, record?.content?.detail || {}, record?.meta?.name || '')
  } catch {
    variants = []
  }
  variantCache.set(cacheKey, variants)
  return variants
}

/**
 * 取条目及其同名折叠掉的其余记录的全部变体（合并为一个数组，主条目变体在前）
 * @param {string} gameId
 * @param {string} filePath - 主条目 record.path
 * @param {string[]} [extraPaths] - 折叠掉的其他记录路径（索引条目的 variantPaths）
 * @returns {Array<object>}
 */
export function collectMonsterVariants (gameId, filePath, extraPaths = []) {
  const out = [...getMonsterVariants(gameId, filePath)]
  for (const p of extraPaths) out.push(...getMonsterVariants(gameId, p))
  return out
}

/**
 * 星铁阵营名（数据源只有数字，见 constants 的 HSR_MONSTER_CAMP_LABEL）
 * 未登记值告警一次并返回空串——新版本新增阵营时能及时暴露，而不是静默变空
 * @param {string|number} camp
 * @returns {string}
 */
export function hsrCampLabel (camp) {
  if (camp == null || camp === '') return ''
  const key = String(camp)
  const label = HSR_MONSTER_CAMP_LABEL[key]
  if (label) return label
  if (!warnedCamps.has(key)) {
    warnedCamps.add(key)
    logger?.warn?.(`[Atlas] 星铁怪物阵营 ${key} 未登记，请在 components/constants.js 的 HSR_MONSTER_CAMP_LABEL 补充`)
  }
  return ''
}
