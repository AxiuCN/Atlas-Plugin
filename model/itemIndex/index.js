/**
 * 物品/材料索引统一入口
 * 按游戏分发到各游戏索引实现（id → 名称/图标解析）
 *
 * 名称数据源：各游戏「物品」页 JSON；
 * 图标规则差异：gi UI_ItemIcon_<id> 直拼 / hsr itemfigures/<id> 直拼 / zzz 需查 localPath
 */
import { getGIItemName } from './gi.js'
import { getHsrItemName } from './hsr.js'
import { getZZZItemName } from './zzz.js'

/**
 * 按游戏 + 素材 id 查询中文名
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {string|number} id
 * @returns {string} 查不到返回 ''
 */
export function getItemName (gameId, id) {
  if (gameId === 'gi') return getGIItemName(id)
  if (gameId === 'hsr') return getHsrItemName(id)
  if (gameId === 'zzz') return getZZZItemName(id)
  return ''
}