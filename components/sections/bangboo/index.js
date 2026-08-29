/**
 * 邦布 sections builder（仅 ZZZ）
 * 入口：仅接收 zzz，其余返回 null
 */
import { buildZZZBangboo } from './zzz.js'

/**
 * 构建邦布页面数据（仅 ZZZ 有邦布数据）
 * @param {string} gameId - 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object|null} { metaFields, sections }
 */
export function buildBangbooData (gameId, record) {
  if (gameId !== 'zzz') return null
  return buildZZZBangboo(record)
}