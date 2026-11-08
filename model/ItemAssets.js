/**
 * 素材/物品索引：名称与图标全部来自 Hesperides 产物
 *
 * 数据来源（都是 `index.json` 的 `pages[<dir>].entries`，含 `name` / `icon` / `imageCount`）：
 *   - `item`      物品页：素材 id → 名称
 *   - `item-all`  物品详情页：item 页查不到时的名称兜底（经验/好感度这类无详情条目）
 *   - `icon`      记录主图相对路径（`images/<game>/…`），直接拼 file:// URL
 *
 * 图标不再按「id → 文件名约定」猜（旧后端靠 `gallery/gi/UI_ItemIcon_<id>.webp` 这类直拼），
 * 而是用产物里已经落好的那一张；按资源名查询时扫一次 `images/<game>` 建文件名索引（进程内缓存）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { HESPERIDES_DIR, getHesperidesIndex, INDEX_SOURCE } from './Hesperides.js'

/** 产物根下的图片目录 */
const IMAGES_DIR = path.join(HESPERIDES_DIR, 'images')

/** @type {{index: object, item: Map<string, object>, itemAll: Map<string, object>, artifact: Map<string, object>, icons: Map<string, Map<string, string>>}|null} */
let cache = null

/** 清空派生缓存（`reloadIndex()` 调用） */
export function resetItemAssetCache () {
  cache = null
}

/**
 * 取（必要时重建）派生缓存
 *
 * 以 `getHesperidesIndex()` 返回的对象身份作判活依据：产物换新时 Hesperides.js 会重建该对象，
 * 这里随之重建，不必额外维护失效钩子。
 * @returns {object}
 */
function ensureCache () {
  const index = getHesperidesIndex()
  if (cache && cache.index === index) return cache
  const build = (dir) => {
    const entries = new Map()
    if (!index) return entries
    for (const [gameId, game] of Object.entries(index)) {
      entries.set(gameId, game?.sources?.[INDEX_SOURCE]?.pages?.[dir]?.entries || {})
    }
    return entries
  }
  cache = {
    index,
    item: build('item'),
    itemAll: build('item-all'),
    artifact: build('artifact'),
    icons: new Map()
  }
  return cache
}

/**
 * 产物里的 posix 相对路径 → file:// URL
 * @param {string} localPath - 如 `images/gi/UI_ItemIcon_113090.webp`
 * @returns {string} 文件不存在或不是图片产物路径时返回空串
 */
export function assetUrl (localPath) {
  if (!localPath) return ''
  const rel = String(localPath).replace(/\\/g, '/')
  if (!rel.startsWith('images/')) return ''
  const abs = path.join(HESPERIDES_DIR, rel)
  try {
    if (!fs.existsSync(abs)) return ''
  } catch {
    return ''
  }
  return pathToFileURL(abs).href
}

/**
 * 某页的 entries（Hesperides 页目录名）
 * @param {string} gameId
 * @param {'item'|'item-all'|'artifact'} dir
 * @returns {Record<string, object>}
 */
export function pageEntries (gameId, dir) {
  const data = ensureCache()
  const bucket = dir === 'item' ? data.item : dir === 'item-all' ? data.itemAll : data.artifact
  return bucket.get(gameId) || {}
}

/**
 * 素材 id → 名称（item 页优先，item-all 兜底）
 * @param {string} gameId
 * @param {string|number} id
 * @returns {string} 查不到返回空串
 */
export function getItemName (gameId, id) {
  if (id == null) return ''
  const key = String(id)
  const hit = pageEntries(gameId, 'item')[key] || pageEntries(gameId, 'item-all')[key]
  return hit?.name ? String(hit.name) : ''
}

/**
 * 素材 id → 图标 file:// URL
 * @param {string} gameId
 * @param {string|number} id
 * @returns {string} 查不到返回空串
 */
export function getItemIconUrl (gameId, id) {
  if (id == null) return ''
  const key = String(id)
  const hit = pageEntries(gameId, 'item')[key] || pageEntries(gameId, 'item-all')[key]
  return assetUrl(hit?.icon)
}

/**
 * 按资源名查图（如 `UI_ItemIcon_113090`、`UI_RelicIcon_15001_4`、`115001`）
 *
 * 懒扫一次 `images/<game>` 建「文件名（去扩展名）→ 相对路径」索引；9 个候选路径失败后才用到，
 * 不该为它读记录。
 * @param {string} gameId
 * @param {string} assetName
 * @returns {string} file:// URL，查不到返回空串
 */
export function iconByAssetName (gameId, assetName) {
  if (!assetName) return ''
  const data = ensureCache()
  let bucket = data.icons.get(gameId)
  if (!bucket) {
    bucket = new Map()
    const root = path.join(IMAGES_DIR, gameId)
    let files = []
    try {
      files = fs.readdirSync(root, { recursive: true })
    } catch {
      files = []
    }
    for (const file of files) {
      const rel = String(file).replace(/\\/g, '/')
      const base = path.basename(rel, path.extname(rel))
      if (!bucket.has(base)) bucket.set(base, `images/${gameId}/${rel}`)
    }
    data.icons.set(gameId, bucket)
  }
  const key = String(assetName).replace(/\.(png|webp|jpg|jpeg|avif)$/i, '')
  const hit = bucket.get(key) || bucket.get(path.basename(key))
  return assetUrl(hit)
}
