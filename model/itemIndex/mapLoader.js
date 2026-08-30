/**
 * map.json 共享加载器
 * 惰性读取 data/map.json 一次（内存缓存），按游戏暴露「物品」页 records。
 * 各游戏 itemIndex（gi/hsr/zzz）共用，避免重复解析 21MB 索引。
 *
 * records 结构：{ [itemId]: { id, name, path, rarity, ... } }
 * 定位：games.<gameId>.locales.zh.pages.item.records
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mapPath = path.resolve(__dirname, '..', '..', 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data/map.json')

/** @type {Map<string, object>} gameId → item 页 records（id → {name, path, ...}） */
let recordsCache = null

/** @type {Map<string, string>} gameId → 全量 mapCache（备用，含所有页面） */
let mapCache = null

/**
 * 惰性加载 map.json（进程内仅解析一次）
 * @returns {object} mapCache
 */
export function loadMap () {
  if (mapCache) return mapCache
  if (!fs.existsSync(mapPath)) {
    mapCache = {}
    return mapCache
  }
  try {
    mapCache = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
  } catch {
    mapCache = {}
  }
  return mapCache
}

/**
 * 按游戏取「物品」页 records（惰性，进程内仅一次全量解析）
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @returns {object} id → {id, name, path, ...}；不存在返回 {}
 */
export function getItemRecords (gameId) {
  if (!recordsCache) {
    recordsCache = new Map()
    const map = loadMap()
    for (const g of Object.keys(map.games || {})) {
      const records = map?.games?.[g]?.locales?.zh?.pages?.item?.records
      recordsCache.set(g, records && typeof records === 'object' ? records : {})
    }
  }
  return recordsCache.get(gameId) || {}
}