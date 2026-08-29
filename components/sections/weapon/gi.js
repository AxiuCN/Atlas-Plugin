/**
 * 原神武器构建（GI）
 * 满级基础属性 + 精炼效果 + 升级素材
 */
import { cleanText, propLabel } from '../util.js'
import { aggregateMats, buildMatItems } from '../materials.js'

/**
 * 构建原神武器数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildGIWeapon (list, detail, meta) {
  const metaFields = [
    { label: '类型', value: list.weapontype || '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
  ].filter(f => f.value)

  // list.atk 为满级 ATK（Lv.90），副属性从 stats_modifier 取满级值
  if (list.atk != null) {
    metaFields.push({ label: '基础攻击力', value: String(list.atk) })
  }

  // 副属性满级值：stats_modifier 中非 atk 的条目（无突破加成）
  if (detail.stats_modifier) {
    const sm = detail.stats_modifier
    for (const [key, val] of Object.entries(sm)) {
      if (key === 'atk' || val?.base == null) continue
      const lv90Mult = val?.levels?.['90']
      const curve = lv90Mult != null ? val.base * lv90Mult : val.base

      let label, displayValue
      if (key.includes('element_mastery')) {
        label = '元素精通'
        displayValue = String(Math.round(curve))
      } else if (key === 'hp' || key === 'def') {
        label = propLabel(key)
        displayValue = String(Math.round(curve))
      } else {
        label = propLabel(key)
        displayValue = (curve * 100).toFixed(1) + '%'
      }
      metaFields.push({ label, value: displayValue })
    }
  }
  const sections = []

  // 精炼
  if (detail.refinement && typeof detail.refinement === 'object') {
    const refs = Object.entries(detail.refinement)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, r]) => ({
        level: `精炼 ${k}`,
        name: r.name || '',
        desc: cleanText(r.desc || '')
      }))
    if (refs.length > 0) {
      sections.push({ title: '精炼', type: 'refinements', items: refs })
    }
  }

  // 升级素材（detail.materials: { "1"~"6": { mats, cost } }，与角色 ascensions 同构）
  if (detail.materials && typeof detail.materials === 'object') {
    const levels = Object.values(detail.materials)
    const agg = aggregateMats(levels)
    const items = buildMatItems(agg, meta?.images || [], 'gi')
    if (items.length > 0) {
      sections.push({ title: '升级素材', type: 'materials', items })
    }
  }

  return { metaFields, sections }
}