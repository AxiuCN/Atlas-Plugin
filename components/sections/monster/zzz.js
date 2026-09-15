/**
 * 绝区零怪物构建（ZZZ）
 *
 * 栏位：图鉴描述 / 分类小方框（`group_desc` 族群，星级由 hero 行右侧出）/
 * 面板（生命值 / 攻击力 / 防御力 / 失衡值，游戏自用口径）/ 弱点与抗性（变体 `element` + `*_damage_res`）/
 * 战斗提示（`card_skill_desc`）/ 卡牌引言（`card_quote`）/ 获取方式（`card_obtain`）/ 变体
 *
 * 说明：`monster_info[].stats` 各变体数值互不相同（同一怪有多个战斗实例），面板取代表变体
 * （`detail.monster_id` 指向的那个）；各实例另有 `curves` 等级曲线，本页不做等级换算。
 */
import { collectMonsterVariants } from '../../../model/monsterIndex/index.js'
import { cleanMarkup } from '../util.js'
import { SECTION, pickSections, descSection, variantSection, primaryVariant } from './common.js'

/**
 * 构建绝区零怪物数据
 * @param {object} ctx - { list, detail, filePath, subView, variantPaths, indexName }
 * @returns {object} { hero, metaFields, sections }
 */
export function buildZZZMonster (ctx) {
  const { list, detail, filePath, subView, variantPaths } = ctx
  const variants = collectMonsterVariants('zzz', filePath, variantPaths)
  const primary = primaryVariant(variants)

  const hero = { chips: [detail.group_desc].filter(Boolean) }

  const sections = []
  const desc = descSection(detail.desc)
  if (desc) sections.push(desc)

  // 战斗中行为提示（一句话）
  const hint = cleanMarkup(detail.card_skill_desc || '')
  if (hint) sections.push({ title: SECTION.HINT, type: 'text', text: hint })

  // 弱点与抗性：弱点来自变体 element 中值为 1 的属性，抗性来自 stats.<元素>_damage_res
  const resistFields = []
  if (primary.weak.length) resistFields.push({ label: '弱点', value: primary.weak.join(' / ') })
  for (const r of primary.resistances) resistFields.push({ label: r.label, value: r.value })
  if (resistFields.length) sections.push({ title: SECTION.RESIST, fields: resistFields })

  const quote = cleanMarkup(detail.card_quote || '')
  if (quote) sections.push({ title: SECTION.QUOTE, type: 'text', text: quote })

  const obtain = cleanMarkup(detail.card_obtain || '')
  if (obtain) sections.push({ title: SECTION.OBTAIN, type: 'text', text: obtain })

  const variant = variantSection('zzz', filePath, variantPaths)
  if (variant) sections.push(variant)

  return {
    hero,
    metaFields: primary.stats,
    sections: pickSections(sections, subView),
    recordName: detail.name || list.zh || ctx.indexName
  }
}
