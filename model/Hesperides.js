/**
 * Hesperides 只读客户端（产物 schema v2）
 *
 * 产物（`tool/Hesperides/Hesperides/data/`）：
 *   index.json          频道状态 + `games.<game>.sources.<source>.pages.<page>`（ids / records / entries）
 *   periods.json        期索引，`games.<game>.<source>.<page>`
 *   records/<game>/<source>/<page>/<id>.json
 *   imagerefs/<game>/<source>/<page>.json   该页的记录级图片引用（按页读，不整份加载）
 *
 * 本模块只读文件、不触发抓取——抓取时机与范围由 `#图鉴更新` / 定时任务通过 AtlasUpdater 决定。
 * 数据缺失或 schema 不兼容时返回 null / 空，调用方按「未初始化」处理（**没有旧后端兜底**）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDataTime } from './ChallengeVersion.js'

/** 插件支持的 Hesperides schemaVersion（不兼容就整体视为无数据） */
const SCHEMA_SUPPORTED = [2]

/** 插件建索引时读取的源：内容页统一取 nanoka（构建器按 nanoka 字段写） */
export const INDEX_SOURCE = 'nanoka'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Hesperides 产物根目录 */
export const HESPERIDES_DIR = path.join(pluginRoot, 'tool/Hesperides/Hesperides/data')

/** 插件 pageKey → [源, 页目录]（挑战页只有这些组合有期数据） */
const CHALLENGE_PAGE_MAP = {
  gi: {
    tower: ['alioth', 'abyss'],
    rolecombat: ['alioth', 'theater'],
    leyline: ['alioth', 'stygian']
  },
  hsr: {
    maze: ['alioth', 'chaos'],
    maze_boss: ['alioth', 'as'],
    maze_extra: ['alioth', 'fiction'],
    maze_peak: ['alioth', 'arbitration']
  },
  zzz: {
    shiyu: ['nanoka', 'shiyu'],
    boss: ['nanoka', 'boss']
  }
}

/** @type {{key: string, index: object, periods: object}|null} */
let cache = null

/** 缓存键：index.json 的 mtime + size（数据更新后自动失效） */
function cacheKey () {
  try {
    const stat = fs.statSync(path.join(HESPERIDES_DIR, 'index.json'))
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return ''
  }
}

/** 读并校验产物（失败返回 null） */
function load () {
  const key = cacheKey()
  if (!key) return null
  if (cache?.key === key) return cache
  try {
    const index = JSON.parse(fs.readFileSync(path.join(HESPERIDES_DIR, 'index.json'), 'utf8'))
    if (!SCHEMA_SUPPORTED.includes(index?.schemaVersion)) return null
    const periods = JSON.parse(fs.readFileSync(path.join(HESPERIDES_DIR, 'periods.json'), 'utf8'))
    if (!SCHEMA_SUPPORTED.includes(periods?.schemaVersion)) return null
    cache = { key, index, periods }
    return cache
  } catch {
    return null
  }
}

/** 清空缓存（reloadIndex / 测试用） */
export function resetHesperidesCache () {
  cache = null
  imagesCache.clear()
  singleFileCache.clear()
}

/**
 * Hesperides 是否可用（产物存在且 schema 兼容）
 * @returns {boolean}
 */
export function hasHesperidesData () {
  return load() !== null
}

/**
 * 取 `index.json` 的 `games`（v2：`games.<game>.sources.<source>.pages`）
 * @returns {object|null}
 */
export function getHesperidesIndex () {
  const data = load()
  return data ? data.index.games : null
}

/**
 * 取某源某页的索引（ids / records / entries）
 * @param {string} gameId
 * @param {string} source
 * @param {string} pageDir
 * @returns {{ids: string[], records: number, entries: object}|null}
 */
export function getHesperidesPage (gameId, source, pageDir) {
  return getHesperidesIndex()?.[gameId]?.sources?.[source]?.pages?.[pageDir] || null
}

/**
 * 取某挑战玩法在 Hesperides 里的期表
 *
 * 返回的期对象与 `ChallengePeriod` 同形（`begin`/`end` 为 Date），供 `pickCurrent` /
 * `resolvePeriodSpec` / `formatPeriodLabel` 直接复用；`source` 标明数据来自哪个源。
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} pageKey - 插件的挑战页键（tower/maze/shiyu…）
 * @returns {{source: string, page: string, periods: object[]}|null}
 */
export function getHesperidesPeriods (gameId, pageKey) {
  const mapped = CHALLENGE_PAGE_MAP[gameId]?.[pageKey]
  const data = load()
  if (!mapped || !data) return null
  const [source, page] = mapped
  const list = data.periods?.games?.[gameId]?.[source]?.[page]
  if (!Array.isArray(list) || !list.length) return null
  const periods = list.map((entry) => ({
    id: entry.id,
    no: entry.no,
    name: entry.name || '',
    version: entry.version || '',
    begin: parseDataTime(entry.begin),
    end: parseDataTime(entry.end),
    source
  })).filter((period) => period.begin && period.end)
  if (!periods.length) return null
  return { source, page, periods }
}

/* ============================================================
 *  页面图片引用（一页一份文件，LRU 限定常驻内存）
 * ============================================================ */

/** 图片引用缓存：`<game>/<source>/<page>` → { key, records }（LRU，容量见 IMAGE_PAGE_CACHE_MAX） */
const imagesCache = new Map()

/**
 * 常驻的图片引用页数上限
 *
 * 最大的一页（zzz item）约 6000 条记录、几 MB；详情页渲染通常只碰 1~2 页，搜索全文兜底会跨 4~6 页。
 * 定为 8 页：够覆盖一次查询的工作集，又不至于把整棵产物（100+ 页）留在内存里。
 */
const IMAGE_PAGE_CACHE_MAX = 8

/**
 * 读一页的图片引用（按需加载 + LRU）
 * @param {string} gameId
 * @param {string} source
 * @param {string} pageDir
 * @returns {Record<string, object[]>} 没有该页图片时返回空对象
 */
export function getHesperidesPageImages (gameId, source, pageDir) {
  const key = `${gameId}/${source}/${pageDir}`
  const hit = imagesCache.get(key)
  let sig = ''
  try {
    const stat = fs.statSync(path.join(HESPERIDES_DIR, 'imagerefs', gameId, source, `${pageDir}.json`))
    sig = `${stat.mtimeMs}:${stat.size}`
  } catch {
    return hit?.records || {}
  }
  if (hit && hit.sig === sig) {
    imagesCache.delete(key)
    imagesCache.set(key, hit)
    return hit.records
  }
  try {
    const data = JSON.parse(fs.readFileSync(path.join(HESPERIDES_DIR, 'imagerefs', gameId, source, `${pageDir}.json`), 'utf8'))
    const records = SCHEMA_SUPPORTED.includes(data?.schemaVersion) ? (data.records || {}) : {}
    imagesCache.set(key, { sig, records })
    while (imagesCache.size > IMAGE_PAGE_CACHE_MAX) {
      imagesCache.delete(imagesCache.keys().next().value)
    }
    return records
  } catch {
    return {}
  }
}

/**
 * 取一条记录的图片引用
 * @param {string} gameId
 * @param {string} source
 * @param {string} pageDir
 * @param {string|number} recordId
 * @returns {object[]}
 */
export function getHesperidesRecordImages (gameId, source, pageDir, recordId) {
  const records = getHesperidesPageImages(gameId, source, pageDir)
  const list = records[String(recordId)]
  return Array.isArray(list) ? list : []
}

/**
 * 读单文件频道的整份 JSON（如 nanoka 的 `diff` 页 → `records/<game>/nanoka/diff/__index.json`）
 *
 * 单文件频道没有记录拆分，整份内容按 `__index.json` 落盘；带 mtime 缓存，重抓后自愈。
 * @param {string} gameId
 * @param {string} source
 * @param {string} pageDir
 * @returns {object|null}
 */
export function getHesperidesSingleFile (gameId, source, pageDir) {
  const key = `${gameId}/${source}/${pageDir}`
  const file = path.join(HESPERIDES_DIR, 'records', gameId, source, pageDir, '__index.json')
  let sig = ''
  try {
    const stat = fs.statSync(file)
    sig = `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
  const hit = singleFileCache.get(key)
  if (hit && hit.sig === sig) return hit.data
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    singleFileCache.set(key, { sig, data })
    return data
  } catch {
    return null
  }
}

/** 单文件频道缓存：`<game>/<source>/<page>` → { sig, data } */
const singleFileCache = new Map()

/**
 * 频道状态（供 `#图鉴状态` 展示）
 * @returns {object|null}
 */
export function getHesperidesChannels () {
  const data = load()
  return data ? data.index.games : null
}
