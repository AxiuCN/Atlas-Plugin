import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import { buildStatusData, renderStatusImage } from '../components/status.js'
import { getPatchOverview } from '../model/AtlasService.js'
import { PATCH_DATA_DIR, PATCH_GALLERY_DIR, PATCH_MAP_FILE } from '../components/patch.js'

const config = getPluginConfig()
const GAME_CN = { gi: '原神', hsr: '星铁', zzz: '绝区零' }

export class AtlasStatus extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴状态',
      dsc: '#图鉴状态 / #图鉴补丁',
      event: 'message',
      priority: config.priority ? config.priority - 10 : 9990,
      rule: [
        { reg: /^#图鉴状态$/, fnc: 'handleStatus', permission: 'all' },
        { reg: /^#图鉴补丁$/, fnc: 'handlePatch', permission: 'all' }
      ]
    })
  }

  /**
   * #图鉴状态 — 展示数据版本、条目数、图片统计
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
        lines.push(`· ${g.name}：版本 ${g.version}，${g.recordCount} 条`)
      }
      if (data.images) {
        lines.push(`图片：${data.images.total} 总计 / ${data.images.downloaded} 已下载 / ${data.images.placeholder} 占位`)
      }
      if (data.fetchedAt) lines.push(`更新时间：${data.fetchedAt}`)
      await e.reply(lines.join('\n'))
    }

    return true
  }

  /**
   * #图鉴补丁 — 列出随插件分发的数据 / 图片 / 索引补丁，并提示上游值已变化的补丁
   */
  async handlePatch (e) {
    const { dataPatches, images, mapPatch } = getPatchOverview()
    const lines = ['[Atlas] 本地补丁（resources/patch/）']

    if (!dataPatches.length && !images.length && !mapPatch) {
      lines.push('· 暂无补丁')
      await e.reply(lines.join('\n'))
      return true
    }

    lines.push(`· 条目补丁 ${dataPatches.length} 个｜图片补丁 ${images.length} 张｜索引补丁 ${mapPatch ? '有' : '无'}`)

    if (dataPatches.length) {
      lines.push('', '【条目补丁】')
      for (const p of dataPatches) {
        const name = p.relPath.replace(/^items\/[^/]+\//, '')
        lines.push(`· ${name}${p.note ? ` — ${p.note}` : ''}${p.updatedAt ? `（${p.updatedAt}）` : ''}`)
        for (const c of p.changed) {
          lines.push(`   ⚠ 上游值已变化：${c.path}（快照 ${JSON.stringify(c.expect)} → 当前 ${JSON.stringify(c.current)}）`)
        }
      }
    }

    if (images.length) {
      lines.push('', '【图片补丁】')
      const byGame = new Map()
      for (const img of images) {
        const list = byGame.get(img.gameId) || []
        list.push(img.name)
        byGame.set(img.gameId, list)
      }
      for (const [gameId, names] of byGame) {
        lines.push(`· ${GAME_CN[gameId] || gameId}（${names.length}）：${names.join('、')}`)
      }
    }

    if (mapPatch) lines.push('', `【索引补丁】${PATCH_MAP_FILE}`)

    lines.push('', `目录：${PATCH_DATA_DIR}｜${PATCH_GALLERY_DIR}`)
    await e.reply(lines.join('\n'))
    return true
  }
}
