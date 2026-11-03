/**
 * ChallengeVersion — 版本时间轴
 *
 * 版本号与日期的换算集中在这里：`components/constants.js` 的 `CHALLENGE_VERSION_TIMELINE`
 * 给出「锚点版本 + 开启时间 + 周期（天）+ 各代 minor 上限」，本模块据此生成版本序列。
 *
 * **锚点是一次性历史常量**，不随版本滚动更新：只有官方改了版本周期（如某游戏从 42 天
 * 缩到 35 天）才需要改一个数。序列按 `+0.1` 递推、`minor` 超过该代上限后进位
 * （hsr 3.8 → 4.0），所以「每代几个版本」由 `minorMaxByMajor` 显式给出而不是猜。
 *
 * 超出生成范围的版本一律返回 null（查询侧提示不支持），不猜。
 */
import { CHALLENGE_VERSION_TIMELINE } from '../components/constants.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** 锚点前后各生成多少个版本（够覆盖往期查询，又不至于把序列算错代） */
const NEARBY_COUNT = 80

/** @type {Map<string, {list: {version: string, major: number, minor: number, start: Date}[], index: Map<string, number>}>} */
const timelineCache = new Map()

/**
 * 解析图鉴数据里的时间字符串（按本地时区）
 *
 * 数据形如 `2026-07-16 04:00:00`，是国服 04:00 日切口径的**本地时间**；
 * 直接交给 `new Date(str)` 会被按 UTC 解析，跨时区时日期会错一天，故手工拆字段。
 * @param {string} text
 * @returns {Date|null} 解析失败返回 null
 */
export function parseDataTime (text) {
  if (typeof text !== 'string') return null
  const matched = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!matched) return null
  const date = new Date(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
    Number(matched[4] || 0),
    Number(matched[5] || 0),
    Number(matched[6] || 0)
  )
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * 格式化版本号
 * @param {number} major
 * @param {number} minor
 * @returns {string} 如 `4.2`
 */
function versionLabel (major, minor) {
  return `${major}.${minor}`
}

/**
 * 某代的最大 minor（未知返回 null，调用方据此停止生成，不猜）
 * @param {object} cfg
 * @param {number} major
 * @returns {number|null}
 */
function minorMaxOf (cfg, major) {
  const max = cfg?.minorMaxByMajor?.[major]
  return Number.isInteger(max) ? max : null
}

/**
 * 生成版本序列（以锚点为中心向前向后各 NEARBY_COUNT 个）
 * @param {object} cfg - CHALLENGE_VERSION_TIMELINE[gameId]
 * @param {string} gameId
 * @returns {{list: object[], index: Map<string, number>}}
 */
function buildTimeline (cfg, gameId) {
  const anchorStart = parseDataTime(cfg?.anchorStart)
  const matched = typeof cfg?.anchorVersion === 'string' ? cfg.anchorVersion.match(/^(\d+)\.(\d+)$/) : null
  const cycleDays = Number(cfg?.cycleDays)
  if (!anchorStart || !matched || !Number.isFinite(cycleDays) || cycleDays <= 0) {
    return { list: [], index: new Map() }
  }

  const anchor = { major: Number(matched[1]), minor: Number(matched[2]) }
  const list = [{ version: versionLabel(anchor.major, anchor.minor), major: anchor.major, minor: anchor.minor, start: anchorStart }]

  // 向后：minor +1，超过该代上限进位
  let cursor = { major: anchor.major, minor: anchor.minor, start: anchorStart }
  for (let i = 0; i < NEARBY_COUNT; i++) {
    const max = minorMaxOf(cfg, cursor.major)
    if (max === null) break
    const next = cursor.minor + 1 > max
      ? { major: cursor.major + 1, minor: 0 }
      : { major: cursor.major, minor: cursor.minor + 1 }
    const start = new Date(cursor.start.getTime() + cycleDays * DAY_MS)
    list.push({ version: versionLabel(next.major, next.minor), major: next.major, minor: next.minor, start })
    cursor = { ...next, start }
  }

  // 向前：minor -1，归零时退到上一代的最大 minor
  cursor = { major: anchor.major, minor: anchor.minor, start: anchorStart }
  for (let i = 0; i < NEARBY_COUNT; i++) {
    let prev
    if (cursor.minor > 0) {
      prev = { major: cursor.major, minor: cursor.minor - 1 }
    } else {
      const max = minorMaxOf(cfg, cursor.major - 1)
      if (max === null) break
      prev = { major: cursor.major - 1, minor: max }
    }
    const start = new Date(cursor.start.getTime() - cycleDays * DAY_MS)
    list.push({ version: versionLabel(prev.major, prev.minor), major: prev.major, minor: prev.minor, start })
    cursor = { ...prev, start }
  }

  list.sort((a, b) => a.start.getTime() - b.start.getTime())
  const index = new Map(list.map((entry, i) => [entry.version, i]))
  logger?.info(`[Atlas] ${gameId} 版本时间轴：${list[0].version} ~ ${list[list.length - 1].version}`)
  return { list, index }
}

/**
 * 取（并缓存）某游戏的版本序列
 * @param {string} gameId - gi/hsr/zzz
 * @returns {{list: object[], index: Map<string, number>}}
 */
export function getTimeline (gameId) {
  const cached = timelineCache.get(gameId)
  if (cached) return cached
  const built = buildTimeline(CHALLENGE_VERSION_TIMELINE[gameId], gameId)
  timelineCache.set(gameId, built)
  return built
}

/**
 * 日期落在哪个版本里
 * @param {string} gameId
 * @param {Date} date
 * @returns {string|null} 版本号；早于序列起点或晚于终点返回 null
 */
export function getVersionAt (gameId, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  const { list } = getTimeline(gameId)
  if (!list.length) return null
  const time = date.getTime()
  if (time < list[0].start.getTime()) return null
  let found = null
  for (const entry of list) {
    if (entry.start.getTime() <= time) found = entry
    else break
  }
  return found ? found.version : null
}

/**
 * 版本区间（含首尾）
 * @param {string} gameId
 * @param {string} version - 如 `7.1`
 * @returns {{from: Date, to: Date}|null} 未知版本返回 null
 */
export function getVersionRange (gameId, version) {
  const { list, index } = getTimeline(gameId)
  const position = index.get(String(version))
  if (position === undefined) return null
  const from = list[position].start
  const next = list[position + 1]
  const to = next ? new Date(next.start.getTime() - 1000) : null
  if (!to) return null
  return { from, to }
}

/**
 * 两个版本相隔几个版本（to 晚于 from 为正）
 * @param {string} gameId
 * @param {string} from
 * @param {string} to
 * @returns {number|null} 任一版本未知返回 null
 */
export function getVersionDistance (gameId, from, to) {
  const { index } = getTimeline(gameId)
  const a = index.get(String(from))
  const b = index.get(String(to))
  if (a === undefined || b === undefined) return null
  return b - a
}

/**
 * 清空版本序列缓存（改了 `CHALLENGE_VERSION_TIMELINE` 或测试里替换锚点时用）
 */
export function resetVersionCache () {
  timelineCache.clear()
}
