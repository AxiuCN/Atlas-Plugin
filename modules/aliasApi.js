/**
 * aliasApi — 别名系统的**对外门面**（供其它插件/模块按相对路径 import）
 *
 * 设计约束（与 `model/AliasLoader.js` 的分工）：
 * - `AliasLoader` 负责「从哪读、怎么合并、怎么归一化」；本文件只做**契约收口**：固定返回形状、
 *   永不抛错、文档化只读与缓存规则。新增消费者只依赖本文件，内部实现换数据源（文件 / 未来的 miao API）时它们不用改。
 * - **只读**：不暴露写入与重建（写入仍走 `apps/alias.js` + `model/CustomAlias.js`）。
 * - **不缓存副本**：返回的 Map 是 Atlas 自己的缓存实例，消费者视为 immutable；确需长期持有派生数据时，
 *   用它自己的缓存 + `getAliasVersion()` 比对失效（重建后版本必然变化）。
 * - **永不抛错**：非法入参返回空结构；读取失败只 `logger.warn`，不中断调用方。
 *
 * 消费方注意：别名表是**双向注册**的（标准名 ↔ 别名互为键），表本身不记录方向，故 `resolveAlias()`
 * 返回的是「对侧候选名」而不是「标准名」；需要区分标准名时，由消费者结合自己的数据源裁决
 * （Atlas 走 `buildKeywordVariants` → 索引评分；ProfileImg 走它的图库目录存在性）。
 */
import {
  loadAliasMap,
  buildKeywordVariants,
  getAliasVersion as readAliasVersion,
  normalizeForMatch
} from '../model/AliasLoader.js'

/** 门面契约版本：形状发生不兼容变化时 +1（与别名表版本 `getAliasVersion()` 无关） */
export const ALIAS_API_VERSION = 1

/** 游戏 ID → 中文名（与 AliasLoader / components/constants 的命名一致） */
const GAME_NAMES = { gi: '原神', hsr: '星铁', zzz: '绝区零' }

/**
 * 统一兜底：任何异常都不外抛，返回该函数的空结构
 * @param {Function} fn - 实际逻辑
 * @param {*} fallback - 异常时的返回值
 * @param {string} label - 日志用函数名
 */
function safe (fn, fallback, label) {
  try {
    return fn()
  } catch (err) {
    logger?.warn?.(`[Atlas] 别名 API ${label} 调用失败: ${err?.message || err}`)
    return fallback
  }
}

/**
 * 取别名表（只读）
 * @param {string} [gameId] - gi/hsr/zzz；缺省或未知值返回全量
 * @returns {Map<string, {value: string, game: string, source: number}[]>} 键为归一化名；异常时返回空 Map
 */
export function getAliasMap (gameId) {
  return safe(() => loadAliasMap(GAME_NAMES[gameId] ? gameId : undefined), new Map(), 'getAliasMap')
}

/**
 * 解析一个名字在别名表里的对侧候选
 *
 * 表是双向的：`风套` 的候选是 `翠绿之影`，`翠绿之影` 的候选是 `风套` 等。**不表示方向**，
 * 消费者需自行判断哪个是标准名（见文件头说明）。
 * @param {string} name - 用户输入的名字（内部按 `normalizeForMatch` 归一后再查）
 * @param {string} [gameId] - gi/hsr/zzz；缺省不按游戏过滤
 * @returns {{ key: string, candidates: string[], primary: string|null }}
 *          key = 归一化后的查表键；candidates = 去重后的对侧名称；primary = 第一条（无命中为 null）
 */
export function resolveAlias (name, gameId) {
  return safe(() => {
    const key = normalizeForMatch(name)
    if (!key) return { key: '', candidates: [], primary: null }
    const list = loadAliasMap(GAME_NAMES[gameId] ? gameId : undefined).get(key) || []
    const candidates = [...new Set(list.map(item => item.value).filter(Boolean))]
    return { key, candidates, primary: candidates[0] || null }
  }, { key: '', candidates: [], primary: null }, 'resolveAlias')
}

/**
 * 把关键词展开成检索变体（原词 + 别名，按游戏过滤、去重）
 * @param {string} keyword - 已去掉 `#` / `*` / `%` 前缀的关键词
 * @param {string} [gameId] - gi/hsr/zzz；缺省不按游戏过滤
 * @returns {{ raw: string, key: string, alias: boolean }[]} 异常时返回只含原词的单元素数组
 */
export function expandKeyword (keyword, gameId) {
  return safe(() => {
    const text = String(keyword || '')
    const variants = buildKeywordVariants(
      text,
      loadAliasMap(GAME_NAMES[gameId] ? gameId : undefined),
      GAME_NAMES[gameId] || ''
    )
    return variants.length ? variants : [{ raw: text, key: normalizeForMatch(text), alias: false }]
  }, [{ raw: String(keyword || ''), key: '', alias: false }], 'expandKeyword')
}

/**
 * 别名表版本号（消费者据此让派生缓存失效）
 * @returns {number} 首次调用会触发构建；每次 `reloadAliasMap()` 后 +1
 */
export function getAliasVersion () {
  return safe(() => readAliasVersion(), 0, 'getAliasVersion')
}

/**
 * 别名表状态摘要（排障 / 接入自检用）
 * @returns {{ version: number, keys: number, entries: number, games: {gi: number, hsr: number, zzz: number} }}
 *          异常时各字段为 0
 */
export function getAliasStatus () {
  return safe(() => {
    const map = loadAliasMap()
    const games = { gi: 0, hsr: 0, zzz: 0 }
    let entries = 0
    for (const list of map.values()) {
      for (const item of list) {
        entries++
        const gameId = Object.keys(GAME_NAMES).find(id => GAME_NAMES[id] === item.game)
        if (gameId) games[gameId]++
      }
    }
    return { version: readAliasVersion(), keys: map.size, entries, games }
  }, { version: 0, keys: 0, entries: 0, games: { gi: 0, hsr: 0, zzz: 0 } }, 'getAliasStatus')
}
