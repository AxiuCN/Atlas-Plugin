/**
 * 原神圣遗物构建（GI）
 * 套装效果 + 各部位
 */
import { cleanMarkup, imgUrl } from '../util.js'

/**
 * 部件槽位顺序与中文名（数据键 → 官方槽位）
 * 数据里 detail.parts 的键序是游戏内部序（杯/羽/冠/花/沙），展示须按 花→羽→沙→杯→冠 排列
 */
const GI_ARTIFACT_SLOTS = [
  ['equip_bracer', '生之花'],
  ['equip_necklace', '死之羽'],
  ['equip_shoes', '时之沙'],
  ['equip_ring', '空之杯'],
  ['equip_dress', '理之冠']
]

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
      desc: cleanMarkup(a.desc || '')
    }))
    if (bonuses.length > 0) {
      sections.push({ title: '套装效果', type: 'list', items: bonuses.map(b => ({
        name: `${b.require}件套: ${b.name}`,
        desc: b.desc
      })) })
    }
  }

  // 各部位（按官方槽位顺序展示，名称前标槽位；数据里未出现的槽位自然跳过）
  if (detail.parts && typeof detail.parts === 'object') {
    const images = meta?.images || []
    const parts = detail.parts
    const piece = (key, slot, p) => ({
      name: `${slot} · ${p.name}`,
      desc: cleanMarkup(p.desc || ''),
      icon: imgUrl(images, `detail.parts.${key}.icon`)
    })
    const pieces = GI_ARTIFACT_SLOTS
      .filter(([key]) => parts[key]?.name)
      .map(([key, slot]) => piece(key, slot, parts[key]))
    // 槽位表未覆盖的键（数据源新增槽位）按原顺序追加，避免静默丢失
    for (const [key, p] of Object.entries(parts)) {
      if (!p?.name || GI_ARTIFACT_SLOTS.some(([k]) => k === key)) continue
      pieces.push(piece(key, '', p))
    }
    if (pieces.length > 0) {
      sections.push({ title: '部件', type: 'list', items: pieces.map(p => ({
        name: p.name.replace(/^ · /, ''),
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