import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  GAME_NAMES,
  PAGE_LABELS,
  SPECIAL_TRIGGERS,
  MAX_RESULTS,
  PAGE_PRIORITY,
  zzzRank
} from '../components/constants.js'
import {
  normalizeForMatch,
  normalizeKeyword,
  buildKeywordVariants,
  loadAliasMap
} from './AliasLoader.js'
import { familyName, variantOf, variantDisplayName, variantAliases, familyGenderAliases, isProtagonistFamily } from '../components/protagonist.js'
import { reloadLinkIndex } from './LinkResolver.js'
import { clearMiaoParamCache } from './MiaoParams.js'
import { resetItemMapCache } from './itemIndex/mapLoader.js'
import {
  patchImageUrl,
  imageGameFolder,
  applyDataPatch,
  loadMapPatch,
  mergePatch,
  clearPatchCache,
  loadDataPatch,
  listDataPatchFiles,
  listImagePatches,
  getByPath
} from '../components/patch.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const backendRoot = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend')
const dataDir = path.join(backendRoot, 'data')

/** @type {object|null} map.json 内容 */
let mapCache = null

/** @type {Map<string, Array>} gameId → flatRecords */
let indexCache = new Map()

/**
 * 记录缓存：相对路径 → { sig, record }（LRU，上限见 RECORD_CACHE_MAX）
 *
 * 一次查询会反复取同一条目（全文兜底的二次评分、详情页 + 兄弟形态、攻略页 hero 与图标），
 * 而 loadRecord 每次都要读盘 + JSON.parse；缓存按「路径 + 文件签名」判活，数据文件被替换即自愈。
 * 注意：缓存的是**套过补丁**的实例，补丁文件本身的改动仍需 reloadIndex() 才生效（与补丁缓存同口径）。
 * @type {Map<string, {sig: string, record: object}>}
 */
const recordCache = new Map()

/**
 * 记录缓存条数上限
 *
 * 单次全文兜底会遍历 500+ 条高优先级条目、怪物深索引一次读 600+ 条，
 * 无上限缓存会把整个图鉴（十万级条目）都留在内存里；300 条够覆盖热门角色及其武器/圣遗物。
 */
const RECORD_CACHE_MAX = 300

/** 游戏中文名映射（local，避免跨模块循环引用） */
const GAME_CN = { gi: '原神', hsr: '星铁', zzz: '绝区零' }

/**
 * 命中来源排序权重（最终排序时小者在前）
 * name 名字/别名命中 >> fulltext 兜底全文命中 >> file 文件系统兜底
 * 避免 Phase 3 全文扫描（技能名/描述沾边）反超 Phase 1 名字直接命中
 */
const SOURCE_RANK = { name: 0, fulltext: 1, file: 2 }

/* ============================================================
 *  索引构建
 * ============================================================ */

/**
 * 加载 map.json 并构建搜索索引
 * 只在首次调用时加载，后续使用缓存
 *
 * 多形态角色（主角 / 同族变体）按属性派生变体名（见 components/protagonist.js），
 * 男女形态折叠为一条索引，另一形态路径记入 variantPair
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
  // 索引补丁（resources/patch/map.json）叠加在 map.json 之上，可修条目名 / 稀有度等索引字段
  const mapPatch = loadMapPatch()
  if (mapPatch) {
    mergePatch(mapCache, mapPatch)
    logger?.info('[Atlas] 已应用索引补丁 resources/patch/map.json')
  }
  logger?.info('[Atlas] map.json 加载完成')

  for (const [gameId, gameData] of Object.entries(mapCache.games)) {
    const flat = []
    const zhData = gameData.locales?.zh
    if (!zhData) continue

    const seen = new Set()
    /** 多形态角色的变体名 → 索引条目（同变体的另一形态记为 variantPair，供 hero 合体图使用） */
    const variantFirst = new Map()
    for (const [pageKey, page] of Object.entries(zhData.pages)) {
      const pageTitle = PAGE_LABELS[pageKey] || page.title || pageKey
      const records = Object.entries(page.records)
      // 形态族成员统计：同名条目（旅行者 / 三月七 / {NICKNAME}）或仅性别标记不同（奇偶·男性/女性）视为同族
      const familySize = new Map()
      for (const [, record] of records) {
        const family = familyName(gameId, record.name)
        familySize.set(family, (familySize.get(family) || 0) + 1)
      }

      // 是否为「可能有形态族」的页面：形态取值只有原神元素 / 星铁命途，且只出现在角色页；
      // 另有一类带性别标记的族（奇偶·男性/女性）按名字判定。
      // 这道闸门只决定「要不要读条目 JSON 派生变体名」——同名条目的折叠与别名合并另由 duplicated
      // 控制（那些不需要读条目）。历史上一页上万条 JSON 被读掉，就是把「同名」当成了「多形态」
      const canHaveForms = pageKey === 'character' && (gameId === 'gi' || gameId === 'hsr')
      const hasGenderMark = (name) => /[·・](男性|女性)$/.test(String(name || ''))

      // 多形态族预扫描：派生各条目变体名，并选出「保留族名别名」的形态
      // （无属性形态优先 → 原神旅行者；否则首个形态 → 星铁开拓者取毁灭、三月七取存护）。
      // 其余形态不再挂族名，避免整族同分导致 `#旅行者` / `#开拓者` 落到排序首条
      const memberInfo = new Map()
      const familyOwner = new Map()
      for (const [recordId, record] of records) {
        const family = familyName(gameId, record.name)
        // 同名（同族）即需折叠为一条，并把其余条目的 id / 文件名并入别名（不读条目）
        const duplicated = (familySize.get(family) || 0) > 1
        // 怪物不参与形态族派生：同名记录是同一图鉴条目的多个战斗变体（见下方 monsterFold）
        // 主角族名（旅行者 / {NICKNAME}）在其他页面出现时同样要归一为族名（如星铁「货币角色」页）
        const formCandidate = pageKey !== 'monster' &&
          (canHaveForms || hasGenderMark(record.name) || isProtagonistFamily(gameId, family))
        if (!formCandidate || !duplicated) {
          memberInfo.set(recordId, { family, label: '', name: record.name, multi: false, duplicated })
          continue
        }
        const loaded = loadRecord(record.path)
        const variant = variantOf(gameId, loaded?.content?.list, loaded?.content?.detail)
        memberInfo.set(recordId, {
          family,
          label: variant.label,
          name: variantDisplayName(family, variant.label),
          multi: true,
          duplicated
        })
        const owner = familyOwner.get(family)
        const preferOwner = !owner || (memberInfo.get(owner).label !== '' && variant.label === '')
        if (preferOwner) familyOwner.set(family, recordId)
      }

      // 怪物页同名折叠（无损）：HSR 628 条记录只有 373 个唯一名字——同名条目本质是同一图鉴条目的
      // 多个战斗变体被拆成了多条索引。主条目按「有详情 → 图多 → 键小」选取（组内位置不变），
      // 其余记录不再入索引，其路径与别名并入主条目的 variantPaths / aliases，供详情页「变体」栏拼合。
      const monsterFold = new Map()
      const monsterMergedPaths = new Set()
      if (pageKey === 'monster') {
        const groups = new Map()
        for (const [recordId, record] of records) {
          const key = record.name || recordId
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push([recordId, record])
        }
        for (const list of groups.values()) {
          if (list.length < 2) continue
          const [mainId] = list.slice().sort((a, b) => {
            const da = a[1].hasDetail ? 1 : 0
            const db = b[1].hasDetail ? 1 : 0
            if (da !== db) return db - da
            const ia = Number(a[1].imageCount) || 0
            const ib = Number(b[1].imageCount) || 0
            if (ia !== ib) return ib - ia
            return String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true })
          })[0]
          const fold = { paths: [], aliases: new Set() }
          for (const [recordId, record] of list) {
            if (recordId === mainId) continue
            fold.paths.push(record.path)
            monsterMergedPaths.add(record.path)
            for (const alias of entryAliases(record)) fold.aliases.add(alias)
          }
          monsterFold.set(mainId, fold)
        }
      }

      for (const [recordId, record] of records) {
        if (monsterMergedPaths.has(record.path)) continue
        const info = memberInfo.get(recordId)
        const isMultiForm = info.multi
        const isFamilyOwner = !isMultiForm || familyOwner.get(info.family) === recordId
        const indexName = info.name

        const dedupeKey = pageKey + '|' + indexName
        if (seen.has(dedupeKey)) {
          // 同变体的另一形态（男女）：不重复入索引，仅记录合体图配对条目并并入其检索别名
          // （族名归属形态并入另一形态的原名，其余形态只并入其 id / 文件名，避免整族同分）
          const first = variantFirst.get(dedupeKey)
          if (first) {
            if (!first.variantPair) first.variantPair = record.path
            const ownerId = familyOwner.get(info.family)
            for (const alias of entryAliases(record, !isMultiForm || first.recordId === ownerId)) {
              first.aliases.add(alias)
            }
          }
          continue
        }
        seen.add(dedupeKey)

        const aliases = entryAliases(record, isFamilyOwner)
        const fold = monsterFold.get(recordId)
        if (fold) for (const alias of fold.aliases) aliases.add(alias)
        for (const alias of variantAliases(gameId, info.family, info.label, indexName)) aliases.add(alias)
        for (const alias of familyGenderAliases(info.family, info.label, isFamilyOwner)) aliases.add(alias)
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
        const entry = {
          name: indexName,
          nameLower: indexName.toLowerCase(),
          nameMatch: normalizeForMatch(indexName),
          pageKey,
          pageTitle,
          // 索引层只有 map.json 的 rarity 标签（数值派生的目录名），按页面档位归一到 S/A/B/C
          rarity: gameId === 'zzz' ? zzzRank(record.rarity, pageKey) : (record.rarity || ''),
          recordId,
          filePath: record.path,
          imageCount: Number(record.imageCount || 0),
          aliases,
          // 同名折叠掉的其余记录路径（仅怪物页会出现），详情页据此拼合「变体」栏
          variantPaths: fold?.paths?.length ? fold.paths : undefined
        }
        // 登记首条：形态族折叠为一条；非形态族的同名条目也在此把其余条目的 id / 文件名并入别名
        // （怪物页走上面的 monsterFold，不在此登记）
        if (isMultiForm || (info.duplicated && pageKey !== 'monster')) variantFirst.set(dedupeKey, entry)
        flat.push(entry)
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
    if (score > 0) scored.push({ entry, score, source: 'name' })
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
        loaded.push({ entry, score, source: 'file' })
      }
    }
  }

  if (!loaded.length) {
    return { type: 'empty', keyword: trimmed }
  }

  // ===== 最终排序：命中来源分层（名字命中 > 全文命中 > 文件兜底） =====
  loaded.sort((a, b) =>
    (SOURCE_RANK[a.source] ?? 0) - (SOURCE_RANK[b.source] ?? 0)
    || b.score - a.score
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
 * 多形态族条目别名：非族名归属形态不再挂族名本身
 * （旅行者的元素形态不挂「旅行者」、三月七·巡猎不挂「三月七」，避免整族同分抢首条）
 * @param {object} record — map.json record
 * @param {boolean} isFamilyOwner — 是否为保留族名的形态
 * @returns {Set<string>}
 */
function entryAliases (record, isFamilyOwner = true) {
  const aliases = buildEntryAliases(record)
  if (isFamilyOwner) return aliases
  const plain = normalizeForMatch(record.name)
  for (const alias of [...aliases]) {
    if (normalizeForMatch(alias) === plain) aliases.delete(alias)
  }
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
    // 匹配必须以补丁后的内容为准：补丁会改写甚至删掉上游文本
    // （如把源站抓成「菲谢尔专用」的部件 desc 换回官方描述），直接扫原文会命中已被改掉的字
    // 无补丁的条目仍走读原文的快路径，省一次 JSON 解析
    const patched = loadDataPatch(entry.filePath) ? loadRecord(entry.filePath) : null
    let text
    if (patched) {
      text = JSON.stringify(patched)
    } else {
      try { text = fs.readFileSync(path.join(dataDir, entry.filePath), 'utf8') } catch { continue }
    }
    const normalized = normalizeForMatch(text)
    if (!variants.some(variant => normalized.includes(variant.key))) continue

    // 上面已取过就复用，不再读第二次
    const record = patched || loadRecord(entry.filePath)
    if (!record) continue

    const score = (PAGE_PRIORITY[entry.pageTitle] || 0) + 120 + scoreLoadedItem(record, variants)
    matches.push({ entry, score, source: 'fulltext' })
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
  if (!picked) return ''
  // 插件图片补丁优先（补缺图 / 覆盖错图）；游戏目录优先取记录自身的 meta.gameId
  const patch = patchImageUrl(record?.meta?.gameId || imageGameFolder(picked, images), picked.originalValue)
  if (patch) return patch
  if (!picked.localPath) return ''
  const fullPath = path.join(backendRoot, picked.localPath)
  return pathToFileURL(fullPath).href
}

/**
 * 加载单条记录 JSON 文件（原始内容，不套补丁；供补丁层做上游值比对）
 * @param {string} relativePath - map.json 中的相对路径
 * @returns {object|null}
 */
export function loadRawRecord (relativePath) {
  try {
    const fullPath = path.join(dataDir, relativePath)
    if (!fs.existsSync(fullPath)) return null
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 记录文件签名（大小 + 修改时间）：数据文件被替换后签名变化，缓存自愈
 * @param {string} relativePath
 * @returns {string} 文件不可读时返回空串
 */
function recordSignature (relativePath) {
  try {
    const stat = fs.statSync(path.join(dataDir, relativePath))
    return `${stat.size}|${Math.round(stat.mtimeMs)}`
  } catch {
    return ''
  }
}

/**
 * 深冻结记录（诊断用，默认关闭）
 *
 * 置 `ATLAS_SCAN_FREEZE=1` 后，缓存里的记录实例会被冻结：ESM 严格模式下任何调用方写回
 * 都会立刻抛 TypeError。用于验证「记录实例可共享」这一前提，防止后续新增代码原地改 record
 * 而污染其他请求（复现脚本见 .dsh/explore/scan-record-freeze.mjs）
 * @param {*} obj
 * @returns {*} 同一对象
 */
function freezeForScan (obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj
  Object.freeze(obj)
  for (const value of Object.values(obj)) freezeForScan(value)
  return obj
}

/**
 * 加载单条记录 JSON（套用 resources/patch/data 下的补丁，命中进程内缓存）
 * @param {string} relativePath - map.json 中的相对路径
 * @returns {object|null}
 */
export function loadRecord (relativePath) {
  const sig = recordSignature(relativePath)
  if (!sig) return null // 文件不存在（与 loadRawRecord 同口径返回 null）

  const hit = recordCache.get(relativePath)
  if (hit && hit.sig === sig) {
    // LRU：Map 迭代序即插入序，命中后挪到队尾
    recordCache.delete(relativePath)
    recordCache.set(relativePath, hit)
    return hit.record
  }

  const record = loadRawRecord(relativePath)
  if (!record) return null
  applyDataPatch(record, relativePath)
  if (process.env.ATLAS_SCAN_FREEZE) freezeForScan(record)

  recordCache.set(relativePath, { sig, record })
  if (recordCache.size > RECORD_CACHE_MAX) recordCache.delete(recordCache.keys().next().value)
  return record
}

/**
 * 补丁概览（供 #图鉴补丁 展示）
 * 数据补丁按 `_patch.upstream` 快照与上游当前值比对，不一致即提示复核（补丁仍会生效）
 * @returns {{ dataPatches: Array, images: Array, mapPatch: boolean }}
 */
export function getPatchOverview () {
  const dataPatches = listDataPatchFiles().map(relPath => {
    const patch = loadDataPatch(relPath) || {}
    const meta = patch._patch || {}
    const upstream = meta.upstream || {}
    const upstreamRecord = Object.keys(upstream).length ? loadRawRecord(relPath) : null
    const changed = []
    for (const [dotPath, expect] of Object.entries(upstream)) {
      const current = getByPath(upstreamRecord, dotPath)
      if (current !== expect) changed.push({ path: dotPath, expect, current })
    }
    return {
      relPath,
      note: meta.note || '',
      updatedAt: meta.updatedAt || '',
      fieldCount: Object.keys(upstream).length,
      changed
    }
  })
  return { dataPatches, images: listImagePatches(), mapPatch: !!loadMapPatch() }
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
 * 精确解析条目的类别（pageKey），用于别名管理等按类别定位的场景
 * 匹配顺序：① 标准名精确（nameMatch 相等） ② 别名命中（aliases 含该词）
 * 多页命中时按 PAGE_PRIORITY 取最优类别（角色 > 武器 > 圣遗物 > 其他）
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} keyword - 标准名或别名
 * @returns {string|null} pageKey（如 character/weapon/artifact…），未命中返回 null
 */
export function resolveEntryPageKey (gameId, keyword) {
  ensureIndex()
  const flat = indexCache.get(gameId) || []
  if (!flat.length || !keyword) return null

  const normal = normalizeForMatch(keyword)
  if (!normal) return null

  // 命中候选：标准名精确 或 别名反查（同名跨页/撞名时取 PAGE_PRIORITY 最优类别，
  // 如"冰风迷途的勇士"既是 gcg 卡牌标准名又是圣遗物套装别名 → 偏向圣遗物主体）
  const candidates = flat.filter(r =>
    r.nameMatch === normal
    || (r.aliases && [...r.aliases].some(a => normalizeForMatch(a) === normal))
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => (PAGE_PRIORITY[b.pageTitle] || 0) - (PAGE_PRIORITY[a.pageTitle] || 0))
  return candidates[0].pageKey
}

/**
 * 重载索引（数据更新后调用）
 *
 * 除了本模块的 map / 索引 / 补丁缓存，还要一并清掉各模块自持的派生缓存：
 * 它们各自读同一份图鉴数据，漏掉任何一个都会出现「更新成功但该模块仍按旧数据渲染」
 * （LINK 参数解析、素材名/图标、怪物索引与等级表、miao 参数名；其余派生缓存按 map 对象身份自失效）
 */
export function reloadIndex () {
  mapCache = null
  indexCache = new Map()
  recordCache.clear() // 记录缓存同样按数据版本作废（补丁改动只有走到这里才会重新套用）
  clearPatchCache() // 补丁文件可能随更新变化，一并失效
  reloadLinkIndex()
  resetItemMapCache()
  clearMiaoParamCache()
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
