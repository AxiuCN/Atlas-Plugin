/**
 * Sections builder 注册表
 * pageKey → builder 函数
 */
import { buildCharacterData } from './character/index.js'
import { buildWeaponData } from './weapon/index.js'
import { buildRelicData } from './relic/index.js'
import { buildMonsterData } from './monster/index.js'
import { buildBangbooData } from './bangboo/index.js'
import { buildItemData } from './item/index.js'

const BUILDERS = {
  character: buildCharacterData,
  weapon: buildWeaponData,
  lightcone: buildWeaponData,
  artifact: buildRelicData,
  relicset: buildRelicData,
  equipment: buildRelicData,
  monster: buildMonsterData,
  bangboo: buildBangbooData,
  item: buildItemData
}

/**
 * 获取 pageKey 对应的 sections builder
 * @param {string} pageKey
 * @returns {function|null}
 */
export function getSectionBuilder (pageKey) {
  return BUILDERS[pageKey] || null
}
