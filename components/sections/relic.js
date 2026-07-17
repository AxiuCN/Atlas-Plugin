/**
 * 圣遗物/遗器套装/驱动盘 sections builder
 */
export function buildRelicData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return _buildGIArtifact(list, detail, record.meta)
  if (gameId === 'hsr') return _buildHSRRelicset(list, detail, record.meta)
  if (gameId === 'zzz') return _buildZZZEquipment(list, detail, record.meta)
  return null
}

function _buildGIArtifact (list, detail, meta) {
  const sections = []
  const rarities = detail?.rank || []

  // 套装效果
  if (detail.affix && Array.isArray(detail.affix)) {
    const bonuses = detail.affix.map(a => ({
      require: a.affix_id ? (a.affix_id % 10 || 2) : 2,
      name: a.name || '',
      desc: _clean(a.desc || '')
    }))
    if (bonuses.length > 0) {
      sections.push({ title: '套装效果', type: 'list', items: bonuses.map(b => ({
        name: `${b.require}件套: ${b.name}`,
        desc: b.desc
      })) })
    }
  }

  // 各部位
  if (detail.parts && typeof detail.parts === 'object') {
    const pieces = Object.values(detail.parts).map(p => ({
      name: p.name || '', type: p.type || '', desc: _clean(p.desc || ''), story: _clean(p.story || '')
    })).filter(p => p.name)
    if (pieces.length > 0) {
      sections.push({ title: '部件', type: 'list', items: pieces.map(p => ({
        name: `${p.type ? p.type + ' · ' : ''}${p.name}`,
        desc: p.desc
      })) })
    }
  }

  return {
    metaFields: [
      { label: '稀有度', value: Array.isArray(rarities) ? rarities.join('/') : String(rarities || '') }
    ],
    sections
  }
}

function _buildHSRRelicset (list, detail, meta) {
  const sections = []

  // 套装效果
  if (detail.require_num && typeof detail.require_num === 'object') {
    const bonuses = Object.entries(detail.require_num)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([num, data]) => ({
        require: Number(num),
        desc: _clean(data?.desc || '')
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
      name: p.name || '', desc: _clean(p.desc || '')
    })).filter(p => p.name)
    if (pieces.length > 0) {
      sections.push({ title: '部件', type: 'list', items: pieces.map(p => ({
        name: p.name, desc: p.desc
      })) })
    }
  }

  return { metaFields: [], sections }
}

function _buildZZZEquipment (list, detail, meta) {
  const sections = []

  const bonuses = []
  if (detail.desc2) bonuses.push({ require: 2, desc: _clean(detail.desc2) })
  if (detail.desc4) bonuses.push({ require: 4, desc: _clean(detail.desc4) })

  if (bonuses.length > 0) {
    sections.push({ title: '套装效果', type: 'list', items: bonuses.map(b => ({
      name: `${b.require}件套`, desc: b.desc
    })) })
  }

  return { metaFields: [], sections }
}

function _clean (str) {
  if (!str) return ''
  return String(str)
    .replace(/\\n/g, '\n')
    .replace(/\{RUBY_B#[^}]*}/g, '').replace(/\{RUBY_E#}/g, '')
    .replace(/\{LINK#[^}]*}/g, '')
    .replace(/<[^>]+>/g, '').trim()
}
