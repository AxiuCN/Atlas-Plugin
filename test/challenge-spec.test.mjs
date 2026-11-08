// 期修饰回归：`#202606剧诗` / `#7.1a深渊` / `#本期深渊` 的解析与路由
//
// 语序固定为 `<期修饰><挑战名>[图鉴]`：纯函数部分用合成期表，端到端部分走真实 handleQuery
// （真实数据会随更新增长，故只断言稳定的性质，不写死期数与具体期名）。
import fs from 'node:fs'
import path from 'node:path'
import template from 'art-template'
import { mod, pluginRoot, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()

const {
  parsePeriodSpec, resolvePeriodSpec, parseDataTime, periodMissReply,
  formatPeriodLabel
} = await import(mod('model/ChallengePeriod.js'))
const { getHesperidesPeriods } = await import(mod('model/Hesperides.js'))
const { syntheticPath } = await import(mod('model/HesperidesRepository.js'))
const { handleQuery } = await import(mod('modules/atlasQuery.js'))
const { buildDetailData } = await import(mod('components/queryUtils.js'))
const { loadRecord } = await import(mod('model/AtlasService.js'))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

const at = (text) => parseDataTime(text)

/* ============================================================
 *  一、前缀解析
 * ============================================================ */

console.log('\n=== 前缀解析 ===')
const cases = [
  ['202606剧诗', { kind: 'month', month: '202606' }, '剧诗'],
  ['202606幻想真境剧诗', { kind: 'month', month: '202606' }, '幻想真境剧诗'],
  ['7.1深渊', { kind: 'version', version: '7.1', slot: 'a' }, '深渊'],
  ['7.1a深渊', { kind: 'version', version: '7.1', slot: 'a' }, '深渊'],
  ['7.1b深境螺旋', { kind: 'version', version: '7.1', slot: 'b' }, '深境螺旋'],
  ['本期深渊', { kind: 'relative', which: '本期' }, '深渊'],
  ['上期危局', { kind: 'relative', which: '上期' }, '危局'],
  ['下期虚构', { kind: 'relative', which: '下期' }, '虚构']
]
for (const [input, spec, base] of cases) {
  const parsed = parsePeriodSpec(input)
  check(`解析 ${input} → ${base}`, !!parsed && parsed.base === base &&
    Object.entries(spec).every(([k, v]) => parsed.spec[k] === v),
  parsed ? JSON.stringify(parsed.spec) : 'null')
}

// 不构成期修饰的输入必须原样放行（否则会把角色名/数字开头的查询吃歪）
for (const input of ['深渊', '202613深渊', '2026深渊', '4星武器', '12345']) {
  check(`不误判 ${input}`, parsePeriodSpec(input) === null)
}
// 数字开头但不是挑战名的查询会被剥出期修饰，剩下的部分照常搜索（命不中即放行，不改变行为）
const notChallenge = parsePeriodSpec('1.5倍率测试')
check('1.5倍率测试 剥出期修饰后仍保留原词', notChallenge?.base === '倍率测试', notChallenge?.base || 'null')
check('期修饰后没剩挑战名时不生效（交给后续流程）',
  parsePeriodSpec('202606')?.base === '')

/* ============================================================
 *  二、选期（合成期表）
 * ============================================================ */

console.log('\n=== 选期 ===')
// 期表来自 Hesperides 产物（形状与 getHesperidesPeriods 一致：no / begin / end）
const periods = [
  { id: '1', no: 1, name: 'jan', begin: at('2026-01-05 04:00:00'), end: at('2026-01-26 03:59:59') },
  { id: '2', no: 2, name: 'feb', begin: at('2026-02-05 04:00:00'), end: at('2026-02-26 03:59:59') },
  { id: '3', no: 3, name: 'mar', begin: at('2026-03-05 04:00:00'), end: at('2026-03-26 03:59:59') }
]
const now = at('2026-02-10 12:00:00')

const monthHit = resolvePeriodSpec('gi', 'tower', { kind: 'month', month: '202602' }, now, periods)
check('月份命中', monthHit.state === 'month' && monthHit.period?.name === 'feb', monthHit.period?.name || monthHit.state)
const monthMiss = resolvePeriodSpec('gi', 'tower', { kind: 'month', month: '202606' }, now, periods)
check('月份未命中给出 no-month 与文案',
  monthMiss.state === 'no-month' &&
  periodMissReply('深境螺旋', monthMiss) === '[Atlas] 深境螺旋 没有 2026 年 6 月 的期',
  periodMissReply('深境螺旋', monthMiss) || monthMiss.state)

const prev = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '上期' }, now, periods)
check('上期取本期前一期', prev.period?.name === 'jan', prev.period?.name || prev.state)
const next = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '下期' }, now, periods)
check('下期取本期的下一期', next.period?.name === 'mar', next.period?.name || next.state)
const current = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '本期' }, now, periods)
check('本期命中的是时间窗内那期', current.period?.name === 'feb', current.period?.name || current.state)

const closedNow = at('2026-08-01 12:00:00')
const closedThis = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '本期' }, closedNow, periods)
check('本期未开放时回 closed 而不是就近一期', closedThis.state === 'closed' && closedThis.period === null)
const closedPrev = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '上期' }, closedNow, periods)
check('本期未开放时上期以最近已开期为基准', closedPrev.period?.name === 'mar', closedPrev.period?.name || closedPrev.state)
const closedNext = resolvePeriodSpec('gi', 'tower', { kind: 'relative', which: '下期' }, closedNow, periods)
check('没有更晚期时回 no-next', closedNext.state === 'no-next' &&
  periodMissReply('深境螺旋', closedNext) === '[Atlas] 深境螺旋 没有更新的期了')

/* ============================================================
 *  三、版本形式（依赖真实版本时间轴）
 * ============================================================ */

console.log('\n=== 版本形式 ===')
const unknown = resolvePeriodSpec('gi', 'tower', { kind: 'version', version: '99.9', slot: 'a' }, now, periods)
check('未知版本给出 unknown-version', unknown.state === 'unknown-version')
const noPeriodInVersion = resolvePeriodSpec('gi', 'tower', { kind: 'version', version: '5.7', slot: 'a' }, now, periods)
check('该版本无期时给出 no-version',
  noPeriodInVersion.state === 'no-version' &&
  periodMissReply('深境螺旋', noPeriodInVersion) === '[Atlas] 深境螺旋 在 5.7 版本没有期')

/* ============================================================
 *  四、期标识文案
 * ============================================================ */

console.log('\n=== 期标识 ===')
const labelPeriod = { no: 3, begin: at('2026-01-05 04:00:00'), end: at('2026-01-26 03:59:59') }
const label = formatPeriodLabel('gi', labelPeriod)
check('期标识含期号与起止日期',
  /第 3 期/.test(label) && /2026-01-05/.test(label) && /→ 01-26/.test(label), label)
check('跨年时结束日期保留年份',
  /→ 2027-01-26/.test(formatPeriodLabel('gi', {
    ...labelPeriod,
    end: at('2027-01-26 03:59:59')
  })))
check('期标识含版本', /版本/.test(label), label)
check('估算期标注推定', /推定/.test(formatPeriodLabel('hsr', { ...labelPeriod, estimated: true })))
check('空期返回空串', formatPeriodLabel('gi', null) === '')

/* ============================================================
 *  五、端到端（真实 handleQuery + 真实数据）
 * ============================================================ */

requireAtlasData()

async function run (gameId, keyword) {
  const texts = []
  let image = false
  const e = {
    msg: `#${keyword}`,
    reply: async (m) => { if (typeof m === 'string') texts.push(m); else image = true }
  }
  let ret
  try {
    ret = await handleQuery(e, gameId, keyword)
  } catch (err) {
    ret = `ERR:${err.message}`
  }
  return { ret, text: texts[0] || '', image }
}

console.log('\n=== 端到端 ===')
const missMonth = await run('gi', '202001深渊')
check('#202001深渊 回「没有 … 年 1 月 的期」',
  missMonth.ret === true && /没有/.test(missMonth.text) && /2020/.test(missMonth.text), missMonth.text)

const badVersion = await run('gi', '99.9深渊')
check('#99.9深渊 回「暂不支持」', /暂不支持/.test(badVersion.text), badVersion.text || String(badVersion.ret))

const versionHit = await run('gi', '7.0深渊')
check('#7.0深渊 出图（消费）', versionHit.ret === true && versionHit.image,
  versionHit.text || String(versionHit.ret))

const slotFallback = await run('gi', '7.0b深渊')
check('#7.0b深渊 缺 b 时回落 a 并出图', slotFallback.ret === true && slotFallback.image,
  slotFallback.text || String(slotFallback.ret))

const thisPeriod = await run('gi', '本期深渊')
check('#本期深渊 要么出图、要么明确回未开放',
  thisPeriod.ret === true && (thisPeriod.image || /本期未开放/.test(thisPeriod.text)),
  thisPeriod.text || '出图')

const plainUnchanged = await run('gi', '深渊')
check('#深渊（无期修饰）行为不变：出图或未开放',
  plainUnchanged.ret === true, plainUnchanged.text || '出图')

console.log('\n=== 出图期标识 ===')
const towerHes = getHesperidesPeriods('gi', 'tower')
const samplePeriod = towerHes.periods[towerHes.periods.length - 1]
// Hesperides 的期对象没有 filePath，记录路径由合成路径推导
const sampleRecordPath = syntheticPath('gi', towerHes.source, towerHes.page, samplePeriod.id)
const sampleRecord = loadRecord(sampleRecordPath)
const detailData = buildDetailData('gi', {
  name: samplePeriod.name,
  filePath: sampleRecordPath,
  record: sampleRecord,
  period: samplePeriod,
  pageKey: 'tower',
  pageTitle: '深境螺旋'
})
check('详情数据带期标识', !!detailData.periodLine && detailData.periodLine.includes('第 '), detailData.periodLine)

const tplHtml = template.render(
  fs.readFileSync(path.join(pluginRoot, 'resources/atlas/challenge.html'), 'utf8'),
  { ...detailData, _res_path: 'file:///atlas-res', renderScale: 1.5 }
)
check('模板把期标识渲染进 hero', tplHtml.includes(detailData.periodLine) && tplHtml.includes('hero-subtitle'))
check('模板不再残留未渲染标记', !tplHtml.includes('{{'))

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
