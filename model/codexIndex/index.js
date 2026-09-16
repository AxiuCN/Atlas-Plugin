/**
 * 角色攻略数据索引（Character-Codex-Data）
 *
 * 攻略仓库以 git clone 方式落在 tool/Character-Codex-Data/Character-Codex-Data/，
 * 由 `#图鉴初始化` / `#图鉴更新` / 每日定时任务同步（见 model/AtlasUpdater.js 的 syncCodexRepo，
 * 调用点是各入口的独立步骤，不挂在图鉴抓取链路的末尾）。
 *
 * **本模块是攻略数据的唯一入口**：页面编排只调用这里，不直接读文件——
 * 攻略仓库的目录结构、字段名、多语言与图片路径解析全部收敛在本文件，
 * 后续适配（含仓库结构变更）只需改这里，不动 apps / modules 层。
 *
 * 数据格式（JSON 优先，HTML 兼容旧克隆）：
 * - 仓库根目录存在 `data/` 时只扫它（约定：`data/<gameId>/<角色名>.json`，解析见 ./parse.js）；
 *   没有 `data/` 时扫整个仓库的 *.json 与 *.html，其中 JSON 存在就不再解析 HTML
 * - 卡片内的行内强调、段落配图等由 parse.js 归一，本层只负责索引与匹配
 *
 * 索引策略（惰性构建 + 进程内缓存）：
 * - 首次取用时扫描并解析，缓存以「文件清单 + 大小 + mtime」为签名，
 *   `#图鉴更新` 拉取后下次调用自动重建，无需重启 bot
 * - 「图鉴条目名 → 攻略卡片」先用别名变体直配；未命中再按攻略卡片名反查图鉴条目
 *   （社区简称、主角族形态名等全靠这一步兜底），反查结果按游戏缓存
 * - 仓库按 gi/hsr/zzz（或中文游戏名）分目录时按目录归属过滤，未分目录的卡片对所有游戏生效；
 *   命中不了图鉴角色即跳过并告警，不做「最像」的模糊兜底
 */
import fs from 'node:fs'
import path from 'node:path'
import { CODEX_DIR } from '../AtlasUpdater.js'
import { search } from '../AtlasService.js'
import { loadAliasMap, normalizeForMatch, buildKeywordVariants } from '../AliasLoader.js'
import { GAME_NAMES } from '../../components/constants.js'
import { parseGuideJson, parseGuideHtml } from './parse.js'

/** 扫描时跳过的子目录 */
const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** 路径提示词 → 游戏（仓库按游戏分目录时生效；未命中返回空串，表示该文件对任意游戏生效） */
const GAME_PATH_HINTS = [
  ['gi', ['gi', '原神', 'genshin']],
  ['hsr', ['hsr', '星铁', '星穹铁道', 'starrail']],
  ['zzz', ['zzz', '绝区零', 'zenless']]
]

/** 索引缓存：{ sig, files, cards, byKey, resolved, warned } */
let cache = null

/** 攻略仓库是否已拉取（以 .git 目录为准） */
export function isCodexReady () {
  return fs.existsSync(path.join(CODEX_DIR, '.git'))
}

/**
 * 列出攻略仓库根目录条目（不含 .git），供调试与仓库结构探查
 * @returns {Array<{name: string, isDirectory: boolean}>} 仓库未拉取时返回空数组
 */
export function listCodexEntries () {
  if (!isCodexReady()) return []
  try {
    return fs.readdirSync(CODEX_DIR, { withFileTypes: true })
      .filter(e => e.name !== '.git')
      .map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
  } catch {
    return []
  }
}

/**
 * 丢弃索引缓存（下次取用时重建；`#图鉴更新` 后由签名自动触发，此接口供调试与手动刷新）
 */
export function reloadCodexIndex () {
  cache = null
}

/**
 * 扫描攻略数据文件
 *
 * 优先只扫 `<仓库>/data/`（约定布局）；没有该目录时扫整个仓库。
 * `_` 开头的文件按约定视为元数据，跳过。
 * @returns {{json: Array, html: Array}} 数据文件与旧格式页面文件
 */
function scanGuideFiles () {
  const dataRoot = path.join(CODEX_DIR, 'data')
  const scanRoot = fs.existsSync(dataRoot) ? dataRoot : CODEX_DIR
  const out = { json: [], html: [] }

  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full)
        continue
      }
      const ext = path.extname(entry.name).toLowerCase()
      const bucket = ext === '.json' ? out.json : (ext === '.html' || ext === '.htm' ? out.html : null)
      if (!bucket) continue
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      bucket.push({
        rel: path.relative(CODEX_DIR, full).split(path.sep).join('/'),
        full,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      })
    }
  }

  walk(scanRoot)
  out.json.sort((a, b) => a.rel.localeCompare(b.rel))
  out.html.sort((a, b) => a.rel.localeCompare(b.rel))
  return out
}

/**
 * 文件清单签名（拉取/改动后与缓存不一致即重建）
 * @param {Array} json
 * @param {Array} html
 * @returns {string}
 */
function fileSignature (json, html) {
  return [...json, ...html].map(f => `${f.rel}|${f.size}|${Math.round(f.mtimeMs)}`).join(';')
}

/**
 * 由文件相对路径推断所属游戏（仓库按 gi/hsr/zzz 或中文游戏名分目录时生效）
 * @param {string} rel
 * @returns {string} 'gi' | 'hsr' | 'zzz' | ''（空串=通用）
 */
function gameFromRelPath (rel) {
  const dirs = String(rel || '').split('/').slice(0, -1).map(s => s.toLowerCase())
  for (const [gameId, hints] of GAME_PATH_HINTS) {
    if (dirs.some(d => hints.includes(d))) return gameId
  }
  return ''
}

/**
 * 读取并解析一个 JSON 数据文件
 * @param {object} file - scanGuideFiles() 条目
 * @returns {Array} 卡片数组（解析失败或非攻略数据返回空数组）
 */
function readJsonCards (file) {
  let data
  try {
    data = JSON.parse(fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, ''))
  } catch (err) {
    logger?.warn(`[Atlas] 攻略数据解析失败 ${file.rel}: ${err.message}`)
    return []
  }
  // 单文件也可以放数组，便于把一组角色写在同一个文件里
  const list = Array.isArray(data) ? data : [data]
  const cards = []
  for (const item of list) {
    const card = parseGuideJson(item, {
      fileDir: path.dirname(file.full),
      fileName: path.basename(file.rel, path.extname(file.rel))
    })
    if (card) cards.push(card)
  }
  return cards
}

/**
 * 读取并解析一个旧格式 HTML 页面
 * @param {object} file - scanGuideFiles() 条目
 * @returns {{docTitle: string, cards: Array}}
 */
function readHtmlCards (file) {
  try {
    return parseGuideHtml(fs.readFileSync(file.full, 'utf8'), file.full)
  } catch (err) {
    logger?.warn(`[Atlas] 攻略页面解析失败 ${file.rel}: ${err.message}`)
    return { docTitle: '', cards: [] }
  }
}

/**
 * 构建（或复用）攻略索引
 * @returns {{files: object, cards: Array, byKey: Map<string, Array>, resolved: Map, warned: Set}}
 */
function buildIndex () {
  const files = scanGuideFiles()
  const sig = fileSignature(files.json, files.html)
  if (cache && cache.sig === sig) return cache

  const cards = []
  const push = (card, file, game, docTitle) => {
    // 无标签、无高亮行、无正文的条目视为空壳（如仓库里的 package.json），直接跳过
    if (!card.tags.length && !card.desc && !card.sections.length) return
    cards.push({
      ...card,
      game: game || card.game || '',
      source: file.rel,
      docTitle: card.docTitle || docTitle || ''
    })
  }

  // JSON 优先：存在 JSON 数据就不再解析旧 HTML 页面
  if (files.json.length) {
    for (const file of files.json) {
      const game = gameFromRelPath(file.rel)
      for (const card of readJsonCards(file)) push(card, file, game, '')
    }
  } else {
    for (const file of files.html) {
      const game = gameFromRelPath(file.rel)
      const { docTitle, cards: parsed } = readHtmlCards(file)
      for (const card of parsed) push(card, file, game, docTitle)
    }
  }

  const byKey = new Map()
  for (const card of cards) {
    const key = normalizeForMatch(card.name)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(card)
  }

  cache = { sig, files, cards, byKey, resolved: new Map(), warned: new Set() }
  logger?.info(`[Atlas] 攻略索引已构建：${cards.length} 个角色（${files.json.length} 个 JSON / ${files.html.length} 个页面）`)
  return cache
}

/**
 * 从同名候选中挑出适用该游戏的卡片（卡片未标注游戏时对任意游戏生效）
 * @param {Array|undefined} list
 * @param {string} gameId
 * @returns {object|null}
 */
function pickCard (list, gameId) {
  if (!list || !list.length) return null
  return list.find(c => !c.game || c.game === gameId) || null
}

/**
 * 反查索引：攻略卡片名 → 图鉴条目名（结果按游戏缓存）
 *
 * 攻略仓库的键可能是社区简称或主角族形态名，图鉴条目名与之对不上时靠 search() 反向解析；
 * 解析不到图鉴角色的卡片会整条跳过——不做「最像」的降级匹配。
 * @param {string} gameId
 * @param {object} idx - buildIndex() 结果
 * @returns {Map<string, object>} normalizeForMatch(图鉴条目名) → 卡片
 */
function reverseIndex (gameId, idx) {
  if (idx.resolved.has(gameId)) return idx.resolved.get(gameId)

  const map = new Map()
  for (const card of idx.cards) {
    if (card.game && card.game !== gameId) continue
    let entryName = ''
    try {
      const res = search(gameId, card.name)
      const top = res?.results?.[0]
      // 只接受角色条目，避免攻略键撞到同名武器/圣遗物
      if (res?.type !== 'empty' && top?.pageKey === 'character') entryName = top.name || ''
    } catch (err) {
      logger?.warn(`[Atlas] 攻略条目「${card.name}」图鉴反查失败: ${err.message}`)
    }
    if (entryName) {
      map.set(normalizeForMatch(entryName), card)
      map.set(normalizeForMatch(card.name), card)
      continue
    }
    // 仓库显式标注了游戏却仍对不上，属维护问题，告警；未标注游戏的多半是他游攻略，仅记信息
    const key = `${gameId}|${card.name}`
    if (idx.warned.has(key)) continue
    idx.warned.add(key)
    const msg = `[Atlas] 攻略条目「${card.name}」未匹配到 ${GAME_NAMES[gameId] || gameId} 图鉴角色，已跳过（${card.source}）`
    if (card.game) logger?.warn(msg)
    else logger?.info(msg)
  }

  idx.resolved.set(gameId, map)
  return map
}

/**
 * 归一攻略数据形状（模板只消费这里列出的字段）
 * @param {object} card
 * @returns {object}
 */
function toGuide (card) {
  return {
    name: card.name,
    game: card.game,
    source: card.source,
    docTitle: card.docTitle || '',
    image: card.image || '',
    chips: card.tags,
    desc: card.desc || '',
    sections: card.sections
  }
}

/**
 * 取某个角色的攻略数据
 *
 * 输入图鉴条目名，先按别名变体直配攻略卡片；未命中再按攻略卡片名反查图鉴条目。
 * 攻略仓库未拉取、无攻略文件、角色无攻略、解析失败一律返回 null，由调用方提示「暂无攻略数据」。
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {string} name - 图鉴条目名（角色名）
 * @returns {object|null} { name, game, source, docTitle, image, chips, desc, sections }
 */
export function getCharacterGuide (gameId, name) {
  if (!gameId || !name || !isCodexReady()) return null

  try {
    const idx = buildIndex()
    if (!idx.cards.length) return null

    // ① 直配：图鉴条目名与其全部别名变体（名字映射一律走别名系统，不自建映射表）
    const aliases = loadAliasMap(gameId)
    const variants = buildKeywordVariants(name, aliases, GAME_NAMES[gameId] || '')
    for (const variant of variants) {
      const card = pickCard(idx.byKey.get(variant.key), gameId)
      if (card) return toGuide(card)
    }

    // ② 反查：攻略卡片名 → 图鉴条目名（社区简称、主角族形态名等）
    const card = reverseIndex(gameId, idx).get(normalizeForMatch(name))
    return card ? toGuide(card) : null
  } catch (err) {
    logger?.warn(`[Atlas] 攻略索引读取失败（${gameId} / ${name}）: ${err.message}`)
    return null
  }
}

/**
 * 列出攻略仓库内已解析到的角色卡片（供状态页 / 调试探查，不参与渲染）
 * @returns {Array<{name: string, game: string, source: string, sections: number}>}
 */
export function listCodexGuides () {
  if (!isCodexReady()) return []
  try {
    return buildIndex().cards.map(c => ({
      name: c.name,
      game: c.game,
      source: c.source,
      sections: c.sections.length
    }))
  } catch {
    return []
  }
}
