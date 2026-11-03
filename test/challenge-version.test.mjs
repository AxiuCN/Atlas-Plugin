// 版本时间轴回归：版本号 ↔ 日期换算（纯函数，不依赖图鉴数据）
//
// 依据 components/constants.js 的 CHALLENGE_VERSION_TIMELINE：锚点版本 + 开启时间 +
// 周期（天）+ 各代 minor 上限。锚点是一次性历史常量，改了锚点本套件会立刻转红。
import { mod, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { parseDataTime, getVersionAt, getVersionRange, getVersionDistance, getTimeline } =
  await import(mod('model/ChallengeVersion.js'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

const at = (text) => parseDataTime(text)

console.log('\n=== 序列生成 ===')
const gi = getTimeline('gi')
check('原神序列含锚点版本', gi.index.has('5.7'))
check('原神序列按 minor 上限进位（5.8 → 6.0）',
  gi.index.has('5.8') && gi.index.has('6.0') && !gi.index.has('5.9'))
const hsr = getTimeline('hsr')
check('星铁序列 3.8 → 4.0 进位', hsr.index.has('3.8') && hsr.index.has('4.0') && !hsr.index.has('3.9'))
const zzz = getTimeline('zzz')
check('绝区零序列 2.7 → 3.0 进位', zzz.index.has('2.7') && zzz.index.has('3.0') && !zzz.index.has('2.8'))

console.log('\n=== 日期 → 版本 ===')
check('原神 2026-07-16 落在 6.7（7.0 于 08-19 才开）', getVersionAt('gi', at('2026-07-16 04:00:00')) === '6.7',
  String(getVersionAt('gi', at('2026-07-16 04:00:00'))))
check('原神锚点当日即锚点版本', getVersionAt('gi', at('2025-06-25 10:00:00')) === '5.7',
  String(getVersionAt('gi', at('2025-06-25 10:00:00'))))
check('星铁 2026-03-02 仍在 4.0（4.1 于 03-27 开）', getVersionAt('hsr', at('2026-03-02 04:00:00')) === '4.0',
  String(getVersionAt('hsr', at('2026-03-02 04:00:00'))))
check('绝区零 3.0 开启日命中 3.0', getVersionAt('zzz', at('2026-06-17 06:00:00')) === '3.0')
check('早于序列起点返回 null', getVersionAt('gi', at('2020-01-01 00:00:00')) === null)
check('非法日期返回 null', getVersionAt('gi', null) === null)

console.log('\n=== 版本 → 日期区间 ===')
const gi70 = getVersionRange('gi', '7.0')
check('原神 7.0 开启日 = 锚点 + 10 个周期', !!gi70 &&
  gi70.from.getTime() === at('2026-08-19 10:00:00')?.getTime(),
  gi70 ? gi70.from.toString().slice(0, 24) : 'null')
check('版本区间到下一版本开启前 1 秒',
  !!gi70 && gi70.to.getTime() === at('2026-09-30 09:59:59')?.getTime(),
  gi70 ? gi70.to.toString().slice(0, 24) : 'null')
const hsr44 = getVersionRange('hsr', '4.4')
check('星铁 4.4 开启日 = 锚点 + 4 个周期', !!hsr44 &&
  hsr44.from.getTime() === at('2026-07-31 06:00:00')?.getTime(),
  hsr44 ? hsr44.from.toString().slice(0, 24) : 'null')
check('未知版本返回 null', getVersionRange('hsr', '9.9') === null)

console.log('\n=== 版本距离 ===')
check('原神 5.7 → 7.0 相隔 10 个版本', getVersionDistance('gi', '5.7', '7.0') === 10,
  String(getVersionDistance('gi', '5.7', '7.0')))
check('跨代仍按实际版本数算（3.8 → 4.0 = 1）', getVersionDistance('hsr', '3.8', '4.0') === 1)
check('未知版本返回 null', getVersionDistance('gi', '5.7', '9.9') === null)
check('反向为负', getVersionDistance('gi', '7.0', '5.7') === -10)

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
