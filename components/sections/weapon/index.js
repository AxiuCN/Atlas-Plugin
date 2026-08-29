/**
 * 武器/光锥/音擎 sections builder 入口
 * 按游戏分发归一化
 */
import { buildGIWeapon } from './gi.js'
import { buildHSRLightcone } from './hsr.js'
import { buildZZZWeapon } from './zzz.js'

/**
 * 构建武器类页面数据
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object|null} { metaFields, sections }
 */
export function buildWeaponData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return buildGIWeapon(list, detail, record.meta)
  if (gameId === 'hsr') return buildHSRLightcone(list, detail, record.meta)
  if (gameId === 'zzz') return buildZZZWeapon(list, detail, record.meta)
  return null
}