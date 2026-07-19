import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawn } from 'node:child_process'
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

/** 抓取超时（2小时，适配 5Mbps 带宽 + 含图片） */
const SCRAPE_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** 版本检查超时 */
const VERSION_CHECK_TIMEOUT_MS = 30 * 1000

/** 最大输出缓冲区（sdtout/stderr） */
const OUTPUT_LIMIT = 50 * 1024 * 1024

/* ============================================================
 *  锁文件管理
 * ============================================================ */

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

/* ============================================================
 *  spawn 封装（永不 reject，错误通过 { ok: false } 返回）
 * ============================================================ */

/**
 * 运行子进程，捕获所有错误，永不 reject
 * @param {string} command - 可执行文件
 * @param {string[]} args - 参数数组
 * @param {object} options
 * @param {string} options.cwd - 工作目录
 * @param {number} [options.timeoutMs] - 超时 ms
 * @param {number} [options.outputLimit] - stdout/stderr 最大长度
 * @param {string} [options.label] - 日志标签（如"全量抓取"）
 * @returns {Promise<{ ok: boolean, code?: number, stdout: string, stderr: string,
 *                     reason?: string, timedOut?: boolean }>}
 */
function runSpawn (command, args, options = {}) {
  const {
    cwd = BACKEND_DIR,
    timeoutMs = SCRAPE_TIMEOUT_MS,
    outputLimit = OUTPUT_LIMIT,
    label = 'spawn'
  } = options

  return new Promise((resolve) => {
    logger?.info(`[Atlas][Updater] ${label}: ${command} ${args.join(' ')}`)

    const child = spawn(command, args, {
      cwd,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // 若 SIGTERM 未生效，强制 kill
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
      }, 10000)
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout = _cap(stdout + chunk.toString(), outputLimit)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = _cap(stderr + chunk.toString(), outputLimit)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      logger?.error(`[Atlas][Updater] ${label} 进程错误:`, err.message)
      resolve({
        ok: false,
        reason: err.message,
        stdout,
        stderr
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        logger?.error(`[Atlas][Updater] ${label} 超时 (${timeoutMs}ms)`)
        resolve({
          ok: false,
          code,
          timedOut: true,
          reason: 'timeout',
          stdout,
          stderr
        })
      } else if (code === 0) {
        logger?.info(`[Atlas][Updater] ${label} 完成`)
        resolve({ ok: true, code, stdout, stderr })
      } else {
        const msg = stderr || `退出码 ${code}`
        logger?.error(`[Atlas][Updater] ${label} 失败:`, msg)
        resolve({
          ok: false,
          code,
          reason: 'non_zero_exit',
          stdout,
          stderr
        })
      }
    })
  })
}

function _cap (value, limit) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n...[truncated]`
}

/* ============================================================
 *  版本检查
 * ============================================================ */

/**
 * 获取远端可用版本（运行 --list-versions）
 * @param {string[]} [games] — 限定游戏，默认全部
 * @returns {Promise<{ ok: boolean, versions?: object, reason?: string }>}
 */
export async function checkRemoteVersions (games = ['gi', 'hsr', 'zzz']) {
  const result = await runSpawn('node', ['src/scrape.mjs', '--list-versions', '--game', games.join(',')], {
    cwd: BACKEND_DIR,
    timeoutMs: VERSION_CHECK_TIMEOUT_MS,
    label: '版本检查'
  })

  if (!result.ok) {
    return { ok: false, reason: result.reason || 'version_check_failed' }
  }

  const allVersions = _parseVersionOutput(result.stdout)
  if (!allVersions || Object.keys(allVersions).length === 0) {
    return { ok: false, reason: 'version_parse_failed', versions: {} }
  }

  // 滤掉不需要的游戏（如 nte），只保留请求的
  const versions = {}
  for (const g of games) {
    if (allVersions[g]) versions[g] = allVersions[g]
  }

  return { ok: true, versions }
}

/**
 * 解析 --list-versions 的 JSON 输出
 */
function _parseVersionOutput (stdout = '') {
  const text = String(stdout || '').trim()
  if (!text) return null

  // 尝试提取 JSON 块
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      // 标准化：{ gi: {latest, live}, hsr: {...}, ... }
      const versions = {}
      for (const [gameId, value] of Object.entries(parsed)) {
        versions[gameId] = {
          latest: String(value?.latest || ''),
          live: String(value?.live || '')
        }
      }
      return versions
    } catch {
      // JSON 解析失败 → 尝试逐行匹配
    }
  }

  // 回退：逐行解析 gi: 6.7.52 格式
  const versions = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/\b(gi|hsr|zzz|nte)\b\s*[:=]\s*([^\s,]+)/i)
    if (match) versions[match[1].toLowerCase()] = { latest: match[2], live: '' }
  }
  return Object.keys(versions).length > 0 ? versions : null
}

/**
 * 读取本地 map.json 中的版本信息
 * @returns {{ ready: boolean, fetchedAt?: string, versions: object }}
 */
export function readLocalVersions () {
  const mapPath = path.join(DATA_DIR, 'map.json')
  if (!fs.existsSync(mapPath)) {
    return { ready: false, versions: {} }
  }

  try {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
    const versions = {}
    if (map.games) {
      for (const [gameId, gameData] of Object.entries(map.games)) {
        versions[gameId] = {
          latest: String(gameData?.game?.latestVersion || ''),
          live: String(gameData?.game?.liveVersion || '')
        }
      }
    }

    return {
      ready: !!map.meta?.fetchedAt,
      fetchedAt: map.meta?.fetchedAt || '',
      versions
    }
  } catch {
    return { ready: false, versions: {} }
  }
}

/**
 * 比较版本差异
 * @param {object} local — readLocalVersions().versions
 * @param {object} remote — checkRemoteVersions().versions
 * @returns {{ changed: boolean, changes: Array<{game: string, local: object, remote: object}> }}
 */
export function compareAtlasVersions (local = {}, remote = {}) {
  const changes = []
  const games = new Set([...Object.keys(local), ...Object.keys(remote)])
  for (const game of games) {
    const lv = local[game] || {}
    const rv = remote[game] || {}
    if (!rv.latest && !rv.live) continue
    if ((rv.latest || '') !== (lv.latest || '') || (rv.live || '') !== (lv.live || '')) {
      changes.push({ game, local: lv, remote: rv })
    }
  }
  return { changed: changes.length > 0, changes }
}

/* ============================================================
 *  抓取命令（底层 spawn 封装）
 * ============================================================ */

/**
 * 全量抓取
 * @param {string[]} games
 * @param {string[]} locales
 * @returns {Promise<{ ok: boolean, error?: string, stdout?: string }>}
 */
export function runScrape (games = ['gi', 'hsr', 'zzz'], locales = ['zh']) {
  const gameArg = games.join(',')
  const localeArg = locales.join(',')
  return runSpawn('node', [
    'src/scrape.mjs',
    '--game', gameArg,
    '--locales', localeArg
  ], {
    cwd: BACKEND_DIR,
    timeoutMs: SCRAPE_TIMEOUT_MS,
    label: '全量抓取'
  }).then(r => ({
    ok: r.ok,
    error: r.ok ? undefined : (r.stderr || r.reason),
    stdout: r.stdout
  }))
}

/**
 * 增量抓取
 * @param {string[]} games
 * @param {string[]} locales
 * @returns {Promise<{ ok: boolean, error?: string, stdout?: string }>}
 */
export function runIncrementalScrape (games = ['gi', 'hsr', 'zzz'], locales = ['zh']) {
  const gameArg = games.join(',')
  const localeArg = locales.join(',')
  return runSpawn('node', [
    'src/scrape.mjs',
    '--game', gameArg,
    '--locales', localeArg,
    '--mode', 'incremental'
  ], {
    cwd: BACKEND_DIR,
    timeoutMs: SCRAPE_TIMEOUT_MS,
    label: '增量抓取'
  }).then(r => ({
    ok: r.ok,
    error: r.ok ? undefined : (r.stderr || r.reason),
    stdout: r.stdout
  }))
}

/* ============================================================
 *  带并发保护的异步包装（保留旧接口兼容）
 * ============================================================ */

/**
 * 带并发保护的全量抓取（用于初始化）
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runScrapeAsync () {
  if (_updateRunning) {
    logger?.warn('[Atlas][Updater] 抓取任务已在运行中，跳过重复触发')
    return { ok: false, error: '抓取任务已在运行中，请稍后再试' }
  }

  if (!_acquireLock()) {
    return { ok: false, error: '抓取任务已在运行中（锁文件检测），请稍后再试' }
  }

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

  if (!_acquireLock()) {
    return { ok: false, error: '更新任务已在运行中（锁文件检测），请稍后再试' }
  }

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

/* ============================================================
 *  checkAndUpdate — 智能更新：版本检查 → 增量 → 重试 → 全量兜底
 * ============================================================ */

/**
 * 检查版本并执行更新
 *
 * 流程：
 * 1. 读本地版本 → 无数据/不完整 → 全量抓取
 * 2. 查远端版本 → 失败 → 返回错误
 * 3. 比较版本 → 没变化 → 跳过
 * 4. 版本有变化 → 增量抓取（含图片）
 * 5. 增量失败 → 等 retryDelayMs → 重试
 * 6. 重试仍失败 → fallbackToFull 时降级全量
 *
 * @param {object} [options]
 * @param {string[]} [options.games] — 限定游戏，默认全部
 * @param {string[]} [options.locales] — 语言，默认 ['zh']
 * @param {number} [options.retries] — 失败重试次数，默认 1
 * @param {number} [options.retryDelayMs] — 重试等待 ms，默认 30000
 * @param {boolean} [options.fallbackToFull] — 增量失败后降级全量，默认 true
 * @returns {Promise<{ ok: boolean, skipped?: boolean, mode?: string,
 *                     reason?: string, error?: string, check?: object }>}
 */
export async function checkAndUpdate (options = {}) {
  const {
    games = ['gi', 'hsr', 'zzz'],
    locales = ['zh'],
    retries = 1,
    retryDelayMs = 30000,
    fallbackToFull = true
  } = options

  if (!_acquireLock()) {
    return { ok: false, reason: 'lock_busy', error: '更新任务已在运行中（锁文件检测），请稍后再试' }
  }

  if (_lastScrapeTime > 0) {
    const elapsed = Date.now() - _lastScrapeTime
    if (elapsed < SCRAPE_COOLDOWN) {
      const remainMin = Math.ceil((SCRAPE_COOLDOWN - elapsed) / 60000)
      _releaseLock()
      return { ok: false, reason: 'cooldown', error: `抓取冷却中，剩余约 ${remainMin} 分钟` }
    }
  }

  _updateRunning = true
  try {
    // ── 步骤 1：读本地版本 ──
    const local = readLocalVersions()
    if (!local.ready) {
      logger?.info('[Atlas][Updater] 本地数据不完整，自动全量抓取')
      const result = await runScrape(games, locales)
      if (result.ok) _lastScrapeTime = Date.now()
      return {
        ...result,
        mode: 'full',
        check: { reason: 'local_data_missing', local }
      }
    }

    // ── 步骤 2：查远端版本 ──
    const remote = await checkRemoteVersions(games)
    if (!remote.ok) {
      _releaseLock()
      return {
        ok: false,
        reason: 'version_check_failed',
        error: remote.reason || '远端版本检查失败，请检查网络后重试',
        check: { local, remote }
      }
    }

    // ── 步骤 3：比较版本 ──
    const diff = compareAtlasVersions(local.versions, remote.versions)
    if (!diff.changed) {
      logger?.info('[Atlas][Updater] 版本未变化，跳过抓取')
      _releaseLock()
      return {
        ok: true,
        skipped: true,
        reason: 'versions_unchanged',
        check: { local, remote, diff }
      }
    }

    const changedGames = diff.changes.map(c => c.game)
    logger?.info(`[Atlas][Updater] 检测到版本变化: ${changedGames.join(', ')}`)

    // ── 步骤 4：增量抓取（含重试） ──
    let incResult = await runIncrementalScrape(games, locales)

    for (let i = 0; i < retries && !incResult.ok; i++) {
      logger?.warn(`[Atlas][Updater] 增量抓取失败，${(retryDelayMs / 1000)}s 后重试 (${i + 1}/${retries})`)
      await _sleep(retryDelayMs)
      incResult = await runIncrementalScrape(games, locales)
    }

    if (incResult.ok) {
      _lastScrapeTime = Date.now()
      _releaseLock()
      return {
        ...incResult,
        mode: 'incremental',
        check: { local, remote, diff }
      }
    }

    // ── 步骤 5：增量失败 → 降级全量 ──
    if (fallbackToFull) {
      logger?.warn('[Atlas][Updater] 增量抓取失败，降级全量抓取')
      const fullResult = await runScrape(games, locales)
      if (fullResult.ok) _lastScrapeTime = Date.now()
      _releaseLock()
      return {
        ...fullResult,
        mode: 'full_fallback',
        check: { local, remote, diff }
      }
    }

    _releaseLock()
    return {
      ok: false,
      reason: 'incremental_failed',
      error: incResult.error || '增量抓取失败',
      check: { local, remote, diff }
    }
  } catch (err) {
    logger?.error('[Atlas][Updater] checkAndUpdate 异常:', err)
    _releaseLock()
    return { ok: false, reason: 'exception', error: err.message }
  } finally {
    _updateRunning = false
  }
}

function _sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/* ============================================================
 *  环境检查 / 初始化
 * ============================================================ */

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
    return !!map.meta?.fetchedAt
  } catch {
    return false
  }
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

/* ============================================================
 *  状态查询
 * ============================================================ */

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
      total: imgMeta.imageCount ?? 0,
      downloaded: imgMeta.downloadedCount ?? 0,
      placeholder: imgMeta.placeholderCount ?? 0,
      missing: imgMeta.missingCount ?? imgMeta.imageCount ?? 0
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
