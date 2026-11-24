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

console.log('\n=== 版本徽标（Hero 右上角）===')
const { parseVersionBadge } = await import(mod('components/versionBadge.js'))
const badge = (game, raw) => parseVersionBadge(game, raw) || {}
check('原神 7.2.52 = 7.3 v3 测试服',
  badge('gi', '7.2.52').label === '原神7.3 v3测试服' && badge('gi', '7.2.52').short === 'GI 7.2.52',
  JSON.stringify(badge('gi', '7.2.52')))
check('原神 7.2.50 = 7.3 v1 测试服', badge('gi', '7.2.50').label === '原神7.3 v1测试服', badge('gi', '7.2.50').label)
check('原神 7.8.50 进位到 8.0 v1', badge('gi', '7.8.50').label === '原神8.0 v1测试服', badge('gi', '7.8.50').label)
check('原神 1.6 是历史最后小版本（进位到 2.0）', badge('gi', '1.6.50').label === '原神2.0 v1测试服', badge('gi', '1.6.50').label)
check('原神 6.7 是历史最后小版本（进位到 7.0）', badge('gi', '6.7.50').label === '原神7.0 v1测试服', badge('gi', '6.7.50').label)
check('原神 6.6 仍在 6.x 内（进位到 6.7）', badge('gi', '6.6.50').label === '原神6.7 v1测试服', badge('gi', '6.6.50').label)
check('原神正式服 7.2', badge('gi', '7.2').label === '原神7.2 正式服', badge('gi', '7.2').label)
check('星铁正式服 4.3', badge('hsr', '4.3').label === '崩坏·星穹铁道 4.3 正式服', badge('hsr', '4.3').label)
check('星铁 1.6 是历史最后小版本（进位到 2.0）', badge('hsr', '1.6.50').label === '崩坏·星穹铁道 2.0 v1测试服', badge('hsr', '1.6.50').label)
check('星铁 2.7 是历史最后小版本（进位到 3.0）', badge('hsr', '2.7.50').label === '崩坏·星穹铁道 3.0 v1测试服', badge('hsr', '2.7.50').label)
check('星铁 3.x 仍按默认 x.8 收尾（3.8 → 4.0）', badge('hsr', '3.8.50').label === '崩坏·星穹铁道 4.0 v1测试服', badge('hsr', '3.8.50').label)
check('星铁 6.7 不特殊（默认 x.8 收尾）', badge('hsr', '6.7.50').label === '崩坏·星穹铁道 6.8 v1测试服', badge('hsr', '6.7.50').label)
check('星铁 4.7.52 = 4.8 v3 测试服', badge('hsr', '4.7.52').label === '崩坏·星穹铁道 4.8 v3测试服', badge('hsr', '4.7.52').label)
check('绝区零 3.4.5+构建号 = 3.4 v5 测试服',
  badge('zzz', '3.4.5+20694646').label === '绝区零3.4 v5测试服' && badge('zzz', '3.4.5+20694646').short === 'ZZZ 3.4.5+20694646',
  JSON.stringify(badge('zzz', '3.4.5+20694646')))
check('绝区零正式服 3.4', badge('zzz', '3.4').label === '绝区零3.4 正式服', badge('zzz', '3.4').label)
check('无法解析的版本返回 null', parseVersionBadge('gi', 'not-a-version') === null)

console.log('\n=== 版本 → 日期区间 ===')
const gi70 = getVersionRange('gi', '7.0')
check('原神 7.0 开启日 = 锚点 + 10 个周期（按天口径，归一到 00:00）', !!gi70 &&
  gi70.from.getTime() === at('2026-08-19 00:00:00')?.getTime(),
  gi70 ? gi70.from.toString().slice(0, 24) : 'null')
check('版本区间到下一版本开启日前 1 秒',
  !!gi70 && gi70.to.getTime() === at('2026-09-29 23:59:59')?.getTime(),
  gi70 ? gi70.to.toString().slice(0, 24) : 'null')
const hsr44 = getVersionRange('hsr', '4.4')
check('星铁 4.4 开启日 = 锚点 + 4 个周期（按天口径）', !!hsr44 &&
  hsr44.from.getTime() === at('2026-07-31 00:00:00')?.getTime(),
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
