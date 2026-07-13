import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GAME_NAMES,
  GAME_FOLDERS,
  PAGE_LABELS,
  SPECIAL_TRIGGERS,
  MAX_RESULTS
} from '../components/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const dataDir = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend/data')

/** @type {object|null} map.json 内容 */
let mapCache = null

/** @type {Map<string, Array>} gameId → flatRecords */
let indexCache = new Map()

/**
 * 加载 map.json 并构建搜索索引
 * 只在首次调用时加载，后续使用缓存
 */
function ensureIndex () {
  if (mapCache) return

  const mapPath = path.join(dataDir, 'map.json')
  if (!fs.existsSync(mapPath)) {
    throw new Error(`map.json 不存在: ${mapPath}，请先执行 nanoka-atlas-backend 数据抓取`)
  }

  logger?.info('[Atlas] 正在加载图鉴索引...')
  const raw = fs.readFileSync(mapPath, 'utf8')
  mapCache = JSON.parse(raw)
  logger?.info('[Atlas] map.json 加载完成')

  for (const [gameId, gameData] of Object.entries(mapCache.games)) {
    const flat = []
    const zhData = gameData.locales?.zh
    if (!zhData) continue

    const seen = new Set()
    for (const [pageKey, page] of Object.entries(zhData.pages)) {
      const pageTitle = PAGE_LABELS[pageKey] || page.title || pageKey
      for (const [recordId, record] of Object.entries(page.records)) {
        const dedupeKey = pageKey + '|' + record.name
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        flat.push({
          name: record.name,
          nameLower: record.name.toLowerCase(),
          pageKey,
          pageTitle,
          rarity: record.rarity || '',
          recordId,
          filePath: record.path
        })
      }
    }

    // 按名称长度排序，短名称优先（精确匹配优先）
    flat.sort((a, b) => a.name.length - b.name.length)
    indexCache.set(gameId, flat)
    logger?.info(`[Atlas] ${GAME_NAMES[gameId]}: ${flat.length} 条记录已索引`)
  }
}

/**
 * 按名称搜索条目
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} keyword - 用户输入的搜索词
 * @returns {{ type: string, results?: Array, keyword?: string, pageKey?: string }}
 *   type: 'exact' | 'multi' | 'fuzzy' | 'empty' | 'special'
 */
export function search (gameId, keyword) {
  ensureIndex()

  const trimmed = keyword.trim()
  if (!trimmed) {
    return { type: 'empty' }
  }

  // 检查是否为特殊触发词（成就、挑战等）
  const special = checkSpecial(gameId, trimmed)
  if (special) return special

  const flat = indexCache.get(gameId)
  if (!flat || flat.length === 0) {
    return { type: 'empty' }
  }

  // 精确匹配
  const exact = flat.filter(r => r.name === trimmed)
  if (exact.length === 1) {
    const record = loadRecord(exact[0].filePath)
    return {
      type: 'exact',
      gameId,
      results: [{ ...exact[0], record }]
    }
  }

  // 包含匹配（按名称长度排序，短名优先）
  const lowerKeyword = trimmed.toLowerCase()
  const includes = flat.filter(r => r.nameLower.includes(lowerKeyword))
  if (includes.length === 0) {
    // 模糊匹配：每个字都在名称中出现
    const chars = [...trimmed]
    const fuzzy = flat.filter(r => chars.every(c => r.name.includes(c)))
    if (fuzzy.length === 0) {
      return { type: 'empty', keyword: trimmed }
    }
    if (fuzzy.length === 1) {
      const record = loadRecord(fuzzy[0].filePath)
      return {
        type: 'exact',
        gameId,
        results: [{ ...fuzzy[0], record }]
      }
    }
    return {
      type: 'fuzzy',
      gameId,
      gameName: GAME_NAMES[gameId],
      keyword: trimmed,
      results: fuzzy.slice(0, MAX_RESULTS),
      total: fuzzy.length
    }
  }

  if (includes.length === 1) {
    const record = loadRecord(includes[0].filePath)
    return {
      type: 'exact',
      gameId,
      results: [{ ...includes[0], record }]
    }
  }

  return {
    type: 'multi',
    gameId,
    gameName: GAME_NAMES[gameId],
    keyword: trimmed,
    results: includes.slice(0, MAX_RESULTS),
    total: includes.length
  }
}

/**
 * 加载单条记录 JSON 文件
 * @param {string} relativePath - map.json 中的相对路径
 * @returns {object|null}
 */
function loadRecord (relativePath) {
  try {
    const fullPath = path.join(dataDir, relativePath)
    if (!fs.existsSync(fullPath)) return null
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 检查特殊触发词
 * @returns {object|null}
 */
function checkSpecial (gameId, keyword) {
  const triggers = SPECIAL_TRIGGERS[gameId]
  if (!triggers) return null

  const hit = triggers[keyword]
  if (!hit) return null

  return {
    type: 'special',
    gameId,
    specialType: hit.type,
    pageKey: hit.pageKey,
    pageTitle: PAGE_LABELS[hit.pageKey] || hit.pageKey
  }
}

/**
 * 获取某个 page 下的所有记录列表（用于特殊页面的列表渲染）
 * @param {string} gameId
 * @param {string} pageKey
 * @returns {Array}
 */
export function getPageRecords (gameId, pageKey) {
  ensureIndex()
  const flat = indexCache.get(gameId) || []
  return flat.filter(r => r.pageKey === pageKey)
}

/**
 * 重载索引（数据更新后调用）
 */
export function reloadIndex () {
  mapCache = null
  indexCache = new Map()
  ensureIndex()
}

export { dataDir }
