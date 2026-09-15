/**
 * 星铁怪物构建（HSR）
 *
 * 栏位：hero 小方框（**阵营 → 评级（英文原码）→ 弱点**）+ 面板（基础值 × 硬等级组(95)）/
 * 图鉴描述 / **弱点与属性抗性**（变体 `stance_weak_list` + `damage_type_resistance`）/
 * 技能（变体 `skill_list`）/ 掉落（`drop` 按世界等级分档）/ 变种个体
 * 阵营在数据源里只有数字（空值归「其他」），名称取自 constants 的手写表。
 */
import { collectMonsterVariants, hsrCampLabel } from '../../../model/monsterIndex/index.js'
import { getItemName, getItemIcon } from '../../../model/itemIndex/index.js'
import { sortMatItems } from '../materials.js'
import { cleanMarkup } from '../util.js'
import { SECTION, pickSections, descSection, variantSection, primaryVariant } from './common.js'

/**
 * 构建星铁怪物数据
 * @param {object} ctx - { list, detail, filePath, subView, variantPaths, indexName }
 * @returns {object} { hero, metaFields, sections }
 */
export function buildHSRMonster (ctx) {
  const { list, detail, filePath, subView, variantPaths } = ctx
  const variants = collectMonsterVariants('hsr', filePath, variantPaths)
  const primary = primaryVariant(variants)

  // 小方框：阵营 → 评级（直接用数据里的英文档位码）→ 弱点
  const chips = [
    hsrCampLabel(list.camp ?? detail.monster_camp_id),
    detail.rank || ''
  ]
  if (primary.weak.length) chips.push(`弱点：${primary.weak.join(' ')}`)

  const hero = { chips: chips.filter(Boolean) }

  const sections = []
  const desc = descSection(detail.desc)
  if (desc) sections.push(desc)

  // 弱点与属性抗性：弱点取自变体 stance_weak_list，抗性取自 damage_type_resistance
  const resistFields = []
  if (primary.weak.length) resistFields.push({ label: '弱点', value: primary.weak.join(' / ') })
  for (const r of primary.resistances) resistFields.push({ label: r.label, value: r.value })
  if (resistFields.length) sections.push({ title: SECTION.RESIST_HSR, fields: resistFields })

  // 技能：按变体取（主变体的技能列表）
  // 少数怪（角色的「幻象」版，如卡芙卡/资深员工·组长）技能描述里带 `#N[fmt]` 参数占位符，
  // 但怪物侧数据没有对应的 param_list，取值无从谈起 → 只保留技能名，描述不出
  const skills = primary.skills.filter(s => s.name || s.desc)
  if (skills.length) {
    sections.push({
      title: SECTION.SKILL,
      type: 'list',
      items: skills.map(s => ({
        name: cleanMarkup(s.tag ? `${s.name} [${s.tag}]` : s.name),
        desc: /#\d+\[/.test(s.desc || '') ? '' : cleanMarkup(s.desc)
      }))
    })
  }

  // 掉落：drop 按世界等级分档，取最高档的物品去重（与养成素材同一排序口径）
  const drops = []
  const seen = new Set()
  const dropList = Array.isArray(detail.drop) ? detail.drop : []
  const top = dropList.length ? dropList[dropList.length - 1] : null
  for (const d of top?.display_item_list || []) {
    const id = d?.item_id != null ? String(d.item_id) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    drops.push({ name: getItemName('hsr', id) || id, icon: getItemIcon('hsr', id), id })
  }
  if (drops.length) {
    sections.push({ title: SECTION.DROP, type: 'materials', items: sortMatItems(drops, 'hsr') })
  }

  const variant = variantSection('hsr', filePath, variantPaths)
  if (variant) sections.push(variant)

  return {
    hero,
    metaFields: primary.stats,
    sections: pickSections(sections, subView),
    recordName: detail.name || list.zh || ctx.indexName
  }
}
