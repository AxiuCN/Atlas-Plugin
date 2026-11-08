/**
 * ZZZ 物品索引
 *
 * 绝区零素材只有数字 id：名称与图标都取 Hesperides `nanoka/zzz/item` 页 `entries`
 * （`name` / `icon`），不再按记录路径去开条目 JSON。
 */
import { getItemName, getItemIconUrl } from '../ItemAssets.js'

/**
 * 按素材 id 查询 ZZZ 中文名
 * @param {string|number} id
 * @returns {string} 查不到返回 ''
 */
export function getZZZItemName (id) {
  return getItemName('zzz', id)
}

/**
 * ZZZ 素材图标
 * @param {string|number} id
 * @returns {string} file:// URL，查不到返回空串
 */
export function getZZZItemIcon (id) {
  return getItemIconUrl('zzz', id)
}
