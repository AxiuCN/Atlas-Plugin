/**
 * 终局视图模型（challenge）公共工具
 *
 * 目标：把「各源各玩法各有各的结构」收敛成一套模板能渲染的形状。
 *
 * ```
 * view = {
 *   summary: [{ label, value }],
 *   groups: [
 *     { kind: 'list',     title, fields: [{ label, value }] },
 *     { kind: 'cards',    title, cards:  [{ title, sub, fields, icons }] },
 *     { kind: 'icons',    title, items:  [{ icon, name, sub }] },
 *     { kind: 'collapse', title, fields: [{ label, value }] }
 *   ]
 * }
 * ```
 *
 * 约定：
 *   - 只做「有的就上，没有就不造」，任何字段缺失都不补占位符、不猜名字；
 *   - 文本统一过 `plain()`（去标签、压空白），避免把上游 HTML 注记糊到画布上；
 *   - 图标按 `fieldPath` 从记录自带的 `imagerefs` 里取，取不到就不放 `<img>`。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { HESPERIDES_DIR } from '../../model/Hesperides.js'
import { getMonsterEntry } from '../../model/monsterIndex/index.js'
import { getPageRecords } from '../../model/AtlasService.js'
import { loadRecord } from '../../model/AtlasRepository.js'

const TEXT_MAX = 140

/** 去标签 + 压空白 + 截断（保留可读性，不保留上游 HTML 注记） */
export function plain (value, max = TEXT_MAX) {
  if (value === null || value === undefined) return ''
  const text = String(value)
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/[。！？]；/g, (m) => m[0])
    .replace(/；+/g, '；')
    .replace(/<[^>]+>/g, '')
    .replace(/\\[nr]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** HTML 转义（`rich()` 自己产标签，正文一律先转义再拼） */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escapeHtml = (text) => String(text ?? '').replace(/[&<>]/g, (char) => ESCAPES[char])

/** 单段文本清洗：换行压成中文分号、去标签、压空白（`rich()` 与 `plain()` 共用口径） */
function cleanText (value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/[。！？]；/g, (matched) => matched[0])
    .replace(/；+/g, '；')
    .replace(/<[^>]+>/g, '')
    .replace(/\\[nr]/g, ' ')
    .replace(/\s+/g, ' ')
}

/** 把 `<color …>…</color>` 切成「普通段 / 高亮段」，其余标签留给 cleanText 剥掉 */
function splitHighlight (value) {
  const source = String(value ?? '')
  const parts = []
  const re = /<color[^>]*>([\s\S]*?)<\/color>/gi
  let last = 0
  let matched
  while ((matched = re.exec(source))) {
    if (matched.index > last) parts.push({ text: source.slice(last, matched.index), highlight: false })
    parts.push({ text: matched[1], highlight: true })
    last = re.lastIndex
  }
  if (last < source.length) parts.push({ text: source.slice(last), highlight: false })
  return parts
}

/**
 * 正文富文本（模板用 `{{@…}}` 渲染）
 *
 * 上游正文里的 `<color>`（玉璃的 `var(--alioth-highlight-color)` 等）转成 `<span class="hl">`，
 * 其余标签照旧剥除、文本一律转义 —— 只有这里产出的标签可以被当成 HTML。
 * @param {*} value - 上游正文
 * @param {number} [max] - 可见字数上限（超出补 `…`）
 * @param {{highlight?: boolean}} [options] - 是否解析 `<color>`（只有玉璃终局页开）
 * @returns {string}
 */
export function rich (value, max = TEXT_MAX, options = {}) {
  if (value === null || value === undefined) return ''
  const parts = options.highlight ? splitHighlight(value) : [{ text: String(value), highlight: false }]
  const segments = parts
    .map((part) => ({ text: cleanText(part.text), highlight: part.highlight }))
    .filter((part) => part.text)

  let rest = max
  let truncated = false
  const kept = []
  for (const segment of segments) {
    if (rest <= 0) {
      truncated = true
      break
    }
    if (segment.text.length > rest) {
      kept.push({ text: segment.text.slice(0, rest), highlight: segment.highlight })
      truncated = true
      rest = 0
      break
    }
    kept.push(segment)
    rest -= segment.text.length
  }
  if (kept.length) {
    kept[0].text = kept[0].text.replace(/^\s+/, '')
    kept[kept.length - 1].text = kept[kept.length - 1].text.replace(/\s+$/, '')
  }
  const html = kept
    .map((segment) => (segment.highlight ? `<span class="hl">${escapeHtml(segment.text)}</span>` : escapeHtml(segment.text)))
    .join('')
  return truncated ? `${html}…` : html
}

/** 数值 → 文本（保留一位小数，避免 0.7 显示成 0.70 之外的噪声） */
export function num (value, digits = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return String(Number(n.toFixed(digits)))
}

/**
 * 百分比文本：支持 0.7（比率）与 "30%"（已带百分号）两种上游写法
 * @param {*} value
 * @returns {string}
 */
export function percent (value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' && value.includes('%')) return value
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return `${num(n * 100)}%`
}

/**
 * 记录里某字段的本地图片（file:// URL）
 *
 * Hesperides 的 `imagerefs` 用 `fieldPath` 精确指向记录字段（`Monsters.51337.Icon`），
 * 这里按同样的键取引用，占位图跳过。
 * @param {object} record — 插件记录（`{ meta: { images } }`）
 * @param {string} fieldPath
 * @returns {string}
 */
export function fieldImage (record, fieldPath) {
  if (!fieldPath) return ''
  const images = record?.meta?.images
  if (!Array.isArray(images) || !images.length) return ''
  const hit = images.find((image) => image?.fieldPath === fieldPath && image?.localPath && !image?.placeholder)
  if (!hit) return ''
  const localPath = String(hit.localPath).replace(/\\/g, '/')
  return pathToFileURL(path.join(HESPERIDES_DIR, localPath)).href
}

/**
 * 图标名 → 条目名（懒建缓存）
 *
 * 剧诗/危战记录里有些引用只给 `Icon`（`UI_MonsterIcon_*` / `UI_AvatarIcon_*`），不带名字，
 * 而怪物索引按 id 也查不到（活动关卡怪、内部编号）。这里用条目页的 `icon` 字段反查名字。
 * @param {string} gameId
 * @param {'character'|'monster'} pageKey
 * @returns {Map<string,string>}
 */
function iconNameMap (gameId, pageKey) {
  const key = `${gameId}|${pageKey}`
  const cached = iconNameMap.cache.get(key)
  if (cached) return cached
  const map = new Map()
  try {
    for (const entry of getPageRecords(gameId, pageKey) || []) {
      const record = loadRecord(entry.filePath)
      const list = record?.content?.list || {}
      const icon = list.icon || list.Icon
      const name = list.zh || list.name || list.Name || entry.name
      if (icon && name) map.set(String(icon), String(name))
    }
  } catch { /* 索引还没建好：返回空表，调用方回落 id */ }
  iconNameMap.cache.set(key, map)
  return map
}
iconNameMap.cache = new Map()

/**
 * 按图标名查条目名
 * @param {string} gameId
 * @param {string} icon
 * @returns {string}
 */
export function nameByIcon (gameId, icon) {
  if (!icon) return ''
  return iconNameMap(gameId, 'monster').get(String(icon)) ||
    iconNameMap(gameId, 'character').get(String(icon)) ||
    ''
}

/**
 * 按「图标名」取本地图标（`UI_MonsterIcon_*` → nanoka 怪物页里的本地图）
 *
 * 终局记录里的怪物常常只有图标名（剧诗的 `Monsters[id]` 是字符串、首领/圣牌只有 `Icon`），
 * 而该页的 `imagerefs` 未必覆盖这些字段（剧诗只抓了角色头像）。这里用 nanoka 怪物页的
 * `icon` 字段建一次 `图标名 → file://` 映射兜底。
 * @param {string} gameId
 * @param {string} icon
 * @returns {string}
 */
const characterIconCache = new Map()

/**
 * 角色 id → 本地头像（预览期记录只有 `featuredAvatars: [10000050…]`，没有图片引用）
 * @param {string} gameId
 * @param {string|number} id
 * @returns {string}
 */
export function characterIcon (gameId, id) {
  if (id === undefined || id === null) return ''
  const key = `character|${gameId}`
  let map = characterIconCache.get(key)
  if (!map) {
    map = new Map()
    try {
      for (const entry of getPageRecords(gameId, 'character') || []) {
        const record = loadRecord(entry.filePath)
        const url = fieldImage(record, 'icon')
        if (url) map.set(String(entry.recordId ?? entry.id), url)
      }
    } catch { /* 索引没建好：空表 */ }
    characterIconCache.set(key, map)
  }
  return map.get(String(id)) || ''
}
const nameIndexCache = new Map()

/**
 * 按条目 id 取名字（预览期只有 id，没有名字字段时用；如月亮网剧诗的 featuredAvatars）
 * @param {string} gameId
 * @param {string} pageKey
 * @param {string|number} id
 * @returns {string}
 */
export function entryNameById (gameId, pageKey, id) {
  if (id === undefined || id === null) return ''
  const key = `${gameId}|${pageKey}`
  let map = nameIndexCache.get(key)
  if (!map) {
    map = new Map()
    try {
      for (const entry of getPageRecords(gameId, pageKey) || []) {
        if (entry?.name) map.set(String(entry.recordId ?? entry.id), entry.name)
      }
    } catch { /* 索引没建好：空表 */ }
    nameIndexCache.set(key, map)
  }
  return map.get(String(id)) || ''
}
const iconImageCache = new Map()

export function monsterIconImage (gameId, icon) {
  if (!icon) return ''
  const key = `icon|${gameId}`
  let map = iconImageCache.get(key)
  if (!map) {
    map = new Map()
    try {
      for (const entry of getPageRecords(gameId, 'monster') || []) {
        const record = loadRecord(entry.filePath)
        const name = record?.content?.list?.icon
        if (!name) continue
        const url = fieldImage(record, 'icon')
        if (url && !map.has(String(name))) map.set(String(name), url)
      }
    } catch { /* 索引没建好：空表，调用方回落无图 */ }
    iconImageCache.set(key, map)
  }
  return map.get(String(icon)) || ''
}

/**
 * 怪物名/图标解析器
 *
 * 优先用记录内自带的 `Name` / `Icon`（玉璃的终局页把名字写在记录里），
 * 其次按 `Icon` 反查条目页，最后才回落怪物索引 / id。
 * @param {string} gameId
 * @param {object} record
 * @param {object} [local] - 该玩法记录里 id → 原始怪物对象的映射
 * @returns {(id:string|number) => { name: string, icon: string }}
 */
export function makeMonsterResolver (gameId, record, local = {}, container = 'Monsters') {
  return (id) => {
    const key = String(id)
    const raw = local?.[key]
    const fromIndex = getMonsterEntry(gameId, key)
    // 剧诗的 `Monsters[id]` 直接就是 Icon 字符串（不是对象），两种形态都要认
    const rawIcon = typeof raw === 'string' ? raw : (raw?.Icon || raw?.icon || '')
    const icon = fieldImage(record, `${container}.${key}.Icon`) ||
      fieldImage(record, `${container}.${key}`) ||
      fieldImage(record, `Monsters.${key}.Icon`) ||
      fieldImage(record, `Monsters.${key}`)
    const name = plain(typeof raw === 'string' ? '' : (raw?.Name || raw?.name || fromIndex?.name || '')) ||
      nameByIcon(gameId, rawIcon) ||
      key
    return { name, icon }
  }
}

/** 两列清单段 */
export function listGroup (title, fields) {
  const rows = (fields || []).filter((field) => field?.label && field?.value !== '' && field?.value !== null && field?.value !== undefined)
  return rows.length ? { kind: 'list', title, fields: rows } : null
}

/** 图标网格段（复用 .material-grid 样式） */
export function iconGroup (title, items, { cols = 0 } = {}) {
  const rows = (items || []).filter((item) => item && (item.name || item.icon))
  if (!rows.length) return null
  const group = { kind: 'icons', title, items: rows }
  if (cols) group.cols = cols
  return group
}

/** 分块卡片段（楼层 / 关卡 / 强敌）；`cols: 2` 只给字段短的段用，长文本走单列 */
export function cardsGroup (title, cards, { cols = 1 } = {}) {
  const rows = (cards || []).filter((card) => card && (card.title || card.fields?.length || card.icons?.length))
  if (!rows.length) return null
  const group = { kind: 'cards', title, cards: rows }
  if (cols === 2) group.cols = 2
  return group
}

/**
 * 战斗卡段（仿玉璃：一卡一「间/关/房间」，卡里就是这间的怪）
 *
 * @param {string} title
 * @param {Array<{title?: string, sub?: string, monsters?: object[], notes?: {label:string,value:string}[]}>} cards
 * @param {{cols?: number}} [opts]
 */
export function battleGroup (title, cards, { cols = 3, dense = false } = {}) {
  const rows = (cards || []).filter((card) => card && (card.title || card.monsters?.length))
  if (!rows.length) return null
  const group = { kind: 'battle', title, cards: rows, cols }
  if (dense) group.dense = true
  return group
}

/** 一只怪物 → 战斗卡里的条目（图标放大占位、数量、血量、抗性） */
export function battleMonster ({ name, icon, count = 0, hp = '', chips = [] } = {}) {
  return {
    name: name || '',
    icon: icon || '',
    count: Number(count) > 1 ? String(count) : '',
    hp: hp === '' || hp === null || hp === undefined ? '' : String(hp),
    chips: (chips || []).filter(Boolean)
  }
}

/**
 * 卡内分块（玉璃那种「研究 / 官方解释」的层级）
 *
 * 每条是「小标题 + 若干段落」，**不占左列**（表格两列会让短标题吃掉三分之一宽度）。
 * @param {string} title
 * @param {Array<{name?: string, paragraphs?: string[]}>} items
 */
export function block (title, items) {
  const rows = (items || [])
    .filter((item) => item && (item.name || item.paragraphs?.length))
    .map((item) => ({
      name: item.name || '',
      paragraphs: (item.paragraphs || []).filter(Boolean)
    }))
  return rows.length ? { title, items: rows } : null
}

/** 折叠段（血量档位这类「有数据但不必抢眼」的信息） */
export function collapseGroup (title, fields) {
  const rows = (fields || []).filter((field) => field?.label && field?.value)
  return rows.length ? { kind: 'collapse', title, fields: rows } : null
}

export function pushGroup (groups, group) {
  if (group) groups.push(group)
  return groups
}

/** 旧通用 sections → 视图段（未知玩法/字段变化时兜底，不空白） */
export function groupsFromSections (sections) {
  return (sections || [])
    .map((section) => listGroup(
      section?.title || '详情',
      (section?.fields || []).map((field) => ({ label: field?.label, value: rich(field?.value, 400) }))
    ))
    .filter(Boolean)
}