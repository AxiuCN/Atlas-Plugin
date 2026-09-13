/**
 * 绝区零驱动盘构建（ZZZ）
 * 套装效果 + 驱动盘描述
 */
import { cleanMarkup } from '../util.js'

/**
 * 构建绝区零驱动盘数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildZZZEquipment (list, detail, meta) {
  const sections = []

  const bonuses = []
  if (detail.desc2) bonuses.push({ require: 2, desc: cleanMarkup(detail.desc2) })
  if (detail.desc4) bonuses.push({ require: 4, desc: cleanMarkup(detail.desc4) })

  if (bonuses.length > 0) {
    sections.push({ title: '套装效果', type: 'list', items: bonuses.map(b => ({
      name: `${b.require}件套`, desc: b.desc
    })) })
  }

  // 驱动盘描述（数据源 detail.story）
  if (detail.story) {
    sections.push({ title: '驱动盘描述', type: 'text', text: cleanMarkup(detail.story) })
  }

  return { metaFields: [], sections }
}