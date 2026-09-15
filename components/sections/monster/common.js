/**
 * 怪物 builder 共用工具
 * 子视图筛选 / 变体栏构建 / 描述段落构建
 * 三游戏共用，差异只在各游戏自己的栏位拼装（gi.js / hsr.js / zzz.js）
 */
import { cleanMarkup } from '../util.js'
import { collectMonsterVariants } from '../../../model/monsterIndex/index.js'

/** 子视图 → 保留的段落标题（未登记的 subView 视为默认视图） */
const VIEW_TITLES = {
  profile: ['图鉴描述'],
  skills: ['技能', '战斗提示'],
  materials: ['掉落'],
  variants: ['变体']
}

/** 段标题常量（子视图按标题筛选，改动需与 VIEW_TITLES 同步） */
export const SECTION = {
  DESC: '图鉴描述',
  FEATURE: '特性',
  HINT: '战斗提示',
  SKILL: '技能',
  RESIST: '弱点与抗性',
  DROP: '掉落',
  VARIANT: '变体',
  QUOTE: '卡牌引言',
  OBTAIN: '获取方式'
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
  // 段标题可能带后缀（变体栏写作「变体（N）」），按前缀匹配
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

/**
 * 变体栏：列出全部战斗变体的内部代号 + id（+ 弱点），标题带总数
 * 同名条目折叠后变体可能来自多条记录（HSR「无尽寒冬之槊」单条最多 8 个变体）
 * @param {string} gameId
 * @param {string} filePath
 * @param {string[]} variantPaths
 * @returns {object|null}
 */
export function variantSection (gameId, filePath, variantPaths) {
  const variants = collectMonsterVariants(gameId, filePath, variantPaths)
  if (variants.length <= 1 && !variantPaths.length) return null
  const items = variants.map((v, i) => {
    const parts = []
    if (!v.codeName && v.id) parts.push(`ID ${v.id}`)
    if (v.kind) parts.push(v.kind)
    if (v.weak?.length) parts.push(`弱点 ${v.weak.join(' / ')}`)
    return { name: v.codeName || v.id || `变体 ${i + 1}`, desc: parts.join(' · ') }
  })
  // 折掉的同名记录没有可变体数据时不出现空段（如原神「蕈猪」）
  if (!items.length) return null
  return { title: `${SECTION.VARIANT}（${variants.length}）`, type: 'list', items }
}
