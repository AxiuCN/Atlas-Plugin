/**
 * HSR 物品索引
 * 光锥/角色升级素材的 promotion_cost_list 只有 item_id，名称从 map.json 的 item 页 records 直接查
 * 数据源：data/map.json → games.hsr.locales.zh.pages.item.records（1594 条，id → {name, path}）
 * 图标：gallery/hsr/itemfigures/<id>.webp（文件名 = id，直查）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { backendRoot } from '../AtlasService.js'
import { getItemRecords } from './mapLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {object|null} item 页 records（map.json 已按 id 建索引，直接访问） */
let recordsCache = null

/**
 * 惰性获取 HSR 物品 records（map.json 一次性解析，id → {name, ...}）
 * @returns {object}
 */
function getHsrRecords () {
  if (!recordsCache) recordsCache = getItemRecords('hsr')
  return recordsCache
}

/**
 * 按素材 id 查询 HSR 中文名（O(1) 访问 map.json records）
 * @param {string|number} id
 * @returns {string} 查不到返回 ''（由调用方回退为原始 id）
 */
export function getHsrItemName (id) {
  if (id == null) return ''
  return getHsrRecords()[String(id)]?.name || ''
}

/**
 * HSR 素材图标（文件名 = 素材 id，直查 gallery/hsr/itemfigures/<id>.webp）
 * @param {string|number} id
 * @returns {string} file:// URL，查不到返回空串
 */
export function getHsrItemIcon (id) {
  if (id == null) return ''
  const fullPath = path.join(backendRoot, 'gallery', 'hsr', 'itemfigures', `${id}.webp`)
  if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
  return ''
}