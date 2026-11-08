// 挑战期表回归：选期逻辑（纯函数）+ 真实 Hesperides 期表
//
// 背景：期表由 Hesperides 产物提供（`periods.json` → `getHesperidesPeriods()`，
// 已带 no/begin/end/version）。本套件锁住两件事：
//   ① 选期只看时间窗，不看记录顺序（图鉴数据常超前于线上版本）；
//   ② 真实期表的形态与「本期」判定在 9 个玩法上都站得住。
import { mod, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { parseDataTime, pickCurrent, getPeriodVersion, formatPeriodDate, formatPeriodLabel, resolvePeriodSpec, periodMissReply } =
  await import(mod('model/ChallengePeriod.js'))
const { getHesperidesPeriods } = await import(mod('model/Hesperides.js'))
const { getVersionDistance } = await import(mod('model/ChallengeVersion.js'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

/* ============================================================
 *  一、时间解析（本地时区，不能被当成 UTC）
 * ============================================================ */

console.log('\n=== 时间解析 ===')
const at = (text) => parseDataTime(text)
const t1 = at('2026-07-16 04:00:00')
check('解析 04:00 日切口径', !!t1 &&
  t1.getFullYear() === 2026 && t1.getMonth() === 6 && t1.getDate() === 16 && t1.getHours() === 4,
  t1 ? t1.toString().slice(0, 24) : 'null')
check('只给日期时补 00:00', at('2026-07-16')?.getHours() === 0)
check('空串与非法文本返回 null', at('') === null && at('abc') === null)
check('01:59 不被算成前一天', at('2026-07-16 01:59:00')?.getDate() === 16)
check('日期格式化用本地时区（04:00 不会退到前一天）',
  formatPeriodDate(at('2026-07-16 04:00:00')) === '2026-07-16',
  formatPeriodDate(at('2026-07-16 04:00:00')))
check('日期格式化为空值 → 空串', formatPeriodDate(null) === '')

/* ============================================================
 *  二、本期判定：时间窗优先，未来期不得当本期
 * ============================================================ */

console.log('\n=== 本期判定 ===')
// 期对象与 Hesperides 产出的形状一致：no / begin / end 为 Date
const period = (name, no, begin, end) => ({ name, no, begin: at(begin), end: at(end) })
const timeline = [
  period('jan', 1, '2026-01-01 04:00:00', '2026-01-31 03:59:59'),
  period('feb', 2, '2026-02-01 04:00:00', '2026-02-28 03:59:59'),
  period('future', 3, '2026-12-01 04:00:00', '2026-12-31 03:59:59')
]

const inFeb = pickCurrent(timeline, at('2026-02-10 12:00:00'))
check('落在窗口内的期被选中', inFeb.state === 'current' && inFeb.period?.name === 'feb', inFeb.period?.name || inFeb.state)

const between = pickCurrent(timeline, at('2026-06-15 12:00:00'))
check('没有期覆盖当前时间时不返回未来期', between.state === 'closed' && between.period === null, between.state)
check('closed 时最近已开期与最早未开期分开给',
  between.last?.name === 'feb' && between.next?.name === 'future',
  `${between.last?.name || 'null'} / ${between.next?.name || 'null'}`)

const nodateTimeline = [{ name: 'n1', no: 1, begin: null, end: null }, { name: 'n2', no: 2, begin: null, end: null }]
const nodate = pickCurrent(nodateTimeline, at('2026-06-15 12:00:00'))
check('全无日期时回落最后一期并标记 nodate', nodate.state === 'nodate' && nodate.period?.name === 'n2', nodate.state)
check('空期表返回 empty', pickCurrent([], at('2026-06-15 12:00:00')).state === 'empty')

const febVersion = getPeriodVersion('gi', timeline[1])
check('期标识含期号 / 版本 / 起止',
  formatPeriodLabel('gi', timeline[1]) === `第 2 期 · ${febVersion} 版本 · 2026-02-01 → 02-28`,
  formatPeriodLabel('gi', timeline[1]))
check('估算期标「推定」', formatPeriodLabel('gi', { ...timeline[1], estimated: true }).endsWith('（推定）'))
check('空期标识为空串', formatPeriodLabel('gi', null) === '')

/* ============================================================
 *  三、期修饰：按月份 / 版本 / 相对期挑期，未命中给不同状态
 * ============================================================ */

console.log('\n=== 期修饰 ===')
const byMonth = resolvePeriodSpec('gi', 'tower', { kind: 'month', month: '202602' }, at('2026-06-15 12:00:00'), timeline)
check('月份命中', byMonth.state === 'month' && byMonth.period?.name === 'feb', byMonth.state)
const monthMiss = resolvePeriodSpec('gi', 'tower', { kind: 'month', month: '202501' }, at('2026-06-15 12:00:00'), timeline)
check('月份未命中', monthMiss.state === 'no-month' && monthMiss.period === null)
check('月份未命中有专属文案', /没有 2025 年 1 月 的期/.test(periodMissReply('深境螺旋', monthMiss) || ''))

const byVersion = resolvePeriodSpec('gi', 'tower', { kind: 'version', version: febVersion, slot: 'a' }, at('2026-06-15 12:00:00'), timeline)
check('版本命中', byVersion.state === 'version' && byVersion.period?.name === 'feb', byVersion.state)
// 找一个肯定没有期的版本：版本时间轴里存在但 timeline 里没有对应期
const versionMiss = resolvePeriodSpec('gi', 'tower', { kind: 'version', version: '1.0', slot: 'a' }, at('2026-06-15 12:00:00'), timeline)
check('该版本没有期（时间轴上存在，期表里无）', versionMiss.state === 'no-version', versionMiss.state)
const unknownVersion = resolvePeriodSpec('gi', 'tower', { kind: 'version', version: '99.9', slot: 'a' }, at('2026-06-15 12:00:00'), timeline)
check('未知版本', unknownVersion.state === 'unknown-version')

const thisPeriod = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '本期' }, at('2026-02-10 12:00:00'), timeline)
check('本期命中', thisPeriod.state === 'current' && thisPeriod.period?.name === 'feb')
const thisClosed = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '本期' }, at('2026-06-15 12:00:00'), timeline)
check('本期未开放 → closed', thisClosed.state === 'closed' && thisClosed.period === null)
const prevPeriod = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '上期' }, at('2026-06-15 12:00:00'), timeline)
check('本期未开放时上期 = 最近已开期', prevPeriod.state === 'relative' && prevPeriod.period?.name === 'feb')
const nextPeriod = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '下期' }, at('2026-06-15 12:00:00'), timeline)
check('本期未开放时下期 = 最早未开期', nextPeriod.state === 'relative' && nextPeriod.period?.name === 'future')
check('空期表 → empty', resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '本期' }, at('2026-01-01'), null).state === 'empty')

/* ============================================================
 *  四、真实期表：来自 Hesperides 产物（9 个玩法全覆盖）
 * ============================================================ */

requireAtlasData()

console.log('\n=== 真实期表（Hesperides）===')
const MODES = [
  ['gi', 'tower'], ['gi', 'rolecombat'], ['gi', 'leyline'],
  ['hsr', 'maze'], ['hsr', 'maze_boss'], ['hsr', 'maze_extra'], ['hsr', 'maze_peak'],
  ['zzz', 'shiyu'], ['zzz', 'boss']
]

for (const [gameId, pageKey] of MODES) {
  const hes = getHesperidesPeriods(gameId, pageKey)
  const label = `${gameId}/${pageKey}`
  check(`${label} 取到期表（源 ${hes?.source || '-'} / 页 ${hes?.page || '-'}）`, Boolean(hes?.periods?.length), hes ? `${hes.periods.length} 期` : 'null')
  if (!hes) continue

  const periods = hes.periods
  check(`${label} 期序号从 1 连续`, periods.every((p, i) => p.no === i + 1))
  check(`${label} 期对象带 Date 型 begin/end`,
    periods.every(p => p.begin instanceof Date && p.end instanceof Date))
  check(`${label} 没有结束早于开始的期`, !periods.some(p => p.end <= p.begin))
  check(`${label} 按期序递增（begin 单调）`,
    periods.every((p, i) => i === 0 || periods[i - 1].begin <= p.begin))

  const current = pickCurrent(periods, new Date())
  check(`${label} 本期状态合法`, ['current', 'closed', 'nodate', 'empty'].includes(current.state), current.state)
  if (current.state === 'current') {
    const now = Date.now()
    check(`${label} 本期窗口包含当前时间`,
      current.period.begin.getTime() <= now && now <= current.period.end.getTime())
  } else if (current.state === 'closed') {
    check(`${label} 无本期时不回退到任何一期`, current.period === null)
  }

  // 期 → 版本：带时间的期应尽量落在版本时间轴内
  const versions = periods.map(p => getPeriodVersion(gameId, p)).filter(Boolean)
  check(`${label} 期→版本有可解析结果`, versions.length > 0, `${versions.length}/${periods.length}`)
  check(`${label} 期→版本随期序非递减`, versions.every((version, i) => {
    if (i === 0) return true
    const distance = getVersionDistance(gameId, versions[i - 1], version)
    return distance !== null && distance >= 0
  }))
}

// 跨源同名页不再互相覆盖：gi/hsr 的终局页来自玉璃，zzz 来自 nanoka
check('gi 终局页来自玉璃（alioth）', getHesperidesPeriods('gi', 'tower')?.source === 'alioth')
check('hsr 终局页来自玉璃（alioth）', getHesperidesPeriods('hsr', 'maze')?.source === 'alioth')
check('zzz 终局页来自 nanoka', getHesperidesPeriods('zzz', 'boss')?.source === 'nanoka')
check('未知页返回 null', getHesperidesPeriods('gi', 'not-a-challenge-page') === null)

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)