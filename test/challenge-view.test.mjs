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

const KINDS = new Set(['list', 'icons', 'cards', 'battle', 'collapse'])
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
    if (group.kind === 'battle') return group.cards.length > 0 && group.cards.every((card) => card.monsters?.length > 0 || card.lineups?.length > 0)
    return group.fields.length > 0
  }))
}

console.log('\n=== ③ 怪物信息（战斗卡：图标 / 元素 / 抗性 / 血量）===')
{
  const tower = views.get('gi/tower')
  // 仿玉璃：怪物不再单独成段，只作为楼层「间」的战斗卡出现
  const battle = tower?.view?.groups.find((group) => group.kind === 'battle' && /第 .+ 层/.test(group.title || ''))
  const monsters = (battle?.cards || []).flatMap((card) => [ ...(card.monsters || []), ...((card.lineups || []).flatMap((lineup) => lineup.monsters || [])) ])
  check('深渊怪物只在楼层的间卡里出现', Boolean(battle) && monsters.length > 0, `${monsters.length} 只`)
  check('深渊没有独立的「怪物」段', !tower?.view?.groups.some((group) => group.title === '怪物'))
  check('深渊战斗卡带数量/血量/抗性标签',
    monsters.every((monster) => monster.name) && monsters.some((monster) => monster.hp) && monsters.some((monster) => monster.chips.length > 0))
  check('深渊战斗卡图标能按 fieldPath 解析',
    monsters.some((monster) => String(monster.icon || '').startsWith('file://')))

  const theater = views.get('gi/rolecombat')
  const bossCards = (theater?.view?.groups.find((group) => group.kind === 'battle' && group.title === '首领')?.cards || [])
  // 首领卡的名字在卡头（第 n 幕 · 怪物），图标下只留血量
  check('剧诗首领卡带「第 n 幕 · 怪物名」且不重复名字',
    bossCards.length > 0 &&
    bossCards.every((card) => /第 \d+ 幕/.test(card.title) && card.title.replace(/^第 \d+ 幕 · /, '').length > 0) &&
    bossCards.every((card) => card.monsters.every((monster) => !monster.name)))

  const stygian = views.get('gi/leyline')
  const strong = stygian?.view?.groups.find((group) => group.kind === 'battle' && group.title === '强敌')
  check('危战强敌是战斗卡（大图 + 血量 + 抗性）',
    Boolean(strong?.cards.some((card) => card.monsters.some((monster) => monster.hp && monster.chips.length > 0))))
  check('危战不再单列血量档位（N5/N6 在强敌卡头部）', !stygian?.view?.groups.some((group) => group.title === '血量档位'))
  // 玉璃的官方解析用 `@高亮#` 标记（机制概述才用 <color>）：两套都要落成 .hl，且不残留标记字符
  const tutorialTexts = (strong?.cards || [])
    .flatMap((card) => (card.blocks || []).filter((block) => block.title === '「玉璃的研究」'))
    .flatMap((block) => block.items.flatMap((item) => item.paragraphs))
  check('「玉璃的研究」正文有高亮（@高亮# 也要解析）', tutorialTexts.some((text) => text.includes('<span class="hl">')),
    `${tutorialTexts.length} 段 / ${tutorialTexts.filter((text) => text.includes('hl')).length} 段含高亮`)
  check('「玉璃的研究」不残留 @ 与 # 标记', tutorialTexts.every((text) => !text.includes('@') && !text.includes('#')),
    tutorialTexts.find((text) => text.includes('@') || text.includes('#')) || '')
  const arb = views.get('hsr/maze_peak')
  check('仲裁血量以「骑士/王棋」两条列表呈现',
    ['骑士 · 血量', '王棋 · 血量'].every((title) => arb?.view?.groups.some((group) => group.title === title)))

  // 绝区零：防线 / Boss 区成段，房间成卡；怪物带 HP 与 ATK/DEF 等数值标签
  const shiyu = views.get('zzz/shiyu')
  const shiyuGroups = shiyu?.view?.groups || []
  const shiyuBattles = shiyuGroups.filter((group) => group.kind === 'battle')
  const shiyuMonsters = shiyuBattles.flatMap((group) => group.cards.flatMap((card) => card.monsters))
  check('式舆按防线成段、房间成卡', shiyuBattles.length >= 5 && shiyuBattles.every((group) => group.cards.length > 0))
  check('式舆怪物带 HP 与数值标签', shiyuMonsters.some((monster) => monster.hp && monster.chips.length >= 2))
  check('式舆段前有等级条件与怪物等级',
    shiyuBattles.every((group) => shiyuGroups.some((item) =>
      item.kind === 'list' &&
      item.title === `${group.title} · 等级条件` &&
      (item.fields || []).some((field) => field.label === '怪物等级'))))
  // child 房间在 `detail.zone.<childId>.layer_room`，图片引用必须按这个路径命中
  const childZone = shiyuBattles.find((group) => /防线/.test(group.title || '') && group.cards.length >= 3)
  check('式舆 child 房间的怪物图标能解析',
    Boolean(childZone) && childZone.cards.flatMap((card) => card.monsters).some((monster) => String(monster.icon || '').startsWith('file://')))

  const boss = views.get('zzz/boss')
  const bossGroups = boss?.view?.groups || []
  const bossBattles = bossGroups.filter((group) => group.kind === 'battle')
  check('危局按 Boss 段、战斗房间成卡', bossBattles.length >= 2 && bossBattles.every((group) => group.cards.length > 0))
  check('危局段前有可选增益',
    bossGroups.some((group) => group.kind === 'list' && /可选增益/.test(group.title || '') && (group.fields || []).length > 0))
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
  check('深渊渲染成战斗卡 .battle-card', html.includes('battle-card') && html.includes('battle-monster'))
  const theaterHtml = template.render(tpl, {
    gameName: '原神',
    pageTitle: '幻想真境剧诗',
    recordName: '第 30 期',
    periodLine: '',
    summary: [],
    groups: views.get('gi/rolecombat')?.view?.groups || [],
    rawFields: [],
    image: '',
    desc: '',
    rarity: '',
    renderScale: 1.5,
    _res_path: 'file:///atlas-res'
  })
  check('角色图标段复用 .material-grid', theaterHtml.includes('material-grid'))
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

console.log('\n=== ⑥ 页脚来源按内容源判定 ===')
{
  const { challengeSources } = await import(mod('modules/challengeHesperides.js'))
  check('玉璃页取期表源', challengeSources('gi', 'tower', 'alioth').join(',') === 'alioth', challengeSources('gi', 'tower', 'alioth').join(','))
  check('危战额外加强度研究院', challengeSources('gi', 'leyline', 'alioth').join(',') === 'alioth,gensri', challengeSources('gi', 'leyline', 'alioth').join(','))
  check('zzz 走 nanoka', challengeSources('zzz', 'shiyu', 'nanoka').join(',') === 'nanoka', challengeSources('zzz', 'shiyu', 'nanoka').join(','))
  check('预览期按内容源、不列期表源', challengeSources('gi', 'tower', 'alioth', 'lunaris').join(',') === 'lunaris', challengeSources('gi', 'tower', 'alioth', 'lunaris').join(','))
  const reward = challengeSources('gi', 'leyline', 'alioth', 'gensri')
  check('预览期危战不重复列同一源', reward.join(',') === 'gensri', reward.join(','))
}

finish()