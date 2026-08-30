/**
 * ZZZ 物品索引
 * 绝区零素材只有数字 id，名称/文件路径可从 map.json 的 item 页 records 直接查，
 * 图标命名不统一（如 WeaponRankStun01.webp），需按需打开物品 JSON 取 meta.images[].localPath。
 *
 * 数据源：
 * - 名称+路径：data/map.json → games.zzz.locales.zh.pages.item.records（5771 条，id → {name, path}）
 * - 图标：按 path 打开 绝区零/物品/<星级>/<名>.json → meta.images[].localPath（懒加载，命中后缓存）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..', '..', 'tool/nanoka-atlas-backend/nanoka-atlas-backend')
const dataDir = path.join(backendRoot, 'data')
const mapPath = path.join(dataDir, 'map.json')

/** @type {Map<string, string>} itemId → 中文名（来自 map.json item records） */
let nameCache = null

/** @type {Map<string, string>} itemId → 相对路径（map.json records[].path） */
let pathCache = null

/** @type {Map<string, string>} itemId → 图标 file:// URL（按需懒加载） */
let iconCache = null

/**
 * 惰性加载 map.json 的 zzz item 页 records（id → {name, path}）
 * @returns {{ names: Map<string,string>, paths: Map<string,string> }}
 */
function loadZzzItemIndex () {
  if (nameCache) return { names: nameCache, paths: pathCache }
  const names = new Map()
  const paths = new Map()
  if (fs.existsSync(mapPath)) {
    try {
      const raw = fs.readFileSync(mapPath, 'utf8')
      const map = JSON.parse(raw)
      const records = map?.games?.zzz?.locales?.zh?.pages?.item?.records
      if (records && typeof records === 'object') {
        for (const [id, rec] of Object.entries(records)) {
          if (!rec?.name) continue
          names.set(id, rec.name)
          if (rec.path) paths.set(id, rec.path)
        }
      }
    } catch { /* map 解析失败 — 空索引 */ }
  }
  nameCache = names
  pathCache = paths
  return { names, paths }
}

/**
 * 按素材 id 查询 ZZZ 中文名（查 map.json item records，零文件扫描）
 * @param {string|number} id
 * @returns {string} 查不到返回 ''
 */
export function getZZZItemName (id) {
  if (id == null) return ''
  return loadZzzItemIndex().names.get(String(id)) || ''
}

/**
 * ZZZ 素材图标：按需打开物品 JSON 取 meta.images[].localPath（懒加载并缓存）
 * @param {string|number} id
 * @returns {string} file:// URL，查不到返回空串
 */
export function getZZZItemIcon (id) {
  const key = String(id)
  if (iconCache && iconCache.has(key)) return iconCache.get(key)
  if (!iconCache) iconCache = new Map()

  const relPath = loadZzzItemIndex().paths.get(key)
  let url = ''
  if (relPath) {
    const fullPath = path.join(dataDir, relPath)
    if (fs.existsSync(fullPath)) {
      try {
        const item = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
        const images = item?.meta?.images
        if (Array.isArray(images)) {
          // 首选 downloaded 且非占位（placeholder 无 localPath）的条目；偏好 icon 类字段
          const picked = images.find(i => i?.status === 'downloaded' && i?.localPath) || images.find(i => i?.localPath)
          if (picked?.localPath) {
            const imgPath = path.join(backendRoot, picked.localPath)
            if (fs.existsSync(imgPath)) url = pathToFileURL(imgPath).href
          }
        }
      } catch { /* JSON 异常 — 无图标 */ }
    }
  }
  iconCache.set(key, url)
  return url
}