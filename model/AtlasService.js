import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  GAME_NAMES,
  PAGE_LABELS,
  SPECIAL_TRIGGERS,
  MAX_RESULTS,
  PAGE_PRIORITY
} from '../components/constants.js'
import {
  normalizeForMatch,
  normalizeKeyword,
  buildKeywordVariants,
  loadAliasMap
} from './AliasLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const backendRoot = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend')
const dataDir = path.join(backendRoot, 'data')

/** @type {object|null} map.json 内容 */
let mapCache = null

/** @type {Map<string, Array>} gameId → flatRecords */
let indexCache = new Map()

/** 游戏中文名映射（local，避免跨模块循环引用） */
const GAME_CN = { gi: '原神', hsr: '星铁', zzz: '绝区零' }

/* ============================================================
 *  索引构建
 * ============================================================ */

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
        const aliases = buildEntryAliases(record)
        // GI 圣遗物名称是纯数字 ID，需从 JSON 内提取套装名作为别名
        if (gameId === 'gi' && pageKey === 'artifact') {
          try {
            const artifactRec = loadRecord(record.path)
            if (artifactRec?.content?.list?.set) {
              for (const s of Object.values(artifactRec.content.list.set)) {
                if (s.name?.zh) aliases.add(s.name.zh)
              }
            }
          } catch {}
        }
        flat.push({
          name: record.name,
          nameLower: record.name.toLowerCase(),
          nameMatch: normalizeForMatch(record.name),
          pageKey,
          pageTitle,
          rarity: record.rarity || '',
          recordId,
          filePath: record.path,
          imageCount: Number(record.imageCount || 0),
          aliases
        })
      }
    }

    indexCache.set(gameId, flat)
    logger?.info(`[Atlas] ${GAME_NAMES[gameId]}: ${flat.length} 条记录已索引`)
  }
}

/* ============================================================
 *  评分函数
 * ============================================================ */

/**
 * Phase 1: 为单条索引计算匹配分数
 * @param {object} entry — 索引条目
 * @param {{raw:string, key:string, alias:boolean}[]} variants — 搜索变体
 * @param {string} originalKeyword — 用户输入的原始关键词
 * @returns {number} 0 = 不匹配
 */
function scoreEntry (entry, variants, originalKeyword) {
  let best = 0

  for (const variant of variants) {
    for (const alias of entry.aliases || []) {
      const text = normalizeForMatch(alias)
      if (!text || !variant.key) continue

      let score = 0

      if (text === variant.key) {
        score += variant.alias ? 155 : 180
      } else if (text.startsWith(variant.key)) {
        score += variant.alias ? 70 : 100
      } else if (text.includes(variant.key)) {
        score += variant.alias ? 45 : 65
      } else if (variant.key.includes(text) && text.length >= 2) {
        score += 45
      }

      if (score) {
        score += PAGE_PRIORITY[entry.pageTitle] || 0
        if (entry.imageCount > 0) score += 5
        if (entry.name === originalKeyword) score += 20
        best = Math.max(best, score)
      }
    }
  }

  return best
}

/**
 * Phase 2: 加载 JSON 后的二次评分
 * 在条目 JSON 的 title/description/facts/sections 中搜索关键词
 * @param {object} item — 已加载的完整条目 JSON
 * @param {{key:string}[]} variants — 搜索变体
 * @returns {number}
 */
function scoreLoadedItem (item, variants) {
  const searchable = extractItemText(item).map(normalizeForMatch)

  let score = 0
  for (const variant of variants) {
    if (searchable.some(value => value === variant.key)) {
      score += 80
    } else if (searchable.some(value => value.includes(variant.key))) {
      score += 35
    }
  }
  return score
}

/**
 * 从加载的条目 JSON 中提取可搜索文本数组
 */
function extractItemText (item) {
  const texts = []

  // title — meta.name
  if (item.meta?.name) texts.push(item.meta.name)

  // description
  const desc = item.content?.list?.desc || item.content?.list?.description
  if (desc) texts.push(String(desc))

  // facts: 关键标量字段
  const list = item.content?.list || {}
  const listKeys = ['zh', 'en', 'ja', 'ko', 'rank', 'rarity', 'stars', 'baseType', 'damageType']
  for (const key of listKeys) {
    if (list[key] != null && typeof list[key] !== 'object') {
      texts.push(PAGE_LABELS[key] || key)
      texts.push(String(list[key]))
    }
  }
  // 其余 list 标量字段
  for (const [key, value] of Object.entries(list)) {
    if (listKeys.includes(key) || key.startsWith('_')) continue
    if (value != null && typeof value !== 'object') {
      texts.push(String(value))
    }
  }

  const detail = item.content?.detail || {}
  for (const [key, value] of Object.entries(detail)) {
    if (key.startsWith('_')) continue
    if (typeof value === 'string' || typeof value === 'number') {
      texts.push(String(value))
    }
  }

  // sections: detail 中的结构化对象（refinements, skills 等）
  const sectionKeys = ['refinements', 'skills', 'talents', 'constellations']
  for (const key of sectionKeys) {
    const obj = detail[key]
    if (!obj || typeof obj !== 'object') continue
    if (Array.isArray(obj)) {
      for (const el of obj) {
        if (el?.name) texts.push(el.name)
        if (el?.desc) texts.push(String(el.desc))
        if (el?.description) texts.push(String(el.description))
      }
    } else if (obj?.name) {
      texts.push(obj.name)
      if (obj.desc) texts.push(String(obj.desc))
    }
  }

  return texts.filter(Boolean)
}

/* ============================================================
 *  搜索主入口
 * ============================================================ */

/**
 * 按名称搜索条目（加权评分 + 别名 + 二次评分）
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} keyword - 用户输入的搜索词
 * @returns {{ type: string, results?: Array, keyword?: string, gameId?: string,
 *             gameName?: string, total?: number, pageKey?: string }}
 *   type: 'exact' (1 条) | 'list' (多条) | 'special' | 'empty'
 */
export function search (gameId, keyword) {
  ensureIndex()

  const trimmed = keyword.trim()
  if (!trimmed) {
    return { type: 'empty' }
  }

  // 特殊触发词（挑战等）— 不参与评分
  const special = checkSpecial(gameId, trimmed)
  if (special) return special

  const flat = indexCache.get(gameId)
  if (!flat || flat.length === 0) {
    return { type: 'empty' }
  }

  // 别名加载 + 变体生成
  const gameName = GAME_CN[gameId] || ''
  const aliases = loadAliasMap(gameId)
  const variants = buildKeywordVariants(trimmed, aliases, gameName)

  // ===== Phase 1: 索引评分 =====
  const scored = []
  for (const entry of flat) {
    const score = scoreEntry(entry, variants, trimmed)
    if (score > 0) scored.push({ entry, score })
  }

  scored.sort((a, b) =>
    b.score - a.score
    || a.entry.name.length - b.entry.name.length
    || a.entry.name.localeCompare(b.entry.name, 'zh-Hans-CN')
  )

  // ===== Phase 2: 二次评分（前 maxResults*5 条加载 JSON） =====
  const phase2Limit = Math.max(MAX_RESULTS * 5, MAX_RESULTS)
  const seen = new Set()
  const loaded = []
  for (const item of scored.slice(0, phase2Limit)) {
    if (seen.has(item.entry.filePath)) continue
    seen.add(item.entry.filePath)
    const record = loadRecord(item.entry.filePath)
    if (record) {
      item.score += scoreLoadedItem(record, variants)
    }
    loaded.push(item)
  }

  // ===== 兜底全文扫描 =====
  if (shouldRunDetailFallback(loaded, MAX_RESULTS, variants)) {
    const detailMatches = findDetailFallbackMatches(flat, variants, seen)
    for (const match of detailMatches) {
      if (!loaded.some(l => l.entry.filePath === match.entry.filePath)) {
        loaded.push(match)
      }
    }
  }

  // ===== 文件系统兜底 =====
  if (!loaded.length) {
    const itemsRoot = path.join(dataDir, 'items', '简体中文')
    const candidates = findCandidateFiles(itemsRoot, trimmed)
    for (const candidate of candidates.slice(0, Math.max(MAX_RESULTS * 3, MAX_RESULTS))) {
      const record = loadRecord(path.relative(dataDir, candidate.file))
      if (record) {
        const score = scoreCandidateFile(candidate, trimmed) + scoreLoadedItem(record, variants)
        const entry = {
          name: candidate.base,
          nameLower: candidate.base.toLowerCase(),
          nameMatch: normalizeForMatch(candidate.base),
          pageKey: '',
          pageTitle: '',
          rarity: '',
          recordId: '',
          filePath: path.relative(dataDir, candidate.file),
          imageCount: 0,
          aliases: new Set([candidate.base])
        }
        loaded.push({ entry, score })
      }
    }
  }

  if (!loaded.length) {
    return { type: 'empty', keyword: trimmed }
  }

  // ===== 最终排序 =====
  loaded.sort((a, b) =>
    b.score - a.score
    || a.entry.name.localeCompare(b.entry.name, 'zh-Hans-CN')
  )

  // 附加 score 到结果
  const results = loaded.slice(0, MAX_RESULTS).map(item => ({
    ...item.entry,
    score: item.score
  }))

  if (results.length === 1) {
    return { type: 'exact', gameId, results }
  }

  return {
    type: 'list',
    gameId,
    gameName: GAME_NAMES[gameId],
    keyword: trimmed,
    results,
    total: loaded.length
  }
}

/* ============================================================
 *  工具函数
 * ============================================================ */

/**
 * 去掉 map.json 去重后缀 __N * @param {string} value
 * @returns {string}
 */
function stripDuplicateSuffix (value = '') {
  return String(value).replace(/__\d+$/, '')
}

/**
 * 为每条记录生成匹配别名 Set
 * 包含：record.name、record.id、stripDuplicateSuffix(name)、basename、带后缀移除的basename
 * @param {object} record — map.json 中的 record 对象
 * @returns {Set<string>}
 */
function buildEntryAliases (record) {
  const aliases = new Set([
    record.name,
    record.id,
    stripDuplicateSuffix(record.name),
    path.basename(record.path || '', '.json'),
    stripDuplicateSuffix(path.basename(record.path || '', '.json'))
  ].filter(Boolean).map(String))
  return aliases
}

/**
 * 判断是否需要兜底全文扫描
 */
function needsDetailFallback (loaded, maxResults) {
  if (loaded.length < maxResults) return true
  const topPriority = PAGE_PRIORITY[loaded[0]?.entry?.pageTitle] || 0
  return topPriority < 180
}

/**
 * 判断是否触发兜底全文扫描
 */
function shouldRunDetailFallback (loaded, maxResults, variants, strict = false) {
  if (!needsDetailFallback(loaded, maxResults)) return false
  if (!strict) return true
  return Math.max(...variants.map(v => v.key.length), 0) >= 3
}

/**
 * 兜底全文扫描：对高优先级条目的 JSON 原文做子串匹配
 * 评分公式：PAGE_PRIORITY[pageTitle] + 120 + scoreLoadedItem
 */
function findDetailFallbackMatches (flat, variants, seen) {
  const matches = []

  const highPriorityEntries = flat.filter(entry =>
    (PAGE_PRIORITY[entry.pageTitle] || 0) >= 180
    && !seen.has(entry.filePath))

  for (const entry of highPriorityEntries) {
    const fullPath = path.join(dataDir, entry.filePath)
    let raw
    try { raw = fs.readFileSync(fullPath, 'utf8') } catch { continue }
    const normalized = normalizeForMatch(raw)
    if (!variants.some(variant => normalized.includes(variant.key))) continue

    const record = loadRecord(entry.filePath)
    if (!record) continue

    const score = (PAGE_PRIORITY[entry.pageTitle] || 0) + 120 + scoreLoadedItem(record, variants)
    matches.push({ entry, score })
    seen.add(entry.filePath)
    if (matches.length >= MAX_RESULTS * 4) break
  }
  return matches
}

/**
 * 递归遍历目录找匹配的 JSON 文件
 */
function findCandidateFiles (root, keyword) {
  const result = []
  const queue = [root]
  const lowerKeyword = normalizeForMatch(keyword)

  while (queue.length) {
    const dir = queue.shift()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const base = path.basename(entry.name, '.json')
        if (!lowerKeyword || normalizeForMatch(base).includes(lowerKeyword)) {
          result.push({
            file: full,
            base,
            exact: normalizeForMatch(base) === lowerKeyword
          })
        }
      }
    }
  }
  return result
}

/**
 * 文件系统兜底评分
 * 评分公式：完全匹配+100 / 前缀+40 / 包含+20 - 名称长度惩罚
 */
function scoreCandidateFile (candidate, keyword) {
  let score = 0
  const base = normalizeForMatch(candidate.base)
  const key = normalizeForMatch(keyword)
  if (base === key) score += 100
  if (base.startsWith(key)) score += 40
  if (base.includes(key)) score += 20
  score -= Math.max(0, candidate.base.length - keyword.length)
  return score
}

/**
 * 从记录 JSON 的 meta.images 中解析主图 file:// URL
 * 优先选 downloaded 非 placeholder，兜底任意有 localPath 的
 * @param {object} record — 完整记录 JSON
 * @returns {string} file:// URL，无图片时返回空串
 */
export function resolveRecordImage (record) {
  const images = record?.meta?.images
  if (!images || !Array.isArray(images) || !images.length) return ''
  const picked = images.find(item => item?.localPath && item.status === 'downloaded' && !item.placeholder)
    || images.find(item => item?.localPath)
  if (!picked?.localPath) return ''
  const fullPath = path.join(backendRoot, picked.localPath)
  return pathToFileURL(fullPath).href
}

/**
 * 加载单条记录 JSON 文件
 * @param {string} relativePath - map.json 中的相对路径
 * @returns {object|null}
 */
export function loadRecord (relativePath) {
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

/**
 * 获取 map.json 缓存（供外部模块复用，避免重复解析）
 * @returns {object}
 */
export function loadMap () {
  ensureIndex()
  return mapCache
}

export { dataDir, backendRoot }
