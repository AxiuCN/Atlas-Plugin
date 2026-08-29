/**
 * GI 物品索引
 * 原神素材数据自带 name（mats[].name），且图标按 UI_ItemIcon_<id>.webp 直查
 * 因此 GI 通常无需额外名称索引；本文件为统一入口占位，
 * 若将来需要按 id 反查 GI 物品（如物品页/成就联动），在此补充。
 */

/**
 * 按素材 id 查询 GI 中文名（当前直接返回 ''，GI 素材名随数据自带）
 * @param {string|number} id
 * @returns {string}
 */
export function getGIItemName (id) {
  return ''
}