/**
 * GI 物品索引
 *
 * 名称：Hesperides `nanoka/gi/item` 与 `item-all` 页的 `entries`（id → { name, icon }）
 * 图标：同一份 `entries` 的 `icon`（产物里已经落好，不再按 id 拼文件名）
 * 圣遗物部件：`artifact` 页记录的 `content.list.set` / `content.detail.parts`
 */
import { getItemName, getItemIconUrl, iconByAssetName, pageEntries } from '../ItemAssets.js'
import { loadRecord } from '../AtlasRepository.js'
import { syntheticPath } from '../HesperidesRepository.js'
import { INDEX_SOURCE } from '../Hesperides.js'

/** @type {Map<string, {setName: string, partName: string}>|null} 圣遗物部件图标名 → 套装名/部件名 */
let relicIconCache = null

/** 上述缓存所属的 entries 对象：图鉴数据重载后 entries 换新，缓存随之作废 */
let relicCacheEntries = null

/** 按素材 id 查 GI 中文名 */
export function getGIItemName (id) {
  return getItemName('gi', id)
}

/** GI 素材图标（产物里的那张；不再按 id 拼 gallery 文件名） */
export function getGIItemIcon (id) {
  return getItemIconUrl('gi', id)
}

/**
 * GI 图标按资源名直查（怪物掉落项自带 icon，如 UI_ItemIcon_113090 / UI_RelicIcon_15001_4）
 * 比按 id 查可靠：圣遗物掉落 id 是 400xxx 抽象 id，文件名却按套装资源命名
 * @param {string} iconName - 资源名
 * @returns {string} file:// URL，查不到返回空串
 */
export function getGIIconByName (iconName) {
  return iconByAssetName('gi', iconName)
}

/**
 * 圣遗物部件图标 → 套装名/部件名 映射（惰性读全部套装条目，整进程一次）
 * 掉落数据只给 icon（如 UI_RelicIcon_10005_4），套装名在 `content.list.set[].name.zh`、
 * 部件名在 `content.detail.parts.<槽位>.name`
 * @returns {Map<string, {setName: string, partName: string}>}
 */
function getGIRelicIconMap () {
  const entries = pageEntries('gi', 'artifact')
  if (relicIconCache && relicCacheEntries === entries) return relicIconCache
  relicCacheEntries = entries
  relicIconCache = new Map()
  for (const id of Object.keys(entries)) {
    const raw = loadRecord(syntheticPath('gi', INDEX_SOURCE, 'artifact', id))
    if (!raw) continue
    const setName = Object.values(raw?.content?.list?.set || {})[0]?.name?.zh || ''
    for (const part of Object.values(raw?.content?.detail?.parts || {})) {
      if (part?.icon) relicIconCache.set(part.icon, { setName, partName: part.name || '' })
    }
  }
  return relicIconCache
}

/**
 * 圣遗物掉落物名称：按 reward 项的 icon 反查部件名（如 UI_RelicIcon_10005_4 → 战狂的蔷薇）
 * 原神掉落里的 400xxx 是「套装 × 部位 × 星级」抽象 id，数据源没有对应物品条目
 * @param {string} iconName
 * @returns {{setName: string, partName: string}|null}
 */
export function getGIRelicByIcon (iconName) {
  if (!iconName) return null
  return getGIRelicIconMap().get(iconName) || null
}
