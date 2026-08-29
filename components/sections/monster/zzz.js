/**
 * 绝区零怪物构建（ZZZ）
 * 类型/标签/属性 + 属性统计
 */
import { propLabel } from '../util.js'

/**
 * 构建绝区零怪物数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildZZZMonster (list, detail, meta) {
  const metaFields = []

  if (detail.monster_info && typeof detail.monster_info === 'object') {
    for (const [, info] of Object.entries(detail.monster_info)) {
      if (info.type) metaFields.push({ label: '类型', value: info.type })
      if (info.tag && Array.isArray(info.tag)) metaFields.push({ label: '标签', value: info.tag.join(' / ') })
      if (info.element && typeof info.element === 'object') {
        metaFields.push({ label: '属性', value: Object.keys(info.element).join(' / ') })
      }
      if (info.stats) {
        for (const [k, v] of Object.entries(info.stats)) {
          if (v != null) metaFields.push({ label: propLabel(k), value: String(v) })
        }
      }
      break
    }
  }

  return { metaFields, sections: [] }
}