/**
 * 星铁怪物数值等级表（HardLevelGroup）
 *
 * 怪物面板 = `detail.<stat>_base` × `child.hard_level_group` 在目标等级的比率。
 * 数据源：`data/items/<语言>/星铁/难度组/<id>.json`，每条 `content.list` =
 * `{ HardLevelGroup, Level, AttackRatio, DefenceRatio, HPRatio, SpeedRatio, StanceRatio, CombatPowerList }`。
 * 全 2648 个变体的 `hard_level_group` 均为 1（已核），故只按组 1 取值；整页惰性读一次并缓存。
 */
import { loadMap } from '../itemIndex/mapLoader.js'
import { loadRecord } from '../AtlasService.js'

/** @type {Map<number, Map<number, object>>|null} 组 → 等级 → 比率 */
let cache = null

/** cache 所属的 map 对象：图鉴数据重载后 map.json 换新，等级表随之重读 */
let cacheMap = null

/**
 * 读取难度组表（惰性，进程内一次；map 换新则重建）
 * @returns {Map<number, Map<number, object>>}
 */
function loadTable () {
  const map = loadMap()
  if (cache && cacheMap === map) return cache
  cacheMap = map
  cache = new Map()
  const records = map?.games?.hsr?.locales?.zh?.pages?.HardLevelGroup?.records || {}
  for (const rec of Object.values(records)) {
    if (!rec?.path) continue
    let list
    try {
      list = loadRecord(rec.path)?.content?.list
    } catch {
      continue
    }
    const group = Number(list?.HardLevelGroup)
    const level = Number(list?.Level)
    if (!Number.isFinite(group) || !Number.isFinite(level)) continue
    if (!cache.has(group)) cache.set(group, new Map())
    cache.get(group).set(level, list)
  }
  return cache
}

/**
 * 取指定难度组在指定等级的数值比率
 * @param {number} group - child.hard_level_group（全库为 1）
 * @param {number} level - 目标等级
 * @returns {{hp:number, attack:number, defence:number, speed:number, stance:number}|null} 无该组/等级返回 null
 */
export function hsrLevelRatio (group, level) {
  const entry = loadTable().get(Number(group))?.get(Number(level))
  if (!entry) return null
  const num = (v, fallback = 1) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
  return {
    hp: num(entry.HPRatio),
    attack: num(entry.AttackRatio),
    defence: num(entry.DefenceRatio),
    speed: num(entry.SpeedRatio),
    stance: num(entry.StanceRatio)
  }
}
