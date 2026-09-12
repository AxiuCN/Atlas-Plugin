/**
 * 原神武器构建（GI）
 * 满级基础属性 + 精炼效果 + 升级素材
 */
import { cleanText, propLabel, giPropInfo, formatGiProp } from '../util.js'
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

  // 副属性满级值：stats_modifier 中非 atk 的条目（无突破加成）——共用 GI_PROP 映射
  if (detail.stats_modifier) {
    const sm = detail.stats_modifier
    for (const [key, val] of Object.entries(sm)) {
      if (key === 'atk' || val?.base == null) continue
      const lv90Mult = val?.levels?.['90']
      const curve = lv90Mult != null ? val.base * lv90Mult : val.base

      // 共用映射（fight_prop_* 与角色突破属性同源），副属性统一加「副属性 · 」前缀
      const { label, kind } = giPropInfo(key, '副属性 · ')
      let finalLabel = label
      let displayValue
      if (kind === 'percent') {
        displayValue = formatGiProp(curve, 'percent')
      } else if (kind === 'flat') {
        displayValue = formatGiProp(curve, 'flat')
      } else {
        // 未知键：兼容既有 hp/def 基础属性与元素精通特判
        if (key.includes('element_mastery')) {
          finalLabel = '副属性 · 元素精通'
          displayValue = String(Math.round(curve))
        } else if (key === 'hp' || key === 'def') {
          finalLabel = '副属性 · ' + propLabel(key)
          displayValue = String(Math.round(curve))
        } else {
          displayValue = (curve * 100).toFixed(1) + '%'
        }
      }
      if (displayValue === '') continue
      metaFields.push({ label: finalLabel, value: displayValue })
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

  // 升级材料（detail.materials: { "1"~"4": { mats, cost } }，与角色 ascensions 同构）
  // 注意：detail.xp_requirements 为升级经验表，不计入材料（与角色素材口径一致）
  if (detail.materials && typeof detail.materials === 'object') {
    const levels = Object.values(detail.materials)
    const agg = aggregateMats(levels)
    const items = buildMatItems(agg, meta?.images || [], 'gi')
    if (items.length > 0) {
      sections.push({ title: '升级材料', type: 'materials', items })
    }
  }

  return { metaFields, sections }
}