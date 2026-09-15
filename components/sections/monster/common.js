/**
 * 怪物 builder 共用工具
 * 子视图筛选 / 变种个体栏 / 描述段落 / 分类小方框构建
 * 三游戏共用，差异只在各游戏自己的栏位拼装（gi.js / hsr.js / zzz.js）
 */
import { cleanMarkup } from '../util.js'
import { collectMonsterVariants } from '../../../model/monsterIndex/index.js'

/** 子视图 → 保留的段落标题（未登记的 subView 视为默认视图） */
const VIEW_TITLES = {
  profile: ['图鉴描述'],
  skills: ['技能', '战斗提示'],
  materials: ['掉落'],
  variants: ['变种个体']
}

/** 三游戏共用的段标题（抗性/特殊称谓按游戏各自命名，见各 builder） */
export const SECTION = {
  DESC: '图鉴描述',
  HINT: '战斗提示',
  SKILL: '技能',
  DROP: '掉落',
  VARIANT: '变种个体',
  QUOTE: '卡牌引言',
  FEATURE_GI: '特殊称谓',
  RESIST_GI: '元素伤害抗性',
  RESIST_HSR: '弱点与属性抗性',
  RESIST_ZZZ: '弱点与抗性'
}

/**
 * 按子视图筛段
 * @param {Array} sections
 * @param {string|null} subView
 * @returns {Array}
 */
export function pickSections (sections, subView) {
  const keep = VIEW_TITLES[subView]
  if (!keep) return sections
  // 段标题可能带后缀（变种个体栏写作「变种个体（N）」），按前缀匹配
  return sections.filter(s => keep.some(t => s.title === t || String(s.title).startsWith(t)))
}

/**
 * 代表变体：取首个有面板的变体（原神少数记录的首变体是无成长曲线的特化版，算不出面板），
 * 都没有时退回首个变体；无变体时返回空壳，调用方按「数据源没有」处理
 * @param {Array} variants
 * @returns {object}
 */
export function primaryVariant (variants) {
  return variants.find(v => v.stats?.length) || variants[0] || { stats: [], weak: [], resistances: [], skills: [] }
}

/**
 * 图鉴描述段（正文可能数百字，做成独立段落而非 hero 一行）
 * @param {string} desc
 * @returns {object|null}
 */
export function descSection (desc) {
  const text = cleanMarkup(desc || '')
  return text ? { title: SECTION.DESC, type: 'text', text } : null
}

/** 属性标签去掉等级标注（变种摘要用，避免每条都重复 Lv） */
function bareLabel (label) {
  return String(label).replace(/\s*\(Lv\.\d+\)$/, '')
}

/** 变体面板摘要（仅在与代表变体不同的时候展示，避免星铁那种 100 个变体逐条重复） */
function statSummary (variant, primary) {
  if (!variant.stats?.length) return ''
  if (JSON.stringify(variant.stats) === JSON.stringify(primary?.stats)) return ''
  return variant.stats.map(s => `${bareLabel(s.label)} ${s.value}`).join(' · ')
}

/**
 * 变种个体栏：列出全部战斗变体（标题带总数）
 * 同名条目折叠后变体可能来自多条记录（星铁「无尽寒冬之槊」单条最多 8 个变体共 100 个）
 * 条目内容 = 内部代号（或 ID）+ id + 分类 + 弱点；面板与代表变体不同的变体另附一份摘要
 * @param {string} gameId
 * @param {string} filePath
 * @param {string[]} variantPaths
 * @returns {object|null}
 */
export function variantSection (gameId, filePath, variantPaths) {
  const variants = collectMonsterVariants(gameId, filePath, variantPaths)
  if (variants.length <= 1 && !variantPaths.length) return null
  const primary = primaryVariant(variants)
  const items = variants.map((v, i) => {
    // 有内部代号的用它做条目名、id 进摘要；没有的（星铁变体）直接用 id 当条目名
    const hasCode = Boolean(v.codeName)
    const name = hasCode ? v.codeName : (v.id ? `ID ${v.id}` : `变种 ${i + 1}`)
    const parts = []
    if (hasCode && v.id) parts.push(`ID ${v.id}`)
    if (v.kind) parts.push(v.kind)
    if (v.weak?.length) parts.push(`弱点 ${v.weak.join(' ')}`)
    const summary = statSummary(v, primary)
    if (summary) parts.push(summary)
    return { name, desc: parts.join(' · ') }
  })
  // 折掉的同名记录没有可变体数据时不出现空段（如原神「蕈猪」）
  if (!items.length) return null
  return { title: `${SECTION.VARIANT}（${variants.length}）`, type: 'list', items }
}
