/**
 * GI 物品索引
 * 原神素材数据自带 name（mats[].name）且图标按 UI_ItemIcon_<id>.webp 直查，
 * 通常无需额外名称索引；本文件提供与 hsr/zzz 一致的统一入口（按 id 反查物品名/图标），
 * 供物品页/成就/怪物掉落等场景按 id 反查使用。
 * 名称数据源：data/map.json → games.gi.locales.zh.pages.item.records（2095 条），
 *             未命中再查 item_all（物品详情 10510 条，收录「冒险阅历 / 好感经验」这类无详情条目）
 * 图标：gallery/gi/<meta.images[].originalValue>.webp（文件名 = 资源名，按名直查）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { backendRoot } from '../AtlasService.js'
import { loadMap, getItemRecords, getItemAllRecords } from './mapLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {object|null} item 页 records */
let recordsCache = null

/** @type {object|null} item_all（物品详情）页 records */
let allRecordsCache = null

/** @type {Map<string, {setName:string, partName:string}>|null} 圣遗物部件图标名 → 套装名/部件名 */
let relicIconCache = null

/**
 * 惰性获取 GI 物品 records（map.json 一次性解析，id → {name, ...}）
 * @returns {object}
 */
function getGIRecords () {
  if (!recordsCache) recordsCache = getItemRecords('gi')
  return recordsCache
}

/**
 * 惰性获取 GI 物品详情 records（item 页查不到时的名称兜底）
 * @returns {object}
 */
function getGIAllRecords () {
  if (!allRecordsCache) allRecordsCache = getItemAllRecords('gi')
  return allRecordsCache
}

/**
 * 按素材 id 查询 GI 中文名（O(1) 访问 map.json records）
 * @param {string|number} id
 * @returns {string} 查不到返回 ''
 */
export function getGIItemName (id) {
  if (id == null) return ''
  const key = String(id)
  return getGIRecords()[key]?.name || getGIAllRecords()[key]?.name || ''
}

/**
 * GI 素材图标（文件名 = 素材 id，直查 gallery/gi/UI_ItemIcon_<id>.webp）
 * @param {string|number} id
 * @returns {string} file:// URL，查不到返回空串
 */
export function getGIItemIcon (id) {
  if (id == null) return ''
  const fullPath = path.join(backendRoot, 'gallery', 'gi', `UI_ItemIcon_${id}.webp`)
  if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
  return ''
}

/**
 * GI 图标按资源名直查（怪物掉落项自带 icon 字段，如 UI_ItemIcon_113090 / UI_RelicIcon_15001_4）
 * 比按 id 直拼可靠：圣遗物掉落 id 是 400xxx 抽象 id，文件名却按套装资源命名
 * @param {string} iconName - meta.images[].originalValue 形态的资源名
 * @returns {string} file:// URL，查不到返回空串
 */
export function getGIIconByName (iconName) {
  if (!iconName) return ''
  const fullPath = path.join(backendRoot, 'gallery', 'gi', `${iconName}.webp`)
  if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
  return ''
}

/**
 * 圣遗物部件图标 → 套装名/部件名 映射（惰性读 65 个套装条目，整进程一次）
 * 掉落数据只给 icon（如 UI_RelicIcon_10005_4），套装名在 content.list.set[].name.zh、
 * 部件名在 content.detail.parts.<槽位>.name
 * @returns {Map<string, {setName:string, partName:string}>}
 */
function getGIRelicIconMap () {
  if (relicIconCache) return relicIconCache
  relicIconCache = new Map()
  const records = loadMap()?.games?.gi?.locales?.zh?.pages?.artifact?.records || {}
  for (const rec of Object.values(records)) {
    if (!rec?.path) continue
    const fullPath = path.join(backendRoot, 'data', rec.path)
    if (!fs.existsSync(fullPath)) continue
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
    } catch {
      continue
    }
    const setName = Object.values(raw?.content?.list?.set || {})[0]?.name?.zh || ''
    for (const part of Object.values(raw?.content?.detail?.parts || {})) {
      if (part?.icon) relicIconCache.set(part.icon, { setName, partName: part.name || '' })
    }
  }
  return relicIconCache
}

/**
 * 圣遗物掉落物名称：按 reward 项的 icon 反查部件名（如 UI_RelicIcon_10005_4 → 战狂的蔷薇）
 * 原神掉落里的 400xxx 是「套装 × 部位 × 星级」抽象 id，数据源没有对应物品条目
 * @param {string} iconName
 * @returns {{setName:string, partName:string}|null}
 */
export function getGIRelicByIcon (iconName) {
  if (!iconName) return null
  return getGIRelicIconMap().get(iconName) || null
}
