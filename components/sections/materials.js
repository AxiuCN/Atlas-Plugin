/**
 * sections 材料工具
 * 材料聚合 / 排序 / 图标查询
 * 角色养成子视图与武器升级素材共用
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backendRoot } from '../../model/AtlasService.js'

/** 聚合材料数组：合并同名材料数量 + 摩拉 */
export function aggregateMats (levels) {
  const cost = levels.reduce((sum, l) => sum + (l.cost || 0), 0)
  const matMap = new Map() // id → { name, id, count, rank }
  for (const level of levels) {
    for (const m of (level.mats || [])) {
      const key = m.id || m.name
      const entry = matMap.get(key)
      if (entry) {
        entry.count += m.count || 0
      } else {
        matMap.set(key, { name: m.name, id: m.id, count: m.count || 0, rank: m.rank || 0 })
      }
    }
  }
  return { cost, mats: [...matMap.values()] }
}

/** 货币映射：gi 摩拉(202) / hsr 信用点(2) / zzz 丁尼(10) */
const CURRENCY = {
  gi: { id: 202, name: '摩拉' },
  hsr: { id: 2, name: '信用点' },
  zzz: { id: 10, name: '丁尼' }
}

/**
 * Boss / 周本素材判定（各游戏独占段位，用于把这批素材提到货币之后）
 * 原神 113xxx（rank4 世界 Boss / rank5 周本）；
 * 星铁 1104xx（Boss）、1105xx（周本）、241 命运的足迹（周本代币）；
 * 绝区零 100941「仓鼠笼」访问器（高级技能）与 1100xx（核心技进阶）、1105xx（高维数据）
 * @param {number} idNum - 物品 id 数值
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @returns {boolean}
 */
function isBossWeeklyMat (idNum, gameId) {
  if (gameId === 'gi') return idNum >= 113000 && idNum <= 113999
  if (gameId === 'hsr') return idNum === 241 || (idNum >= 110400 && idNum <= 110599)
  if (gameId === 'zzz') return idNum === 100941 || (idNum >= 110000 && idNum <= 110999)
  return false
}

/**
 * 素材分组：0 货币 / 1 Boss·周本素材 / 2 其余素材
 * @param {object} item - { id }
 * @param {string} gameId
 * @returns {number}
 */
function matGroup (item, gameId) {
  const idNum = Number(item?.id) || 0
  if (CURRENCY[gameId]?.id === idNum) return 0
  if (isBossWeeklyMat(idNum, gameId)) return 1
  return 2
}

/**
 * 素材排序：货币 → Boss/周本素材 → 其余素材，组内按物品 id 数值升序
 * 三游戏共用（角色 / 武器 / 邦布养成素材与怪物掉落栏同一口径）
 * 注意必须按数值比较：字符串比较会把「105 好感经验」排到「113090」之后
 * @param {Array} items - [{ id, name, count, icon }]
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @returns {Array} 同一数组（原地排序）
 */
export function sortMatItems (items, gameId) {
  return items.sort((a, b) => {
    const ga = matGroup(a, gameId)
    const gb = matGroup(b, gameId)
    if (ga !== gb) return ga - gb
    return (Number(a.id) || 0) - (Number(b.id) || 0)
  })
}

/**
 * 材料图标查询：先按命名约定直查 gallery，再在 meta.images 中精确文件名兜底
 * 命名约定：gi 为 UI_ItemIcon_<id>.webp，hsr 为 itemfigures/<id>.webp
 * 注意：meta.images 是条目自身图标集（角色/光锥立绘等），不能裸子串匹配——如 id=2 会被 "xx_2.webp" 误命中
 */
function matIcon (images, materialId, gameId) {
  if (!materialId) return ''

  // 约定文件名
  let expectedName
  if (gameId === 'hsr') {
    expectedName = `${materialId}.webp`
  } else {
    expectedName = materialId === 'mora' ? 'UI_ItemIcon_202.webp' : `UI_ItemIcon_${materialId}.webp`
  }

  // 1) 优先按命名约定直查 gallery（素材图都在各自约定目录）
  const convPath = gameId === 'hsr'
    ? path.join(backendRoot, 'gallery', 'hsr', 'itemfigures', expectedName)
    : path.join(backendRoot, 'gallery', gameId, expectedName)
  if (fs.existsSync(convPath)) return pathToFileURL(convPath).href

  // 2) 兜底：在 meta.images 中找「文件名精确等于约定名」的条目（避免裸子串误命中）
  if (Array.isArray(images)) {
    const hit = images.find(i => i.localPath && path.basename(i.localPath) === expectedName)
    if (hit?.localPath) {
      const fullPath = path.join(backendRoot, hit.localPath)
      if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
    }
  }

  return ''
}

/** 构建材料列表项（含图标，按货币→Boss/周本→其余 id 升序排序） */
export function buildMatItems (agg, images, gameId) {
  const items = []
  const cur = CURRENCY[gameId]
  if (agg.cost > 0 && cur) {
    items.push({ name: cur.name, count: agg.cost, icon: matIcon(images, cur.id, gameId), id: cur.id, rank: 0 })
  }
  for (const m of agg.mats) {
    items.push({ name: m.name, count: m.count, icon: matIcon(images, m.id, gameId), id: m.id, rank: m.rank })
  }
  return sortMatItems(items, gameId)
}
