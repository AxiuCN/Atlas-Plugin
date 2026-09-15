/**
 * 原神怪物构建（GI）
 *
 * 栏位：图鉴描述 / 分类小方框（codex）/ 面板（base × 该变体声明的成长曲线 @ 世界等级 9 → 103）/
 * 特性（special_names）/ 元素抗性（sub_hurt）/ 掉落（reward）/ 变体
 * 原神怪物无技能数据；面板算不出的变体（`GROW_CURVE_NONE`，如裂空的魔龙）只出描述与分类。
 */
import { GI_MONSTER_CODEX_LABEL } from '../../constants.js'
import { collectMonsterVariants } from '../../../model/monsterIndex/index.js'
import { getItemName, getItemIcon } from '../../../model/itemIndex/index.js'
import { SECTION, pickSections, descSection, variantSection, primaryVariant } from './common.js'

/**
 * 构建原神怪物数据
 * @param {object} ctx - { list, detail, filePath, subView, variantPaths, indexName }
 * @returns {object} { hero, metaFields, sections }
 */
export function buildGIMonster (ctx) {
  const { list, detail, filePath, subView, variantPaths } = ctx
  const codex = detail.codex || list.codex || ''
  const variants = collectMonsterVariants('gi', filePath, variantPaths)
  const primary = primaryVariant(variants)

  const hero = { chips: [GI_MONSTER_CODEX_LABEL[codex] || codex].filter(Boolean) }

  const sections = []
  const desc = descSection(detail.desc)
  if (desc) sections.push(desc)

  // 特性（官方图鉴的怪物特性标签，如「圆滚滚的元素之力」）
  const features = (Array.isArray(detail.special_names) ? detail.special_names : []).filter(Boolean)
  if (features.length) {
    sections.push({ title: SECTION.FEATURE, type: 'list', items: features.map(n => ({ name: String(n) })) })
  }

  // 弱点与抗性：原神怪物无弱点字段，只有 sub_hurt 承伤系数（全 0 表示无抗性，不列）
  if (primary.resistances.length) {
    sections.push({ title: SECTION.RESIST, fields: primary.resistances.map(r => ({ label: r.label, value: r.value })) })
  }

  // 掉落：图鉴标明的掉落物（reward），名称与图标走物品索引
  const drops = []
  const seen = new Set()
  for (const r of Array.isArray(detail.reward) ? detail.reward : []) {
    const id = r?.id != null ? String(r.id) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    drops.push({ name: getItemName('gi', id) || id, icon: getItemIcon('gi', id) })
  }
  if (drops.length) sections.push({ title: SECTION.DROP, type: 'materials', items: drops })

  const variant = variantSection('gi', filePath, variantPaths)
  if (variant) sections.push(variant)

  return {
    hero,
    metaFields: primary.stats,
    sections: pickSections(sections, subView),
    recordName: detail.name || list.zh || ctx.indexName
  }
}
