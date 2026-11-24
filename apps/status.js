import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import { buildStatusData, renderStatusImage } from '../components/status.js'

const config = getPluginConfig()

export class AtlasStatus extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴状态',
      dsc: '#图鉴状态 / #图鉴版本',
      event: 'message',
      priority: config.priority ? config.priority - 10 : 9990,
      rule: [
        { reg: /^#(?:图鉴状态|图鉴版本)$/, fnc: 'handleStatus', permission: 'all' }
      ]
    })
  }

  /**
   * #图鉴状态 / #图鉴版本 — 展示各游戏版本（含版本号解析）、引擎与各数据库状态、条目数、图片统计
   */
  async handleStatus (e) {
    const data = buildStatusData()

    if (!data) {
      await e.reply('[Atlas] 图鉴数据未初始化，请主人使用 #图鉴初始化 完成数据准备')
      return true
    }

    try {
      const img = await renderStatusImage()
      if (img) {
        await e.reply(img)
      } else {
        await e.reply('[Atlas] 状态图生成失败')
      }
    } catch (err) {
      logger?.error('[Atlas][状态] 渲染失败:', err)
      // 文字 fallback
      const lines = ['[Atlas] 图鉴状态']
      for (const g of data.games) {
        lines.push(`· ${g.name}：版本 ${g.version}${g.versionTag ? `（${g.versionTag}）` : ''}，${g.recordCount} 条`)
      }
      if (data.engine) lines.push(`引擎：${data.engine.version}｜抓取${data.engine.scraping}`)
      for (const db of data.databases || []) {
        lines.push(`· ${db.name}：${db.detail}${db.warn ? `（${db.warn}）` : ''}`)
      }
      if (data.images) {
        lines.push(`图片：${data.images.total} 总计 / ${data.images.downloaded} 已下载 / ${data.images.placeholder} 占位 / ${data.images.missing} 缺失`)
      }
      if (data.fetchedAt) lines.push(`更新时间：${data.fetchedAt}`)
      await e.reply(lines.join('\n'))
    }

    return true
  }
}