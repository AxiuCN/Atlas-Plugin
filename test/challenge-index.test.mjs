// 终局挑战期索引回归：期表构建（纯函数）+ 真实数据的期数与「本期」判定
//
// 背景：挑战页在 map.json 里同名多条（zzz 危局 47 条全叫「试炼」），索引层按「页 + 名」去重后
// 只剩 1~4 条；且图鉴数据常超前于线上版本，`records[last]` 可能是尚未开放的未来期。
// 本套件锁住两点：期表不再受同名去重影响、「本期」由时间窗判定而不是记录顺序。
import { mod, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { parseDataTime, collectPeriods, pickCurrent, getPeriods, getCurrentPeriod, getPeriodVersion, formatPeriodDate } =
  await import(mod('model/ChallengePeriod.js'))
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
const t1 = parseDataTime('2026-07-16 04:00:00')
check('解析 04:00 日切口径', !!t1 &&
  t1.getFullYear() === 2026 && t1.getMonth() === 6 && t1.getDate() === 16 && t1.getHours() === 4,
  t1 ? t1.toString().slice(0, 24) : 'null')
check('只给日期时补 00:00', parseDataTime('2026-07-16')?.getHours() === 0)
check('空串与非法文本返回 null', parseDataTime('') === null && parseDataTime('abc') === null)
check('01:59 不被算成前一天', parseDataTime('2026-07-16 01:59:00')?.getDate() === 16)
check('日期格式化用本地时区（04:00 不会退到前一天）',
  formatPeriodDate(parseDataTime('2026-07-16 04:00:00')) === '2026-07-16',
  formatPeriodDate(parseDataTime('2026-07-16 04:00:00')))
check('日期格式化为空值 → 空串', formatPeriodDate(null) === '')

/* ============================================================
 *  二、期表构建：排序、占位剔除、去重
 * ============================================================ */

console.log('\n=== 期表构建 ===')
const at = (text) => parseDataTime(text)
const synthetic = collectPeriods([
  { name: 'b', filePath: 'b.json', begin: at('2026-02-01 04:00:00'), end: at('2026-02-28 03:59:59'), detailId: 2 },
  { name: 'a', filePath: 'a.json', begin: at('2026-01-01 04:00:00'), end: at('2026-01-31 03:59:59'), detailId: 1 },
  { name: 'nodate-late', filePath: 'x.json', begin: null, end: null, detailId: 9 },
  { name: 'nodate-early', filePath: 'y.json', begin: null, end: null, detailId: 5 },
  { name: 'placeholder', filePath: 's.json', begin: at('2026-03-01 04:00:00'), end: at('2026-03-01 20:00:00'), detailId: 3 },
  { name: 'dup-old', filePath: 'd1.json', begin: at('2026-04-01 04:00:00'), end: at('2026-04-15 03:59:59'), detailId: 10 },
  { name: 'dup-new', filePath: 'd2.json', begin: at('2026-04-01 04:00:00'), end: at('2026-04-15 03:59:59'), detailId: 11 }
])

check('按期启日升序，无时间期排最后', synthetic.map(p => p.name).join(',')
  === 'a,b,dup-new,nodate-early,nodate-late', synthetic.map(p => p.name).join(','))
check('期序号从 1 连续', synthetic.every((p, i) => p.no === i + 1))
check('一天窗口的占位期被剔除', !synthetic.some(p => p.name === 'placeholder'))
check('同窗口重复只保留 detail.id 最大的一条',
  !synthetic.some(p => p.name === 'dup-old') && synthetic.some(p => p.name === 'dup-new'))
check('无时间期按 detail.id 升序',
  synthetic.findIndex(p => p.name === 'nodate-early') < synthetic.findIndex(p => p.name === 'nodate-late'))

/* ============================================================
 *  三、本期判定：时间窗优先，未来期不得当本期
 * ============================================================ */

console.log('\n=== 本期判定 ===')
const timeline = collectPeriods([
  { name: 'jan', filePath: 'jan.json', begin: at('2026-01-01 04:00:00'), end: at('2026-01-31 03:59:59'), detailId: 1 },
  { name: 'feb', filePath: 'feb.json', begin: at('2026-02-01 04:00:00'), end: at('2026-02-28 03:59:59'), detailId: 2 },
  { name: 'future', filePath: 'future.json', begin: at('2026-12-01 04:00:00'), end: at('2026-12-31 03:59:59'), detailId: 3 }
])

const inFeb = pickCurrent(timeline, at('2026-02-10 12:00:00'))
check('落在窗口内的期被选中', inFeb.state === 'current' && inFeb.period?.name === 'feb', inFeb.period?.name || inFeb.state)

const between = pickCurrent(timeline, at('2026-06-15 12:00:00'))
check('没有期覆盖当前时间时不返回未来期', between.state === 'closed' && between.period === null, between.state)
check('closed 时最近已开期与最早未开期分开给',
  between.last?.name === 'feb' && between.next?.name === 'future',
  `${between.last?.name || 'null'} / ${between.next?.name || 'null'}`)

const nodateTimeline = collectPeriods([
  { name: 'n1', filePath: 'n1.json', begin: null, end: null, detailId: 1 },
  { name: 'n2', filePath: 'n2.json', begin: null, end: null, detailId: 2 }
])
const nodate = pickCurrent(nodateTimeline, at('2026-06-15 12:00:00'))
check('全无日期时回落最后一期并标记 nodate', nodate.state === 'nodate' && nodate.period?.name === 'n2', nodate.state)
check('空期表返回 empty', pickCurrent([], at('2026-06-15 12:00:00')).state === 'empty')

/* ============================================================
 *  四、真实数据：期数、占位剔除、「本期」与旧实现的差异
 * ============================================================ */

requireAtlasData()

console.log('\n=== 真实期表 ===')
const MODES = [
  ['gi', 'tower'], ['gi', 'rolecombat'], ['gi', 'leyline'],
  ['hsr', 'maze'], ['hsr', 'maze_boss'], ['hsr', 'maze_extra'], ['hsr', 'maze_peak'],
  ['zzz', 'shiyu'], ['zzz', 'boss']
]

for (const [gameId, pageKey] of MODES) {
  const periods = getPeriods(gameId, pageKey)
  const dated = periods.filter(p => p.begin && p.end)
  const estimated = periods.filter(p => p.estimated)
  const current = getCurrentPeriod(gameId, pageKey)
  const label = `${gameId}/${pageKey}`

  check(`${label} 期数 ${periods.length}（有日期 ${dated.length}，估算 ${estimated.length}）`, periods.length > 0)
  check(`${label} 期序号连续`, periods.every((p, i) => p.no === i + 1))
  check(`${label} 无一天窗口的占位期`,
    !periods.some(p => p.begin && p.end && p.end - p.begin < 3 * 86400000))
  check(`${label} 没有结束早于开始的期`,
    !periods.some(p => p.begin && p.end && p.end <= p.begin))
  check(`${label} 至少有一条期带时间`, dated.length > 0)
  check(`${label} 本期状态合法`, ['current', 'closed', 'nodate', 'empty'].includes(current.state), current.state)
  if (current.state === 'current') {
    const now = Date.now()
    check(`${label} 本期窗口包含当前时间`,
      current.period.begin.getTime() <= now && now <= current.period.end.getTime())
  } else if (current.state === 'closed') {
    check(`${label} 无本期时不回退到任何一期`, current.period === null)
  }
  // 估算期的窗口长度必须等于锚点期长，且按序递增（等距外推的自检）
  if (estimated.length) {
    check(`${label} 估算期窗口长度一致`,
      new Set(estimated.map(p => p.end - p.begin)).size === 1)
    check(`${label} 估算期按序递增`,
      estimated.every((p, i) => i === 0 || estimated[i - 1].begin < p.begin))
  }

  // 期 → 版本：带时间的期应尽量落在版本时间轴内，相邻期最多相差一个版本
  // （早期期早于版本序列起点 → null；少数记录日期异常会与 id 顺序错位一个版本，均属已知偏差）
  const versions = periods.map(p => getPeriodVersion(gameId, p)).filter(Boolean)
  check(`${label} 期→版本有可解析结果`, versions.length > 0, `${versions.length}/${dated.length}`)
  // 估算出来的期由等距外推得到，相邻期最多差一个版本；真实日期数据里有整段缺期（zzz 式舆
  // 2024-08 之后直接跳到 2025-12），相邻差可以很大，故只对估算模式断言
  if (estimated.length) {
    check(`${label} 期→版本相邻差不超过一个版本`, versions.every((version, i) => {
      if (i === 0) return true
      const distance = getVersionDistance(gameId, versions[i - 1], version)
      return distance !== null && Math.abs(distance) <= 1
    }))
  }
}

// 同名去重曾把 zzz 危局压到 1 条、式舆压到 4 条；期表必须完全不受影响
check('zzz/boss 期数 > 1（同名不再被去重压掉）', getPeriods('zzz', 'boss').length > 1,
  String(getPeriods('zzz', 'boss').length))
check('zzz/shiyu 期数 > 4（同名不再被去重压掉）', getPeriods('zzz', 'shiyu').length > 4,
  String(getPeriods('zzz', 'shiyu').length))
check('gi/tower 有超过 20 期可用', getPeriods('gi', 'tower').length > 20,
  String(getPeriods('gi', 'tower').length))

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
