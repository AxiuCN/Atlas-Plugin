/**
 * ChallengePeriod — 终局挑战期索引
 *
 * 挑战页（深境螺旋 / 幻想真境剧诗 / 地脉异常(幽境危战) / 混沌回忆 / 末日幻影 / 虚构叙事 /
 * 异相仲裁 / 式舆防卫战 / 危局强袭战）在 map.json 里是**同名多条**：zzz 危局 47 条全叫
 * 「试炼」、式舆 62 条只有 4 个名字。索引层按「页 + 名」去重后只剩 1~4 条，既无法表达
 * 「第几期」，也不能判断「哪一期正在开」——图鉴数据常超前于线上版本，索引里最后一条
 * 可能是尚未开放的未来期，故不能再用 `records[last]` 当「最新一期」。
 *
 * 本模块绕开索引，直接按 map.json 的原始记录（后端按开启时间写入，顺序即时间序）建期表：
 *   - begin/end：gi 三个玩法齐全，zzz 部分有，hsr 全为空串
 *   - detail.id：hsr/zzz 递增，缺时间时用它保持时间序
 *
 * 期与版本的对应关系不在这里（后续步骤接入版本序列与锚点），本模块只回答
 * 「这个玩法有哪些期」与「哪一期正在开」。
 */
import { loadMap, loadRecord } from './AtlasService.js'
import { parseDataTime, getVersionAt } from './ChallengeVersion.js'
import { CHALLENGE_PERIOD_ANCHORS } from '../components/constants.js'

// 时间解析与版本时间轴都在 ChallengeVersion（本模块再导出，保持调用方 import 面不变）
export { parseDataTime }

/** 期表缓存：`${gameId}:${pageKey}` → 期数组（不含占位期） */
const periodCache = new Map()

/** 缓存所属的 map 对象：reloadIndex 会换新对象，据此整体作废（与 itemIndex 各模块同一种失效方式） */
let cachedMap = null

const DAY_MS = 24 * 60 * 60 * 1000

/** 占位期判定阈值：窗口短于该天数即为测试服占位 / 抓取残渣（剧诗 28~31 期只有一天窗口） */
const PLACEHOLDER_MAX_DAYS = 3

/**
 * 期排序：先按记录 id（图鉴数据里的期就是按它递增的），再按开启时间，最后退原始顺序
 *
 * 记录 id 比时间更可靠：同一玩法的期 id 单调递增，而时间既可能缺失、也可能被占位记录污染
 * （zzz 尾部那批 6205x1 的记录时间全是同一个窗口）。
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function comparePeriods (a, b) {
  const keyA = a.identity ?? Number.MAX_SAFE_INTEGER
  const keyB = b.identity ?? Number.MAX_SAFE_INTEGER
  if (keyA !== keyB) return keyA - keyB
  if (a.begin && b.begin) {
    const diff = a.begin.getTime() - b.begin.getTime()
    if (diff !== 0) return diff
  } else if (a.begin) {
    return -1
  } else if (b.begin) {
    return 1
  }
  const idA = a.detailId ?? Number.MAX_SAFE_INTEGER
  const idB = b.detailId ?? Number.MAX_SAFE_INTEGER
  if (idA !== idB) return idA - idB
  return a.orderIndex - b.orderIndex
}

/**
 * 由记录摘要构建期表（纯函数，便于回归测试）
 *
 * 占位期判定两条：
 *   ① 窗口短于 PLACEHOLDER_MAX_DAYS（测试服占位）
 *   ② 同一 (begin,end) 重复出现，只保留 detail.id 最大的一条（zzz 620571/620581/620591 等）
 * 占位期直接剔除，不占据期序号。
 * @param {{name: string, filePath: string, begin: Date|null, end: Date|null, detailId: number|null}[]} entries
 * @returns {object[]} 按期启日升序、`no` 从 1 开始的期数组
 */
export function collectPeriods (entries) {
  const list = entries.map((entry, orderIndex) => ({
    name: entry.name || '',
    filePath: entry.filePath,
    begin: entry.begin || null,
    end: entry.end || null,
    detailId: Number.isFinite(entry.detailId) ? entry.detailId : null,
    identity: Number.isFinite(entry.identity) ? entry.identity : null,
    orderIndex
  }))

  const dropped = new Set()
  for (const period of list) {
    if (period.begin && period.end && period.end - period.begin < PLACEHOLDER_MAX_DAYS * DAY_MS) {
      dropped.add(period)
    }
  }

  const windows = new Map()
  for (const period of list) {
    if (dropped.has(period) || !period.begin || !period.end) continue
    const key = `${period.begin.getTime()}|${period.end.getTime()}`
    if (!windows.has(key)) windows.set(key, [])
    windows.get(key).push(period)
  }
  for (const group of windows.values()) {
    if (group.length < 2) continue
    // 同一窗口多次出现：保 detail.id 最大的一条（占位记录的 id 通常是追加后缀的那批）
    const keep = group.reduce((best, current) =>
      (current.detailId ?? -1) > (best.detailId ?? -1) ? current : best)
    for (const period of group) if (period !== keep) dropped.add(period)
  }

  const kept = list.filter(period => !dropped.has(period))
  kept.sort(comparePeriods)
  kept.forEach((period, index) => { period.no = index + 1 })
  return kept
}

/**
 * 读取一条挑战记录的 `content.list` / `content.detail`，抽出期信息
 * @param {string} filePath - 相对 data/ 的记录路径
 * @returns {{begin: Date|null, end: Date|null, detailId: number|null, name: string}}
 */
function readPeriodMeta (filePath) {
  const record = loadRecord(filePath)
  const list = record?.content?.list
  const detail = record?.content?.detail
  const detailEntry = Array.isArray(detail) ? detail[0] : detail
  return {
    // 部分玩法（zzz 危局）时间只写在 detail 里
    begin: parseDataTime(list?.begin) || parseDataTime(detailEntry?.begin_time),
    end: parseDataTime(list?.end) || parseDataTime(detailEntry?.end_time),
    detailId: Number(detailEntry?.id) || null,
    name: String(detailEntry?.name || '')
  }
}

/**
 * 取某玩法的期表（进程内缓存，按 map 对象身份失效）
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} pageKey - 挑战页键（tower/rolecombat/leyline/maze/maze_boss/maze_extra/maze_peak/shiyu/boss）
 * @returns {object[]}
 */
export function getPeriods (gameId, pageKey) {
  const map = loadMap()
  if (cachedMap !== map) {
    cachedMap = map
    periodCache.clear()
  }
  const cacheKey = `${gameId}:${pageKey}`
  const cached = periodCache.get(cacheKey)
  if (cached) return cached

  const records = map?.games?.[gameId]?.locales?.zh?.pages?.[pageKey]?.records || {}
  const entries = []
  for (const [recordId, entry] of Object.entries(records)) {
    if (!entry?.path) continue
    let meta = { begin: null, end: null, detailId: null, name: '' }
    try {
      meta = readPeriodMeta(entry.path)
    } catch {
      // 记录读不出来时保留为「无时间期」，靠记录 id / 原始顺序定位
    }
    // 期标识优先用 map.json 的记录键（同一玩法的期按它递增），键不是数字时退到条目 detail.id
    const keyId = Number(recordId)
    entries.push({
      name: meta.name || entry.name || recordId,
      filePath: entry.path,
      begin: meta.begin,
      end: meta.end,
      detailId: meta.detailId,
      identity: Number.isFinite(keyId) ? keyId : meta.detailId
    })
  }

  const periods = applyPeriodAnchors(gameId, pageKey, collectPeriods(entries))
  periodCache.set(cacheKey, periods)
  return periods
}

/**
 * 用静态锚点给「没有 begin/end」的期补出时间窗（原地修改并返回同一数组）
 *
 * 锚点见 `components/constants.js` 的 `CHALLENGE_PERIOD_ANCHORS`：以锚点那期为基准，
 * 按「期序号差 × 期长」推算。等距外推会累积误差（实测期频有 35/42 混用），所以
 * 锚点取较近的一期；补出来的期标 `estimated: true`，出图时可标注为推定。
 * @param {string} gameId
 * @param {string} pageKey
 * @param {object[]} periods
 * @returns {object[]}
 */
function applyPeriodAnchors (gameId, pageKey, periods) {
  const anchor = CHALLENGE_PERIOD_ANCHORS[`${gameId}:${pageKey}`]
  if (!anchor) return periods
  const anchorStart = parseDataTime(anchor.start)
  const anchorPeriod = periods.find(period => period.identity === Number(anchor.id))
  if (!anchorStart || !anchorPeriod) return periods

  const span = Number(anchor.days) * DAY_MS
  if (!Number.isFinite(span) || span <= 0) return periods
  for (const period of periods) {
    if (period.begin && period.end) continue
    const begin = new Date(anchorStart.getTime() + (period.no - anchorPeriod.no) * span)
    period.begin = begin
    period.end = new Date(begin.getTime() + span - 1000)
    period.estimated = true
  }
  return periods
}

/**
 * 从期表里挑出「当前正在进行的期」（纯函数，便于回归测试）
 *
 * 只看「期窗口是否包含当前时间」，**不看记录顺序**：图鉴数据超前时最后一条可能是未来期，
 * 用 `records[last]` 会把还没开放的期当成本期。
 *
 * state 语义：
 *   - `current` 命中正在进行的期
 *   - `closed`  有日期数据但没有期覆盖当前时间（含未来期未开、数据滞后两种情况）
 *   - `nodate`  该玩法完全没有日期（当前为 hsr 四个玩法）——暂按数据最后一期处理，
 *               等接入版本序列后改为按版本序判定
 *   - `empty`   没有可用期
 * @param {object[]} periods - 已排序的期数组
 * @param {Date} now
 * @returns {{period: object|null, state: string, latest: object|null}}
 */
export function pickCurrent (periods, now) {
  if (!periods?.length) return { period: null, state: 'empty', latest: null }

  const time = now.getTime()
  const hit = periods.filter(period =>
    period.begin && period.end && period.begin.getTime() <= time && time <= period.end.getTime())
  if (hit.length) {
    // 时间窗重叠时取开启最晚的一期
    hit.sort((a, b) => b.begin.getTime() - a.begin.getTime())
    return { period: hit[0], state: 'current', latest: hit[0] }
  }

  const dated = periods.filter(period => period.begin && period.end)
  if (!dated.length) {
    return {
      period: periods[periods.length - 1],
      state: 'nodate',
      latest: periods[periods.length - 1],
      last: periods[periods.length - 1],
      next: null
    }
  }
  // 数据可能超前：最近已开期与最早未开期分开给，用于「本期未开放」的提示文案
  const time2 = now.getTime()
  const opened = dated.filter(period => period.begin.getTime() <= time2)
  const upcoming = dated.find(period => period.begin.getTime() > time2) || null
  return {
    period: null,
    state: 'closed',
    latest: dated[dated.length - 1],
    last: opened.length ? opened[opened.length - 1] : null,
    next: upcoming
  }
}

/**
 * 找当前正在进行的期（读取真实期表后交给 pickCurrent）
 * @param {string} gameId
 * @param {string} pageKey
 * @param {Date} [now]
 * @returns {{period: object|null, state: string, latest: object|null}}
 */
export function getCurrentPeriod (gameId, pageKey, now = new Date()) {
  return pickCurrent(getPeriods(gameId, pageKey), now)
}

/**
 * 某一期属于哪个版本（口径：**期开启日落在哪个版本区间**）
 *
 * 一期只算"开启它的那个版本"，跨版本不重复计；时间窗是估算值时按估算值算。
 * @param {string} gameId
 * @param {object} period
 * @returns {string|null} 版本号；无开启时间或早于版本序列起点返回 null
 */
export function getPeriodVersion (gameId, period) {
  if (!period?.begin) return null
  return getVersionAt(gameId, period.begin)
}

/**
 * 格式化为 `YYYY-MM-DD`（本地时区；不用 toISOString，避免 UTC 偏移把日期推到前一天）
 * @param {Date|null} date
 * @returns {string} 空值返回空串
 */
export function formatPeriodDate (date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 清空期表缓存（数据更新后由 reloadIndex 的调用方按需触发；map 对象变化也会自动失效）
 */
export function resetPeriodCache () {
  periodCache.clear()
  cachedMap = null
}
