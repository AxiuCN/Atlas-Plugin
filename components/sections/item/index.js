/**
 * 物品 sections builder（跨游戏统一）
 * 类型/描述/来源
 */
import { cleanText, propLabel } from '../util.js'

/**
 * 构建物品页面数据（三游戏通用同一路径）
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object} { metaFields, sections }
 */
export function buildItemData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  const metaFields = []
  const itemKeys = ['item_type', 'material_type', 'rank', 'rarity', 'type']
  for (const key of itemKeys) {
    const val = detail[key] || list[key]
    if (val != null && typeof val !== 'object') {
      metaFields.push({ label: propLabel(key), value: String(val) })
    }
  }

  // 描述
  const desc = cleanText(detail.desc || detail.description || list.desc || list.description || '')

  const sections = []
  if (desc) {
    sections.push({ title: '描述', type: 'text', text: desc })
  }

  // 来源
  if (detail.source_list && Array.isArray(detail.source_list)) {
    sections.push({
      title: '来源',
      type: 'list',
      items: detail.source_list.map(s => ({ name: typeof s === 'string' ? s : (s.name || ''), desc: '' })).filter(i => i.name)
    })
  }

  return { metaFields, sections }
}