import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import { getDataStatus } from '../model/AtlasUpdater.js'
import { renderAtlas } from '../components/render.js'

const config = getPluginConfig()

export class AtlasStatus extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴状态',
      dsc: '#图鉴状态',
      event: 'message',
      priority: config.priority ? config.priority - 10 : 9990,
      rule: [
        { reg: /^#图鉴状态$/, fnc: 'handleStatus', permission: 'all' }
      ]
    })
  }

  /**
   * #图鉴状态 — 展示数据版本、条目数、图片统计
   */
  async handleStatus (e) {
    const status = getDataStatus()

    if (!status.initialized) {
      await e.reply('[Atlas] 图鉴数据未初始化，请主人使用 #图鉴初始化 完成数据准备')
      return true
    }

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

    const data = {
      games,
      images: status.images || { total: 0, downloaded: 0, placeholder: 0, missing: 0 },
      fetchedAt,
      mode: status.mode || '',
      imageDownloads: status.imageDownloads
    }

    try {
      const img = await renderAtlas('status', data, { imgType: 'jpeg' })
      if (img) {
        await e.reply(img)
      } else {
        await e.reply('[Atlas] 状态图生成失败')
      }
    } catch (err) {
      logger?.error('[Atlas][状态] 渲染失败:', err)
      // 文字 fallback
      const lines = ['[Atlas] 图鉴状态']
      for (const g of games) {
        lines.push(`· ${g.name}：版本 ${g.version}，${g.recordCount} 条`)
      }
      if (status.images) {
        lines.push(`图片：${status.images.total} 总计 / ${status.images.downloaded} 已下载 / ${status.images.placeholder} 占位`)
      }
      if (fetchedAt) lines.push(`更新时间：${fetchedAt}`)
      await e.reply(lines.join('\n'))
    }

    return true
  }
}
