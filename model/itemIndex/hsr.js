/**
 * HSR 物品索引
 *
 * 光锥/角色升级素材的 promotion_cost_list 只有 item_id；
 * 名称与图标都取 Hesperides `nanoka/hsr/item` 页 `entries`（`name` / `icon`）。
 */
import { getItemName, getItemIconUrl } from '../ItemAssets.js'

/**
 * 按素材 id 查询 HSR 中文名
 * @param {string|number} id
 * @returns {string} 查不到返回 ''（由调用方回退为原始 id）
 */
export function getHsrItemName (id) {
  return getItemName('hsr', id)
}

/**
 * HSR 素材图标
 * @param {string|number} id
 * @returns {string} file:// URL，查不到返回空串
 */
export function getHsrItemIcon (id) {
  return getItemIconUrl('hsr', id)
}
