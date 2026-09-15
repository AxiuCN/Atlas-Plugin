/**
 * 绝区零怪物构建（ZZZ）
 *
 * 栏位：hero 短描述（`card_quote` 卡牌引言）+ 小方框（族群 → 弱点 → 抗性，抗性只列属性名）+
 * 面板（生命值 / 攻击力 / 防御力 / 冲击力 / 失衡伤害倍率 / 失衡持续时间，按 Lv.70 曲线换算）/
 * 图鉴描述 / 战斗提示 / **弱点与抗性**（数值保留）/ 变种个体
 * 不展示「获取方式」（`card_obtain` 是游戏内卡牌解锁提示，非怪物资料）。
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

  // 小方框：族群 → 弱点 → 抗性（抗性只列属性，数值在下方「弱点与抗性」栏）
  const chips = [detail.group_desc]
  if (primary.weak.length) chips.push(`弱点：${primary.weak.join(' ')}`)
  if (primary.resistances.length) {
    chips.push(`抗性：${primary.resistances.map(r => r.label.replace(/抗性$/, '')).join(' ')}`)
  }

  const hero = {
    chips: chips.filter(Boolean),
    desc: cleanMarkup(detail.card_quote || '')
  }

  const sections = []
  const desc = descSection(detail.desc)
  if (desc) sections.push(desc)

  // 战斗中行为提示（一句话）
  const hint = cleanMarkup(detail.card_skill_desc || '')
  if (hint) sections.push({ title: SECTION.HINT, type: 'text', text: hint })

  // 弱点与抗性：弱点列属性，抗性列具体数值
  const resistFields = []
  if (primary.weak.length) resistFields.push({ label: '弱点', value: primary.weak.join(' / ') })
  for (const r of primary.resistances) resistFields.push({ label: r.label, value: r.value })
  if (resistFields.length) sections.push({ title: SECTION.RESIST_ZZZ, fields: resistFields })

  const variant = variantSection('zzz', filePath, variantPaths)
  if (variant) sections.push(variant)

  return {
    hero,
    metaFields: primary.stats,
    sections: pickSections(sections, subView),
    recordName: detail.name || list.zh || ctx.indexName
  }
}
