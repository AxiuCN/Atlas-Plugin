/**
 * 状态数据构建 + 状态图渲染 — status.html 数据共享层
 *
 * 供两处复用：
 *   apps/status.js   #图鉴状态 命令
 *   apps/admin.js    初始化/更新完成通知（渲染状态图代替文字）
 */
import { getDataStatus } from '../model/AtlasUpdater.js'
import { renderAtlas } from './render.js'

/**
 * 构建 status.html 模板数据
 * @returns {object|null} 未初始化时返回 null
 */
export function buildStatusData () {
  const status = getDataStatus()
  if (!status.initialized) return null

  // 格式化游戏数据
  const games = status.games
    ? Object.entries(status.games).map(([id, g]) => ({
        id,
        name: g.name,
        version: g.version || '未知',
        recordCount: g.recordCount.toLocaleString()
      }))
    : []

  // 格式化更新时间
  let fetchedAt = ''
  if (status.fetchedAt) {
    try {
      const d = new Date(status.fetchedAt)
      fetchedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      fetchedAt = status.fetchedAt
    }
  }

  return {
    games,
    images: status.images || { total: 0, downloaded: 0, placeholder: 0, missing: 0 },
    fetchedAt,
    mode: status.mode || '',
    imageDownloads: status.imageDownloads
  }
}

/**
 * 渲染状态图（segment.image 对象）
 * @returns {Promise<object|null>} 未初始化 / 渲染失败返回 null
 */
export async function renderStatusImage () {
  const data = buildStatusData()
  if (!data) return null
  try {
    return await renderAtlas('status', data, { imgType: 'jpeg' })
  } catch (err) {
    logger?.error('[Atlas][状态] 状态图渲染失败:', err.message)
    return null
  }
}