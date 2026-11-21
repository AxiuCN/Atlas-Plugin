// 挑战超前层回归：身份键推断、日期外推、可疑跨度、预览渲染
//
// 超前层的契约：**期表与日期以主表（玉璃）为准**，预览源只提供「主表还没发布的那一期」的内容。
// 身份键按玩法不同（祝福名 / 序号 / 版本号 / 期 id），断言只校验「规则本身成立」，
// 不写死期号或条数——数据会继续长。
import { mod, requireHesperidesProducts, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const { getHesperidesPeriods, getHesperidesPeriodPage, getHesperidesPage } = await import(mod('model/Hesperides.js'))
const { addMonths, monthStep, buildPreviewSections } = await import(mod('model/HesperidesPreview.js'))
const { readRawByPath, syntheticPath } = await import(mod('model/HesperidesRepository.js'))
const { formatPeriodLabel } = await import(mod('model/ChallengePeriod.js'))

const { check, finish } = checker()

/** 主表期（去掉预告） */
const mainOf = (hes) => (hes?.periods || []).filter((period) => !period.preview)
/** 预告期 */
const previewOf = (hes) => (hes?.periods || []).filter((period) => period.preview)

console.log('\n=== ① 预览渲染（数据无关） ===')

const lunarisTower = {
  chsBuffName: '甲霰之月',
  detail: {
    monthlyBuff: { description: '处于护盾庇护下的当前场上角色对敌人造成伤害时…' },
    floors: [{ floorIndex: 12, chambers: [{ monsterLevel: 95 }, { monsterLevel: 100 }], firstHalfBuff: '上半', secondHalfBuff: '下半' }]
  }
}
const towerSections = buildPreviewSections('lunaris', 'tower', lunarisTower)
check('深渊预告出「月之祝福」段', towerSections[0]?.title === '月之祝福' && towerSections[0].fields[0].label === '甲霰之月')
check('深渊预告出层段且房间等级成行', towerSections.some((s) => s.title === '第 12 层' && s.fields.some((f) => f.value === '95 / 100')))

const gensriSections = buildPreviewSections('gensri', 'stygian', {
  name: '霜锋之役',
  detail: { title: '危战 7.3', date: '2026-12-23', enemies: [{ name: '甲' }, { name: '乙' }] }
})
check('危战预告出期名与敌阵', gensriSections[0]?.fields.some((f) => f.value === '霜锋之役') &&
  gensriSections.some((s) => s.title === '敌阵' && s.fields.length === 2))

const nanokaSections = buildPreviewSections('nanoka', 'maze_boss', {
  detail: { buff: { name: '末法余烬', desc: '说明' }, level: [{ damage_type1: 'Fire', boss_monster_id: 501401404 }] }
})
check('末日预告出增益与关卡', nanokaSections[0]?.title === '增益' && nanokaSections.some((s) => s.title === '关卡 1'))

check('空记录不出段', buildPreviewSections('lunaris', 'tower', null).length === 0)
check('未知预览源不出段', buildPreviewSections('someone', 'else', { a: 1 }).length === 0)
check('无月度祝福时不硬造祝福段', buildPreviewSections('lunaris', 'tower', { detail: { floors: [] } }).length === 0)

console.log('\n=== ② 日期外推规则（数据无关） ===')
const jan15 = new Date(2027, 0, 15, 4, 0, 0)
check('按月平移保留“第几天”', addMonths(jan15, 1).getDate() === 15)
check('月底不足时退到当月最后一天', addMonths(new Date(2027, 0, 31), 1).getMonth() === 1 && addMonths(new Date(2027, 0, 31), 1).getDate() === 28)
check('两期相差一个月时 step=1', monthStep([{ begin: new Date(2026, 10, 16) }, { begin: new Date(2026, 11, 16) }]) === 1)
check('期表不足两条时 step=1', monthStep([{ begin: new Date(2026, 10, 16) }]) === 1)

requireHesperidesProducts()

console.log('\n=== ③ 真实产物：四个玩法的超前层 ===')
const tower = getHesperidesPeriods('gi', 'tower')
const rolecombat = getHesperidesPeriods('gi', 'rolecombat')
const leyline = getHesperidesPeriods('gi', 'leyline')
const mazeBoss = getHesperidesPeriods('hsr', 'maze_boss')

// 合并后的期表性质：序号连续、begin 单调（预告接在主表之后）
for (const [label, hes] of [['gi/tower', tower], ['gi/rolecombat', rolecombat], ['gi/leyline', leyline], ['hsr/maze_boss', mazeBoss]]) {
  const periods = hes?.periods || []
  check(`${label} 合并后期号单调不减`, periods.every((p, i) => i === 0 || Number(periods[i - 1].no) <= Number(p.no)), `${periods.length} 期`)
  check(`${label} 合并后 begin 单调递增`, periods.every((p, i) => i === 0 || periods[i - 1].begin <= p.begin))
  check(`${label} 预告期都带预览源与记录 id`,
    previewOf(hes).every((p) => p.previewSource && p.previewPage && p.previewRecordId && p.begin instanceof Date && p.end instanceof Date))
  check(`${label} 预告期都能读到记录`,
    previewOf(hes).every((p) => Boolean(readRawByPath(syntheticPath(p.previewSource === 'nanoka' ? 'hsr' : 'gi', p.previewSource, p.previewPage, p.previewRecordId)))))
}

console.log('\n=== ④ 深渊：以「祝福名」为身份键（月亮网） ===')
{
  const main = mainOf(tower)
  const known = new Set()
  for (const period of main.slice(-3)) {
    const record = readRawByPath(syntheticPath('gi', 'alioth', 'abyss', String(period.id)))
    for (const item of record?.Blessings || []) if (item?.Name) known.add(String(item.Name))
  }
  check('深渊主表最近三期能读到祝福名', known.size >= 2, `${known.size} 个`)
  check('深渊预告的月名不在主表近期祝福里', previewOf(tower).every((p) => p.name && !known.has(p.name)))
  check('深渊预告从主表末期往后按月外推',
    previewOf(tower).every((p, i) => p.begin.getTime() === addMonths(main.at(-1).begin, monthStep(main) * (i + 1)).getTime()))
}

console.log('\n=== ⑤ 剧诗：以「序号」为身份键（月亮网） ===')
{
  const main = mainOf(rolecombat)
  const rawIds = (getHesperidesPage('gi', 'lunaris', 'rolecombat')?.ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0 && id < 1000)
  // 与实现同口径：排除剧诗上线前（2024-07 之前）的测试服期与 2099 哨兵
  const eraStart = new Date(main[0].begin.getTime() - 60 * 24 * 60 * 60 * 1000)
  const eraEnd = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000)
  const ids = rawIds.filter((id) => {
    const record = readRawByPath(syntheticPath('gi', 'lunaris', 'rolecombat', String(id)))
    const begin = record?.beginTime ? new Date(String(record.beginTime).replace(' ', 'T')) : null
    return begin && begin >= eraStart && begin <= eraEnd
  })
  check('剧诗预告期数 = 月亮网有效期数 − 主表期数',
    previewOf(rolecombat).length === Math.max(0, ids.length - main.length), `月亮网 ${ids.length} / 主表 ${main.length}`)
  check('剧诗预告的 id 都是月亮网真实 id',
    previewOf(rolecombat).every((p) => ids.includes(Number(p.previewRecordId))))
}

console.log('\n=== ⑥ 危战：以「版本号」为身份键（强度研究院） ===')
{
  const mainVersions = new Set(mainOf(leyline).map((p) => String(p.version || '')).filter(Boolean))
  const expected = (getHesperidesPeriodPage('gi', 'gensri', 'stygian') || [])
    .filter((entry) => entry.version && !mainVersions.has(String(entry.version)))
    .map((entry) => String(entry.id))
  check('危战预告 = 强度研究院里主表没有的版本', JSON.stringify(previewOf(leyline).map((p) => p.previewRecordId)) === JSON.stringify(expected), expected.join(','))
  check('危战预告版本都不在主表版本集合里', previewOf(leyline).every((p) => p.version && !mainVersions.has(p.version)))
}

console.log('\n=== ⑦ 末日幻影：以「期 id」为身份键（nanoka） ===')
{
  const main = mainOf(mazeBoss)
  const mainIds = new Set(main.map((p) => String(p.id)))
  const expected = (getHesperidesPeriodPage('hsr', 'nanoka', 'maze_boss') || [])
    .filter((entry) => !mainIds.has(String(entry.id)))
    .map((entry) => String(entry.id))
  check('末日预告 = nanoka 里主表没有的期', previewOf(mazeBoss).every((p) => expected.includes(p.previewRecordId)), `主表 ${main.length} 期`)
  check('末日预告都晚于主表末期', previewOf(mazeBoss).every((p) => p.begin > main.at(-1).begin))
  const spans = main.map((p) => p.end - p.begin).sort((a, b) => a - b)
  const limit = spans[Math.floor(spans.length / 2)] * 1.5
  check('跨度超过主表中位数 1.5 倍的预告被标 long-span',
    previewOf(mazeBoss).every((p) => (p.end - p.begin > limit ? p.suspect === 'long-span' : p.suspect !== 'long-span')))
}

console.log('\n=== ⑧ 没有超前源或没有超前期时不硬造 ===')
{
  const maze = getHesperidesPeriods('hsr', 'maze')
  check('混沌（无超前源）没有预告', previewOf(maze).length === 0)
  const fiction = getHesperidesPeriods('hsr', 'maze_extra')
  check('虚构（无超前源）没有预告', previewOf(fiction).length === 0)
  check('未映射的页返回 null', getHesperidesPeriods('gi', 'character') === null)
}

console.log('\n=== ⑨ 期标识带「预告」标注 ===')
{
  const preview = previewOf(tower)[0]
  if (preview) check('预告期不再标注「（预告）」', !formatPeriodLabel('gi', preview).includes('（预告）'), formatPeriodLabel('gi', preview))
  else check('预告期不再标注「（预告）」', true, '当前无预告期，跳过')
  const normal = mainOf(tower).at(-1)
  check('正常期标签不含（预告）', !formatPeriodLabel('gi', normal).includes('（预告）'))
}

finish()