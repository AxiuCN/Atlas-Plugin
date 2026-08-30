/**
 * 绝区零音擎构建（ZZZ）
 * 基础属性 + 音擎天赋 + 升级素材
 */
import { cleanText } from '../util.js'
import { aggregateMats, buildMatItems } from '../materials.js'
import { getZZZItemName, getZZZItemIcon } from '../../../model/itemIndex/zzz.js'

/** 格式化 ZZZ 数值（format 形如 {0:%.2f} 或 {0:...%}） */
function fmtZZZValue (value, format) {
  if (value == null) return ''
  if (!format) return String(Math.round(value))
  const match = format.match(/\{0:(.+)\}/)
  if (!match) return String(value)
  const inner = match[1]
  if (inner.includes('%')) {
    return (value / 100).toFixed(1).replace(/\.0$/, '') + '%'
  }
  return String(Math.round(value))
}

/**
 * 构建绝区零音擎数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildZZZWeapon (list, detail, meta) {
  const metaFields = [
    { label: '类型', value: detail.weapon_type ? Object.values(detail.weapon_type)[0] : '' },
    { label: '稀有度', value: meta?.rarity || list.rarity || '' },
  ].filter(f => f.value)

  // 基础属性
  if (detail.base_property) {
    metaFields.push({
      label: detail.base_property.name || '基础属性',
      value: fmtZZZValue(detail.base_property.value, detail.base_property.format)
    })
  }
  if (detail.rand_property) {
    metaFields.push({
      label: detail.rand_property.name || '副属性',
      value: fmtZZZValue(detail.rand_property.value, detail.rand_property.format)
    })
  }

  const sections = []

  // 音擎天赋（类似精炼）
  if (detail.talents && typeof detail.talents === 'object') {
    const refs = Object.entries(detail.talents)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, t]) => ({
        level: `等级 ${k}`,
        name: t.name || '',
        desc: cleanText(t.desc || '')
      }))
    if (refs.length > 0) {
      sections.push({ title: '音擎天赋', type: 'refinements', items: refs })
    }
  }

  // 升级素材（detail.materials 扁平字符串："10:9600,101011:3|10:22400,101021:10|..."）
  // 格式：| 分档、, 分材料、id:count；id=10 为货币丁尼（转 cost）
  if (detail.materials && typeof detail.materials === 'string') {
    const levels = detail.materials.split('|').map(lvl => {
      const parts = lvl.split(',').map(pair => {
        const [id, count] = pair.split(':')
        return { id, count: count != null ? Number(count) : 0 }
      })
      const currency = parts.find(p => p.id === '10')
      const mats = parts
        .filter(p => p.id !== '10')
        .map(p => ({ id: p.id, count: p.count, name: getZZZItemName(p.id) || String(p.id), rank: 0 }))
      return { cost: currency?.count || 0, mats }
    }).filter(l => l.mats.length > 0 || l.cost > 0)
    if (levels.length > 0) {
      const agg = aggregateMats(levels)
      // ZZZ 素材名称/图标需走 itemIndex（图标命名不统一，不能按 id 直拼）
      const items = []
      if (agg.cost > 0) {
        items.push({ name: '丁尼', count: agg.cost, icon: getZZZItemIcon('10'), id: 10, rank: 0 })
      }
      for (const m of agg.mats) {
        items.push({ name: m.name, count: m.count, icon: getZZZItemIcon(m.id), id: m.id, rank: m.rank })
      }
      if (items.length > 0) {
        sections.push({ title: '升级素材', type: 'materials', items })
      }
    }
  }

  return { metaFields, sections }
}