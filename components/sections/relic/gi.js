/**
 * 原神圣遗物构建（GI）
 * 套装效果 + 各部位
 */
import { cleanText, imgUrl } from '../util.js'

/**
 * 构建原神圣遗物数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { recordName?, metaFields, sections }
 */
export function buildGIArtifact (list, detail, meta) {
  const sections = []
  const rarities = detail?.rank || []

  // 提取套装名（meta.name 是数字 ID，真正名称在 affix 或 set 中）
  let recordName = null
  if (detail.affix && Array.isArray(detail.affix) && detail.affix.length > 0) {
    recordName = detail.affix[0].name || null
  }
  if (!recordName && list.set) {
    const first = Object.values(list.set)[0]
    if (first?.name?.zh) recordName = first.name.zh
  }

  // 套装效果
  if (detail.affix && Array.isArray(detail.affix)) {
    const bonuses = detail.affix.map(a => ({
      require: a.affix_id ? (a.affix_id % 10 ? 4 : 2) : 2,
      name: a.name || '',
      desc: cleanText(a.desc || '')
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
    const images = meta?.images || []
    const pieces = Object.entries(detail.parts).map(([key, p]) => ({
      name: p.name || '', type: p.type || '', desc: cleanText(p.desc || ''),
      story: cleanText(p.story || ''),
      icon: imgUrl(images, `detail.parts.${key}.icon`)
    })).filter(p => p.name)
    if (pieces.length > 0) {
      sections.push({ title: '部件', type: 'list', items: pieces.map(p => ({
        name: `${p.type ? p.type + ' · ' : ''}${p.name}`,
        desc: p.desc,
        icon: p.icon
      })) })
    }
  }

  return {
    recordName,
    metaFields: [
      { label: '稀有度', value: Array.isArray(rarities) ? rarities.join('/') : String(rarities || '') }
    ],
    sections
  }
}