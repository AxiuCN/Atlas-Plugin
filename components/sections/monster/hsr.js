/**
 * 星铁怪物构建（HSR）
 *
 * 栏位：图鉴描述 / 分类小方框（rank + 阵营 camp）/ 面板（基础数值，各变体共用）/
 * 弱点与抗性（变体 `stance_weak_list` + `damage_type_resistance`）/ 技能（变体 `skill_list`）/
 * 掉落（`drop` 按世界等级分档）/ 变体
 * 阵营在数据源里只有数字，名称取自 constants 的手写表（见 HSR_MONSTER_CAMP_LABEL）。
 */
import { HSR_MONSTER_RANK_LABEL } from '../../constants.js'
import { collectMonsterVariants, hsrCampLabel } from '../../../model/monsterIndex/index.js'
import { getItemName, getItemIcon } from '../../../model/itemIndex/index.js'
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

  const hero = {
    chips: [
      HSR_MONSTER_RANK_LABEL[detail.rank] || detail.rank || '',
      hsrCampLabel(list.camp ?? detail.monster_camp_id)
    ].filter(Boolean)
  }

  const sections = []
  const desc = descSection(detail.desc)
  if (desc) sections.push(desc)

  // 弱点与抗性：弱点来自变体 stance_weak_list，抗性来自变体 damage_type_resistance
  const resistFields = []
  if (primary.weak.length) resistFields.push({ label: '弱点', value: primary.weak.join(' / ') })
  for (const r of primary.resistances) resistFields.push({ label: r.label, value: r.value })
  if (resistFields.length) sections.push({ title: SECTION.RESIST, fields: resistFields })

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

  // 掉落：drop 按世界等级分档，取各档出现过的物品去重（最高档为准）
  const drops = []
  const seen = new Set()
  const dropList = Array.isArray(detail.drop) ? detail.drop : []
  const top = dropList.length ? dropList[dropList.length - 1] : null
  for (const d of top?.display_item_list || []) {
    const id = d?.item_id != null ? String(d.item_id) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    drops.push({ name: getItemName('hsr', id) || id, icon: getItemIcon('hsr', id) })
  }
  if (drops.length) sections.push({ title: SECTION.DROP, type: 'materials', items: drops })

  const variant = variantSection('hsr', filePath, variantPaths)
  if (variant) sections.push(variant)

  return {
    hero,
    metaFields: primary.stats,
    sections: pickSections(sections, subView),
    recordName: detail.name || list.zh || ctx.indexName
  }
}
