import fs from 'node:fs'
import path from 'node:path'
import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import {
  isInitialized,
  isDataIntact,
  initSubmodule,
  installDeps,
  runScrapeAsync,
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
        { reg: /^#图鉴强制初始化$/, fnc: 'handleForceInit', permission: 'master' },
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
    // 已初始化 + 数据完整 → 跳过
    if (isInitialized()) {
      if (isDataIntact()) {
        await e.reply('[Atlas] 图鉴数据已初始化且完整，无需重复操作。如需强制重新初始化请使用 #图鉴强制初始化', true)
        return true
      }
      // map.json 存在但数据异常（上次超时/崩溃残留），自动允许重新初始化
      logger?.warn('[Atlas][管理] 检测到数据不完整（上次可能异常中断），自动重新初始化')
      await e.reply('[Atlas] 检测到上次初始化未完整完成，自动重新抓取...', true)
    }

    return await this._doInit(e)
  }

  /**
   * 初始化核心流程：环境准备 → 异步抓取
   * handleInit / handleForceInit 共用
   */
  async _doInit (e) {
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

    // 阶段一完成，发确认消息，启动后台抓取
    const cfg = getPluginConfig()
    const mode = cfg?.notifyMode || 'all'
    const hasGroups = mode === 'all' && parseGroupList(cfg?.notifyGroups).length > 0
    const notifyHint = mode === 'first_master' ? '第一位主人'
      : hasGroups ? '主人和配置群' : '主人'
    await e.reply(`[Atlas] 环境准备完成，开始后台抓取图鉴数据（含图片），完成后将通知${notifyHint}`, true)

    // ---- 阶段二：异步数据抓取（不阻塞 bot） ----
    runScrapeAsync().then(async (ret) => {
      if (!ret.ok) {
        this._notifyResult(`[Atlas] 图鉴初始化失败：${ret.error}`)
        return
      }

      // 重建索引
      try {
        reloadIndex()
      } catch (err) {
        logger?.error('[Atlas][管理] 初始化后索引重载失败:', err.message)
        this._notifyResult(`[Atlas] 图鉴初始化完成但索引加载失败：${err.message}`)
        return
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

      this._notifyResult(`[Atlas] 初始化完成！\n${gameLines}${imgInfo}`)
    }).catch((err) => {
      logger?.error('[Atlas][管理] 初始化异常:', err)
      this._notifyResult(`[Atlas] 图鉴初始化异常：${err.message}`)
    })

    return true
  }

  /**
   * #图鉴强制初始化 — 跳过完整性检查，直接全量抓取
   */
  async handleForceInit (e) {
    await e.reply('[Atlas] 强制重新初始化，跳过已有数据...', true)
    // 直接走完整流程（不检查 isInitialized）
    await this._doInit(e)
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

    const cfg = getPluginConfig()
    const mode = cfg?.notifyMode || 'all'
    const hasGroups = mode === 'all' && parseGroupList(cfg?.notifyGroups).length > 0
    const notifyHint = mode === 'first_master' ? '第一位主人'
      : hasGroups ? '主人和配置群' : '主人'
    await e.reply(`[Atlas] 更新任务已启动，完成后将通知${notifyHint}`, true)

    // 异步执行，不阻塞
    runIncrementalScrapeAsync().then(async (ret) => {
      if (!ret.ok) {
        this._notifyResult(`[Atlas] 图鉴更新失败：${ret.error}`)
        return
      }

      // 重建索引
      try {
        reloadIndex()
      } catch (err) {
        logger?.error('[Atlas][管理] 更新后索引重载失败:', err.message)
        this._notifyResult(`[Atlas] 图鉴更新完成但索引加载失败：${err.message}`)
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

      this._notifyResult(`[Atlas] 图鉴更新完成\n${gameLines}${imgInfo}`)
    }).catch((err) => {
      logger?.error('[Atlas][管理] 更新异常:', err)
      this._notifyResult(`[Atlas] 图鉴更新异常：${err.message}`)
    })

    return true
  }

  /**
   * 发送更新结果通知
   * @param {string} msg - 通知消息
   */
  _notifyResult (msg) {
    const cfg = getPluginConfig()
    const mode = cfg?.notifyMode || 'all'

    if (mode === 'first_master') {
      // 仅通知第一位主人
      const first = firstMaster()
      if (first) {
        Bot.sendFriendMsg(first.botId, first.userId, msg).catch(() => {
          logger?.warn('[Atlas][管理] 通知第一位主人失败')
        })
      }
      return
    }

    // all / master_only：通知全部主人
    Bot.sendMasterMsg(msg)

    // master_only 跳过群通知
    if (mode === 'master_only') return

    // all 模式：额外通知配置群
    const list = parseGroupList(cfg?.notifyGroups)
    for (const gid of list) {
      Bot.sendGroupMsg(gid, msg).catch(() => {
        logger?.warn(`[Atlas][管理] 通知群 ${gid} 失败`)
      })
    }
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
        this._notifyResult(`[Atlas] 定时更新失败：${ret.error}`)
        return
      }

      reloadIndex()

      const status = getDataStatus()
      const gameStats = status.games
      const gameLines = gameStats
        ? Object.entries(gameStats).map(([, g]) => `· ${g.name} ${g.recordCount} 条`).join('、')
        : '更新完成'

      logger?.info('[Atlas][管理] 定时更新完成')
      this._notifyResult(`[Atlas] 每日自动更新完成：${gameLines}`)
    } catch (err) {
      logger?.error('[Atlas][管理] 定时更新异常:', err)
    }
  }
}

/**
 * 解析群号列表 — 兼容 YAML 数字/字符串/数组三种格式
 * YAML 可能将单群号 "notifyGroups: 123" 解析为数字，导致 .length 不可用
 * @param {*} groups — 配置中的 notifyGroups 值
 * @returns {string[]}
 */
function parseGroupList (groups) {
  if (!groups && groups !== 0) return []
  const raw = Array.isArray(groups) ? groups.join(',') : String(groups)
  return raw.split(/[,，\s]+/).filter(Boolean).map(s => s.trim())
}

/**
 * 获取第一位主人（bot_id + user_id）
 * cfg.master 结构: { bot_id: [user_id, ...], ... }
 * @returns {{botId: string, userId: string}|null}
 */
function firstMaster () {
  try {
    const map = cfg.master
    const botId = Object.keys(map)[0]
    const userId = map[botId]?.[0]
    if (botId && userId) return { botId, userId }
    return null
  } catch {
    return null
  }
}
