// 终局视图（challenge）回归
//
// 契约：九个玩法各有一个适配器，输出「视图模型」（`{summary, groups}`）；未知结构回退通用启发式，
// 两边都取不到内容时返回 null。断言只校验形状与「有的就上」，不写死条数（数据会继续长）。
import fs from 'node:fs'
import path from 'node:path'
import template from 'art-template'
import { mod, pluginRoot, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { buildChallengeView } = await import(mod('components/challenge/index.js'))
const { fieldImage, groupsFromSections } = await import(mod('components/challenge/view.js'))
const { getHesperidesPeriods } = await import(mod('model/Hesperides.js'))
const { syntheticPath, readRawByPath } = await import(mod('model/HesperidesRepository.js'))
const { loadRecord } = await import(mod('model/AtlasRepository.js'))
const { check, finish } = checker()

const KINDS = new Set(['list', 'icons', 'cards', 'collapse'])
const tpl = fs.readFileSync(path.join(pluginRoot, 'resources/atlas/challenge.html'), 'utf8')

/** 取某玩法最新已开期的记录（跳过预告期） */
function latestRecord (gameId, pageKey) {
  const hes = getHesperidesPeriods(gameId, pageKey)
  const main = (hes?.periods || []).filter((period) => !period.preview)
  const period = main.at(-1)
  if (!period) return null
  const recordPath = syntheticPath(gameId, hes.source, hes.page, period.id)
  return { period, record: loadRecord(recordPath), raw: readRawByPath(recordPath), hes }
}

console.log('\n=== ① 未知结构回退（数据无关）===')
check('未知玩法返回 null（不抛）', buildChallengeView({ gameId: 'gi', pageKey: 'not-a-challenge', record: null }) === null)
check('空记录返回 null', buildChallengeView({ gameId: 'gi', pageKey: 'tower', record: null }) === null)
const fallback = buildChallengeView({
  gameId: 'gi',
  pageKey: 'not-a-challenge',
  record: { content: { list: { Buff: { Name: '测试', Desc: '说明' } } } },
  raw: { Buff: { Name: '测试', Desc: '说明' } }
})
check('通用启发式仍能兜底出段', Boolean(fallback?.groups?.length), `${fallback?.groups?.length || 0} 段`)
check('sections → 视图段是 list 类型', groupsFromSections([{ title: 'x', fields: [{ label: 'a', value: 'b' }] }])[0]?.kind === 'list')
check('空 sections → 空数组', groupsFromSections([]).length === 0)

console.log('\n=== ② 九个玩法的视图形状 ===')
const MODES = [
  ['gi', 'tower'], ['gi', 'rolecombat'], ['gi', 'leyline'],
  ['hsr', 'maze'], ['hsr', 'maze_extra'], ['hsr', 'maze_boss'], ['hsr', 'maze_peak'],
  ['zzz', 'shiyu'], ['zzz', 'boss']
]
const views = new Map()
for (const [gameId, pageKey] of MODES) {
  const label = `${gameId}/${pageKey}`
  const ctx = latestRecord(gameId, pageKey)
  if (!ctx) {
    check(`${label} 有最新期记录`, false, '取不到期')
    continue
  }
  const view = buildChallengeView({ gameId, pageKey, record: ctx.record, raw: ctx.raw })
  views.set(label, { view, ctx })
  check(`${label} 出视图`, Boolean(view?.groups?.length), `${view?.groups?.length || 0} 段`)
  if (!view) continue
  check(`${label} 段类型合法`, view.groups.every((group) => KINDS.has(group.kind)),
    view.groups.map((group) => group.kind).join(','))
  check(`${label} 每段都有标题`, view.groups.every((group) => typeof group.title === 'string' && group.title.length > 0))
  check(`${label} 列表段有字段、图标段有名称、卡片段有标题`, view.groups.every((group) => {
    if (group.kind === 'list') return group.fields.length > 0
    if (group.kind === 'icons') return group.items.length > 0 && group.items.every((item) => item.name || item.icon)
    if (group.kind === 'cards') return group.cards.length > 0 && group.cards.every((card) => card.title || card.fields?.length)
    return group.fields.length > 0
  }))
}

console.log('\n=== ③ 怪物信息（图标 / 元素 / 抗性）===')
{
  const tower = views.get('gi/tower')
  const monsterGroup = tower?.view?.groups.find((group) => group.kind === 'icons' && group.title === '怪物')
  check('深渊有怪物图标段', Boolean(monsterGroup), `${monsterGroup?.items?.length || 0} 个`)
  check('深渊怪物条目带名字', Boolean(monsterGroup?.items.every((item) => item.name)))
  check('深渊怪物条目有本地图标（fieldPath 命中 imagerefs）',
    Boolean(monsterGroup?.items.some((item) => String(item.icon || '').startsWith('file://'))))
  check('图标能按 fieldPath 解析', String(fieldImage(tower?.ctx?.record, 'Monsters.51337.Icon') || '').startsWith('file://') ||
    Boolean(fieldImage(tower?.ctx?.record, 'Monsters.51337.Icon')))

  const stygian = views.get('gi/leyline')
  const strong = stygian?.view?.groups.find((group) => group.kind === 'cards' && group.title === '强敌')
  check('危战强敌卡带抗性/机制字段', Boolean(strong?.cards.some((card) => card.fields.some((field) => /抗性|机制|生命/.test(field.label)))))
  const hp = stygian?.view?.groups.find((group) => group.kind === 'collapse')
  check('危战血量档位走折叠', hp?.title === '血量档位' && hp.fields.length > 0)
  const arb = views.get('hsr/maze_peak')
  check('仲裁血量档位走折叠', Boolean(arb?.view?.groups.some((group) => group.kind === 'collapse')))
}

console.log('\n=== ④ 模板渲染（真实视图）===')
{
  const tower = views.get('gi/tower')
  const html = template.render(tpl, {
    gameName: '原神',
    pageTitle: '深境螺旋',
    recordName: '第 60 期',
    periodLine: '第 60 期 · 7.3 版本 · 2026-12-16 → 2027-01-16',
    summary: tower?.view?.summary || [],
    groups: tower?.view?.groups || [],
    rawFields: [],
    image: '',
    desc: '',
    rarity: '',
    renderScale: 1.5,
    _res_path: 'file:///atlas-res'
  })
  check('模板渲染无残留 {{', !html.includes('{{'))
  check('卡片段渲染成 .challenge-card', html.includes('challenge-card'))
  check('图标段复用 .material-grid', html.includes('material-grid'))
  check('期标识仍在 hero', html.includes('第 60 期'))
  check('折叠段渲染成 details', template.render(tpl, {
    gameName: '原神', pageTitle: '危战', recordName: 'x', periodLine: '', summary: [],
    groups: [{ kind: 'collapse', title: '血量档位', fields: [{ label: 'a', value: 'b' }] }],
    rawFields: [], image: '', desc: '', rarity: '', renderScale: 1.5, _res_path: 'file:///x'
  }).includes('<details'))
}

console.log('\n=== ⑤ 预览期共用同一模板 ===')
{
  const previewSource = { source: 'lunaris', page: 'tower' }
  const id = '20100'
  const raw = readRawByPath(syntheticPath('gi', 'lunaris', 'tower', id))
  const view = buildChallengeView({ gameId: 'gi', pageKey: 'tower', record: null, raw, preview: previewSource })
  check('月亮网预览记录能出视图', Boolean(view?.groups?.length), `${view?.groups?.length || 0} 段`)
  check('预览视图段类型合法', (view?.groups || []).every((group) => KINDS.has(group.kind)))
}

finish()