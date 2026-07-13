import fs from 'node:fs'
import path from 'node:path'
import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import {
  isInitialized,
  initSubmodule,
  installDeps,
  runScrape,
  runIncrementalScrapeAsync,
  getDataStatus,
  BACKEND_DIR
} from '../model/AtlasUpdater.js'
import { reloadIndex } from '../model/AtlasService.js'

const config = getPluginConfig()

export class AtlasAdmin extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴管理',
      dsc: '#图鉴初始化、#图鉴更新',
      event: 'message',
      priority: config.priority ? config.priority - 10 : 9990,
      rule: [
        { reg: /^#图鉴初始化$/, fnc: 'handleInit', permission: 'master' },
        { reg: /^#图鉴更新$/, fnc: 'handleUpdate', permission: 'master' }
      ]
    })

    // 定时任务（仅在 autoUpdate.enabled ≠ false 时注册）
    if (config?.autoUpdate?.enabled !== false) {
      this.task = [{
        name: '图鉴数据自动更新',
        cron: config.autoUpdate?.cron || '0 0 5 * * *',
        fnc: () => this.autoUpdateTask(),
        log: true
      }]
    }
  }

  /**
   * #图鉴初始化 — 两阶段：环境准备 → 数据抓取
   */
  async handleInit (e) {
    // 已初始化则跳过
    if (isInitialized()) {
      await e.reply('[Atlas] 图鉴数据已初始化，无需重复操作', true)
      return true
    }

    // ---- 阶段一：环境准备 ----
    const gitFile = path.join(BACKEND_DIR, '.git')

    if (!fs.existsSync(gitFile)) {
      await e.reply('[Atlas] 正在拉取子模块，请稍候...', true)
      const gitRet = initSubmodule()
      if (!gitRet.ok) {
        await e.reply(`[Atlas] 子模块拉取失败：${gitRet.error}`, true)
        return true
      }
    }

    const nmDir = path.join(BACKEND_DIR, 'node_modules')
    if (!fs.existsSync(nmDir)) {
      await e.reply('[Atlas] 正在安装依赖，请稍候...', true)
      const depRet = installDeps()
      if (!depRet.ok) {
        await e.reply(`[Atlas] 依赖安装失败：${depRet.error}`, true)
        return true
      }
    }

    // 阶段一完成，发确认消息
    await e.reply('[Atlas] 环境准备完成，开始抓取图鉴数据（含图片），预计耗时较长，请耐心等待...', true)

    // ---- 阶段二：数据抓取 ----
    const scrapeRet = runScrape()
    if (!scrapeRet.ok) {
      await e.reply(`[Atlas] 数据抓取失败：${scrapeRet.error}`, true)
      return true
    }

    // 重建索引
    try {
      reloadIndex()
    } catch (err) {
      logger?.error('[Atlas][管理] 索引重载失败:', err.message)
      await e.reply(`[Atlas] 数据抓取完成但索引加载失败：${err.message}`, true)
      return true
    }

    // 统计结果
    const status = getDataStatus()
    const gameStats = status.games
    const gameLines = gameStats
      ? Object.entries(gameStats).map(([, g]) => `· ${g.name} ${g.recordCount} 条`).join('\n')
      : '抓取完成'

    const imgInfo = status.images
      ? `\n图片：${status.images.total} 总计 / ${status.images.downloaded} 已下载 / ${status.images.placeholder} 占位`
      : ''

    await e.reply(`[Atlas] 初始化完成！\n${gameLines}${imgInfo}`, true)
    return true
  }

  /**
   * #图鉴更新 — 异步执行，完成后通知主人
   */
  async handleUpdate (e) {
    if (!isInitialized()) {
      await e.reply('[Atlas] 图鉴数据未初始化，请先使用 #图鉴初始化', true)
      return true
    }

    await e.reply('[Atlas] 更新任务已启动，完成后将通知主人', true)

    // 异步执行，不阻塞
    runIncrementalScrapeAsync().then(async (ret) => {
      if (!ret.ok) {
        Bot.sendMasterMsg(`[Atlas] 图鉴更新失败：${ret.error}`)
        return
      }

      // 重建索引
      try {
        reloadIndex()
      } catch (err) {
        logger?.error('[Atlas][管理] 更新后索引重载失败:', err.message)
        Bot.sendMasterMsg(`[Atlas] 图鉴更新完成但索引加载失败：${err.message}`)
        return
      }

      // 读取新状态
      const status = getDataStatus()
      const gameStats = status.games
      const gameLines = gameStats
        ? Object.entries(gameStats).map(([, g]) => `· ${g.name} ${g.recordCount} 条`).join('\n')
        : '更新完成'

      const imgInfo = status.images
        ? `\n图片：${status.images.total} 总计 / ${status.images.downloaded} 已下载`
        : ''

      Bot.sendMasterMsg(`[Atlas] 图鉴更新完成\n${gameLines}${imgInfo}`)
    }).catch((err) => {
      logger?.error('[Atlas][管理] 更新异常:', err)
      Bot.sendMasterMsg(`[Atlas] 图鉴更新异常：${err.message}`)
    })

    return true
  }

  /**
   * 定时自动更新任务
   */
  async autoUpdateTask () {
    // 检查是否已初始化 + 配置是否开启
    const cfg = getPluginConfig()
    if (cfg?.autoUpdate?.enabled === false) return
    if (!isInitialized()) return

    logger?.info('[Atlas][管理] 开始定时自动更新...')

    try {
      const ret = await runIncrementalScrapeAsync()
      if (!ret.ok) {
        Bot.sendMasterMsg(`[Atlas] 定时更新失败：${ret.error}`)
        return
      }

      reloadIndex()

      const status = getDataStatus()
      const gameStats = status.games
      const gameLines = gameStats
        ? Object.entries(gameStats).map(([, g]) => `· ${g.name} ${g.recordCount} 条`).join('、')
        : '更新完成'

      logger?.info('[Atlas][管理] 定时更新完成')
      Bot.sendMasterMsg(`[Atlas] 每日自动更新完成：${gameLines}`)
    } catch (err) {
      logger?.error('[Atlas][管理] 定时更新异常:', err)
    }
  }
}
