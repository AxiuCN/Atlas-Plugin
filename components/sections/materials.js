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

/** 材料排序：按类型分组，组内按品质升序 */
function matSortOrder (m) {
  const idNum = Number(m.id) || 0
  const rank = m.rank || 0

  // 分类：摩拉→经验书→区域特产→Boss素材→突破宝石→周本材料→智识之冕→天赋书→怪物素材
  let cat
  if (idNum === 202) cat = 0                           // 摩拉
  else if (idNum >= 104001 && idNum <= 104099) cat = 1  // 经验书
  else if (idNum >= 101000 && idNum <= 101999) cat = 2  // 区域特产
  else if (idNum >= 113000 && idNum <= 113999) cat = rank >= 5 ? 5 : 3  // Boss素材(rank<5) / 周本材料(rank≥5)
  else if (idNum >= 104100 && idNum <= 104199) cat = 4  // 突破宝石
  else if (idNum === 104319) cat = 6                     // 智识之冕
  else if (idNum >= 104300 && idNum <= 104399) cat = 7  // 天赋书
  else if (idNum >= 112000 && idNum <= 112999) cat = 8  // 怪物素材
  else cat = 99

  return cat * 100 + rank
}

/**
 * 材料图标查询：先查 meta.images 匹配，再按 UI_ItemIcon_<id> 模式直查 gallery
 */
function matIcon (images, materialId, gameId) {
  if (!materialId) return ''
  // 先查已下载的 images 列表
  if (Array.isArray(images)) {
    const haystack = String(materialId)
    const hit = images.find(i => i.localPath && i.localPath.includes(haystack))
    if (hit?.localPath) {
      const fullPath = path.join(backendRoot, hit.localPath)
      if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
    }
  }
  // 兜底：按命名约定直查 gallery
  const filename = materialId === 'mora'
    ? 'UI_ItemIcon_202.webp'
    : `UI_ItemIcon_${materialId}.webp`
  const fullPath = path.join(backendRoot, 'gallery', gameId, filename)
  if (fs.existsSync(fullPath)) return pathToFileURL(fullPath).href
  return ''
}

/** 构建材料列表项（含图标，按类型+品质排序） */
export function buildMatItems (agg, images, gameId) {
  const items = []
  if (agg.cost > 0) {
    items.push({ name: '摩拉', count: agg.cost, icon: matIcon(images, 'mora', gameId), id: 202, rank: 0 })
  }
  for (const m of agg.mats) {
    items.push({ name: m.name, count: m.count, icon: matIcon(images, m.id, gameId), id: m.id, rank: m.rank })
  }
  items.sort((a, b) => matSortOrder(a) - matSortOrder(b))
  return items
}