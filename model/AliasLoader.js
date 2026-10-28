import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { SIGNATURE_SUFFIX, SIGNATURE_SHORT_SUFFIX } from '../components/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** 插件主维护别名目录（随源码分发，入 git） */
const PRESET_ALIAS_DIR = path.join(pluginRoot, 'resources', 'alias')
/** 用户自定义别名目录（运行时，不入 git） */
const CUSTOM_ALIAS_DIR = path.join(pluginRoot, 'config', 'alias')

/** 游戏 ID → 中文名（本地映射，供来源归属） */
const GAME_CN = { gi: '原神', hsr: '星铁', zzz: '绝区零' }

/**
 * 别名来源优先级：数值越大优先级越高
 * 低优先级先写，高优先级后写覆盖同游戏项
 * 层级：外部插件（miao/ZZZ 预设，0）< miao 用户自定义（1）
 *       < Atlas 插件预设（2）< Atlas 用户自定义（3）
 */
const SOURCE_MIAO_CUSTOM = 1 // miao-plugin 用户自定义（alias_gs/sr.cfg）
const SOURCE_PRESET = 2      // Atlas resources/alias 插件预设
const SOURCE_CUSTOM = 3      // config/alias 用户自定义（Atlas 自身）

/**
 * 别名 Map 条目附带来源优先级，用于覆盖判断
 * @type {{ loaded: boolean, map: Map<string, {value: string, game: string, source: number}[]> }}
 */
const ALIAS_CACHE = { loaded: false, map: new Map() }

/**
 * 别名 Map 的版本号：每次重建 +1
 * 供消费者判断「自己基于别名表派生的数据」是否过期（`reloadAliasMap()` 后必然变化）
 */
let aliasVersion = 0

/**
 * 按游戏过滤的结果缓存（键 gameId）
 * 过滤要遍历全表并新建 Map（约 3000 键），放在每次 `loadAliasMap(gameId)` 里做会成为热路径开销；
 * 重建时整体清空，保证与 `aliasVersion` 同步失效、不会出现「版本变了但拿到旧过滤表」。
 */
const FILTERED_CACHE = new Map()

/** 热更新 watcher 是否已挂载（惰性单次） */
let watcherStarted = false
/** 热更新防抖定时器 */
let reloadTimer = null
/** 防抖窗口（毫秒），编辑器保存多次触发合并为一次 */
const RELOAD_DEBOUNCE = 500

/* ============================================================
 *  文本标准化（与 Lotus-ReFactor 对齐）
 * ============================================================ */

/**
 * 标准化文本用于匹配比较
 * 去除空格、间隔号（六种变体）、括号、引号，转小写
 *
 * **间隔号补全的判定线**（2026-10 实施）：六种中点/连点（`·` U+00B7、`・` U+30FB、`•` U+2022、
 * `‧` U+2027、`⋅` U+22C5、`∙` U+2219）统一去掉——同一个角色名在不同来源里会混用这几种符号
 * （miao 的 `丹恒•饮月` 与标准名 `丹恒·饮月`、用户手输的 `阮梅` 与 `阮•梅`），不归一就互相搜不到。
 * 补全会让「同一角色的两种写法」合并成一个键，故验收口径是 **Map 键数前后对比**：
 * 下降 ≤ 5 视为同义合并（预期），> 5 必须停下复核是否误合并了不同实体。
 * 实测 3077 → 3068（−9，超过阈值，已逐组复核）：13 个含 `•` 的写法并成 9 个键
 * （希儿•没有姓 / 丹恒•饮月 / 阮•梅 / 零号•安比 …），**全部指向同一标准名，0 组引入歧义**，
 * 故按同义合并接受；判定线保留，后续再动归一化仍要按此复核。
 * @param {string} value
 * @returns {string}
 */
export function normalizeForMatch (value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[·・•‧⋅∙]/g, '')
    .replace(/[「」『』"'""''【】[\]()（）]/g, '')
    .toLowerCase()
}

/**
 * 标准化搜索关键词（去前缀 + trim）
 * @param {string} value
 * @returns {string}
 */
export function normalizeKeyword (value) {
  return String(value || '')
    .replace(/^[#*%％]/, '')
    .replace(/^(图鉴|Lotus图鉴|荷花图鉴)/, '')
    .trim()
}

/* ============================================================
 *  别名加载主入口
 * ============================================================ */

/**
 * 加载别名映射（带缓存）
 * 来源（按优先级）：miao-plugin alias.js → ZZZ-Plugin alias.yaml
 *   → Atlas resources/alias 预设 → config/alias 用户自定义
 * @param {string} [gameId] — 限定游戏（gi/hsr/zzz），不传或为空则加载全部
 * @returns {Map<string, {value: string, game: string, source: number}[]>}
 */
export function loadAliasMap (gameId) {
  if (!ALIAS_CACHE.loaded) {
    buildAliasMap()
    initAliasWatcher() // 惰性挂载热更新（首次加载后）
  }
  if (!gameId) return ALIAS_CACHE.map
  let filtered = FILTERED_CACHE.get(gameId)
  if (!filtered) {
    filtered = filterAliasMap(ALIAS_CACHE.map, gameId)
    FILTERED_CACHE.set(gameId, filtered)
  }
  return filtered
}

/**
 * 当前别名 Map 的版本号（首次调用会自动构建别名表）
 * 消费者据此判断派生数据是否过期；与 `loadAliasMap()` 同源，重建后必然变化。
 * @returns {number}
 */
export function getAliasVersion () {
  if (!ALIAS_CACHE.loaded) {
    buildAliasMap()
    initAliasWatcher()
  }
  return aliasVersion
}

/**
 * 重建别名 Map（低优先级来源先写，高优先级后写覆盖同游戏项）
 * 不操作缓存，供热更新与 reloadAliasMap 复用
 */
function buildAliasMap () {
  const aliases = new Map()
  FILTERED_CACHE.clear() // 与本次重建同步失效，避免旧过滤表残留

  // ── 来源 A: miao-plugin alias.js（仅 gi/hsr 有，低优先级） ──
  for (const file of miaoAliasFiles()) {
    try {
      const exports = readJsAliasExports(file.path, file.exports)
      for (const name of file.exports) {
        addAliasObject(aliases, exports[name], file.game, 0)
      }
    } catch {
      // 正则回退也失败 → 跳过该文件
    }
  }

  // ── 来源 B: ZZZ-Plugin alias.yaml（仅 zzz 有，低优先级） ──
  for (const file of zzzAliasFiles()) {
    try {
      addAliasObject(aliases, readYamlAliasObject(file), '绝区零', 0)
    } catch {
      // YAML 解析失败 → 跳过
    }
  }

  // ── 来源 B2: miao-plugin 用户自定义（alias_gs/sr.cfg，覆盖 miao 预设） ──
  for (const file of miaoCustomFiles()) {
    try {
      addAliasCfgFile(aliases, file.path, file.game, SOURCE_MIAO_CUSTOM)
    } catch {
      // 解析失败 → 跳过
    }
  }

  // ── 来源 C: Atlas resources/alias 插件预设 ──
  addAliasYamlDir(aliases, PRESET_ALIAS_DIR, SOURCE_PRESET)

  // ── 来源 D: config/alias 用户自定义（最高优先级） ──
  addAliasYamlDir(aliases, CUSTOM_ALIAS_DIR, SOURCE_CUSTOM)

  // 专武索引随之重建（「<角色>专武」是逐条登记的别名，这里把它归一成「角色 → 武器列表」）
  buildSignatureIndexes(aliases)

  ALIAS_CACHE.loaded = true
  ALIAS_CACHE.map = aliases
  aliasVersion++
  logger?.info(`[Atlas] 别名映射已加载，共 ${aliases.size} 个关键词（v${aliasVersion}）`)
}

/**
 * 重新加载别名映射（清缓存重建）— 热更新与数据更新后调用
 */
export function reloadAliasMap () {
  ALIAS_CACHE.loaded = false
  ALIAS_CACHE.map = new Map()
  buildAliasMap()
}

/**
 * 扫描目录下各游戏子目录的 YAML 别名文件并注册
 * 目录结构：<baseDir>/<gameId>/*.yaml（游戏内按类别分文件，自动发现）
 * @param {Map} aliases - 目标别名 Map
 * @param {string} baseDir - resources/alias 或 config/alias
 * @param {number} source - 来源优先级
 */
function addAliasYamlDir (aliases, baseDir, source) {
  if (!fs.existsSync(baseDir)) return
  for (const [gameId, gameName] of Object.entries(GAME_CN)) {
    const gameDir = path.join(baseDir, gameId)
    if (!fs.existsSync(gameDir)) continue
    let files
    try {
      files = fs.readdirSync(gameDir).filter(f => f.endsWith('.yaml'))
    } catch {
      continue
    }
    for (const file of files) {
      try {
        const obj = YAML.parse(fs.readFileSync(path.join(gameDir, file), 'utf8')) || {}
        addAliasObject(aliases, obj, gameName, source)
      } catch (err) {
        logger?.warn(`[Atlas] 别名文件解析失败，已跳过: ${path.join(gameDir, file)} — ${err.message}`)
      }
    }
  }
}

/**
 * 按游戏过滤别名 Map
 */
function filterAliasMap (fullMap, gameId) {
  const gameName = { gi: '原神', hsr: '星铁', zzz: '绝区零' }[gameId]
  if (!gameName) return fullMap

  const filtered = new Map()
  for (const [key, list] of fullMap) {
    const filteredList = list.filter(item => !item.game || item.game === gameName)
    if (filteredList.length > 0) filtered.set(key, filteredList)
  }
  return filtered
}

/* ============================================================
 *  别名数据源
 * ============================================================ */

/**
 * miao-plugin alias.js 文件清单
 */
function miaoAliasFiles () {
  const files = []
  for (const base of miaoPluginRoots()) {
    files.push(
      { path: path.join(base, 'resources', 'meta-gs', 'character', 'alias.js'), exports: ['alias'], game: '原神' },
      { path: path.join(base, 'resources', 'meta-gs', 'weapon', 'alias.js'), exports: ['alias', 'abbr', 'aliasCfg'], game: '原神' },
      { path: path.join(base, 'resources', 'meta-gs', 'artifact', 'alias.js'), exports: ['alias', 'setAbbr', 'setAlias'], game: '原神' },
      { path: path.join(base, 'resources', 'meta-sr', 'character', 'alias.js'), exports: ['alias'], game: '星铁' },
      { path: path.join(base, 'resources', 'meta-sr', 'weapon', 'alias.js'), exports: ['alias', 'abbr', 'aliasCfg'], game: '星铁' },
      { path: path.join(base, 'resources', 'meta-sr', 'artifact', 'alias.js'), exports: ['alias', 'setAbbr', 'aliasCfg', 'artiAbbr', 'artiSetAbbr'], game: '星铁' }
    )
  }
  return uniqueExistingFiles(files)
}

/**
 * miao-plugin 用户自定义别名 cfg 文件清单
 * 仅读取存在且非空的（config/alias_gs.cfg、config/alias_sr.cfg 由 miao 命令产生，不入 git）
 */
function miaoCustomFiles () {
  const files = []
  for (const base of miaoPluginRoots()) {
    files.push(
      { path: path.join(base, 'config', 'alias_gs.cfg'), game: '原神' },
      { path: path.join(base, 'config', 'alias_sr.cfg'), game: '星铁' }
    )
  }
  return uniqueExistingFiles(files)
}

/**
 * 解析 miao 自定义别名 cfg 并注册进 Map
 * 行格式对齐 miao CustomAlias.parseLine：`标准名:别名1，别名2`（兼容中英文冒号/逗号），坏行跳过
 * @param {Map} map - 目标别名 Map
 * @param {string} file - cfg 文件绝对路径
 * @param {string} game - 中文游戏名
 * @param {number} source - 来源优先级
 */
function addAliasCfgFile (map, file, game, source) {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of content.split(/\r?\n/)) {
    try {
      const match = /^([^：:]+)[：:](.*)$/.exec(line.trim())
      if (!match) continue
      const canonical = String(match[1]).trim()
      const aliases = String(match[2]).split(/[,，]/).map(t => String(t).trim()).filter(Boolean)
      if (!canonical || aliases.length === 0) continue
      addAliasPair(map, canonical, aliases, game, source)
    } catch {
      // 坏行跳过，不影响其他行
    }
  }
}

/**
 * ZZZ-Plugin alias.yaml 文件清单
 */
function zzzAliasFiles () {
  return zzzPluginRoots()
    .map(base => path.join(base, 'defSet', 'alias.yaml'))
    .filter(p => fs.existsSync(p))
}

/**
 * miao-plugin 可能的安装目录
 */
function miaoPluginRoots () {
  return [
    path.join(pluginRoot, '..', 'miao-plugin'),
    path.join(pluginRoot, '..', 'Miao-Plugin'),
    path.join(pluginRoot, '..', 'miao-plugin-fork')
  ]
}

/**
 * ZZZ-Plugin 可能的安装目录
 */
function zzzPluginRoots () {
  return [
    path.join(pluginRoot, '..', 'ZZZ-Plugin'),
    path.join(pluginRoot, '..', 'zzz-plugin')
  ]
}

/**
 * 去重并过滤出存在的文件
 */
function uniqueExistingFiles (files) {
  const seen = new Set()
  const result = []
  for (const item of files) {
    const file = item.path
    const key = path.resolve(file).toLowerCase()
    if (seen.has(key) || !fs.existsSync(file)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

/* ============================================================
 *  JS 别名文件读取（含正则回退）
 * ============================================================ */

/**
 * 读取 JS 别名文件导出（dynamic import + 正则回退）
 * @param {string} file — JS 文件绝对路径
 * @param {string[]} exportNames — 需要的导出名列表
 * @returns {object} — { [name]: object }
 */
function readJsAliasExports (file, exportNames = []) {
  let mod
  try {
    const stat = fs.statSync(file)
    mod = readJsAliasExportsDynamic(file, stat.mtimeMs)
  } catch {
    mod = null
  }

  if (!mod) {
    // 正则回退：读源码 → 提取 export const xxx = {...}
    mod = readJsAliasExportsFallback(file, exportNames)
  }

  const ret = {}
  for (const name of exportNames) {
    if (mod && mod[name] != null) ret[name] = mod[name]
  }
  return ret
}

/**
 * 尝试 dynamic import（仅 CJS/ESM 模块环境有效）
 */
function readJsAliasExportsDynamic (file, mtimeMs) {
  // ESM 环境无法直接使用 require，用 import() + 缓存破坏
  // 由于本插件为 ESM 且 alias.js 为 CJS 风格，
  // 使用 Function + require 的方式读取
  try {
    // eslint-disable-next-line no-eval
    const req = (typeof require !== 'undefined') ? require : null
    if (!req) return null
    // 缓存破坏
    delete req.cache[require.resolve(file)]
    return req(file)
  } catch {
    return null
  }
}

/**
 * 正则回退：从 JS 源码中提取 export const xxx = {...}
 */
function readJsAliasExportsFallback (file, exportNames = []) {
  try {
    const source = fs.readFileSync(file, 'utf8')
    const ret = {}
    for (const name of exportNames) {
      const literal = extractExportObjectLiteral(source, name)
      if (!literal) continue
      try {
        // eslint-disable-next-line no-new-func
        ret[name] = (new Function(`"use strict"; return (${literal});`))()
      } catch {
        // 格式异常 → 跳过
      }
    }
    return ret
  } catch {
    return {}
  }
}

/**
 * 从 JS 源码中提取 `export const <name> = <object>` 的对象字面量
 */
function extractExportObjectLiteral (source, name) {
  const marker = new RegExp(`export\\s+const\\s+${name}\\s*=`, 'u')
  const match = marker.exec(source)
  if (!match) return ''
  const start = source.indexOf('{', match.index + match[0].length)
  if (start < 0) return ''
  return extractBalancedBraces(source, start)
}

/**
 * 从 start 位置的 { 开始提取平衡括号内容
 * 处理字符串、转义、注释（行注释/块注释）
 */
function extractBalancedBraces (source, start) {
  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]

    if (lineComment) {
      if (ch === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++ }
      continue
    }
    if (quote) {
      if (escaped) { escaped = false } else if (ch === '\\') { escaped = true } else if (ch === quote) { quote = '' }
      continue
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue }

    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') { depth++; continue }
    if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}

/* ============================================================
 *  YAML 别名文件读取
 * ============================================================ */

function readYamlAliasObject (file) {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/* ============================================================
 *  别名 Map 构建
 * ============================================================ */

/**
 * 将一整个别名对象注册到 Map（遍历每个 key）
 * @param {Map} map - 目标别名 Map
 * @param {object} object - { 标准名: 别名串/数组 }
 * @param {string} game - 中文游戏名
 * @param {number} source - 来源优先级（高者覆盖低者同游戏项）
 */
function addAliasObject (map, object, game = '', source = 0) {
  if (!object || typeof object !== 'object') return
  for (const [canonical, aliases] of Object.entries(object)) {
    addAliasPair(map, canonical, aliases, game, source)
  }
}

/**
 * 注册一对别名关系（双向）
 * canonical → aliases（正向）
 * 每个 alias → canonical（反向）
 * @param {Map} map - 目标别名 Map
 * @param {string} canonical - 标准名
 * @param {*} aliases - 别名串（逗号分隔）或数组
 * @param {string} game - 中文游戏名
 * @param {number} source - 来源优先级（高者覆盖低者同游戏项）
 */
function addAliasPair (map, canonical, aliases, game = '', source = 0) {
  const values = Array.isArray(aliases) ? aliases : String(aliases || '').split(/[,，]/)
  for (const alias of values) {
    const aliasText = String(alias || '').trim()
    const canonicalText = String(canonical || '').trim()
    if (!aliasText || !canonicalText || aliasText === canonicalText) continue
    addAliasValue(map, canonicalText, aliasText, game, source)
    addAliasValue(map, aliasText, canonicalText, game, source)
  }
}

/**
 * 写入一条映射：key → {value, game, source}
 * 覆盖语义：同一 (key, game) 下，高来源写入时清除该 game 的所有低来源项
 * （用户自定义某别名 = 让该别名完全指向自定义角色），删除后重建自动回退；
 * 不同 game 互不干扰（同一别名可分别作用于多游戏）。
 * @param {Map} map - 目标别名 Map
 * @param {string} key - 标准名或别名（未标准化）
 * @param {string} value - 对应的另一端
 * @param {string} game - 中文游戏名
 * @param {number} source - 来源优先级（高者覆盖低者同游戏项）
 */
function addAliasValue (map, key, value, game = '', source = 0) {
  const normalized = normalizeForMatch(key)
  if (!normalized) return
  const list = map.get(normalized) || []

  // 相同 (value, game) 已存在 → 更新来源优先级（同源或低→高时）
  const existing = list.find(item => item.value === value && item.game === game)
  if (existing) {
    if (source > existing.source) existing.source = source
    return
  }

  // 同游戏同 key 已有其他 value：
  // - 新来源 > 旧来源 → 替换（清除该 game 旧项，高优先级覆盖低优先级）
  // - 新来源 <= 旧来源（同来源跨文件或多 canonical 引用同一别名）→ 共存追加
  if (list.some(item => item.game === game)) {
    const maxSource = Math.max(...list.filter(item => item.game === game).map(item => item.source))
    if (source > maxSource) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].game === game) list.splice(i, 1)
      }
    } else {
      return // 同/低来源不修改，保留既有项
    }
  }

  list.push({ value, game, source })
  map.set(normalized, list)
}

/* ============================================================
 *  搜索变体生成
 * ============================================================ */

/**
 * 根据别名映射生成搜索变体列表
 * @param {string} keyword — 用户输入的关键词（已去前缀）
 * @param {Map} aliases — loadAliasMap() 返回的别名映射
 * @param {string} game — 中文游戏名（原神/星铁/绝区零）
 * @returns {{raw: string, key: string, alias: boolean}[]}
 */
export function buildKeywordVariants (keyword, aliases = new Map(), game = '') {
  const text = normalizeKeyword(keyword)
  const values = new Set([text])
  const aliasValues = aliases.get(normalizeForMatch(text)) || []

  for (const item of aliasValues) {
    if (!item.game || !game || item.game === game) {
      values.add(item.value)
    }
  }

  return [...values].filter(Boolean).map(value => ({
    raw: value,
    key: normalizeForMatch(value),
    alias: value !== text
  }))
}

/* ============================================================
 *  专武索引（「<角色>专武」→ 武器）
 *
 *  专武在数据源里没有字段，只有 miao 逐条登记的别名（`胡桃专武`、`雷电将军专武`、
 *  `万叶专武`、`温迪新专武`…），写法在简称/全名之间不统一，且一个角色可能有多把
 *  （目前只有温迪：`温迪专武` 旧、`温迪新专武` 新）。故这里做两件事：
 *    1) 建索引：`<角色>` → [{ weapon, label, game }]，label 区分「专武」与「新专武」等修饰；
 *    2) 查询时先直查整串（保住 `万叶专武`/`温迪新专武` 这类逐条写法），
 *       再以角色名的 1-hop 双向闭包（官名 + 简称）拼 `候选专武` 兜底。
 *  索引随别名表重建（`buildAliasMap()` 内调用），与 `reloadAliasMap()` 同步失效。
 *  简写：`<角色>专` / `<角色>新专` 由 `expandSignatureKeyword()` 补成 `专武` 后再走同一路径。
 * ============================================================ */

/** 「专武」后缀本体（与 components/constants.js 的 SIGNATURE_SUFFIX 同源） */

/**
 * 专武键的修饰词（出现在「专武」之前）
 * 例：`温迪新专武` → base=温迪、label=新专武。将来出现新写法时在这里登记。
 */
const SIGNATURE_LABEL_MARKERS = ['新']

/** 专武索引：normalize(base) → [{ weapon, label, game }] */
let SIGNATURE_INDEX = new Map()

/** 反向索引：normalize(值) → Set<归一化键>，用于「简称/别名 → 官名」的闭包 */
let SIGNATURE_REVERSE = new Map()

/**
 * 重建专武索引与反向索引
 * @param {Map<string, {value: string, game: string, source: number}[]>} aliases - 全量别名表
 */
function buildSignatureIndexes (aliases) {
  const index = new Map()
  const reverse = new Map()
  for (const [key, list] of aliases) {
    for (const item of list) {
      const value = normalizeForMatch(item.value)
      if (!value) continue
      const keys = reverse.get(value) || new Set()
      keys.add(key)
      reverse.set(value, keys)
    }
    if (!key.endsWith(SIGNATURE_SUFFIX)) continue
    let base = key.slice(0, -SIGNATURE_SUFFIX.length)
    let label = SIGNATURE_SUFFIX
    for (const marker of SIGNATURE_LABEL_MARKERS) {
      if (base.length > marker.length && base.endsWith(marker)) {
        base = base.slice(0, -marker.length)
        label = marker + SIGNATURE_SUFFIX
        break
      }
    }
    if (!base) continue
    const bucket = index.get(base) || []
    for (const item of list) {
      if (!item.value) continue
      bucket.push({ weapon: item.value, label, game: item.game })
    }
    index.set(base, bucket)
  }
  SIGNATURE_INDEX = index
  SIGNATURE_REVERSE = reverse
}

/**
 * 该关键词是否以「专武」或简写「专」结尾（含 `新专武` / `新专` 等修饰写法）
 * @param {string} keyword - 已去前缀的关键词
 * @returns {boolean}
 */
export function isSignatureKeyword (keyword) {
  const text = String(keyword || '').trim()
  return text.endsWith(SIGNATURE_SUFFIX) || text.endsWith(SIGNATURE_SHORT_SUFFIX)
}

/**
 * 把简写「专」补成「专武」（已带「专武」的原样返回）
 *
 * 只补末尾一个字，不改写中间的修饰词：`丝柯克专` → `丝柯克专武`、`温迪新专` → `温迪新专武`。
 * @param {string} keyword
 * @returns {string}
 */
export function expandSignatureKeyword (keyword) {
  const text = String(keyword || '')
  if (text.endsWith(SIGNATURE_SUFFIX)) return text
  if (text.endsWith(SIGNATURE_SHORT_SUFFIX)) return text + '武'
  return text
}

/**
 * 取关键词里的专武修饰词（无修饰返回空串）
 * @param {string} keyword
 * @returns {string} 如 `新`（对应 `新专武` / `新专`）
 */
export function signatureLabelMarker (keyword) {
  const text = expandSignatureKeyword(keyword)
  return SIGNATURE_LABEL_MARKERS.find(marker => text.endsWith(marker + SIGNATURE_SUFFIX)) || ''
}

/**
 * 按角色名解析专武（逐条直查由调用方负责，这里只做「角色 → 武器」的组合解析）
 *
 * 角色名先做 1-hop 双向闭包（自身 + 别名值 + 以它为值的键），再对每个候选查
 * `候选 + (修饰)专武` 索引。因此简称与全名可以互通：`雷神` → `雷电将军专武`、
 * `枫原万叶` → `万叶专武`；传 `marker='新'` 时只取 `新专武` 那一条（`风神` → `黎明破晓之史`）。
 * @param {string} name - 角色名或角色别名（不含「专武」）
 * @param {string} [gameId] - gi/hsr/zzz；缺省不按游戏过滤
 * @param {string} [marker] - 修饰词（如 `新`），只返回该修饰的专武
 * @returns {{weapon: string, label: string}[]} 去重后的专武列表（可能为空 / 多把）
 */
export function resolveSignatureWeapons (name, gameId, marker = '') {
  const key = normalizeForMatch(name)
  if (!key) return []
  if (!ALIAS_CACHE.loaded) {
    buildAliasMap()
    initAliasWatcher()
  }
  const gameName = GAME_CN[gameId] || ''
  const wantLabel = marker ? marker + SIGNATURE_SUFFIX : ''

  const bases = new Set([key])
  for (const other of SIGNATURE_REVERSE.get(key) || []) bases.add(other)
  for (const item of loadAliasMap(gameId || undefined).get(key) || []) {
    const value = normalizeForMatch(item.value)
    if (value) bases.add(value)
  }

  const found = []
  const seen = new Set()
  for (const base of bases) {
    for (const entry of SIGNATURE_INDEX.get(base) || []) {
      if (gameName && entry.game && entry.game !== gameName) continue
      if (wantLabel && entry.label !== wantLabel) continue
      const id = `${entry.weapon}|${entry.label}`
      if (seen.has(id)) continue
      seen.add(id)
      found.push({ weapon: entry.weapon, label: entry.label })
    }
  }
  return found
}

/* ============================================================
 *  热更新
 * ============================================================ */

/**
 * 惰性挂载别名热更新监听（首次 loadAliasMap 时启动，幂等）
 *
 * 监听策略（对齐 miao-plugin 参考）：
 * - 目录级 fs.watch 主监听：覆盖「新增/删除文件」事件
 * - 文件级 fs.watchFile 兜底（interval 1000ms）：补充目录监听
 *   在部分平台对「文件首次创建」感知盲区
 * - 事件触发 → 0.5s 防抖 → reloadAliasMap()
 */
export function initAliasWatcher () {
  if (watcherStarted) return
  watcherStarted = true

  const watchDirs = [PRESET_ALIAS_DIR, CUSTOM_ALIAS_DIR]
  for (const dir of watchDirs) {
    if (!fs.existsSync(dir)) {
      // 目录尚不存在（自定义别名首次使用前）→ 监听其父目录以感知创建
      const parent = path.dirname(dir)
      if (parent !== dir && fs.existsSync(parent)) watchTree(parent)
      continue
    }
    watchTree(dir)
  }

  // miao-plugin 用户自定义 cfg（位于 miao 目录，不属于上述树）→ 文件级 watchFile 兜底
  for (const file of miaoCustomFiles()) {
    try {
      fs.watchFile(file.path, { interval: 1000 }, () => scheduleReload())
    } catch {
      // 单个文件监听失败忽略
    }
  }

  logger?.info('[Atlas] 别名热更新监听已启动')
}

/** 递归监听目录树（目录级 fs.watch + 文件级 watchFile 兜底） */
function watchTree (dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  // 目录级监听（感知新增/删除）
  try {
    fs.watch(dir, { persistent: false }, () => scheduleReload())
  } catch {
    // 平台不支持 → 仅靠 watchFile
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    // 文件级兜底（watchFile 可感知内容修改与创建）
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      try {
        fs.watchFile(full, { interval: 1000 }, () => scheduleReload())
      } catch {
        // 忽略单个文件监听失败
      }
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      watchTree(full) // 递归游戏/类别子目录
    }
  }
}

/** 防抖后重载别名缓存 */
function scheduleReload () {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    reloadAliasMap()
    logger?.info('[Atlas] 别名配置已热更新')
  }, RELOAD_DEBOUNCE)
}
