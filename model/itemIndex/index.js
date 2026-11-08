/**
 * 物品/材料索引统一入口
 * 按游戏分发到各游戏索引实现（id → 名称/图标解析）
 *
 * 数据源统一为 Hesperides `nanoka/<game>/item` 页的 `entries`（`name` / `icon`），
 * 见 `model/ItemAssets.js`；不再有按 id 拼文件名的旧图库约定。
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