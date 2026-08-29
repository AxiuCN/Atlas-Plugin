/**
 * 星铁光锥构建（HSR）
 * 满级基础属性 + 叠影效果
 */
import { cleanText, propLabel } from '../util.js'

/**
 * 构建星铁光锥数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildHSRLightcone (list, detail, meta) {
  const metaFields = [
    { label: '命途', value: list.baseType || '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
  ].filter(f => f.value)

  // 满级基础属性（Lv.80）= stats 最后一条
  if (detail.stats && Array.isArray(detail.stats) && detail.stats.length > 0) {
    const base = detail.stats[detail.stats.length - 1]
    const statKeys = ['base_hp', 'base_atk', 'base_def', 'base_speed']
    for (const key of statKeys) {
      if (base[key] != null) metaFields.push({ label: propLabel(key), value: String(Math.round(base[key])) })
    }
  }

  const sections = []

  // 叠影
  if (detail.refinements) {
    const name = detail.refinements.name || ''
    const desc = cleanText(detail.refinements.desc || '')
    let refs = []
    if (detail.refinements.level && typeof detail.refinements.level === 'object') {
      refs = Object.entries(detail.refinements.level)
        .filter(([k]) => /^\d+$/.test(k))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([k, r]) => {
          let refDesc = ''
          if (r?.param_list) {
            refDesc = Object.values(r.param_list).join(' / ')
          }
          return { level: `叠影 ${k}`, name, desc: refDesc || desc }
        })
    }
    if (refs.length > 0) {
      sections.push({ title: '叠影', type: 'refinements', items: refs })
    } else if (name || desc) {
      sections.push({
        title: '叠影',
        type: 'refinements',
        items: [{ level: '', name, desc }]
      })
    }
  }

  return { metaFields, sections }
}