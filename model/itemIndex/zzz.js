/**
 * ZZZ 物品索引
 * 绝区零素材只有数字 id，名称在 绝区零/物品 各星级目录 JSON 的 detail.name，
 * 图标命名不统一（meta.images[].localPath，如 WeaponRankStun01.webp），需逐条查表。
 * 待实现：惰性扫描 ZZZ 物品目录 → Map<id, {name, iconUrl}>。
 */

/**
 * 按素材 id 查询 ZZZ 中文名（待实现）
 * @param {string|number} id
 * @returns {string}
 */
export function getZZZItemName (id) {
  return ''
}