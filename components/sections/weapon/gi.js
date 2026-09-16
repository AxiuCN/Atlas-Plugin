/**
 * 原神武器构建（GI）
 * 满级基础属性 + 精炼效果 + 升级素材
 */
import { cleanMarkup, propLabel, giPropInfo, formatGiProp, weaponLabel } from '../util.js'
import { mergeRefineLevels } from './refine.js'
import { aggregateMats, buildMatItems } from '../materials.js'

/**
 * 构建原神武器数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { hero, metaFields, sections }
 */
export function buildGIWeapon (list, detail, meta) {
  // 武器类型码在 list.type / detail.weapon_type（无 list.weapontype 字段），与角色页「武器」同用 weaponLabel 映射
  const weaponType = list.type || detail.weapon_type || ''
  const metaFields = [
    { label: '稀有度', value: meta?.rarity || list.rarity || '' }
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
      // 无副属性的武器该键为 fight_prop_none（值恒 0），跳过不显示
      if (key === 'fight_prop_none') continue
      const lv90Mult = val?.levels?.['90']
      const curve = lv90Mult != null ? val.base * lv90Mult : val.base
      if (!curve) continue

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

  // hero：类型进主标题下方小方框（与角色页「武器」标签同款），武器描述置 hero 底部
  // 描述取数据源 detail.desc（中文，list.desc 是未翻译英文不可用）；源站没有该字段则整行不显示
  // 数据源个别条目用双转义换行（字面 \n），归一为空白；<i> 官方注记交给 cleanMarkup 转 .note
  const desc = cleanMarkup(String(detail.desc || ''))
    .replace(/\\[nr]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const hero = {
    weapon: weaponLabel(weaponType),
    desc
  }

  // 精炼：1~5 档合并成一段（各档仅数值不同 → 一条，差异处写 12%/15%/18%/21%/24%；
  // 文本本身有差异的武器（如「星锋剑」精炼1 多一句）→ 按档位区间分成两条）
  if (detail.refinement && typeof detail.refinement === 'object') {
    const levels = Object.entries(detail.refinement)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, r]) => ({ level: k, name: r.name || '', desc: r.desc || '' }))
    const items = mergeRefineLevels(levels, '精炼')
    if (items.length > 0) {
      sections.push({ title: '精炼', type: 'refinements', items })
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

  return { hero, metaFields, sections }
}