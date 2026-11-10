/**
 * 图鉴数据更新：驱动 Hesperides 采集，管理抓取锁与版本检查
 *
 * **抓取范围（运行时口径）**：nanoka 的全部页 + 玉璃（alioth）的终局频道。
 * 不是为了省流量才这么定——插件的内容页（角色/武器/圣遗物/怪物/物品…）按 nanoka 字段写，
 * 玉璃只在终局提供更完整的期与条目；玉璃的非终局页与 nanoka 同名（`weapon`/`monster`/`item`），
 * 既用不上也是重活。
 *
 * 本模块只做「什么时候抓、抓哪些、失败怎么办、状态怎么读」；
 * 「怎么抓」全部在 Hesperides（`tool/Hesperides/Hesperides`），用其 CLI 执行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { syncSubmodules, submoduleCommit } from './Submodules.js'
import { getPluginConfig } from '../components/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** Hesperides 子模块根目录 */
export const BACKEND_DIR = path.join(pluginRoot, 'tool', 'Hesperides', 'Hesperides')
/** 产物目录（index.json / periods.json / records / imagerefs / images） */
const DATA_DIR = path.join(BACKEND_DIR, 'data')
/** CLI 入口 */
const CLI_PATH = path.join(BACKEND_DIR, 'src', 'cli.mjs')
/** 抓取锁（产物目录内，已 gitignore） */
const LOCK_FILE = path.join(DATA_DIR, '_scraping.lock')

/** 抓取冷却（两次抓取的最小间隔，防抖） */
const SCRAPE_COOLDOWN = 5 * 60 * 1000
/** 单次抓取超时 */
const SCRAPE_TIMEOUT_MS = 2 * 60 * 60 * 1000
/** 锁的过期时间（超时时间 + 余量） */
const LOCK_TTL_MS = SCRAPE_TIMEOUT_MS + 30 * 60 * 1000
/** 版本检查超时 */
const VERSION_CHECK_TIMEOUT_MS = 30 * 1000
/** 子进程输出上限（防止把整份日志读进内存） */
const OUTPUT_LIMIT = 8 * 1024 * 1024
/** nanoka 上游 manifest（版本与「本版本新增」都在这里） */
const NANOKA_MANIFEST_URL = 'https://static.nanoka.cc/manifest.json'
/** 三游戏 */
const GAMES = ['gi', 'hsr', 'zzz']

/* ============================================================
 *  抓取范围
 * ============================================================ */

/**
 * 读子模块的频道表（**必须懒加载**）
 *
 * 不能在模块顶层静态 import：子模块可能还没初始化（全新安装），静态 import 会让**整个插件加载失败**，
 * 而「同步子模块」的代码本身就在本文件里 —— 那样就死锁了，用户连 `#图鉴初始化` 都发不出去。
 * @returns {Promise<{channels: object[], endgameIds: string[]}>} 不可用时返回空表
 */
async function loadChannelTable () {
  try {
    const mod = await import('../tool/Hesperides/Hesperides/src/sources/registry.mjs')
    return {
      channels: Array.isArray(mod.ALL_CHANNELS) ? mod.ALL_CHANNELS : [],
      endgameIds: Array.isArray(mod.ENDGAME_CHANNEL_IDS) ? mod.ENDGAME_CHANNEL_IDS : []
    }
  } catch (err) {
    logger?.warn(`[Atlas] 子模块频道表未就绪（${err?.message || err}），改用产物里的频道清单`)
    return { channels: [], endgameIds: [] }
  }
}

/**
 * 运行时抓取范围：nanoka 全部频道 + 玉璃终局频道
 *
 * 来源两级：子模块 registry（权威）→ 产物 `manifest.json` 的 channels 键（有产物时够用）。
 * @returns {Promise<object[]>}
 */
async function runtimeChannels () {
  const { channels, endgameIds } = await loadChannelTable()
  if (channels.length) {
    return channels.filter((channel) => channel.source === 'nanoka' || (channel.source === 'alioth' && endgameIds.includes(channel.id)))
  }
  const manifest = readManifest()
  return Object.entries(manifest?.channels || {}).map(([id, entry]) => ({ id, ...entry }))
}

/**
 * 运行时抓取的频道 id
 * @param {string[]} [games]
 * @returns {Promise<string[]>}
 */
export async function runtimeChannelIds (games = GAMES) {
  const channels = await runtimeChannels()
  return channels.filter((channel) => games.includes(channel.game)).map((channel) => channel.id)
}

/**
 * 版本差异频道 id（`nanoka/<game>/diff`）
 * @param {string[]} [games]
 * @returns {Promise<string[]>}
 */
export async function diffChannelIds (games = GAMES) {
  const channels = await runtimeChannels()
  return channels.filter((channel) => channel.page === 'diff' && games.includes(channel.game)).map((channel) => channel.id)
}

/* ============================================================
 *  抓取锁
 * ============================================================ */

/** 进程是否还活着 */
function isProcessAlive (pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

/** 读锁文件 */
function readLock () {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 清理残留锁（pid 已死或超过 TTL）
 * @returns {boolean} 是否清理过
 */
function cleanupStaleLock () {
  const data = readLock()
  if (!data) {
    if (fs.existsSync(LOCK_FILE)) {
      try { fs.unlinkSync(LOCK_FILE) } catch { /* ignore */ }
      return true
    }
    return false
  }
  // time 兼容毫秒数与 ISO 字符串（套件与手工排查两种写法都可能出现）
  const written = typeof data.time === 'number' ? data.time : (Date.parse(data.time) || 0)
  const stale = !isProcessAlive(Number(data.pid)) || Date.now() - written > LOCK_TTL_MS
  if (!stale) return false
  try { fs.unlinkSync(LOCK_FILE) } catch { /* ignore */ }
  return true
}

/**
 * 原子创建抓取锁（`wx`，并发下只有一个能成功）
 * @returns {boolean}
 */
function acquireLock () {
  cleanupStaleLock()
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const fd = fs.openSync(LOCK_FILE, 'wx')
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: Date.now() }))
    fs.closeSync(fd)
    return true
  } catch {
    return false
  }
}

/** 释放锁 */
function releaseLock () {
  try { fs.unlinkSync(LOCK_FILE) } catch { /* ignore */ }
}

/** 当前是否有抓取在跑 */
export function isScraping () {
  const data = readLock()
  if (!data) return false
  // time 兼容毫秒数与 ISO 字符串（与 cleanupStaleLock 同一口径；只认数字会让 ISO 锁恒判「没在跑」）
  const written = typeof data.time === 'number' ? data.time : (Date.parse(data.time) || 0)
  return isProcessAlive(Number(data.pid)) && Date.now() - written <= LOCK_TTL_MS
}

/* ============================================================
 *  子进程
 * ============================================================ */

/**
 * 运行 Hesperides CLI
 * @param {string[]} args
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.onLine] - 每行输出回调（用于日志/进度）
 * @returns {Promise<{ok: boolean, code: number|null, stdout: string, stderr: string, error?: string, timedOut?: boolean}>}
 */
function runCli (args, options = {}) {
  const { timeoutMs = SCRAPE_TIMEOUT_MS, onLine } = options
  return new Promise((resolve) => {
    if (!fs.existsSync(CLI_PATH)) {
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: `Hesperides CLI 不存在：${CLI_PATH}` })
      return
    }
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: BACKEND_DIR,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const append = (target, chunk) => {
      const text = chunk.toString()
      if (target === 'out') {
        if (stdout.length < OUTPUT_LIMIT) stdout += text
      } else if (stderr.length < OUTPUT_LIMIT) {
        stderr += text
      }
      if (!onLine) return
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) onLine(trimmed)
      }
    }

    child.stdout?.on('data', (chunk) => append('out', chunk))
    child.stderr?.on('data', (chunk) => append('err', chunk))

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)

    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, error: error || (timedOut ? `超时（${Math.round(timeoutMs / 1000)}s）` : ''), timedOut })
    }

    child.on('error', (err) => finish(null, err.message))
    child.on('close', (code) => finish(code))
  })
}

/** 结束整个进程树（Windows 需要 taskkill，否则只杀父进程） */
function killTree (pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
  }
}

/* ============================================================
 *  抓取
 * ============================================================ */

/**
 * 是否在抓取后清理图片重复（默认开启）
 *
 * 默认开是因为「不清理也不影响功能」——用户不会为了省 150 MB 主动去跑 CLI 命令，
 * 所以必须让默认行为是对的。清理只删同资源的多余格式并修正引用，无重复时引擎内部短路。
 * @returns {boolean}
 */
function imagePruneEnabled () {
  try {
    const cfg = getPluginConfig()
    if (cfg?.imagePrune?.enabled === false) return false
  } catch {
    // 配置读取失败按开启处理（默认值）
  }
  return true
}

/**
 * 组装抓取参数
 * @param {object} options
 * @param {'full'|'incremental'} [options.mode]
 * @param {string[]} [options.games]
 * @param {number} [options.concurrency]
 * @param {boolean} [options.pruneImages] - 是否在抓完后清理同资源多格式重复（默认按配置）
 * @returns {string[]}
 */
async function scrapeArgs ({ mode = 'incremental', games = GAMES, concurrency = 4, pruneImages } = {}) {
  const shouldPrune = pruneImages === undefined ? imagePruneEnabled() : pruneImages !== false
  const channels = await runtimeChannelIds(games)
  const args = [
    '--channels', channels.join(','),
    '--mode', mode === 'full' ? 'full' : 'incremental',
    '--with-details',
    '--images',
    '--concurrency', String(concurrency)
  ]
  // 抓完顺带清理同资源多格式重复（复用本轮抓图的扫描结果，无重复时引擎内部短路）。
  // 只删多余格式并同步修正引用，不影响已抓数据；可用 config.yaml → imagePrune.enabled 关掉。
  if (shouldPrune) args.push('--prune-images', '--yes')
  return args
}

/**
 * 同步抓取（调用方自己处理锁）
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, mode: string, code: number|null, error?: string, timedOut?: boolean}>}
 */
export async function runScrape (options = {}) {
  const { mode = 'full', timeoutMs = SCRAPE_TIMEOUT_MS, onLine } = options
  const result = await runCli(await scrapeArgs({ mode, games: options.games, concurrency: options.concurrency }), { timeoutMs, onLine })
  return { ok: result.ok, mode, code: result.code, error: result.error, timedOut: result.timedOut }
}

/**
 * 增量抓取（调用方自己处理锁）
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, mode: string, code: number|null, error?: string, timedOut?: boolean}>}
 */
export async function runIncrementalScrape (options = {}) {
  return runScrape({ ...options, mode: 'incremental' })
}

/**
 * 后台抓取（带锁；已有抓取在跑时直接拒绝）
 * @param {object} [options]
 * @param {'full'|'incremental'} [options.mode]
 * @param {number} [options.timeoutMs]
 * @param {string[]} [options.games]
 * @param {Function} [options.onLine]
 * @returns {Promise<{ok: boolean, mode: string, error?: string, code?: number|null}>}
 */
export async function runScrapeAsync (options = {}) {
  const { mode = 'full', timeoutMs = SCRAPE_TIMEOUT_MS, games = GAMES, onLine } = options
  if (!acquireLock()) {
    // 锁被活进程占着不是失败：调用方据此回「已有任务在跑」，不要走失败通报
    const busy = isScraping()
    return { ok: false, mode, busy, error: busy ? '已有抓取任务在运行' : '无法创建抓取锁' }
  }
  try {
    const result = await runCli(await scrapeArgs({ mode, games }), { timeoutMs, onLine })
    return { ok: result.ok, mode, code: result.code, error: result.error, timedOut: result.timedOut }
  } finally {
    releaseLock()
  }
}

/**
 * 后台增量抓取
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, mode: string, error?: string}>}
 */
export async function runIncrementalScrapeAsync (options = {}) {
  return runScrapeAsync({ ...options, mode: 'incremental' })
}

/**
 * 抓版本差异（`nanoka/<game>/diff`），失败只告警
 * @param {string[]} [games]
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function runDiffScrape (games = GAMES) {
  const channels = await diffChannelIds(games)
  if (!channels.length) return { ok: true }
  if (isScraping()) return { ok: false, busy: true, error: '已有抓取任务在运行' }
  if (!acquireLock()) return { ok: false, busy: isScraping(), error: '无法创建抓取锁' }
  try {
    const result = await runCli(['--channels', channels.join(','), '--mode', 'incremental'], { timeoutMs: 5 * 60 * 1000 })
    if (!result.ok) logger?.warn(`[Atlas][Updater] 版本差异抓取失败：${result.error || result.code}`)
    return { ok: result.ok, error: result.error }
  } finally {
    releaseLock()
  }
}

/* ============================================================
 *  版本
 * ============================================================ */

/** 读本地 manifest 的频道片段 */
function readManifest () {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'))
  } catch {
    return { channels: {} }
  }
}

/**
 * 本地版本（每个游戏取 nanoka `character` 频道的版本）
 * @returns {{ready: boolean, versions: object}}
 */
export function readLocalVersions () {
  const manifest = readManifest()
  const versions = {}
  let ready = true
  for (const game of GAMES) {
    const entry = Object.values(manifest.channels || {}).find(
      (channel) => channel.source === 'nanoka' && channel.game === game && channel.page === 'character'
    )
    versions[game] = { latest: entry?.version || '', records: entry?.records || 0 }
    if (!entry?.version) ready = false
  }
  return { ready, versions }
}

/**
 * 远端版本（nanoka 根 manifest）
 * @param {string[]} [games]
 * @returns {Promise<{ok: boolean, versions?: object, reason?: string}>}
 */
export async function checkRemoteVersions (games = GAMES) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(NANOKA_MANIFEST_URL, { signal: controller.signal })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const data = await res.json()
    const versions = {}
    for (const game of games) {
      versions[game] = { latest: data?.[game]?.latest || '', live: data?.[game]?.live || '' }
    }
    return { ok: true, versions }
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? '请求超时' : String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 比较本地与远端版本
 * @param {object} local - readLocalVersions().versions
 * @param {object} remote - checkRemoteVersions().versions
 * @returns {{changed: boolean, changes: Array<{game: string, local: object, remote: object}>}}
 */
export function compareAtlasVersions (local = {}, remote = {}) {
  const changes = []
  for (const game of Object.keys(remote)) {
    const localVer = local?.[game]?.latest || ''
    const remoteVer = remote?.[game]?.latest || ''
    if (!remoteVer) continue
    if (localVer !== remoteVer) changes.push({ game, local: local[game] || {}, remote: remote[game] })
  }
  return { changed: changes.length > 0, changes }
}

/* ============================================================
 *  状态
 * ============================================================ */

/**
 * 读产物里的索引
 * @returns {object|null}
 */
function readIndex () {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 数据状态（供 `#图鉴状态` 与更新通知使用）
 * @returns {{games: object, images: {total: number, downloaded: number, placeholder: number}, pages: number}}
 */
export function getDataStatus () {
  const index = readIndex()
  const games = {}
  let pages = 0
  for (const game of GAMES) {
    const pagesOfGame = index?.games?.[game]?.sources?.nanoka?.pages || {}
    let recordCount = 0
    for (const [page, value] of Object.entries(pagesOfGame)) {
      recordCount += value?.records || 0
      pages += 1
      void page
    }
    games[game] = {
      name: { gi: '原神', hsr: '星铁', zzz: '绝区零' }[game],
      version: Object.values(index?.games?.[game]?.channels || {}).find((channel) => channel.page === 'character')?.version || '',
      recordCount
    }
  }

  // 图片小计：读一页一份的引用文件（几十个文件，按需统计）
  let total = 0
  let downloaded = 0
  let placeholder = 0
  try {
    for (const game of fs.readdirSync(path.join(DATA_DIR, 'imagerefs'))) {
      const gameDir = path.join(DATA_DIR, 'imagerefs', game)
      for (const source of fs.readdirSync(gameDir)) {
        const sourceDir = path.join(gameDir, source)
        for (const file of fs.readdirSync(sourceDir)) {
          if (!file.endsWith('.json')) continue
          const data = JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'))
          for (const list of Object.values(data.records || {})) {
            for (const ref of list) {
              total += 1
              if (ref.placeholder) placeholder += 1
              else if (ref.status === 'downloaded' && ref.localPath) downloaded += 1
            }
          }
        }
      }
    }
  } catch {
    // 还没有图片产物
  }
  // 状态页需要：是否已初始化 + 最近一次抓取时间（取各频道 fetchedAt 的最大值）
  let fetchedAt = ''
  for (const game of Object.values(index?.games || {})) {
    for (const channel of Object.values(game?.channels || {})) {
      if (channel.fetchedAt && channel.fetchedAt > fetchedAt) fetchedAt = channel.fetchedAt
    }
  }
  return { games, images: { total, downloaded, placeholder }, pages, initialized: isInitialized(), fetchedAt }
}

/**
 * 产物是否已初始化（`index.json` 存在）
 * @returns {boolean}
 */
export function isInitialized () {
  return fs.existsSync(path.join(DATA_DIR, 'index.json'))
}

/**
 * 还缺哪些游戏的核心数据（该游戏 nanoka 角色页一条记录都没有）
 *
 * 「有数据可用」与「整份数据完整」是两码事：抓完之后用它区分「缺几条」和「缺一整个游戏」。
 * @param {object|null} [index] - 索引对象；缺省读产物（回归可直接注入合成索引）
 * @returns {string[]} 缺数据的 gameId 列表
 */
export function missingGames (index = readIndex()) {
  return GAMES.filter((game) => !((index?.games?.[game]?.sources?.nanoka?.pages?.character?.records || 0) > 0))
}

/**
 * 数据是否完整（三游戏都有 nanoka 角色页）
 * @returns {boolean}
 */
export function isDataIntact () {
  return missingGames().length === 0
}

/* ============================================================
 *  更新编排
 * ============================================================ */

/** 简单休眠 */
function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 检查并更新：版本比对 → 增量抓取（失败可重试 / 降级全量）
 * @param {object} [options]
 * @param {string[]} [options.games]
 * @param {number} [options.retries]
 * @param {number} [options.retryDelayMs]
 * @param {boolean} [options.fallbackToFull]
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.onLine]
 * @returns {Promise<{ok: boolean, skipped?: boolean, mode?: string, error?: string, reason?: string, check?: object}>}
 */
export async function checkAndUpdate (options = {}) {
  const {
    games = GAMES,
    retries = 1,
    retryDelayMs = 30000,
    fallbackToFull = true,
    timeoutMs = SCRAPE_TIMEOUT_MS,
    onLine
  } = options

  // 已有任务在跑：立即返回，不重试也不降级——重试只会白等，降级全量更会去抢同一把锁
  if (isScraping()) return { ok: false, busy: true, error: '已有抓取任务在运行' }

  const local = readLocalVersions()
  const remote = await checkRemoteVersions(games)
  if (!remote.ok) return { ok: false, reason: remote.reason }
  const diff = compareAtlasVersions(local.versions, remote.versions)
  if (!diff.changed) return { ok: true, skipped: true, check: { diff } }

  let result = await runScrapeAsync({ mode: 'incremental', games, timeoutMs, onLine })
  // 锁被占用 / 锁建不出来都不是「这次抓失败」：重试只会白等，降级全量还会去抢同一把锁
  const lockBlocked = (ret) => Boolean(ret?.busy) || /抓取锁/.test(String(ret?.error || ''))
  for (let attempt = 0; !result.ok && !lockBlocked(result) && attempt < retries; attempt++) {
    logger?.warn(`[Atlas][Updater] 增量抓取失败（${result.error || result.code}），${Math.round(retryDelayMs / 1000)}s 后重试`)
    await sleep(retryDelayMs)
    result = await runScrapeAsync({ mode: 'incremental', games, timeoutMs, onLine })
  }
  let mode = result.mode
  if (!result.ok && !lockBlocked(result) && fallbackToFull) {
    logger?.warn('[Atlas][Updater] 增量失败，降级全量')
    result = await runScrapeAsync({ mode: 'full', games, timeoutMs, onLine })
    mode = result.ok ? 'full_fallback' : result.mode
  }

  return { ok: result.ok, busy: result.busy, mode, error: result.error, check: { diff } }
}

/**
 * 补抓「本地缺数据」的游戏（全量）
 * @param {string[]} [games]
 * @returns {Promise<{ok: boolean, missing: string[], error?: string}>}
 */
export async function repairMissingGames (games = GAMES) {
  const index = readIndex()
  const missing = games.filter((game) => (index?.games?.[game]?.sources?.nanoka?.pages?.character?.records || 0) === 0)
  if (!missing.length) return { ok: true, missing }
  const result = await runScrapeAsync({ mode: 'full', games: missing })
  return { ok: result.ok, missing, busy: result.busy, error: result.error }
}

/* ============================================================
 *  子模块
 * ============================================================ */

/**
 * 初始化子模块（`git submodule update --init`）
 *
 * 与同步是同一条 git 命令（`--init` 幂等），实现都在 `model/Submodules.js`；
 * 这里只保留 `#图鉴初始化` 侧的历史入口名。
 * @returns {Promise<{ok: boolean, skipped?: boolean, error?: string}>}
 */
export async function initSubmodule () {
  return syncSubmodule()
}

/**
 * 同步子模块（拉取最新提交；提交没变或没登记时回 skipped）
 *
 * 「有没有登记在 .gitmodules」由 `Submodules.syncSubmodules()` 自己校验，这里不重复判断。
 * @returns {Promise<{ok: boolean, skipped?: boolean, updated?: string[], error?: string}>}
 */
export async function syncSubmodule () {
  return syncSubmodules()
}

/** 供外部排查：子模块当前 HEAD */
export async function currentSubmoduleCommit () {
  return submoduleCommit('tool/Hesperides/Hesperides')
}

