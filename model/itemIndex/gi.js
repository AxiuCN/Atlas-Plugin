/**
 * GI 物品索引
 * 原神素材数据自带 name（mats[].name）且图标按 UI_ItemIcon_<id>.webp 直查，
 * 通常无需额外名称索引；本文件提供与 hsr/zzz 一致的统一入口（按 id 反查物品名/图标），
 * 供物品页/成就等场景按 id 反查使用。
 * 名称数据源：data/map.json → games.gi.locales.zh.pages.item.records（2095 条）
 * 图标：gallery/gi/UI_ItemIcon_<id>.webp（文件名 = id，直查）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { backendRoot } from '../AtlasService.js'
import { getItemRecords } from './mapLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {object|null} item 页 records */
let recordsCache = null

/**
 * 惰性获取 GI 物品 records（map.json 一次性解析，id → {name, ...}）
 * @returns {object}
 */
function getGIRecords () {
  if (!recordsCache) recordsCache = getItemRecords('gi')
  return recordsCache
}

/**
 * 按素材 id 查询 GI 中文名（O(1) 访问 map.json records）
 * @param {string|number} id
 * @returns {string} 查不到返回 ''
 */
export function getGIItemName (id) {
  if (id == null) return ''
  return getGIRecords()[String(id)]?.name || ''
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