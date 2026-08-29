/**
 * 绝区零音擎构建（ZZZ）
 * 基础属性 + 音擎天赋
 */
import { cleanText } from '../util.js'

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

  return { metaFields, sections }
}