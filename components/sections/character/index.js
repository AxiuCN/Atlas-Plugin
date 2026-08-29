/**
 * 角色 sections builder 入口
 * 游戏分发 + 子视图路由
 */
import { buildGI } from './gi.js'
import { buildHSR } from './hsr.js'
import { buildZZZ } from './zzz.js'
import { applyDefaultView, applySkillsView, applyConstellationsView, applyProfileView, applyStoriesView, applyMaterialsView } from './views.js'

/**
 * 将三游戏异构 JSON 归一化为统一的角色模板数据
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @param {string|null} subView - 子视图: skills | constellations | profile | stories | materials
 * @returns {object} 模板数据 { hero, metaFields, sections }
 */
export function buildCharacterData (gameId, record, subView = null) {
  const list = record?.content?.list || {}
  const detail = record?.content?.detail || {}
  const meta = record?.meta

  let fullData
  if (gameId === 'gi') fullData = buildGI(list, detail, meta)
  else if (gameId === 'hsr') fullData = buildHSR(list, detail, meta)
  else if (gameId === 'zzz') fullData = buildZZZ(list, detail, meta)
  else return null

  if (!fullData) return null

  // ---- 子视图路由 ----
  if (!subView) {
    return applyDefaultView(fullData)
  }
  switch (subView) {
    case 'skills': return applySkillsView(fullData)
    case 'constellations': return applyConstellationsView(fullData)
    case 'profile': return applyProfileView(fullData, gameId, detail)
    case 'stories': return applyStoriesView(fullData, gameId, detail)
    case 'materials': return applyMaterialsView(fullData, gameId, detail)
    default: return applyDefaultView(fullData)
  }
}