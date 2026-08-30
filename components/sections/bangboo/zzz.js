/**
 * 绝区零邦布构建（ZZZ）
 * 基础属性 + 技能 A/B/C + 影画 + 养成素材
 */
import { cleanText, propLabel } from '../util.js'
import { aggregateMats } from '../materials.js'
import { getZZZItemName, getZZZItemIcon } from '../../../model/itemIndex/zzz.js'

/**
 * 构建绝区零邦布数据
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object} { metaFields, sections }
 */
export function buildZZZBangboo (record) {
  const detail = record?.content?.detail || {}

  const metaFields = [
    { label: '稀有度', value: record?.meta?.rarity || '' }
  ].filter(f => f.value)

  // 基础属性
  if (detail.stats) {
    const statKeys = ['endurance', 'hp_max', 'attack', 'defence', 'break_stun', 'crit', 'crit_dmg', 'pen_ratio']
    for (const key of statKeys) {
      if (detail.stats[key] != null) metaFields.push({ label: propLabel(key), value: String(detail.stats[key]) })
    }
  }

  const sections = []

  // 技能 A/B/C
  if (detail.skill && typeof detail.skill === 'object') {
    const slotLabels = { a: '主动技 (A)', b: '额外能力 (B)', c: '连携技 (C)' }
    const skills = []
    for (const [slot, sk] of Object.entries(detail.skill)) {
      if (!sk) continue
      let desc = ''
      let params = null
      if (sk.level && typeof sk.level === 'object') {
        const levels = Object.keys(sk.level).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
        if (levels.length > 0) {
          const first = sk.level[levels[0]]
          desc = cleanText(first?.desc || '')
          if (first?.property && Array.isArray(first.property)) {
            const headers = ['等级', ...(first.property.map(p => p.name || ''))]
            const rows = levels.map(lv => {
              const l = sk.level[lv]
              const vals = (l?.property || []).map(p => p.param || '')
              return [lv, ...vals]
            })
            params = { headers, rows }
          }
        }
      }
      skills.push({
        name: `${slotLabels[slot] || slot}`,
        tag: '',
        desc,
        params
      })
    }
    sections.push({ title: '技能', type: 'skill-cards', skills })
  }

  // 影画 (talent, 类似角色命座)
  if (detail.talent && typeof detail.talent === 'object') {
    const items = Object.entries(detail.talent)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, t]) => ({
        order: Number(k),
        name: t.name || '',
        desc: cleanText(t.desc || '')
      }))
    if (items.length > 0) {
      sections.push({ title: '影画', type: 'constellation-grid', items })
    }
  }

  // 养成素材（detail.level[1~6].materials 对象：{ "10": 15000, "102010": 4 }，id=10 为丁尼）
  if (detail.level && typeof detail.level === 'object') {
    const levels = Object.values(detail.level).map(lv => {
      const mats = lv?.materials && typeof lv.materials === 'object'
        ? Object.entries(lv.materials)
            .filter(([id]) => id !== '10')
            .map(([id, count]) => ({
              id,
              count: Number(count) || 0,
              name: getZZZItemName(id) || String(id),
              rank: 0
            }))
        : []
      const currency = lv?.materials?.['10']
      return { cost: Number(currency) || 0, mats }
    }).filter(l => l.mats.length > 0 || l.cost > 0)
    if (levels.length > 0) {
      const agg = aggregateMats(levels)
      const items = []
      if (agg.cost > 0) {
        items.push({ name: '丁尼', count: agg.cost, icon: getZZZItemIcon('10'), id: 10, rank: 0 })
      }
      for (const m of agg.mats) {
        items.push({ name: m.name, count: m.count, icon: getZZZItemIcon(m.id), id: m.id, rank: m.rank })
      }
      if (items.length > 0) {
        sections.push({ title: '养成素材', type: 'materials', items })
      }
    }
  }

  return { metaFields, sections }
}