/**
 * 圣遗物/遗器套装/驱动盘 sections builder 入口
 * 按游戏分发归一化
 */
import { buildGIArtifact } from './gi.js'
import { buildHSRRelicset } from './hsr.js'
import { buildZZZEquipment } from './zzz.js'

/**
 * 构建圣遗物类页面数据
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object|null} { metaFields, sections }
 */
export function buildRelicData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return buildGIArtifact(list, detail, record.meta)
  if (gameId === 'hsr') return buildHSRRelicset(list, detail, record.meta)
  if (gameId === 'zzz') return buildZZZEquipment(list, detail, record.meta)
  return null
}