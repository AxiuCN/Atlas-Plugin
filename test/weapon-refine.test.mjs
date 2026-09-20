// 精炼 / 叠影 / 音擎天赋合并的无损性回归
//   ① 合成用例（单槽 / 相邻多槽加括号 / 文本差异分组 / 原文本自带的常量斜杠表）
//   ② 全量数据：把合并结果按档位展开回 1~5 档，与各档原始文本逐字比对
import { mod, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { mergeRefineLevels } = await import(mod('components/sections/weapon/refine.js'))
const { cleanMarkup, resolveHsrParams } = await import(mod('components/sections/util.js'))
const { getPageRecords, loadRecord } = await import(mod('model/AtlasService.js'))
const { buildDetailData } = await import(mod('components/queryUtils.js'))
const { check, finish } = checker()

/* ============ ① 合成用例 ============ */
console.log('=== ① 合成用例 ===')
let out = mergeRefineLevels([
  { level: '1', name: '效果', desc: '伤害提高<color=#99FFFFFF>12%</color>。' },
  { level: '2', name: '效果', desc: '伤害提高<color=#99FFFFFF>15%</color>。' },
  { level: '3', name: '效果', desc: '伤害提高<color=#99FFFFFF>18%</color>。' },
  { level: '4', name: '效果', desc: '伤害提高<color=#99FFFFFF>21%</color>。' },
  { level: '5', name: '效果', desc: '伤害提高<color=#99FFFFFF>24%</color>。' }
], '精炼')
check('单槽 → 1 条、无等级标签', out.length === 1 && out[0].level === '', JSON.stringify(out))
check('单槽 → a/b/c/d/e 且保留色号', out[0].desc === '伤害提高<span style="color:#99FFFF">12%/15%/18%/21%/24%</span>。', out[0]?.desc)

out = mergeRefineLevels([
  { level: '1', name: '效果', desc: '获得<color=#99FFFFFF>8/16/28%</color>加成。' },
  { level: '2', name: '效果', desc: '获得<color=#99FFFFFF>10/20/35%</color>加成。' },
  { level: '3', name: '效果', desc: '获得<color=#99FFFFFF>12/24/42%</color>加成。' },
  { level: '4', name: '效果', desc: '获得<color=#99FFFFFF>14/28/49%</color>加成。' },
  { level: '5', name: '效果', desc: '获得<color=#99FFFFFF>16/32/56%</color>加成。' }
], '精炼')
check('相邻多值槽 → 各自加括号',
  out[0]?.desc === '获得<span style="color:#99FFFF">(8/10/12/14/16)/(16/20/24/28/32)/(28%/35%/42%/49%/56%)</span>加成。',
  out[0]?.desc)

out = mergeRefineLevels([
  { level: '1', name: '效果', desc: '命中后攻击力提升<color=#99FFFFFF>16%</color>，持续8秒。' },
  { level: '2', name: '效果', desc: '共鸣后暴击伤害提升6%。此外攻击力提升<color=#99FFFFFF>20%</color>，持续8秒。' },
  { level: '3', name: '效果', desc: '共鸣后暴击伤害提升6%。此外攻击力提升<color=#99FFFFFF>24%</color>，持续8秒。' },
  { level: '4', name: '效果', desc: '共鸣后暴击伤害提升6%。此外攻击力提升<color=#99FFFFFF>32%</color>，持续8秒。' },
  { level: '5', name: '效果', desc: '共鸣后暴击伤害提升6%。此外攻击力提升<color=#99FFFFFF>40%</color>，持续8秒。' }
], '精炼')
check('文本有差异 → 分 2 条并标档位区间',
  out.length === 2 && out[0].level === '精炼1' && out[1].level === '精炼2-5',
  out.map(i => i.level).join('|'))
check('第 2 条只合并 2~5 档的数值', out[1]?.desc.includes('20%/24%/32%/40%'), out[1]?.desc)

out = mergeRefineLevels([
  { level: '1', name: '效果', desc: '持有1/2/3层时生效，能量上限不超过60/40点。' },
  { level: '2', name: '效果', desc: '持有1/2/3层时生效，能量上限不超过60/40点。' }
], '精炼')
check('原文本自带的常量斜杠表 → 不加括号、不进多值', out[0]?.desc === '持有1/2/3层时生效，能量上限不超过60/40点。', out[0]?.desc)

out = mergeRefineLevels([{ level: '1', name: '效果', desc: '' }, { level: '2', name: '效果', desc: '' }], '精炼')
check('空文本 → 空数组', out.length === 0)

/* ============ ② 全量数据往返比对 ============ */
console.log('\n=== ② 全量数据：合并结果展开回各档 vs 原始各档文本 ===')

const NUM_RE = /(\d+(?:,\d{3})*(?:\.\d+)?%?)/
const tokenize = (text) => {
  const tokens = []
  for (const chunk of String(text || '').match(/<[^>]*>|[^<]+/g) || []) {
    if (chunk.startsWith('<')) { tokens.push({ type: 'tag', text: chunk }); continue }
    for (const part of chunk.split(NUM_RE)) {
      if (!part) continue
      tokens.push({ type: /^\d/.test(part) ? 'num' : 'text', text: part })
    }
  }
  return tokens
}

/** 把合并后的富文本按档位数展开回各档（括号包住的、或长度恰为档位数的 / 串 = 多值槽） */
function expand (merged, size) {
  const tokens = tokenize(merged)
  const slots = []
  // ① 括号包裹的（合并时为了消歧补的括号，展开时要一并去掉）
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'num') continue
    const before = tokens[i - 1]?.text || ''
    const after = tokens[i + 1]?.text || ''
    if (before.endsWith('(') && after.startsWith(')')) {
      slots.push({ start: i, end: i, values: tokens[i].text.split('/'), wrapped: true })
    }
  }
  // ② 未被括号包裹的 / 串，长度恰为档位数时视为一个多值槽
  let i = 0
  while (i < tokens.length) {
    if (tokens[i].type !== 'num' || slots.some(s => s.start === i)) { i++; continue }
    const run = [i]
    let j = i
    while (j + 2 < tokens.length && tokens[j + 1].type === 'text' && /^[／/]+$/.test(tokens[j + 1].text) && tokens[j + 2].type === 'num') {
      j += 2
      run.push(j)
    }
    if (!run.some(k => slots.some(s => s.start === k))) {
      const values = run.map(k => tokens[k].text)
      if (values.length === size) slots.push({ start: i, end: j, values, wrapped: false })
    }
    i = j + 1
  }

  const byStart = new Map(slots.map(s => [s.start, s]))
  const byEnd = new Map(slots.map(s => [s.end, s]))
  const rows = Array.from({ length: size }, () => [])
  for (let t = 0; t < tokens.length; t++) {
    const slot = byStart.get(t)
    if (slot) {
      slot.values.forEach((v, idx) => rows[idx]?.push(v))
      t = slot.end
      continue
    }
    let text = tokens[t].text
    if (byStart.has(t + 1)) text = text.replace(/\($/, '')
    if (byEnd.has(t - 1)) text = text.replace(/^\)/, '')
    if (text) for (const row of rows) row.push(text)
  }
  return rows.map(r => r.join(''))
}

const PAGES = [['gi', 'weapon', '精炼'], ['hsr', 'lightcone', '叠影'], ['zzz', 'weapon', '音擎天赋']]
let checked = 0
const bad = []

for (const [game, pageKey, sectionTitle] of PAGES) {
  for (const rec of getPageRecords(game, pageKey)) {
    const record = loadRecord(rec.filePath)
    if (!record) continue
    const d = record.content?.detail || {}
    let levels = []
    if (game === 'gi') {
      levels = Object.entries(d.refinement || {}).filter(([k]) => /^\d+$/.test(k)).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, r]) => ({ level: k, desc: r.desc || '' }))
    } else if (game === 'hsr') {
      const tmpl = d.refinements?.desc || ''
      levels = Object.entries(d.refinements?.level || {}).filter(([k]) => /^\d+$/.test(k)).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, r]) => ({ level: k, desc: resolveHsrParams(tmpl, r?.param_list) }))
    } else {
      levels = Object.entries(d.talents || {}).filter(([k]) => /^\d+$/.test(k)).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, t]) => ({ level: k, desc: t.desc || '' }))
    }
    if (!levels.length) continue
    const section = (buildDetailData(game, { ...rec, record }).sections || []).find(s => s.title === sectionTitle)
    if (!section) continue

    for (const item of section.items) {
      const m = /^[^\d]*(\d+)(?:-(\d+))?$/.exec(item.level || '')
      const group = m
        ? levels.filter(l => Number(l.level) >= Number(m[1]) && Number(l.level) <= Number(m[2] ?? m[1]))
        : levels
      if (!group.length) continue
      checked++
      const rebuilt = expand(item.desc, group.length)
      for (let i = 0; i < group.length; i++) {
        const want = cleanMarkup(group[i].desc)
        if (rebuilt[i] !== want) {
          bad.push(`[${game}] ${rec.name} ${item.level || '(单条)'} 第 ${group[i].level} 档不一致\n    展开: ${rebuilt[i]}\n    原文: ${want}`)
        }
      }
    }
  }
}

console.log(`  往返比对 ${checked} 条`)
check(`全部无损（不一致 ${bad.length} 条）`, bad.length === 0)
for (const b of bad.slice(0, 6)) console.log('  ' + b)

finish()
