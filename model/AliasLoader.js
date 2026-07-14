import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/**
 * 静态别名：标准名 → { game, aliases[] }
 * 键为标准名，值为别名列表。加载时会双向注册。
 */
const STATIC_QUERY_ALIASES = Object.freeze({
  '星见雅': { game: '绝区零', aliases: ['雅'] },
  '雾切之回光': { game: '原神', aliases: ['雾切'] },
  '冰封迷途的勇士': { game: '原神', aliases: ['冰风迷途的勇士'] }
})

/** @type {{ loaded: boolean, map: Map<string, {value: string, game: string}[]> }} */
const ALIAS_CACHE = { loaded: false, map: new Map() }

/* ============================================================
 *  文本标准化（与 Lotus-ReFactor 对齐）
 * ============================================================ */

/**
 * 标准化文本用于匹配比较
 * 去除空格、间隔号、括号、引号，转小写
 * @param {string} value
 * @returns {string}
 */
export function normalizeForMatch (value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[·・]/g, '')
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
 * 来源：静态别名 + miao-plugin alias.js + ZZZ-Plugin alias.yaml
 * @param {string} [gameId] — 限定游戏（gi/hsr/zzz），不传或为空则加载全部
 * @returns {Map<string, {value: string, game: string}[]>}
 */
export function loadAliasMap (gameId) {
  if (ALIAS_CACHE.loaded) {
    // 有 gameId 限定时过滤
    if (!gameId) return ALIAS_CACHE.map
    return filterAliasMap(ALIAS_CACHE.map, gameId)
  }

  const aliases = new Map()

  // 来源 1: 静态别名
  for (const [canonical, config] of Object.entries(STATIC_QUERY_ALIASES)) {
    addAliasPair(aliases, canonical, config.aliases, config.game)
  }

  // 来源 2: miao-plugin alias.js（仅 gi/hsr 有）
  for (const file of miaoAliasFiles()) {
    try {
      const exports = readJsAliasExports(file.path, file.exports)
      for (const name of file.exports) {
        addAliasObject(aliases, exports[name], file.game)
      }
    } catch {
      // 正则回退也失败 → 跳过该文件
    }
  }

  // 来源 3: ZZZ-Plugin alias.yaml（仅 zzz 有）
  for (const file of zzzAliasFiles()) {
    try {
      addAliasObject(aliases, readYamlAliasObject(file), '绝区零')
    } catch {
      // YAML 解析失败 → 跳过
    }
  }

  ALIAS_CACHE.loaded = true
  ALIAS_CACHE.map = aliases
  logger?.info(`[Atlas] 别名映射已加载，共 ${aliases.size} 个关键词`)

  if (!gameId) return aliases
  return filterAliasMap(aliases, gameId)
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
      { path: path.join(base, 'resources', 'meta-gs', 'weapon', 'alias.js'), exports: ['alias', 'abbr'], game: '原神' },
      { path: path.join(base, 'resources', 'meta-gs', 'artifact', 'alias.js'), exports: ['alias', 'setAbbr'], game: '原神' },
      { path: path.join(base, 'resources', 'meta-sr', 'character', 'alias.js'), exports: ['alias'], game: '星铁' },
      { path: path.join(base, 'resources', 'meta-sr', 'weapon', 'alias.js'), exports: ['alias', 'abbr'], game: '星铁' },
      { path: path.join(base, 'resources', 'meta-sr', 'artifact', 'alias.js'), exports: ['alias', 'setAbbr'], game: '星铁' }
    )
  }
  return uniqueExistingFiles(files)
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
 */
function addAliasObject (map, object, game = '') {
  if (!object || typeof object !== 'object') return
  for (const [canonical, aliases] of Object.entries(object)) {
    addAliasPair(map, canonical, aliases, game)
  }
}

/**
 * 注册一对别名关系（双向）
 * canonical → aliases（正向）
 * 每个 alias → canonical（反向）
 */
function addAliasPair (map, canonical, aliases, game = '') {
  const values = Array.isArray(aliases) ? aliases : String(aliases || '').split(/[,，]/)
  for (const alias of values) {
    const aliasText = String(alias || '').trim()
    const canonicalText = String(canonical || '').trim()
    if (!aliasText || !canonicalText || aliasText === canonicalText) continue
    addAliasValue(map, canonicalText, aliasText, game)
    addAliasValue(map, aliasText, canonicalText, game)
  }
}

/**
 * 写入一条映射：key → {value, game}
 */
function addAliasValue (map, key, value, game = '') {
  const normalized = normalizeForMatch(key)
  if (!normalized) return
  const list = map.get(normalized) || []
  if (!list.some(item => item.value === value && item.game === game)) {
    list.push({ value, game })
  }
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
