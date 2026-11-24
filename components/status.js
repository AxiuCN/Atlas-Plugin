/**
 * 状态数据构建 + 状态图渲染 — status.html 数据共享层
 *
 * 供两处复用：
 *   apps/status.js   #图鉴状态 / #图鉴版本 命令
 *   apps/admin.js    初始化/更新完成通知（渲染状态图代替文字）
 *
 * 页面内容：各游戏（版本 + 版本号解析 + 条目数）→ 本次更新（可选）→ 引擎与数据库 → 图片资源。
 */
import { getDataStatus } from '../model/AtlasUpdater.js'
import { parseVersionBadge } from './versionBadge.js'
import { sourceLabel } from './sourceCredit.js'
import { hesperidesVersion } from './pluginVersion.js'
import { renderAtlas } from './render.js'

/**
 * ISO 时间 → `YYYY-MM-DD HH:mm`（本地时区）；解析不了就原样返回
 * @param {string} value
 * @returns {string}
 */
function formatTime (value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 构建 status.html 模板数据
 * @param {object} [extra]
 * @param {{name: string, changed: boolean, from: string, to: string, delta: number}[]} [extra.changes]
 *   「本次更新」卡片；仅更新/定时更新会传，#图鉴状态 与首次初始化不传
 * @param {string} [extra.warning]
 *   抓取未完全成功的提醒（如「有未抓到的条目，数据可能不完整」）；为空则不显示
 * @returns {object|null} 未初始化时返回 null
 */
export function buildStatusData (extra = {}) {
  const status = getDataStatus()
  if (!status.initialized) return null

  // 各游戏：保留原始版本号，另给解析出的状态（如 7.2.53 → 7.3 v4 测试服）
  const games = status.games
    ? Object.entries(status.games).map(([id, game]) => ({
        id,
        name: game.name,
        version: game.version || '未知',
        versionTag: parseVersionBadge(id, game.version)?.tag || '',
        recordCount: game.recordCount.toLocaleString()
      }))
    : []

  // 引擎与数据库：引擎是产物本身（版本 + schema + 生成时间 + 抓取状态），数据库按源汇总
  const engine = {
    version: hesperidesVersion ? `Hesperides ${hesperidesVersion}` : 'Hesperides',
    schema: status.engine?.schemaVersion ? `v${status.engine.schemaVersion}` : '',
    generatedAt: formatTime(status.engine?.generatedAt),
    scraping: status.engine?.scraping ? '进行中' : '空闲'
  }
  const databases = (status.databases || []).map((item) => ({
    name: sourceLabel(item.id),
    detail: [
      `${item.pages} 页`,
      `${Number(item.records).toLocaleString()} 条`,
      formatTime(item.fetchedAt)
    ].filter(Boolean).join(' · '),
    warn: item.failed > 0 ? `${item.failed} 个频道失败（沿用上一轮数据）` : ''
  }))

  // 格式化更新时间
  const fetchedAt = formatTime(status.fetchedAt)

  // 「本次更新」：模板只负责展示，文案在这里拼好（避免模板里写表达式）
  const changes = Array.isArray(extra?.changes)
    ? extra.changes.map(c => ({
        name: c.name,
        changed: !!c.changed,
        text: c.changed
          ? `${c.from || '?'} → ${c.to || '未知'}${c.delta ? `（条目 ${c.delta > 0 ? '+' : ''}${c.delta}）` : ''}`
          : `无变化（${c.to || '版本未知'}）`
      }))
    : []

  return {
    games,
    engine,
    databases,
    images: status.images || { total: 0, downloaded: 0, placeholder: 0, missing: 0 },
    fetchedAt,
    mode: status.mode || '',
    imageDownloads: status.imageDownloads,
    changes,
    warning: typeof extra?.warning === 'string' ? extra.warning : ''
  }
}

/**
 * 渲染状态图（segment.image 对象）
 * @param {object} [extra] - 同 buildStatusData，见其说明
 * @returns {Promise<object|null>} 未初始化 / 渲染失败返回 null
 */
export async function renderStatusImage (extra = {}) {
  const data = buildStatusData(extra)
  if (!data) return null
  try {
    return await renderAtlas('status', data, { imgType: 'jpeg' })
  } catch (err) {
    logger?.error('[Atlas][状态] 状态图渲染失败:', err.message)
    return null
  }
}