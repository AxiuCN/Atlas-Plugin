/**
 * 星铁遗器套装构建（HSR）
 * 套装效果 + 部件
 */
import { cleanText } from '../util.js'

/**
 * 构建星铁遗器套装数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildHSRRelicset (list, detail, meta) {
  const sections = []

  // 套装效果
  if (detail.require_num && typeof detail.require_num === 'object') {
    const bonuses = Object.entries(detail.require_num)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([num, data]) => ({
        require: Number(num),
        desc: cleanText(data?.desc || '')
      }))
    if (bonuses.length > 0) {
      sections.push({ title: '套装效果', type: 'list', items: bonuses.map(b => ({
        name: `${b.require}件套`,
        desc: b.desc
      })) })
    }
  }

  // 部件
  if (detail.parts && typeof detail.parts === 'object') {
    const pieces = Object.values(detail.parts).map(p => ({
      name: p.name || '', desc: cleanText(p.desc || '')
    })).filter(p => p.name)
    if (pieces.length > 0) {
      sections.push({ title: '部件', type: 'list', items: pieces.map(p => ({
        name: p.name, desc: p.desc
      })) })
    }
  }

  return { metaFields: [], sections }
}