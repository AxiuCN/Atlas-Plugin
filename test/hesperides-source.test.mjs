// Hesperides 数据源回归：期表映射、记录读取、通用挑战渲染器
import { mod, requireAtlasData } from './_helper.mjs'
import { installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { getHesperidesPeriods, readHesperidesRecord, hasHesperidesData, getHesperidesChannels } =
  await import(mod('model/Hesperides.js'))
const { buildHesperidesChallengeSections, pickHesperidesTitle } = await import(mod('components/hesperidesChallenge.js'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

console.log('\n=== 通用渲染器（数据无关） ===')
const synthetic = {
  Buff: { Name: '末法余烬', Desc: '拥有【坚防守备】的敌方目标被弱点击破时…' },
  Floors: [
    { Floor: 3, HP: 7300969, Monsters: [{ Name: '甲' }, { Name: '乙' }] },
    { Floor: 4, HP: 48329009 }
  ],
  Monsters: [{ Name: '丙' }]
}
const sections = buildHesperidesChallengeSections('maze_boss', synthetic)
check('增益段落被识别', sections[0]?.title === '增益' && sections[0].fields.length === 1)
check('列表字段按条成段', sections.filter(s => s.title.startsWith('Floors')).length === 2)
check('数字字段被渲染成文本', sections.some(s => s.fields.some(f => f.label === 'HP' && f.value === '7300969')))
check('数组字段拼成一行', sections.some(s => s.fields.some(f => String(f.value).includes('甲、乙'))))
check('空记录返回空 sections', buildHesperidesChallengeSections('maze_boss', null).length === 0)
check('标题取 Name 字段', pickHesperidesTitle(synthetic) === '' && pickHesperidesTitle({ Name: '支配遗志' }) === '支配遗志')
check('超长文本被截断', buildHesperidesChallengeSections('as', { Buff: 'x'.repeat(300) })[0].fields[0].value.length <= 121)

requireAtlasData()

console.log('\n=== 真实产物映射 ===')
if (!hasHesperidesData()) {
  console.log('  ⏭ Hesperides 产物不存在（先跑 node src/cli.mjs …），跳过真实数据断言')
} else {
  const tower = getHesperidesPeriods('gi', 'tower')
  check('gi tower → alioth abyss', tower?.source === 'alioth' && tower.page === 'abyss', `${tower?.source}:${tower?.page}`)
  check('期对象带 Date 起止', tower.periods[0].begin instanceof Date && tower.periods.at(-1).end instanceof Date)
  check('期序号连续', tower.periods.every((p, i) => i === 0 || tower.periods[i - 1].begin <= p.begin))
  check('zzz 走 nanoka 源', getHesperidesPeriods('zzz', 'boss')?.source === 'nanoka')
  check('未知页返回 null', getHesperidesPeriods('gi', 'character') === null)
  const last = tower.periods.at(-1)
  const record = readHesperidesRecord('gi', 'tower', last.id)
  check('按 id 读到记录', !!record && typeof record === 'object', last.id)
  check('读不存在的 id 返回 null', readHesperidesRecord('gi', 'tower', '0') === null)
  check('频道状态可读', !!getHesperidesChannels()?.gi)
}

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
