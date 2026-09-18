/**
 * 星铁光锥构建（HSR）
 * 满级基础属性 + 叠影效果 + 晋阶材料
 */
import { cleanMarkup, hsrLabel, resolveHsrParams } from '../util.js'
import { mergeRefineLevels } from './refine.js'
import { aggregateMats, buildMatItems } from '../materials.js'
import { getHsrItemName } from '../../../model/itemIndex/hsr.js'
import { HSR_MAX_LEVEL } from '../../constants.js'

/**
 * 构建星铁光锥数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { hero, metaFields, sections }
 */
export function buildHSRLightcone (list, detail, meta) {
  // 命途在 list.baseType / detail.base_type（数据源职业码，如 Rogue），与角色页「命途」同用 hsrLabel 映射
  const pathCn = hsrLabel(list.baseType || detail.base_type || '')
  const metaFields = [
    { label: '稀有度', value: meta?.rarity || list.rarity || '' }
  ].filter(f => f.value)

  // 满级基础属性（Lv.80）：stats 末档 = 基准值 + (80-1) × 成长值（与角色基础属性同款算法，已与 miao baseAttr 对齐）
  if (detail.stats && Array.isArray(detail.stats) && detail.stats.length > 0) {
    const top = detail.stats[detail.stats.length - 1]
    const growth = HSR_MAX_LEVEL - 1
    const pushSum = (label, base, add) => {
      if (base == null) return
      metaFields.push({ label, value: String(Math.round(Number(base) + growth * Number(add || 0))) })
    }
    pushSum('基础生命值', top.base_hp, top.base_hp_add)
    pushSum('基础攻击力', top.base_attack, top.base_attack_add)
    pushSum('基础防御力', top.base_defence, top.base_defence_add)
  }

  const sections = []

  // 叠影：1~5 档合并成一段（desc 是带 #N[fmt] 占位符的模板，各档按自己的 param_list 解析后再对齐合并，
  // 差异处写 18%/21%/24%/27%/30%；文本本身有差异时按档位区间分成多条）
  if (detail.refinements) {
    const name = detail.refinements.name || ''
    const template = detail.refinements.desc || ''
    let items = []
    if (detail.refinements.level && typeof detail.refinements.level === 'object') {
      const levels = Object.entries(detail.refinements.level)
        .filter(([k]) => /^\d+$/.test(k))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([k, r]) => {
          // 该档位的完整文案：有 param_list 就代入模板，否则退回该档参数值罗列
          const desc = r?.param_list
            ? (template ? resolveHsrParams(template, r.param_list) : Object.values(r.param_list).join(' / '))
            : template
          return { level: k, name, desc }
        })
      items = mergeRefineLevels(levels, '叠影')
    }
    if (items.length > 0) {
      sections.push({ title: '叠影', type: 'refinements', items })
    } else if (name || template) {
      sections.push({
        title: '叠影',
        type: 'refinements',
        items: [{ level: '', name, desc: cleanMarkup(template) }]
      })
    }
  }

  // 晋阶材料（detail.stats[0~6].promotion_cost_list，item_id=2 为信用点）
  if (detail.stats && Array.isArray(detail.stats)) {
    const levels = detail.stats
      .map(s => {
        const list = Array.isArray(s?.promotion_cost_list) ? s.promotion_cost_list : []
        const credit = list.find(c => c.item_id === 2)
        const mats = list
          .filter(c => c.item_id !== 2)
          .map(c => ({
            id: c.item_id,
            count: c.item_num,
            name: getHsrItemName(c.item_id) || String(c.item_id),
            rank: _rarityRank(c.rarity)
          }))
        return { cost: credit?.item_num || 0, mats }
      })
      .filter(l => l.mats.length > 0 || l.cost > 0)
    if (levels.length > 0) {
      const agg = aggregateMats(levels)
      const items = buildMatItems(agg, meta?.images || [], 'hsr')
      if (items.length > 0) {
        sections.push({ title: '晋阶材料', type: 'materials', items })
      }
    }
  }

  // hero：命途进主标题下方小方框（与角色页「命途」标签同款）
  // 光锥故事：nanoka 光锥详情无 desc/story 字段，数据源没有就不显示（不引入外部文本源）
  const hero = { weapon: pathCn }

  return { hero, metaFields, sections }
}

/** HSR rarity 字符串 → 排序 rank（NotNormal < Rare < VeryRare） */
function _rarityRank (rarity) {
  if (rarity === 'NotNormal') return 1
  if (rarity === 'Rare') return 2
  if (rarity === 'VeryRare') return 3
  return 0
}