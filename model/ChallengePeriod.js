/**
 * ChallengePeriod — 挑战期表的「选期」逻辑
 *
 * 期表本身**不在这里构建**：数据来自 Hesperides 产物（`periods.json`，经
 * `model/Hesperides.js` 的 `getHesperidesPeriods(gameId, pageKey)` 适配成同形对象，
 * 含 `no` / `begin` / `end` / `version`，`begin`/`end` 已解析成 Date）。
 *
 * 本模块只负责「在给定期表上做选择与格式化」：
 *   - `pickCurrent()`       哪一期正在开（由时间窗判定，不看记录顺序）
 *   - `parsePeriodSpec()`   解析查询里的期修饰（月份 / 版本 / 本期·上期·下期）
 *   - `resolvePeriodSpec()` 按修饰挑期
 *   - `periodMissReply()`   未命中状态 → 用户文案
 *   - `formatPeriodLabel()` 期的展示标题
 *
 * 为什么要按时间窗判定「本期」：图鉴数据常超前于线上版本，最后一期可能是尚未开放的未来期，
 * 用「最后一条」会把没开的期当成本期。
 */
import { parseDataTime, getVersionAt, getVersionRange } from './ChallengeVersion.js'

// 时间解析与版本时间轴都在 ChallengeVersion（本模块再导出，保持调用方 import 面不变）
export { parseDataTime }

/**
 * 从期表里挑出「当前正在进行的期」（纯函数，便于回归测试）
 *
 * 只看「期窗口是否包含当前时间」，**不看记录顺序**：图鉴数据超前时最后一条可能是未来期，
 * 用 `records[last]` 会把还没开放的期当成本期。
 *
 * state 语义：
 *   - `current` 命中正在进行的期
 *   - `closed`  有日期数据但没有期覆盖当前时间（含未来期未开、数据滞后两种情况）
 *   - `nodate`  该玩法完全没有日期——暂按数据最后一期处理
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
  const opened = dated.filter(period => period.begin.getTime() <= time)
  const upcoming = dated.find(period => period.begin.getTime() > time) || null
  return {
    period: null,
    state: 'closed',
    latest: dated[dated.length - 1],
    last: opened.length ? opened[opened.length - 1] : null,
    next: upcoming
  }
}

/**
 * 某一期属于哪个版本（口径：**期开启日落在哪个版本区间**）
 *
 * 一期只算"开启它的那个版本"，跨版本不重复计。
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
 * 期的展示标题：`第 44 期 · 4.4 版本 · 2026-07-20 → 2026-08-31（推定）`
 *
 * 三段信息缺一不可——只给期名（zzz 全叫「试炼」）用户无法确认选中了哪一期。
 * @param {string} gameId
 * @param {object} period
 * @returns {string} 空期返回空串
 */
export function formatPeriodLabel (gameId, period) {
  if (!period) return ''
  const parts = []
  if (period.no) parts.push(`第 ${period.no} 期`)
  const version = getPeriodVersion(gameId, period)
  if (version) parts.push(`${version} 版本`)
  if (period.begin && period.end) {
    const from = formatPeriodDate(period.begin)
    const to = formatPeriodDate(period.end)
    // 同年时省略结束日期的年份，避免这一行在 900px 画布上折行
    parts.push(`${from} → ${from.slice(0, 4) === to.slice(0, 4) ? to.slice(5) : to}`)
  }
  if (period.estimated) parts.push('（推定）')
  return parts.join(' · ')
}

/**
 * 解析查询里的「期修饰」前缀（月份 / 版本 / 相对期）
 *
 * 语序固定为 `<期修饰><挑战名>[图鉴]`，只识别前缀，避免与挑战名内部数字打架：
 *   - 月份：`202606`（`20\d{2}` + 合法月份；不合法的如 `202613` 不匹配）
 *   - 版本：`7.1` / `7.1a` / `7.1b`（小写字母可省，默认 `a`）
 *   - 相对：`本期` / `上期` / `下期`
 * @param {string} keyword - 已剥掉「图鉴」等后缀的关键词
 * @returns {{spec: object, base: string}|null} 未命中返回 null
 */
export function parsePeriodSpec (keyword) {
  if (typeof keyword !== 'string') return null
  const text = keyword.trim()
  if (!text) return null

  let matched = text.match(/^(20\d{2})(0[1-9]|1[0-2])(?=[^\d]|$)/)
  if (matched) {
    return { spec: { kind: 'month', month: `${matched[1]}${matched[2]}` }, base: text.slice(matched[0].length).trim() }
  }

  matched = text.match(/^(\d{1,2})\.(\d{1,2})([a-fA-F])?(?=[^\d.]|$)/)
  if (matched) {
    return {
      spec: {
        kind: 'version',
        version: `${Number(matched[1])}.${Number(matched[2])}`,
        slot: (matched[3] || 'a').toLowerCase()
      },
      base: text.slice(matched[0].length).trim()
    }
  }

  matched = text.match(/^(本期|上期|下期)/)
  if (matched) {
    return { spec: { kind: 'relative', which: matched[1] }, base: text.slice(matched[0].length).trim() }
  }

  return null
}

/**
 * 按「期修饰」挑期
 *
 * state 语义见各分支：`month`/`version`/`relative` 命中；`no-month`/`no-version`/`unknown-version`/
 * `no-prev`/`no-next`/`closed` 为各类未命中，调用方据此给不同文案。
 * @param {string} gameId
 * @param {string} pageKey
 * @param {object} spec - parsePeriodSpec 的 spec
 * @param {Date} [now]
 * @param {object[]} periods - 期表（调用方从 `getHesperidesPeriods()` 取；缺省为空表）
 * @returns {{period: object|null, state: string, spec: object}}
 */
export function resolvePeriodSpec (gameId, pageKey, spec, now = new Date(), periods = null) {
  const list = periods || []
  if (!list.length) return { period: null, state: 'empty', spec }
  const dated = list.filter(period => period.begin && period.end)

  if (spec.kind === 'month') {
    const hit = dated.find(period =>
      `${period.begin.getFullYear()}${String(period.begin.getMonth() + 1).padStart(2, '0')}` === spec.month)
    return { period: hit || null, state: hit ? 'month' : 'no-month', spec }
  }

  if (spec.kind === 'version') {
    const range = getVersionRange(gameId, spec.version)
    if (!range) return { period: null, state: 'unknown-version', spec }
    const group = dated.filter(period => period.begin >= range.from && period.begin <= range.to)
    if (!group.length) return { period: null, state: 'no-version', spec }
    const slot = spec.slot.charCodeAt(0) - 97
    // 该版本期数不足（如只有 a 却查 b）→ 回落 a
    return { period: group[slot] || group[0], state: 'version', spec }
  }

  const current = pickCurrent(list, now)
  if (spec.which === '本期') {
    return current.period
      ? { period: current.period, state: 'current', spec }
      : { period: null, state: 'closed', spec }
  }

  // 本期未开放时：上期 = 最近结束的那期，下期 = 最早未开的那期
  if (!current.period) {
    if (spec.which === '上期') {
      return current.last
        ? { period: current.last, state: 'relative', spec }
        : { period: null, state: 'closed', spec }
    }
    return current.next
      ? { period: current.next, state: 'relative', spec }
      : { period: null, state: 'no-next', spec }
  }

  const index = dated.indexOf(current.period)
  const target = spec.which === '上期' ? dated[index - 1] : dated[index + 1]
  if (!target) return { period: null, state: spec.which === '上期' ? 'no-prev' : 'no-next', spec }
  return { period: target, state: 'relative', spec }
}

/**
 * 把期修饰的未命中状态翻成对用户的话（null 表示照常出图）
 * @param {string} pageTitle
 * @param {{state: string, spec: object}} resolved
 * @returns {string|null}
 */
export function periodMissReply (pageTitle, resolved) {
  const spec = resolved?.spec || {}
  switch (resolved?.state) {
    case 'no-month': {
      const month = `${spec.month.slice(0, 4)} 年 ${Number(spec.month.slice(4))} 月`
      return `[Atlas] ${pageTitle} 没有 ${month} 的期`
    }
    case 'no-version':
      return `[Atlas] ${pageTitle} 在 ${spec.version} 版本没有期`
    case 'unknown-version':
      return `[Atlas] 暂不支持 ${spec.version} 这个版本（可查范围以数据里有的期为准）`
    case 'no-prev':
      return `[Atlas] ${pageTitle} 没有更早的期了`
    case 'no-next':
      return `[Atlas] ${pageTitle} 没有更新的期了`
    default:
      return null
  }
}