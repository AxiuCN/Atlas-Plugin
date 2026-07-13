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

/** 并发保护：更新任务是否正在运行 */
let _updateRunning = false

/**
 * 检查图鉴是否已完成初始化
 * @returns {boolean}
 */
export function isInitialized () {
  const gitFile = path.join(BACKEND_DIR, '.git')
  const pkgJson = path.join(BACKEND_DIR, 'package.json')
  const mapJson = path.join(DATA_DIR, 'map.json')
  return fs.existsSync(gitFile) && fs.existsSync(pkgJson) && fs.existsSync(mapJson)
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
 * 全量抓取（带图片），同步执行
 * @param {string[]} games
 * @param {string[]} locales
 * @returns {{ ok: boolean, error?: string, stdout?: string }}
 */
export function runScrape (games = ['gi', 'hsr', 'zzz'], locales = ['zh']) {
  try {
    const gameArg = games.join(',')
    const localeArg = locales.join(',')
    const cmd = `node src/scrape.mjs --game ${gameArg} --locales ${localeArg}`
    logger?.info(`[Atlas][Updater] 执行全量抓取: ${cmd}`)
    const stdout = execSync(cmd, {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      timeout: 1800000 // 30 分钟超时
    })
    logger?.info('[Atlas][Updater] 全量抓取完成')
    return { ok: true, stdout }
  } catch (err) {
    const msg = err.stderr || err.message || String(err)
    logger?.error('[Atlas][Updater] 全量抓取失败:', msg)
    return { ok: false, error: msg }
  }
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
      timeout: 1800000,
      maxBuffer: 10 * 1024 * 1024
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
 * 带并发保护的异步增量抓取
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runIncrementalScrapeAsync () {
  if (_updateRunning) {
    logger?.warn('[Atlas][Updater] 更新任务已在运行中，跳过重复触发')
    return { ok: false, error: '更新任务已在运行中，请稍后再试' }
  }
  _updateRunning = true
  try {
    return await runIncrementalScrape()
  } finally {
    _updateRunning = false
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
