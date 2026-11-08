/**
 * Hesperides 只读客户端
 *
 * Hesperides 是独立的数据子模块（`tool/Hesperides/Hesperides`），产物：
 *   data/hesperides/index.json   频道状态 + 记录 id
 *   data/hesperides/periods.json 期索引
 *   data/hesperides/records/<game>/<page>/<id>.json
 *
 * 本模块只读文件、不触发抓取——抓取时机与范围由 `#图鉴更新` / 定时任务通过 AtlasUpdater 决定。
 * 数据缺失或 schema 不兼容时返回 null，调用方回退到旧数据路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDataTime } from './ChallengeVersion.js'

/** 插件支持的 Hesperides schemaVersion（不兼容就整体回退旧数据路径） */
const SCHEMA_SUPPORTED = [1]

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Hesperides 产物根目录 */
export const HESPERIDES_DIR = path.join(pluginRoot, 'tool/Hesperides/Hesperides/data/hesperides')

/** 插件 pageKey → Hesperides 的「源 + 页面」 */
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
    cache = { key, index, periods }
    return cache
  } catch {
    return null
  }
}

/** 清空缓存（reloadIndex / 测试用） */
export function resetHesperidesCache () {
  cache = null
}

/**
 * Hesperides 是否可用（产物存在且 schema 兼容）
 * @returns {boolean}
 */
export function hasHesperidesData () {
  return load() !== null
}

/**
 * 取 Hesperides 的 page 索引（`index.json` 的 `games` 字段）
 *
 * 消费者（`HesperidesIndex`）据此不用读全量记录就能建搜索索引：`pages[page]` 里有
 * `ids`（记录 id 列表）、`records`（条数）与 `entries`（记录级 `{ name, rarity }`）。
 * @returns {object|null} 产物缺失 / schema 不兼容时返回 null
 */
export function getHesperidesIndex () {
  const data = load()
  return data ? data.index.games : null
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
  const list = data.periods?.games?.[gameId]?.[page]
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

/**
 * 读一条 Hesperides 记录（原始结构，不做规范化）
 * @param {string} gameId
 * @param {string} pageKey - 插件页键
 * @param {string} id - 期/条目 id
 * @returns {object|null}
 */
export function readHesperidesRecord (gameId, pageKey, id) {
  const mapped = CHALLENGE_PAGE_MAP[gameId]?.[pageKey]
  if (!mapped) return null
  const [, page] = mapped
  try {
    return JSON.parse(fs.readFileSync(path.join(HESPERIDES_DIR, 'records', gameId, page, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 频道状态（供 `#图鉴状态` 展示）
 * @returns {object|null}
 */
export function getHesperidesChannels () {
  const data = load()
  return data ? data.index.games : null
}
