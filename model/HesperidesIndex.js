/**
 * Hesperides 索引：由 `index.json` 的页记录直接建出搜索索引（schema v2）
 *
 * `AtlasService.ensureIndex()` 只认一种输入形状——`games.<game>.locales.zh.pages[pageKey].records[id]`，
 * 每条记录带 `name` / `rarity` / `path` / `hasDetail` / `imageCount`。本模块把这个形状从 Hesperides
 * 产物直接合成出来：
 *
 *   - **只取 `INDEX_SOURCE`（nanoka）源**：内容页构建器按 nanoka 字段写；玉璃的终局页目录名
 *     （`abyss` / `chaos` / `as` …）与插件 pageKey 不同名，走 `Hesperides.getHesperidesPeriods()` 的期表路径
 *   - 页目录名（`<page>`，上游端点里的 `/` 换成 `-`）↔ 插件 pageKey 由 `PAGE_LABELS` 反推
 *   - `path` 用合成路径 `hes/<game>/<source>/<page>/<id>.json`
 *   - `name` / `rarity` 来自 `pages[<page>].entries`；`imageCount` / `icon` 抓过图后才有
 *
 * **单一数据源**：没有按页回退、也没有旧后端；产物里没有的页就是没有，插件按「未初始化」报错。
 */
import { PAGE_LABELS } from '../components/constants.js'
import { getHesperidesIndex, INDEX_SOURCE } from './Hesperides.js'
import { syntheticPath } from './HesperidesRepository.js'

/**
 * 页目录名 → 插件 pageKey
 *
 * 目录名规则与 Hesperides 的 `pageDir()` 一致：把上游端点里的 `/` 换成 `-`
 * （`achievement/achievement` → `achievement-achievement`）。从 `PAGE_LABELS` 反推而不是
 * 反向替换，避免 `item_all` 这类下划线页被误映射成 `item/all`。
 */
export const PAGE_KEY_BY_DIR = new Map(
  Object.keys(PAGE_LABELS).map((pageKey) => [pageKey.replace(/\//g, '-'), pageKey])
)

/**
 * 页目录名 → pageKey
 * @param {string} dir
 * @returns {string} 插件不索引的页返回空串
 */
export function pageKeyOfDir (dir) {
  return PAGE_KEY_BY_DIR.get(String(dir || '')) || ''
}

/**
 * 合成单页的记录表（`ensureIndex()` 的 records 形状）
 * @param {string} gameId
 * @param {string} dir - Hesperides 页目录名
 * @param {object} page - `index.json` 里的页对象（`ids` / `records` / `entries`）
 * @returns {Record<string, object>}
 */
export function pageToMapRecords (gameId, dir, page) {
  const entries = page?.entries && typeof page.entries === 'object' ? page.entries : {}
  const ids = Array.isArray(page?.ids) && page.ids.length ? page.ids.map(String) : Object.keys(entries)
  const records = {}
  for (const id of ids) {
    const label = entries[id] && typeof entries[id] === 'object' ? entries[id] : {}
    records[id] = {
      // 名字缺失（如玉璃的期记录只有 Phases 时间）时退化为 id，保证条目仍可按 id 命中
      name: label.name ? String(label.name) : String(id),
      rarity: label.rarity ?? '',
      path: syntheticPath(gameId, INDEX_SOURCE, dir, id),
      hasDetail: Boolean(label.hasDetail),
      imageCount: Number(label.imageCount) || 0,
      icon: label.icon || ''
    }
  }
  return records
}

/**
 * `index.json` 的 `games` → 插件可索引的页（只取 `INDEX_SOURCE` 源）
 * @param {object|null} games
 * @returns {Record<string, Record<string, {dir: string, records: object}>>} gameId → pageKey → 页
 */
export function buildMapPages (games) {
  const result = {}
  for (const [gameId, game] of Object.entries(games || {})) {
    const pages = {}
    for (const [dir, page] of Object.entries(game?.sources?.[INDEX_SOURCE]?.pages || {})) {
      // 优先用产物里的 pageKey（上游端点 key）；没有时按 PAGE_LABELS 反推，最后退回目录名
      const pageKey = page?.key || pageKeyOfDir(dir) || dir
      const records = pageToMapRecords(gameId, dir, page)
      if (!Object.keys(records).length) continue
      pages[pageKey] = { dir, records }
    }
    if (Object.keys(pages).length) result[gameId] = pages
  }
  return result
}

/**
 * 建出 `ensureIndex()` 消费的整份索引对象
 *
 * 空产物（没抓过 / schema 不兼容 / 只有终局页）返回 `null`，由调用方按「未初始化」处理。
 * @param {object|null} games
 * @returns {{games: object}|null}
 */
export function buildHesperidesMap (games) {
  const pagesByGame = buildMapPages(games)
  const map = { games: {} }
  for (const [gameId, pageMap] of Object.entries(pagesByGame)) {
    map.games[gameId] = { locales: { zh: { pages: {} } } }
    for (const [pageKey, page] of Object.entries(pageMap)) {
      map.games[gameId].locales.zh.pages[pageKey] = { title: '', records: page.records }
    }
  }
  return Object.keys(map.games).length ? map : null
}

/**
 * 读取 Hesperides 产物并直接建出索引对象
 * @returns {{games: object}|null} 无可用数据时为 `null`
 */
export function getHesperidesMap () {
  return buildHesperidesMap(getHesperidesIndex())
}

/**
 * 索引页数与记录数（用于日志）
 * @param {{games: object}|null} map
 * @returns {{pages: number, records: number}}
 */
export function countIndex (map) {
  let pages = 0
  let records = 0
  for (const game of Object.values(map?.games || {})) {
    for (const page of Object.values(game?.locales?.zh?.pages || {})) {
      pages += 1
      records += Object.keys(page?.records || {}).length
    }
  }
  return { pages, records }
}
