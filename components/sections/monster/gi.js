/**
 * 原神怪物构建（GI）
 *
 * 栏位：hero 短描述（`detail.title`，与条目名相同视为占位不出）+ 分类小方框（codex）+
 * 面板（base × 该变体声明的成长曲线 @ 世界等级 9 → 103）/ 图鉴描述 / **元素伤害抗性**（`child.sub_hurt`）/
 * **特殊称谓**（`special_names`）/ 掉落（`reward`）/ 变种个体
 * 原神怪物无技能数据；面板算不出的变体（`GROW_CURVE_NONE`，如裂空的魔龙）只出描述与分类。
 */
import { GI_MONSTER_CODEX_LABEL } from '../../constants.js'
import { collectMonsterVariants } from '../../../model/monsterIndex/index.js'
import { getItemName, getItemIcon } from '../../../model/itemIndex/index.js'
import { cleanMarkup } from '../util.js'
import { SECTION, pickSections, descSection, variantSection, primaryVariant } from './common.js'

/**
 * 构建原神怪物数据
 * @param {object} ctx - { list, detail, filePath, subView, variantPaths, indexName }
 * @returns {object} { hero, metaFields, sections }
 */
export function buildGIMonster (ctx) {
  const { list, detail, filePath, subView, variantPaths } = ctx
  const name = detail.name || list.zh || ctx.indexName || ''
  const codex = detail.codex || list.codex || ''
  const variants = collectMonsterVariants('gi', filePath, variantPaths)
  const primary = primaryVariant(variants)

  // hero 短描述取 title（与条目名相同的占位不出）
  const title = cleanMarkup(detail.title || '')
  const hero = {
    chips: [GI_MONSTER_CODEX_LABEL[codex] || codex].filter(Boolean),
    desc: title && title !== name ? title : ''
  }

  const sections = []
  const desc = descSection(detail.desc)
  if (desc) sections.push(desc)

  // 元素伤害抗性：原神怪物无弱点字段，只有 sub_hurt 承伤系数（全 0 表示无抗性，不列）
  if (primary.resistances.length) {
    sections.push({
      title: SECTION.RESIST_GI,
      fields: primary.resistances.map(r => ({ label: r.label, value: r.value }))
    })
  }

  // 特殊称谓（官方图鉴的怪物称号标签，如「圆滚滚的元素之力」）
  const features = (Array.isArray(detail.special_names) ? detail.special_names : []).filter(Boolean)
  if (features.length) {
    sections.push({ title: SECTION.FEATURE_GI, type: 'list', items: features.map(n => ({ name: String(n) })) })
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
    recordName: name
  }
}
