/**
 * Hesperides 记录仓库：合成路径 ↔ 原始记录 ↔ 旧结构适配
 *
 * 插件原有代码都通过「相对路径 + loadRecord()」访问记录（`items/简体中文/原神/…`）。
 * 切到 Hesperides 后不再保留那套目录，改用**合成路径**（不进磁盘，只作 key）：
 *
 *     hes/<game>/<page>/<id>.json
 *
 * 好处：① 消费者（搜索、构建器、补丁层）代码不用改；② 路径天然是 recordId 定位，补丁层可平移。
 *
 * 旧结构适配：原后端把每条记录导出为 `{ meta, content: { list, detail } }`，
 * 而 Hesperides 存的是**源原始记录**（nanoka 页面记录 + 可选 `detail` 字段）。适配层只做一层包装。
 */
import fs from 'node:fs'
import path from 'node:path'
import { HESPERIDES_DIR } from './Hesperides.js'

/** 合成路径前缀 */
export const HES_PATH_PREFIX = 'hes/'

/**
 * 生成合成路径
 * @param {string} gameId
 * @param {string} page
 * @param {string|number} id
 * @returns {string} `hes/gi/character/10000002.json`
 */
export function syntheticPath (gameId, page, id) {
  return `${HES_PATH_PREFIX}${gameId}/${page}/${id}.json`
}

/**
 * 解析合成路径
 * @param {string} filePath
 * @returns {{gameId: string, page: string, id: string}|null}
 */
export function parseSyntheticPath (filePath) {
  if (typeof filePath !== 'string' || !filePath.startsWith(HES_PATH_PREFIX)) return null
  const matched = filePath.slice(HES_PATH_PREFIX.length).match(/^([^/]+)\/([^/]+)\/(.+)\.json$/)
  if (!matched) return null
  return { gameId: matched[1], page: matched[2], id: matched[3] }
}

/**
 * 进程内记录缓存（按合成路径）
 *
 * 每条带文件签名（大小 + 修改时间）：`#图鉴更新` 重抓后签名变化即自愈，
 * 不必等 `reloadIndex()`；补丁仍由 AtlasRepository 那层缓存控制（补丁改动需 reloadIndex）。
 * @type {Map<string, {sig: string, raw: object}>}
 */
const recordCache = new Map()

/** 清空缓存 */
export function resetHesperidesRecordCache () {
  recordCache.clear()
}

/**
 * 合成路径 → Hesperides 记录文件绝对路径
 * @param {string} filePath
 * @returns {string} 路径不合法时返回空串
 */
export function hesperidesRecordFile (filePath) {
  const parsed = parseSyntheticPath(filePath)
  if (!parsed) return ''
  return path.join(HESPERIDES_DIR, 'records', parsed.gameId, parsed.page, `${parsed.id}.json`)
}

/**
 * 记录文件签名（大小 + 修改时间），供上层记录缓存判活
 * @param {string} filePath
 * @returns {string} 文件不可读时返回空串
 */
export function hesperidesRecordSignature (filePath) {
  const full = hesperidesRecordFile(filePath)
  if (!full) return ''
  try {
    const stat = fs.statSync(full)
    return `${stat.size}|${Math.round(stat.mtimeMs)}`
  } catch {
    return ''
  }
}

/**
 * 按合成路径读取 Hesperides 原始记录
 * @param {string} filePath - `hes/<game>/<page>/<id>.json`
 * @returns {object|null}
 */
export function readRawByPath (filePath) {
  const full = hesperidesRecordFile(filePath)
  if (!full) return null
  const sig = hesperidesRecordSignature(filePath)
  if (!sig) return null

  const hit = recordCache.get(filePath)
  if (hit && hit.sig === sig) return hit.raw

  try {
    const raw = JSON.parse(fs.readFileSync(full, 'utf8'))
    recordCache.set(filePath, { sig, raw })
    return raw
  } catch {
    return null
  }
}

/**
 * 原始记录 → 旧结构（`{ meta, content: { list, detail } }`）
 *
 * `list` 取页面记录本身（去掉 `detail` 字段），`detail` 取详情（没有则为空对象），
 * 与旧后端的导出形状一致，构建器无需改动。
 * @param {string} filePath
 * @param {object} raw
 * @returns {object}
 */
export function adaptToLegacyRecord (filePath, raw) {
  const { detail, ...list } = raw || {}
  const parsed = parseSyntheticPath(filePath)
  const meta = {
    gameId: parsed?.gameId || '',
    pageId: parsed?.page || '',
    id: parsed?.id || '',
    name: pickName(list),
    rarity: pickRarity(list)
  }
  return {
    meta,
    content: {
      list,
      detail: detail && typeof detail === 'object' ? detail : {}
    }
  }
}

/** 从原始记录里取名字（多语言字段优先级） */
function pickName (record) {
  if (!record || typeof record !== 'object') return ''
  for (const key of ['Name', 'name', 'zh', 'Title', 'title']) {
    if (record[key]) return String(record[key])
  }
  return ''
}

/** 从原始记录里取稀有度 */
function pickRarity (record) {
  if (!record || typeof record !== 'object') return ''
  for (const key of ['Rarity', 'rarity', 'rank', 'Rank', 'star']) {
    const value = record[key]
    if (typeof value === 'number') return value
    if (Array.isArray(value) && value.length) {
      const nums = value.filter((item) => typeof item === 'number')
      if (nums.length) return Math.max(...nums)
    }
  }
  return ''
}

/**
 * 按合成路径读取并适配成旧结构
 * @param {string} filePath
 * @returns {object|null}
 */
export function loadLegacyRecord (filePath) {
  const raw = readRawByPath(filePath)
  return raw ? adaptToLegacyRecord(filePath, raw) : null
}
