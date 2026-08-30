/**
 * 物品/材料索引统一入口
 * 按游戏分发到各游戏索引实现（id → 名称/图标解析）
 *
 * 名称数据源：data/map.json → games.<game>.locales.zh.pages.item.records（三游戏通用，共享 mapLoader）
 * 图标规则差异：gi UI_ItemIcon_<id> 直拼 / hsr itemfigures/<id> 直拼 / zzz 需查 localPath
 */
import { getGIItemName, getGIItemIcon } from './gi.js'
import { getHsrItemName, getHsrItemIcon } from './hsr.js'
import { getZZZItemName, getZZZItemIcon } from './zzz.js'

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

/**
 * 按游戏 + 素材 id 查询图标 URL
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {string|number} id
 * @returns {string} file:// URL，查不到返回空串
 */
export function getItemIcon (gameId, id) {
  if (gameId === 'gi') return getGIItemIcon(id)
  if (gameId === 'hsr') return getHsrItemIcon(id)
  if (gameId === 'zzz') return getZZZItemIcon(id)
  return ''
}