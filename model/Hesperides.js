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
import { buildPreviewPeriods, buildAbyssNumbering, buildLeylineNames } from './HesperidesPreview.js'

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
  manifestCache = null
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
 * 取某源某页的**原始**期表（未适配，`begin`/`end` 仍是字符串）
 *
 * 只给超前层用：它需要原样比较 `version` 与时间字符串，不适配成 Date。
 * @param {string} gameId
 * @param {string} source
 * @param {string} page
 * @returns {object[]}
 */
export function getHesperidesPeriodPage (gameId, source, page) {
  const list = load()?.periods?.games?.[gameId]?.[source]?.[page]
  return Array.isArray(list) ? list : []
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
  const periods = list.map((entry) => {
    const end = parseDataTime(entry.end)
    // 只有日期的结束值包含当天；上游显式给出的时刻保持不变。
    // 否则 `2026-11-30` 会被解析成 11/30 00:00，导致「11/30 中午就说本期已结束」。
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(entry.end)) end.setHours(23, 59, 59, 999)
    return {
      id: entry.id,
      no: entry.no,
      name: entry.name || '',
      version: entry.version || '',
      begin: parseDataTime(entry.begin),
      end,
      source
    }
  }).filter((period) => period.begin && period.end)
  if (!periods.length) return null

  // 原神专属的两项「口径修正」：
  //   ① 深渊期号：玉璃的 `no` 是它自己的版本段计数（当前期显示 59），真实期号要看月亮网的连续序号（凌振 = 125）；
  //   ② 危战期名：玉璃不给名字，按版本从强度研究院（6.7+）与月亮网（5.7~6.4）补齐。
  //   ③ 剧诗幕血量倍率：在 manifest 的期对象上（引擎 `phaseFields` 带出），渲染时要用。
  if (gameId === 'gi' && pageKey === 'tower') applyAbyssNumbers(periods, data.key)
  if (gameId === 'gi' && pageKey === 'leyline') applyLeylineNames(periods, data.key)
  if (gameId === 'gi' && pageKey === 'rolecombat') applyTheaterHp(periods)

  // 超前层：主表之后还能再接上的下一期（预览源内容，日期由主表节奏外推）
  const preview = buildPreviewPeriods({
    gameId,
    pageKey,
    main: periods,
    rawPeriods: getHesperidesPeriodPage,
    pageIds: (game, sourceId, pageKey) => getHesperidesPage(game, sourceId, pageKey)?.ids || []
  })
  let lastNo = Number(periods.at(-1)?.no) || periods.length
  for (const item of preview) {
    item.no = ++lastNo
    item.source = source
  }
  const merged = preview.length ? [...periods, ...preview].sort((a, b) => a.begin - b.begin) : periods
  return { source, page, periods: merged }
}

/**
 * 深渊期号：玉璃的 `no` 换成月亮网的连续序号
 *
 * 只改「能与月亮网月名唯一对齐的末段」：从最后一个唯一匹配的期当锚点往前推，
 * 遇到名字多义/对不上就停（早期玉璃期是版本段，对不到单次轮换，保留玉璃 no）。
 * 锚点之后的期按 +1 顺延（预告期由后面的编号逻辑接上）。
 * @param {object[]} periods - 原地修改
 * @param {string} key - 产物缓存键
 */
function applyAbyssNumbers (periods, key) {
  const numbering = buildAbyssNumbering({
    periods,
    pageIds: (game, source, page) => getHesperidesPage(game, source, page)?.ids || []
  }, key)
  if (!numbering.size) return
  let anchor = -1
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    const no = numbering.get(String(periods[i].id))
    if (no !== undefined) { anchor = i; break }
  }
  if (anchor < 0) return
  for (let i = anchor; i >= 0; i -= 1) {
    const no = numbering.get(String(periods[i].id))
    const expected = numbering.get(String(periods[anchor].id)) - (anchor - i)
    if (no === undefined || no !== expected) break
    periods[i].no = no
  }
  const baseNo = numbering.get(String(periods[anchor].id))
  for (let i = anchor + 1; i < periods.length; i += 1) periods[i].no = baseNo + (i - anchor)
}

/**
 * 危战期名：按版本从强度研究院 / 月亮网补（玉璃的 stygian 期没有名字）
 * @param {object[]} periods - 原地修改
 * @param {string} key
 */
function applyLeylineNames (periods, key) {
  const names = buildLeylineNames({ rawPeriods: getHesperidesPeriodPage }, key)
  if (!names.size) return
  for (const period of periods) {
    if (period.name) continue
    const name = names.get(String(period.version || ''))
    if (name) period.name = name
  }
}

/** 剧诗幕血量倍率：从 manifest 的期对象上取（引擎 `phaseFields` 带出） */
function applyTheaterHp (periods) {
  const channel = getChannelManifest('alioth:gi:theater')
  const phases = channel?.phases
  if (!Array.isArray(phases) || !phases.length) return
  const byId = new Map(phases.map((phase) => [String(phase.id), phase]))
  for (const period of periods) {
    const phase = byId.get(String(period.id))
    if (!phase) continue
    if (Array.isArray(phase.HP)) period.hpByBoss = phase.HP
    if (Array.isArray(phase.HPChamber)) period.hpByLineup = phase.HPChamber
  }
}

/** manifest 的频道条目（按产物缓存键失效） */
let channelManifest = { key: '', manifest: null }
function getChannelManifest (channelId) {
  const key = cacheKey()
  if (channelManifest.key !== key) {
    try {
      channelManifest = { key, manifest: JSON.parse(fs.readFileSync(path.join(HESPERIDES_DIR, 'manifest.json'), 'utf8')) }
    } catch {
      channelManifest = { key, manifest: null }
    }
  }
  return channelManifest.manifest?.channels?.[channelId] || null
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
 * 读 nanoka 根 manifest 快照（`data/upstream/nanoka.json`，抓取时落盘）
 *
 * 快照放在 `upstream/` 下，表示它是**上游响应的原样副本**（输入素材），不是本引擎的产物。
 * 只有提供根清单的源才有这个文件：目前仅 nanoka；玉璃上游没有根清单，版本在期表的 `Ver` 里。
 * 内容含 `latest` / `live` 与 `new`（本版本新增条目 id），供 `#版本新增内容` 使用。
 * 带 mtime 缓存，重抓后自愈。
 * @returns {{games: object, generatedAt: string}|null}
 */
export function getHesperidesUpstreamManifest () {
  const file = path.join(HESPERIDES_DIR, 'upstream', 'nanoka.json')
  let sig = ''
  try {
    const stat = fs.statSync(file)
    sig = `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
  if (manifestCache?.sig === sig) return manifestCache.data
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!SCHEMA_SUPPORTED.includes(data?.schemaVersion)) return null
    manifestCache = { sig, data: { games: data.games || {}, generatedAt: data.generatedAt || '' } }
    return manifestCache.data
  } catch {
    return null
  }
}

/** nanoka manifest 快照缓存：{ sig, data } */
let manifestCache = null

/**
 * 频道状态（供 `#图鉴状态` 展示）
 * @returns {object|null}
 */
export function getHesperidesChannels () {
  const data = load()
  return data ? data.index.games : null
}
