/**
 * 物品 sections builder
 */
export function buildItemData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  const metaFields = []
  const itemKeys = ['item_type', 'material_type', 'rank', 'rarity', 'type']
  for (const key of itemKeys) {
    const val = detail[key] || list[key]
    if (val != null && typeof val !== 'object') {
      metaFields.push({ label: _label(key), value: String(val) })
    }
  }

  // 描述
  const desc = _clean(detail.desc || detail.description || list.desc || list.description || '')

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

function _clean (s) {
  if (!s) return ''
  return String(s)
    .replace(/\\n/g, '\n')
    .replace(/\{RUBY_B#[^}]*}/g, '').replace(/\{RUBY_E#}/g, '')
    .replace(/\{LINK#[^}]*}/g, '')
    .replace(/<[^>]+>/g, '').trim()
}

function _label (k) {
  const m = { item_type: '类型', material_type: '材料类型', rank: '品级', rarity: '稀有度', type: '类型' }
  return m[k] || k
}
