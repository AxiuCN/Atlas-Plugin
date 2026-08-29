/**
 * 原神怪物构建（GI）
 * 类型 + 变体属性
 */
import { propLabel } from '../util.js'

/**
 * 构建原神怪物数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildGIMonster (list, detail, meta) {
  const metaFields = [
    { label: '类型', value: detail.codex || list.type || '' }
  ].filter(f => f.value)

  const sections = []

  // 子怪物/变体
  if (detail.child && typeof detail.child === 'object') {
    const variants = Object.values(detail.child).map(c => {
      const stats = []
      if (c.base) {
        for (const [k, v] of Object.entries(c.base)) {
          if (v != null) stats.push(`${propLabel(k)}: ${v}`)
        }
      }
      return {
        name: c.monster_name || c.name || '',
        desc: stats.join(' / '),
        type: c.type || ''
      }
    }).filter(v => v.name)

    if (variants.length > 0) {
      // 取第一个变体的属性
      const first = detail.child[Object.keys(detail.child)[0]]
      if (first?.base) {
        for (const [k, v] of Object.entries(first.base)) {
          if (v != null) metaFields.push({ label: propLabel(k), value: String(v) })
        }
      }
      sections.push({ title: '变体', type: 'list', items: variants.map(v => ({
        name: v.name, desc: v.desc
      })) })
    }
  }

  return { metaFields, sections }
}