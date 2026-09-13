/**
 * 本地补丁层：随插件一起分发的数据 / 图片修正
 *
 * 数据源 submodule（nanoka-atlas-backend）会在 `#图鉴更新` 时被覆盖，所以修正一律放本插件 `resources/patch/`：
 * - `resources/patch/gallery/<game>/<资源名>.webp` —— 图片补丁，按资源名匹配，补缺图或覆盖错图
 * - `resources/patch/data/<与 data/ 相同的相对路径>.json` —— 条目补丁，读取时深合并
 * - `resources/patch/map.json` —— 索引补丁，结构同 `data/map.json`（可修条目名 / 稀有度等索引字段）
 *
 * 本模块只做「读补丁 + 合并」，不拼数据源路径：调用方（sections/util.js、model/AtlasService.js）各自拼，
 * 从而避免 model ⇄ components 循环依赖
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** 图片补丁根目录 */
export const PATCH_GALLERY_DIR = path.join(pluginRoot, 'resources', 'patch', 'gallery')
/** 条目补丁根目录（其下相对路径与 submodule data/ 一致） */
export const PATCH_DATA_DIR = path.join(pluginRoot, 'resources', 'patch', 'data')
/** 索引补丁文件 */
export const PATCH_MAP_FILE = path.join(pluginRoot, 'resources', 'patch', 'map.json')

/** 条目补丁缓存：相对路径 → 解析结果（null 表示无补丁） */
const dataPatchCache = new Map()
/** 索引补丁缓存（undefined 表示尚未读取） */
let mapPatchCache

/** 读取 JSON 文件，失败返回 null */
function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 查询图片补丁（按资源名，扩展名固定 webp）
 * @param {string} gameId - gallery 下的游戏目录名（gi/hsr/zzz）
 * @param {string} fileName - 资源名，如 UI_NameCardPic_Natlan1_P
 * @returns {string} file:// URL，无补丁返回空串
 */
export function patchImageUrl (gameId, fileName) {
  if (!gameId || !fileName) return ''
  const fullPath = path.join(PATCH_GALLERY_DIR, gameId, `${fileName}.webp`)
  return fs.existsSync(fullPath) ? pathToFileURL(fullPath).href : ''
}

/**
 * 推断图片所属 gallery 游戏目录，按序尝试：
 * ① 自身 localPath（`gallery/<game>/xxx.webp`）② 自身 remoteUrl（`/assets/<game>/`）
 * ③ 同记录其它图片的 localPath；占位图（`gallery/_placeholder/unknown.svg`）与 remoteUrl 为空的条目靠 ③ 兜底
 * @param {object} img - record.meta.images 条目
 * @param {Array} [images] - 同记录的完整 meta.images（可选）
 * @returns {string} 游戏目录名，推断不出返回空串
 */
export function imageGameFolder (img, images) {
  const segs = String(img?.localPath || '').split('/')
  if (segs.length > 1 && segs[0] === 'gallery' && segs[1] !== '_placeholder') return segs[1]
  const match = /\/assets\/([a-z]+)\//.exec(String(img?.remoteUrl || ''))
  if (match) return match[1]
  for (const other of images || []) {
    const otherSegs = String(other?.localPath || '').split('/')
    if (otherSegs.length > 1 && otherSegs[0] === 'gallery' && otherSegs[1] !== '_placeholder') return otherSegs[1]
  }
  return ''
}

/**
 * 读取条目补丁（带缓存）
 * @param {string} relPath - 与 data/ 下一致的相对路径
 * @returns {object|null} 补丁对象（含可选 `_patch` 元数据）
 */
export function loadDataPatch (relPath) {
  if (!relPath) return null
  if (dataPatchCache.has(relPath)) return dataPatchCache.get(relPath)
  const fullPath = path.join(PATCH_DATA_DIR, relPath)
  const patch = fs.existsSync(fullPath) ? readJson(fullPath) : null
  dataPatchCache.set(relPath, patch)
  return patch
}

/**
 * 读取索引补丁（resources/patch/map.json，结构同 data/map.json）
 * @returns {object|null}
 */
export function loadMapPatch () {
  if (mapPatchCache !== undefined) return mapPatchCache
  mapPatchCache = fs.existsSync(PATCH_MAP_FILE) ? readJson(PATCH_MAP_FILE) : null
  return mapPatchCache
}

/**
 * 清空补丁缓存（数据更新 / 手动改补丁后调用）
 */
export function clearPatchCache () {
  dataPatchCache.clear()
  mapPatchCache = undefined
}

/**
 * 深合并补丁到目标对象：对象递归合并、数组整体替换、标量覆盖；`_patch` 元数据跳过
 * @param {object} target - 被合并对象（原地修改）
 * @param {object} patch - 补丁对象
 * @returns {object} target
 */
export function mergePatch (target, patch) {
  if (!target || typeof target !== 'object' || !patch || typeof patch !== 'object' || Array.isArray(patch)) return target
  for (const [key, value] of Object.entries(patch)) {
    if (key === '_patch') continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {}
      mergePatch(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
}

/**
 * 应用条目补丁（原地合并）
 * @param {object} record - 已解析的条目 JSON
 * @param {string} relPath - 与 data/ 下一致的相对路径
 * @returns {boolean} 是否应用了补丁
 */
export function applyDataPatch (record, relPath) {
  const patch = loadDataPatch(relPath)
  if (!patch) return false
  mergePatch(record, patch)
  return true
}

/**
 * 按点路径取值（补丁 `_patch.upstream` 的上游值比对用；数组用数字下标）
 * @param {object} obj
 * @param {string} dotPath - 如 content.detail.parts.equip_ring.desc
 * @returns {*} 取不到返回 undefined
 */
export function getByPath (obj, dotPath) {
  let cur = obj
  for (const seg of String(dotPath).split('.')) {
    if (cur == null) return undefined
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg]
  }
  return cur
}

/**
 * 列出全部条目补丁文件（相对 data/ 的路径，字典序）
 * @returns {string[]}
 */
export function listDataPatchFiles () {
  const result = []
  const walk = (dir, rel) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel)
      else if (entry.name.endsWith('.json')) result.push(childRel)
    }
  }
  walk(PATCH_DATA_DIR, '')
  return result.sort()
}

/**
 * 列出全部图片补丁
 * @returns {{gameId: string, name: string}[]}
 */
export function listImagePatches () {
  if (!fs.existsSync(PATCH_GALLERY_DIR)) return []
  const result = []
  let games
  try {
    games = fs.readdirSync(PATCH_GALLERY_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  for (const game of games) {
    if (!game.isDirectory()) continue
    const dir = path.join(PATCH_GALLERY_DIR, game.name)
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.webp')) result.push({ gameId: game.name, name: file.replace(/\.webp$/, '') })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}
