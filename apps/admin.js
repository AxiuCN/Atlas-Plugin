import fs from 'node:fs'
import path from 'node:path'
import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import {
  isInitialized,
  isDataIntact,
  initSubmodule,
  runScrapeAsync,
  checkAndUpdate,
  checkRemoteVersions,
  readLocalVersions,
  compareAtlasVersions,
  getDataStatus,
  repairMissingGames,
  BACKEND_DIR
} from '../model/AtlasUpdater.js'
import { reloadIndex } from '../model/AtlasService.js'
import { renderStatusImage } from '../components/status.js'
import { GAME_NAMES } from '../components/constants.js'
import { runDiffScrape } from '../model/AtlasUpdater.js'

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
    // 已初始化 + 数据完整 → 跳过抓取
    if (isInitialized()) {
      if (isDataIntact()) {
        await e.reply('[Atlas] 图鉴数据已初始化且完整，无需重复抓取', false)
        return true
      }
      // map.json 存在但数据异常（上次超时/崩溃残留），自动允许重新初始化
      logger?.warn('[Atlas][管理] 检测到数据不完整（上次可能异常中断），自动重新初始化')
      await e.reply('[Atlas] 检测到上次初始化未完整完成，自动重新抓取...', false)
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
      await e.reply('[Atlas] 正在拉取子模块，请稍候...', false)
      const gitRet = await initSubmodule()
      if (!gitRet.ok) {
        await e.reply(`[Atlas] 子模块拉取失败：${gitRet.error}`, false)
        return true
      }
    }

    // Hesperides 零依赖，不需要安装步骤

    // 阶段一完成，发确认消息，启动后台抓取
    const cfg = getPluginConfig()
    const mode = cfg?.notifyMode || 'all'
    const hasGroups = (mode === 'all' || mode === 'first_master_groups')
      && parseGroupList(cfg?.notifyGroups).length > 0
    const notifyHint = (mode === 'first_master' || mode === 'first_master_groups')
      ? (hasGroups ? '第一位主人和配置群' : '第一位主人')
      : hasGroups ? '主人和配置群' : '主人'
    await e.reply(`[Atlas] 环境准备完成，开始后台抓取（nanoka 全量 + 玉璃终局，含图片），完成后将通知${notifyHint}`, false)

    // ---- 阶段二：异步数据抓取（不阻塞 bot） ----
    runScrapeAsync({ mode: 'full', timeoutMs: cfg?.autoUpdate?.timeoutMs }).then(async (ret) => {
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

      // 渲染状态图通知（失败回退文字）
      const img = await renderStatusImage()
      if (img) {
        this._notifyResult(img)
      } else {
        this._notifyResult(`[Atlas] 初始化完成！\n${gameLines}${imgInfo}`)
      }

      // 最后一步：抓取版本变更记录（最新版 vs 前一版），失败仅告警
      await runDiffScrape(['gi', 'hsr', 'zzz'])
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
    await e.reply('[Atlas] 强制重新初始化：跳过完整性检查，按全量模式重抓记录与图片（不清空现有产物）...', false)
    // 直接走完整流程（不检查 isInitialized）
    await this._doInit(e)
    return true
  }

  /**
   * #图鉴更新 — 版本检查 → 增量抓取 → 重试 → 全量兜底
   */
  async handleUpdate (e) {
    if (!isInitialized()) {
      await e.reply('[Atlas] 图鉴数据未初始化，请先使用 #图鉴初始化', false)
      return true
    }

    // ── 同步完成版本检查（~5s）：期间不发「正在检查」，避免与结果几乎同时刷屏 ──
    // 更新前的状态留作「本次更新」卡片对比基线（版本 + 条目数）
    const before = getDataStatus()
    const local = readLocalVersions()
    const remote = await checkRemoteVersions(['gi', 'hsr', 'zzz'])

    if (!remote.ok) {
      await e.reply(`[Atlas] 远端版本检查失败：${remote.reason || '网络异常'}`, false)
      return true
    }

    if (!local.ready) {
      await e.reply('[Atlas] 本地数据不完整，自动全量抓取中，完成后将通知...', false)
    } else {
      const diff = compareAtlasVersions(local.versions, remote.versions)
      if (!diff.changed) {
        await e.reply(`[Atlas] 版本未变化，无需更新\n${versionLine(local.versions)}`, false)
        return true
      }
      const changes = diff.changes.map(c => `${gameLabel(c.game)} ${c.local.latest || '-'}→${c.remote.latest}`).join('，')
      await e.reply(`[Atlas] 检测到版本变化：${changes}，开始更新（完成后通知）`, false)
    }

    // ── 异步抓取（不阻塞 bot）──
    const cfg = getPluginConfig()
    checkAndUpdate({
      games: ['gi', 'hsr', 'zzz'],
      locales: ['zh'],
      retries: cfg?.autoUpdate?.retries ?? 1,
      retryDelayMs: cfg?.autoUpdate?.retryDelayMs ?? 30000,
      fallbackToFull: cfg?.autoUpdate?.fallbackToFull ?? true,
      timeoutMs: cfg?.autoUpdate?.timeoutMs
    }).then(async (ret) => {
      if (ret.skipped) {
        // checkAndUpdate 内部重新检查发现版本未变（极端情况）
        this._notifyResult('[Atlas] 图鉴版本未变化，无需更新')
        return
      }
      if (!ret.ok) {
        this._notifyResult(`[Atlas] 图鉴更新失败：${ret.error || ret.reason}`)
        return
      }

      // 空缺检查 + 补抓（仅针对缺失游戏）
      const repairRet = await repairMissingGames(['gi', 'hsr', 'zzz'])
      if (repairRet.missing?.length > 0) {
        if (repairRet.ok) logger?.info(`[Atlas][管理] 数据空缺已修复: ${repairRet.missing.join(', ')}`)
        else logger?.error(`[Atlas][管理] 数据空缺修复失败: ${repairRet.missing.join(', ')}`)
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

      const modeLabel = ret.mode === 'full' ? '（全量补全）'
        : ret.mode === 'full_fallback' ? '（增量失败，降级全量）'
        : ''

      // 「本次更新」摘要（谁变了、条目数增减），随状态图一起展示
      const changes = buildChangeSummary(before, status, ret?.check?.diff)

      // 渲染状态图通知（失败回退文字）
      const img = await renderStatusImage({ changes })
      if (img) {
        this._notifyResult(img)
      } else {
        this._notifyResult(`[Atlas] 图鉴更新完成${modeLabel}\n${gameLines}${imgInfo}\n${changeLines(changes)}`)
      }

      // 最后一步：抓取版本变更记录（最新版 vs 前一版），失败仅告警
      await runDiffScrape(['gi', 'hsr', 'zzz'])
    }).catch((err) => {
      logger?.error('[Atlas][管理] 更新异常:', err)
      this._notifyResult(`[Atlas] 图鉴更新异常：${err.message}`)
    })

    return true
  }

  /**
   * 发送更新结果通知（文字或状态图）
   * @param {string|object} msg - 通知消息：文字字符串，或 renderStatusImage 返回的 segment.image 对象
   */
  _notifyResult (msg) {
    const cfg = getPluginConfig()
    const mode = cfg?.notifyMode || 'all'

    if (mode === 'first_master' || mode === 'first_master_groups') {
      // 仅通知第一位主人
      const first = firstMaster()
      if (first) {
        Bot.sendFriendMsg(first.botId, first.userId, msg).catch(() => {
          logger?.warn('[Atlas][管理] 通知第一位主人失败')
        })
      }
      // first_master_groups 续行群通知
      if (mode === 'first_master') return
    } else {
      // all / master_only：通知全部主人
      Bot.sendMasterMsg(msg)
      if (mode === 'master_only') return
    }

    // 发送配置群（all / first_master_groups）
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
    const cfg = getPluginConfig()
    if (cfg?.autoUpdate?.enabled === false) return
    if (!isInitialized()) return

    logger?.info('[Atlas][管理] 开始定时自动更新...')

    try {
      const before = getDataStatus()
      const ret = await checkAndUpdate({
        games: ['gi', 'hsr', 'zzz'],
        locales: ['zh'],
        retries: cfg?.autoUpdate?.retries ?? 1,
        retryDelayMs: cfg?.autoUpdate?.retryDelayMs ?? 30000,
        fallbackToFull: cfg?.autoUpdate?.fallbackToFull ?? true,
        timeoutMs: cfg?.autoUpdate?.timeoutMs
      })

      if (ret.skipped) {
        logger?.info('[Atlas][管理] 版本未变化，跳过抓取')
        return
      }

      if (!ret.ok) {
        this._notifyResult(`[Atlas] 定时更新失败：${ret.error || ret.reason}`)
        return
      }

      // 空缺检查 + 补抓（仅针对缺失游戏）
      const repairRet = await repairMissingGames(['gi', 'hsr', 'zzz'])
      if (repairRet.missing?.length > 0) {
        if (repairRet.ok) logger?.info(`[Atlas][管理] 数据空缺已修复: ${repairRet.missing.join(', ')}`)
        else logger?.error(`[Atlas][管理] 数据空缺修复失败: ${repairRet.missing.join(', ')}`)
      }

      reloadIndex()

      const status = getDataStatus()
      const gameStats = status.games
      const gameLines = gameStats
        ? Object.entries(gameStats).map(([, g]) => `· ${g.name} ${g.recordCount} 条`).join('、')
        : '更新完成'

      const modeLabel = ret.mode === 'full' ? '（全量补全）'
        : ret.mode === 'full_fallback' ? '（增量失败，降级全量）'
        : ''
      logger?.info('[Atlas][管理] 定时更新完成')

      // 「本次更新」摘要（谁变了、条目数增减），随状态图一起展示
      const changes = buildChangeSummary(before, status, ret?.check?.diff)

      // 渲染状态图通知（失败回退文字）
      const img = await renderStatusImage({ changes })
      if (img) {
        this._notifyResult(img)
      } else {
        this._notifyResult(`[Atlas] 每日自动更新完成${modeLabel}：${gameLines}\n${changeLines(changes)}`)
      }

      // 最后一步：抓取版本变更记录（最新版 vs 前一版），失败仅告警
      await runDiffScrape(['gi', 'hsr', 'zzz'])
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
 * 游戏 ID → 中文名（缺省原样返回）
 * @param {string} gameId
 * @returns {string}
 */
function gameLabel (gameId) {
  return GAME_NAMES[gameId] || gameId
}

/**
 * 版本行：`原神 7.0.51 · 星铁 3.4.1 · 绝区零 2.1.0`（缺版本的跳过）
 * @param {object} versions - readLocalVersions().versions
 * @returns {string}
 */
function versionLine (versions = {}) {
  const parts = Object.entries(versions)
    .map(([game, v]) => {
      const ver = v?.latest || v?.live
      return ver ? `${gameLabel(game)} ${ver}` : ''
    })
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : '（版本未知）'
}

/**
 * 本次更新摘要：逐游戏对比更新前后的版本与条目数
 * @param {object} before - 更新前的 getDataStatus()
 * @param {object} after - 更新后的 getDataStatus()
 * @param {object} [diff] - checkAndUpdate().check.diff（判定哪些游戏真的变了）
 * @returns {{id: string, name: string, changed: boolean, from: string, to: string, delta: number}[]}
 */
function buildChangeSummary (before, after, diff) {
  const changedGames = new Set((diff?.changes || []).map(c => c.game))
  const afterGames = after?.games || {}
  return Object.entries(afterGames).map(([id, g]) => {
    const prev = before?.games?.[id] || {}
    return {
      id,
      name: g?.name || gameLabel(id),
      changed: changedGames.has(id),
      from: prev.version || '',
      to: g?.version || '',
      delta: Number(g?.recordCount || 0) - Number(prev.recordCount || 0)
    }
  })
}

/**
 * 「本次更新」的文字版（状态图渲染失败时回退用）
 * @param {ReturnType<typeof buildChangeSummary>} changes
 * @returns {string}
 */
function changeLines (changes = []) {
  if (!changes.length) return ''
  const lines = changes.map(c => c.changed
    ? `· ${c.name}：${c.from || '?'} → ${c.to}${c.delta ? `（条目 ${c.delta > 0 ? '+' : ''}${c.delta}）` : ''}`
    : `· ${c.name}：无变化（${c.to || '版本未知'}）`)
  return `本次更新：\n${lines.join('\n')}`
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
