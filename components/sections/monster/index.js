/**
 * 敌人/怪物 sections builder 入口
 * 按游戏分发归一化
 */
import { buildGIMonster } from './gi.js'
import { buildHSRMonster } from './hsr.js'
import { buildZZZMonster } from './zzz.js'

/**
 * 构建敌人/怪物页面数据
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object|null} { metaFields, sections }
 */
export function buildMonsterData (gameId, record) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}

  if (gameId === 'gi') return buildGIMonster(list, detail, record.meta)
  if (gameId === 'hsr') return buildHSRMonster(list, detail, record.meta)
  if (gameId === 'zzz') return buildZZZMonster(list, detail, record.meta)
  return null
}