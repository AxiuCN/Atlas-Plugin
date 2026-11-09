import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { resolveEntryPageKey } from './AtlasService.js'
import { loadAliasMap, reloadAliasMap } from './AliasLoader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const CUSTOM_ALIAS_DIR = path.join(pluginRoot, 'config', 'alias')

const GAME_CN = { gi: '原神', hsr: '星铁', zzz: '绝区零' }

/** 禁止作为别名的字符（与配置分隔符冲突） */
const FORBIDDEN = /[:：,，]|\s/
/** 拒绝纯数字别名（防与 recordId 冲突） */
const DIGITS_ONLY = /^\d+$/

/**
 * 别名合法性校验
 * @param {string} alias
 * @returns {string} 错误信息，空串表示合法
 */
function validateAlias (alias) {
  const text = String(alias || '').trim()
  if (!text) return '别名不能为空'
  if (DIGITS_ONLY.test(text)) return '别名不能为纯数字（可能与条目 ID 冲突）'
  if (FORBIDDEN.test(text)) return '别名不能包含空格、冒号或逗号'
  return ''
}

/**
 * 同步原子写文件（tmp + rename）
 *
 * 必须是同步的：写入与「读改写」「别名缓存刷新」之间**不能让出执行权**，
 * 否则两个并发请求会基于同一份旧快照各自合并，后写的把前一个改动覆盖掉。
 * @param {string} filePath
 * @param {string} content
 */
function atomicWrite (filePath, content) {
  const tmp = `${filePath}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

/**
 * 读取某游戏的某个类别自定义别名文件
 * @param {string} gameId
 * @param {string} pageKey
 * @returns {object} YAML map（标准名 → 别名串），文件不存在返回 {}
 */
function readCategoryFile (gameId, pageKey, strict = false) {
  const file = path.join(CUSTOM_ALIAS_DIR, gameId, `${pageKey}.yaml`)
  if (!fs.existsSync(file)) return {}
  try {
    const value = YAML.parse(fs.readFileSync(file, 'utf8'))
    if (value == null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('别名配置必须为映射')
    return value
  } catch {
    // 写路径（strict）下必须中止：按空处理会让下一次保存把整个类别覆盖掉
    if (strict) throw new Error('别名文件解析失败，未修改原配置，请修复后重试')
    logger?.warn(`[Atlas] 别名文件解析失败，按空处理: ${file}`)
    return {}
  }
}

/**
 * 读取某游戏全部类别自定义别名（合并为「标准名 → 别名串」Map，文件名即类别）
 * @param {string} gameId
 * @returns {Map<string, {category: string, file: string, aliases: string}>}
 */
function readAllCategories (gameId) {
  const result = new Map()
  const dir = path.join(CUSTOM_ALIAS_DIR, gameId)
  if (!fs.existsSync(dir)) return result
  let files
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))
  } catch {
    return result
  }
  for (const f of files) {
    const pageKey = f.replace(/\.yaml$/, '')
    const obj = readCategoryFile(gameId, pageKey)
    for (const [canonical, aliases] of Object.entries(obj)) {
      result.set(canonical, { category: pageKey, file: path.join(dir, f), aliases: String(aliases) })
    }
  }
  return result
}

/**
 * 设置自定义别名
 * 写入 config/alias/<gameId>/<pageKey>.yaml，立即刷新内存（reloadAliasMap）
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} canonical - 标准名（或可解析的别名）
 * @param {string} alias - 新别名
 * @returns {Promise<{ok: boolean, msg: string}>}
 */
export async function setAlias (gameId, canonical, alias) {
  const name = String(canonical || '').trim()
  const text = String(alias || '').trim()
  if (!name) return { ok: false, msg: '角色/武器名不能为空' }

  // 定位类别：标准名或别名 → pageKey
  const pageKey = resolveEntryPageKey(gameId, name)
  if (!pageKey) {
    return { ok: false, msg: `未找到「${name}」，请输入正确的标准名` }
  }

  // 别名合法性
  const err = validateAlias(text)
  if (err) return { ok: false, msg: err }

  // 冲突检查：别名已被任意来源占用（预设/自定义/miao）
  const aliasMap = loadAliasMap(gameId)
  const conflict = aliasMap.get(text)?.some(item => item.game === GAME_CN[gameId])
  if (conflict) {
    return { ok: false, msg: `别名「${text}」已存在，不支持重复设置` }
  }

  // 读取该类别现有内容，追加 key（保持注释头）
  const file = path.join(CUSTOM_ALIAS_DIR, gameId, `${pageKey}.yaml`)
  let obj
  try {
    obj = readCategoryFile(gameId, pageKey, true)
  } catch (err) {
    return { ok: false, msg: err.message }
  }
  const existing = String(obj[name] || '')
  const merged = existing ? `${existing}，${text}` : text
  obj[name] = merged

  const header = `# 用户自定义${GAME_CN[gameId]}字段${pageKey}别名（config/alias，不入 git）\n`
  atomicWrite(file, header + YAML.stringify(obj))

  reloadAliasMap()
  logger?.info(`[Atlas] 已设置自定义别名: ${GAME_CN[gameId]} ${name} → ${text} (${pageKey})`)
  return { ok: true, msg: `已为「${name}」添加别名「${text}」` }
}

/**
 * 删除自定义别名
 * 只操作自定义层；预设/miao 层不支持删除
 * @param {string} gameId
 * @param {string} alias - 要删除的别名
 * @returns {Promise<{ok: boolean, msg: string}>}
 */
export async function delAlias (gameId, alias) {
  const text = String(alias || '').trim()
  if (!text) return { ok: false, msg: '请提供要删除的别名' }

  const all = readAllCategories(gameId)
  let target = null
  for (const [canonical, info] of all) {
    const list = String(info.aliases).split(/[,，]/).map(s => s.trim()).filter(Boolean)
    if (list.includes(text)) {
      target = { canonical, ...info, list }
      break
    }
  }

  if (!target) {
    // 检查是否预设/miao 层别名（提示不可删）
    const aliasMap = loadAliasMap(gameId)
    const inOther = aliasMap.get(text)?.some(item => item.game === GAME_CN[gameId])
    return {
      ok: false,
      msg: inOther ? `别名「${text}」为预设别名，不支持删除` : `自定义别名中不存在「${text}」`
    }
  }

  let obj
  try {
    obj = readCategoryFile(gameId, target.category, true)
  } catch (err) {
    return { ok: false, msg: err.message }
  }
  const remaining = target.list.filter(a => a !== text)
  if (remaining.length > 0) {
    obj[target.canonical] = remaining.join('，')
  } else {
    delete obj[target.canonical]
  }

  const header = `# 用户自定义${GAME_CN[gameId]}字段${target.category}别名（config/alias，不入 git）\n`
  atomicWrite(target.file, header + YAML.stringify(obj))

  reloadAliasMap()
  logger?.info(`[Atlas] 已删除自定义别名: ${GAME_CN[gameId]} ${text}（归属 ${target.canonical}）`)
  return { ok: true, msg: `已删除「${text}」` }
}

/**
 * 列出某游戏全部自定义别名
 * @param {string} gameId
 * @returns {{exists: boolean, lines: string[]}}
 */
export function listAlias (gameId) {
  const all = readAllCategories(gameId)
  if (all.size === 0) {
    return { exists: false, lines: [] }
  }
  const lines = [...all.entries()].map(([canonical, info]) => `${canonical}: ${info.aliases}`)
  return { exists: true, lines }
}

/**
 * 检索某别名是否在自定义层存在（用于删除前判断）
 * @param {string} gameId
 * @param {string} alias
 * @returns {boolean}
 */
export function findAlias (gameId, alias) {
  const text = String(alias || '').trim()
  if (!text) return false
  for (const info of readAllCategories(gameId).values()) {
    if (String(info.aliases).split(/[,，]/).map(s => s.trim()).includes(text)) return true
  }
  return false
}
