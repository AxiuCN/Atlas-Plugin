import fs from 'node:fs'
import path from 'node:path'
import { execSync, exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** nanoka-atlas-backend 子模块目录 */
export const BACKEND_DIR = path.join(pluginRoot, 'tool/nanoka-atlas-backend/nanoka-atlas-backend')

/** 数据目录 */
const DATA_DIR = path.join(BACKEND_DIR, 'data')

/** 抓取锁文件，防止并发 + 标记异常中断 */
const LOCK_FILE = path.join(DATA_DIR, '_scraping.lock')

/** 并发保护：更新任务是否正在运行 */
let _updateRunning = false

/** 上次抓取完成时间戳，防止短时间内重复抓取（如初始化后立即被定时任务触发） */
let _lastScrapeTime = 0

/** 抓取冷却期（毫秒），此时间内拒绝新的抓取 */
const SCRAPE_COOLDOWN = 5 * 60 * 1000 // 5 分钟

/**
 * 启动时清理残留锁文件
 * 如果锁文件存在但原进程已死，kill 整个进程树（含孤儿 spawn 子进程）
 */
function _cleanupStaleLock () {
  if (!fs.existsSync(LOCK_FILE)) return
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8')
    const data = JSON.parse(raw)
    try {
      process.kill(data.pid, 0) // 检查进程是否存活
      logger?.info(`[Atlas][Updater] 检测到活跃抓取进程 (PID ${data.pid})，保留锁文件`)
      return // 进程仍在运行，保留锁
    } catch {
      // 原进程已死，杀残留进程树
      try {
        execSync(`taskkill /PID ${data.pid} /T /F`, { timeout: 5000, windowsHide: true })
        logger?.info('[Atlas][Updater] 已终止残留抓取进程树')
      } catch { /* taskkill 失败也继续清理锁 */ }
    }
  } catch { /* 锁文件损坏 */ }
  try { fs.unlinkSync(LOCK_FILE) } catch {}
  logger?.info('[Atlas][Updater] 启动时清理残留锁文件')
}

/** 模块加载时自动清理残留锁 */
_cleanupStaleLock()

/**
 * 获取抓取锁（文件锁）
 * @returns {boolean}
 */
function _acquireLock () {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
      try {
        process.kill(data.pid, 0)
        logger?.warn('[Atlas][Updater] 抓取锁文件存在且进程活跃，拒绝重复启动')
        return false
      } catch {}
      // 僵尸锁，清理
      try { fs.unlinkSync(LOCK_FILE) } catch {}
    } catch { try { fs.unlinkSync(LOCK_FILE) } catch {} }
  }
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }), 'utf8')
    return true
  } catch (e) {
    logger?.error('[Atlas][Updater] 无法创建锁文件:', e.message)
    return false
  }
}

/**
 * 释放抓取锁
 */
function _releaseLock () {
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE) } catch {}
}

/**
 * 检查图鉴是否已完成初始化
 * 锁文件存在时视为未完全初始化（上次可能异常中断，数据不完整）
 * @returns {boolean}
 */
export function isInitialized () {
  const gitFile = path.join(BACKEND_DIR, '.git')
  const pkgJson = path.join(BACKEND_DIR, 'package.json')
  const mapJson = path.join(DATA_DIR, 'map.json')
  if (fs.existsSync(LOCK_FILE)) return false
  return fs.existsSync(gitFile) && fs.existsSync(pkgJson) && fs.existsSync(mapJson)
}

/**
 * 检查已初始化数据是否完整（map.json 中有无正常抓取记录）
 * @returns {boolean}
 */
export function isDataIntact () {
  const mapJson = path.join(DATA_DIR, 'map.json')
  if (!fs.existsSync(mapJson)) return false
  try {
    const map = JSON.parse(fs.readFileSync(mapJson, 'utf8'))
    const meta = map.meta || {}
    // fetchedAt 存在说明至少完成过一次完整抓取
    return !!meta.fetchedAt
  } catch {
    return false
  }
}

/**
 * 检查 node_modules 是否已安装
 * @returns {boolean}
 */
function hasDeps () {
  const nmDir = path.join(BACKEND_DIR, 'node_modules')
  return fs.existsSync(nmDir)
}

/**
 * 初始化子模块（git submodule update --init）
 * @returns {{ ok: boolean, error?: string }}
 */
export function initSubmodule () {
  try {
    logger?.info('[Atlas][Updater] 正在拉取子模块...')
    execSync('git submodule update --init -- tool/nanoka-atlas-backend/nanoka-atlas-backend', {
      cwd: pluginRoot,
      encoding: 'utf8',
      timeout: 120000
    })
    logger?.info('[Atlas][Updater] 子模块拉取完成')
    return { ok: true }
  } catch (err) {
    const msg = err.stderr || err.message || String(err)
    logger?.error('[Atlas][Updater] 子模块拉取失败:', msg)
    return { ok: false, error: msg }
  }
}

/**
 * 安装子模块依赖（corepack yarn install）
 * @returns {{ ok: boolean, error?: string }}
 */
export function installDeps () {
  try {
    logger?.info('[Atlas][Updater] 正在安装依赖...')
    execSync('corepack yarn install', {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      timeout: 180000
    })
    logger?.info('[Atlas][Updater] 依赖安装完成')
    return { ok: true }
  } catch (err) {
    const msg = err.stderr || err.message || String(err)
    logger?.error('[Atlas][Updater] 依赖安装失败:', msg)
    return { ok: false, error: msg }
  }
}

/**
 * 全量抓取（带图片），异步执行，返回 Promise
 * @param {string[]} games
 * @param {string[]} locales
 * @returns {Promise<{ ok: boolean, error?: string, stdout?: string }>}
 */
export function runScrape (games = ['gi', 'hsr', 'zzz'], locales = ['zh']) {
  return new Promise((resolve) => {
    const gameArg = games.join(',')
    const localeArg = locales.join(',')
    const cmd = `node src/scrape.mjs --game ${gameArg} --locales ${localeArg}`
    logger?.info(`[Atlas][Updater] 执行全量抓取: ${cmd}`)

    const child = exec(cmd, {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      timeout: 0, // 不限制（全量抓取含图片可能数小时）
      maxBuffer: 50 * 1024 * 1024
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })

    child.on('close', (code) => {
      if (code === 0) {
        logger?.info('[Atlas][Updater] 全量抓取完成')
        resolve({ ok: true, stdout })
      } else {
        const msg = stderr || `退出码 ${code}`
        logger?.error('[Atlas][Updater] 全量抓取失败:', msg)
        resolve({ ok: false, error: msg })
      }
    })

    child.on('error', (err) => {
      logger?.error('[Atlas][Updater] 全量抓取进程错误:', err.message)
      resolve({ ok: false, error: err.message })
    })
  })
}

/**
 * 增量抓取（带图片），异步执行，返回 Promise
 * @param {string[]} games
 * @param {string[]} locales
 * @returns {Promise<{ ok: boolean, error?: string, stdout?: string }>}
 */
export function runIncrementalScrape (games = ['gi', 'hsr', 'zzz'], locales = ['zh']) {
  return new Promise((resolve) => {
    const gameArg = games.join(',')
    const localeArg = locales.join(',')
    const cmd = `node src/scrape.mjs --game ${gameArg} --locales ${localeArg} --mode incremental`
    logger?.info(`[Atlas][Updater] 执行增量抓取: ${cmd}`)

    const child = exec(cmd, {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      timeout: 0, // 不限制（增量抓取含图片可能很久）
      maxBuffer: 50 * 1024 * 1024
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })

    child.on('close', (code) => {
      if (code === 0) {
        logger?.info('[Atlas][Updater] 增量抓取完成')
        resolve({ ok: true, stdout })
      } else {
        const msg = stderr || `退出码 ${code}`
        logger?.error('[Atlas][Updater] 增量抓取失败:', msg)
        resolve({ ok: false, error: msg })
      }
    })

    child.on('error', (err) => {
      logger?.error('[Atlas][Updater] 增量抓取进程错误:', err.message)
      resolve({ ok: false, error: err.message })
    })
  })
}

/**
 * 带并发保护的全量抓取（用于初始化）
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runScrapeAsync () {
  if (_updateRunning) {
    logger?.warn('[Atlas][Updater] 抓取任务已在运行中，跳过重复触发')
    return { ok: false, error: '抓取任务已在运行中，请稍后再试' }
  }

  // 文件锁（跨进程保护）
  if (!_acquireLock()) {
    return { ok: false, error: '抓取任务已在运行中（锁文件检测），请稍后再试' }
  }

  // 冷却检查：上次抓取完成不久，跳过
  if (_lastScrapeTime > 0) {
    const elapsed = Date.now() - _lastScrapeTime
    if (elapsed < SCRAPE_COOLDOWN) {
      const remainMin = Math.ceil((SCRAPE_COOLDOWN - elapsed) / 60000)
      logger?.info(`[Atlas][Updater] 距上次抓取仅 ${Math.floor(elapsed / 1000)}s，冷却中，剩余约 ${remainMin} 分钟`)
      _releaseLock()
      return { ok: false, error: `抓取冷却中，剩余约 ${remainMin} 分钟` }
    }
  }

  _updateRunning = true
  try {
    const result = await runScrape()
    if (result.ok) _lastScrapeTime = Date.now()
    return result
  } finally {
    _updateRunning = false
    _releaseLock()
  }
}

/**
 * 带并发保护的异步增量抓取
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runIncrementalScrapeAsync () {
  if (_updateRunning) {
    logger?.warn('[Atlas][Updater] 更新任务已在运行中，跳过重复触发')
    return { ok: false, error: '更新任务已在运行中，请稍后再试' }
  }

  // 文件锁（跨进程保护）
  if (!_acquireLock()) {
    return { ok: false, error: '更新任务已在运行中（锁文件检测），请稍后再试' }
  }

  // 冷却检查：上次抓取完成不久，跳过（防止初始化后立即被定时任务触发）
  if (_lastScrapeTime > 0) {
    const elapsed = Date.now() - _lastScrapeTime
    if (elapsed < SCRAPE_COOLDOWN) {
      const remainMin = Math.ceil((SCRAPE_COOLDOWN - elapsed) / 60000)
      logger?.info(`[Atlas][Updater] 距上次抓取仅 ${Math.floor(elapsed / 1000)}s，冷却中，剩余约 ${remainMin} 分钟`)
      _releaseLock()
      return { ok: false, error: `抓取冷却中，剩余约 ${remainMin} 分钟` }
    }
  }

  _updateRunning = true
  try {
    const result = await runIncrementalScrape()
    if (result.ok) _lastScrapeTime = Date.now()
    return result
  } finally {
    _updateRunning = false
    _releaseLock()
  }
}

/**
 * 获取图鉴数据状态
 * @returns {{ initialized: boolean, fetchedAt?: string, mode?: string,
 *             imageDownloads?: boolean, games?: object, images?: object }}
 */
export function getDataStatus () {
  const mapPath = path.join(DATA_DIR, 'map.json')
  const galleryPath = path.join(DATA_DIR, 'gallery-index.json')

  if (!fs.existsSync(mapPath)) {
    return { initialized: false }
  }

  try {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
    const gallery = fs.existsSync(galleryPath)
      ? JSON.parse(fs.readFileSync(galleryPath, 'utf8'))
      : null

    // 统计各游戏数据
    const games = {}
    if (map.games) {
      for (const [gameId, gameData] of Object.entries(map.games)) {
        const zhData = gameData.locales?.zh
        if (!zhData) continue

        let recordCount = 0
        for (const page of Object.values(zhData.pages)) {
          recordCount += Object.keys(page.records || {}).length
        }

        const version = (gameData.game?.versions && gameData.game.versions[0])
          || gameData.game?.latestVersion
          || ''

        games[gameId] = {
          name: gameData.game?.name || gameId,
          version,
          recordCount
        }
      }
    }

    // 图片统计
    const imgMeta = gallery?.meta || {}
    const images = {
      total: imgMeta.imageCount || 0,
      downloaded: imgMeta.downloadedCount || 0,
      placeholder: imgMeta.placeholderCount || 0,
      missing: imgMeta.missingCount || imgMeta.imageCount || 0
    }

    const meta = map.meta || {}

    return {
      initialized: true,
      fetchedAt: meta.fetchedAt || '',
      mode: meta.mode === 'incremental' ? '增量更新' : (meta.mode || ''),
      imageDownloads: meta.imageDownloads !== false,
      games,
      images
    }
  } catch (err) {
    logger?.error('[Atlas][Updater] 读取状态失败:', err.message)
    return { initialized: false }
  }
}
