/**
 * HSR 物品索引
 * 光锥/角色升级素材的 promotion_cost_list 只有 item_id，名称需从 HSR 物品页数据查
 * 数据源：data/items/简体中文/星铁/物品/未分类/*.json → detail.id / detail.item_name
 * 图标：gallery/hsr/itemfigures/<id>.webp（文件名 = id，直查）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { backendRoot } from '../AtlasService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..', '..')
const itemDir = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data/items/简体中文/星铁/物品/未分类')

/** @type {Map<string, string>} itemId → 中文名 */
let itemNameCache = null

/**
 * 惰性加载 HSR 物品名索引
 * @returns {Map<string, string>}
 */
function loadHsrItemNames () {
  if (itemNameCache) return itemNameCache
  const map = new Map()
  if (fs.existsSync(itemDir)) {
    try {
      for (const file of fs.readdirSync(itemDir)) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = fs.readFileSync(path.join(itemDir, file), 'utf8')
          const data = JSON.parse(raw)
          const id = data?.content?.detail?.id
          const name = data?.content?.detail?.item_name
          if (id != null && name) map.set(String(id), name)
        } catch { /* skip malformed */ }
      }
    } catch { /* dir error — empty */ }
  }
  itemNameCache = map
  return map
}

/**
 * 按素材 id 查询 HSR 中文名
 * @param {string|number} id
 * @returns {string} 查不到返回 ''（由调用方回退为原始 id）
 */
export function getHsrItemName (id) {
  if (id == null) return ''
  return loadHsrItemNames().get(String(id)) || ''
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