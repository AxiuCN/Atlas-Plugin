/**
 * 挑战页「超前层」：把预览源里比主表多出来的那一期接在主表后面
 *
 * 分工：**期表与日期一律以主表（玉璃）为准**，预览源只提供「下一期的身份与内容」。
 * 身份键按玩法各不相同，全部由数据推断，不写死期号、偏移或日期：
 *   - gi/tower      祝福名（玉璃 `Blessings[].Name` ↔ 月亮网 `chsBuffName`）
 *   - gi/rolecombat 序号（月亮网有效期条数与主表对齐后，多出来的那几条）
 *   - gi/leyline    版本号（强度研究院 `version` 不在主表版本集合里）
 *   - hsr/maze_boss 期 id（nanoka 目录里主表没有的 id）
 *
 * 任何一条推断不成立就返回空数组——宁可不预告，也不猜。
 * 预览期的 `begin`/`end` 由主表的期节奏外推（主表每期相差几个月，就往后推几个月）；
 * 期间内容来自预览源，渲染时统一加「预告」标注，见 `buildPreviewSections()`。
 */
import { readRawByPath, syntheticPath } from './HesperidesRepository.js'
import { parseDataTime } from './ChallengeVersion.js'

/**
 * 解析预览源的时间
 *
 * 主表（玉璃）用 `YYYY-MM-DD[ HH:mm:ss]` 的本地时间；强度研究院给的是带偏移的 ISO
 * （`2026-12-23T10:00:00+08:00`），`parseDataTime()` 不认。这里只把**带显式时区**的串
 * 交给 `Date.parse`，其余仍走本地时间解析——否则无时区的串会被当 UTC，整体偏 8 小时。
 * @param {string} text
 * @returns {Date|null}
 */
function parseTime (text) {
  const local = parseDataTime(text)
  if (local) return local
  if (typeof text === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(text.trim())) {
    const time = Date.parse(text)
    if (Number.isFinite(time)) return new Date(time)
  }
  return null
}

const TEXT_MAX = 100
const DAY_MS = 24 * 60 * 60 * 1000
/** 剧诗序列与主表的容差：期数差超过这个值就判定推断不可信 */
const MAX_EXTRA_PERIODS = 3

/** 去标签 + 截断 */
function plain (value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text
}

/**
 * 按月平移日期（保留「第几天」，月底不足则退到当月最后一天）
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
export function addMonths (date, months) {
  const result = new Date(date.getTime())
  const day = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() + months)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDay))
  return result
}

/** 主表相邻两期的月份差（取最后两期，异常回落 1） */
export function monthStep (main) {
  if (!Array.isArray(main) || main.length < 2) return 1
  const prev = main.at(-2)?.begin
  const last = main.at(-1)?.begin
  if (!(prev instanceof Date) || !(last instanceof Date)) return 1
  const months = (last.getFullYear() - prev.getFullYear()) * 12 + (last.getMonth() - prev.getMonth())
  return months > 0 ? months : 1
}

/** 中位数（空数组返回 0） */
function median (list) {
  if (!list.length) return 0
  const sorted = [...list].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** 读预览源的一条记录（不存在返回 null） */
function readPreviewRecord (previewSource, previewPage, id, gameId = 'gi') {
  try {
    return readRawByPath(syntheticPath(gameId, previewSource, previewPage, String(id)))
  } catch {
    return null
  }
}

/**
 * 深境螺旋：以「祝福名」为身份键
 *
 * 玉璃每期带 `Blessings[].Name`（月之祝福名），月亮网每条记录带 `chsBuffName`。
 * 月亮网里名字不在主表集合中的，就是主表还没发布的那一期。
 */
function abyssPreview ({ main, pageIds }) {
  const known = new Set()
  for (const period of main.slice(-3)) {
    const record = readRawByPath(syntheticPath('gi', 'alioth', 'abyss', String(period.id)))
    const blessings = Array.isArray(record?.Blessings) ? record.Blessings : []
    for (const item of blessings) if (item?.Name) known.add(String(item.Name))
  }
  if (!known.size) return []
  const ids = (pageIds('gi', 'lunaris', 'tower') || [])
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b)
    .slice(-4)
  const step = monthStep(main)
  const last = main.at(-1)
  const out = []
  for (const id of ids) {
    const record = readPreviewRecord('lunaris', 'tower', id)
    const name = String(record?.chsBuffName || '')
    if (!name || known.has(name)) continue
    const k = out.length + 1
    out.push({
      id: `preview:lunaris:tower:${id}`,
      name,
      version: '',
      begin: addMonths(last.begin, step * k),
      end: addMonths(last.end, step * k),
      preview: true,
      previewSource: 'lunaris',
      previewPage: 'tower',
      previewRecordId: String(id)
    })
    if (out.length >= 2) break
  }
  return out
}

/**
 * 幻想真境剧诗：以「序号」为身份键
 *
 * 剧诗 2024-07 起每月一期，月亮网按 id 递增存同一序列（更早有两条测试服期）。
 * 取「有效序列条数 − 主表条数」，多出来的就是超前期；差值不合理就放弃。
 */
function theaterPreview ({ main, pageIds }) {
  const ids = (pageIds('gi', 'lunaris', 'rolecombat') || [])
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0 && id < 1000)
    .sort((a, b) => a - b)
  if (!ids.length) return []
  // 排除剧诗上线前（2024-07）的测试服期，以及 2099 这类占位哨兵
  const eraStart = new Date(main[0].begin.getTime() - 60 * DAY_MS)
  const eraEnd = new Date(Date.now() + 400 * DAY_MS)
  const series = ids.filter((id) => {
    const begin = parseTime(readPreviewRecord('lunaris', 'rolecombat', id)?.beginTime)
    return begin && begin >= eraStart && begin <= eraEnd
  })
  const extra = series.length - main.length
  if (extra <= 0 || extra > MAX_EXTRA_PERIODS) return []
  const step = monthStep(main)
  const last = main.at(-1)
  return series.slice(main.length).map((id, index) => ({
    id: `preview:lunaris:rolecombat:${id}`,
    name: '',
    version: '',
    begin: addMonths(last.begin, step * (index + 1)),
    end: addMonths(last.end, step * (index + 1)),
    preview: true,
    previewSource: 'lunaris',
    previewPage: 'rolecombat',
    previewRecordId: String(id)
  }))
}

/** 幽境危战：以「版本号」为身份键（强度研究院的期直接用版本命名） */
function stygianPreview ({ main, rawPeriods }) {
  const known = new Set(main.map((period) => String(period.version || '')).filter(Boolean))
  const entries = rawPeriods('gi', 'gensri', 'stygian') || []
  const out = []
  for (const entry of entries) {
    const version = String(entry?.version || '')
    if (!version || known.has(version)) continue
    const begin = parseTime(entry.begin)
    const end = parseTime(entry.end)
    if (!begin || !end) continue
    out.push({
      id: `preview:gensri:stygian:${entry.id}`,
      name: entry.name || '',
      version,
      begin,
      end,
      preview: true,
      previewSource: 'gensri',
      previewPage: 'stygian',
      previewRecordId: String(entry.id)
    })
  }
  return out
}

/** 末日幻影：以「期 id」为身份键；期跨度明显超常的标 `suspect` */
function mazeBossPreview ({ main, rawPeriods }) {
  const known = new Set(main.map((period) => String(period.id)))
  const entries = rawPeriods('hsr', 'nanoka', 'maze_boss') || []
  const limit = median(main.map((period) => period.end - period.begin)) * 1.5
  const lastBegin = main.at(-1).begin
  const out = []
  for (const entry of entries) {
    if (known.has(String(entry?.id))) continue
    const begin = parseTime(entry.begin)
    const end = parseTime(entry.end)
    if (!begin || !end || begin <= lastBegin) continue
    const item = {
      id: `preview:nanoka:maze_boss:${entry.id}`,
      name: entry.name || '',
      version: '',
      begin,
      end,
      preview: true,
      previewSource: 'nanoka',
      previewPage: 'maze_boss',
      previewRecordId: String(entry.id)
    }
    if (limit > 0 && end - begin > limit) item.suspect = 'long-span'
    out.push(item)
  }
  return out
}

/**
 * 生成某挑战玩法的超前期（主表之后能再接上的那些）
 * @param {object} context
 * @param {string} context.gameId
 * @param {string} context.pageKey
 * @param {object[]} context.main - 主表期（已适配成 {id,no,name,version,begin,end}）
 * @param {(game:string, source:string, page:string) => object[]} context.rawPeriods - 读源产物里的原始期表
 * @param {(game:string, source:string, page:string) => string[]} context.pageIds - 读索引里的记录 id
 * @returns {object[]}
 */
export function buildPreviewPeriods ({ gameId, pageKey, main, rawPeriods, pageIds }) {
  if (!Array.isArray(main) || !main.length) return []
  const key = `${gameId}/${pageKey}`
  if (key === 'gi/tower') return abyssPreview({ main, pageIds })
  if (key === 'gi/rolecombat') return theaterPreview({ main, pageIds })
  if (key === 'gi/leyline') return stygianPreview({ main, rawPeriods })
  if (key === 'hsr/maze_boss') return mazeBossPreview({ main, rawPeriods })
  return []
}

/* ============================================================
 *  预览期内容 → 模板 sections
 * ============================================================ */

/** 月亮网深渊：月之祝福 + 楼层 */
function lunarisTowerSections (record) {
  const detail = record?.detail || {}
  const sections = []
  const buff = detail.monthlyBuff
  if (buff?.description) {
    sections.push({
      title: '月之祝福',
      fields: [{ label: String(record.chsBuffName || '祝福'), value: plain(buff.description) }]
    })
  }
  const floors = Array.isArray(detail.floors) ? detail.floors : []
  for (const floor of floors.slice(0, 4)) {
    const chambers = Array.isArray(floor?.chambers) ? floor.chambers : []
    const fields = []
    if (chambers.length) {
      fields.push({
        label: '房间等级',
        value: chambers.map((room) => String(room?.monsterLevel ?? '')).filter(Boolean).join(' / ')
      })
    }
    for (const [name, key] of [['上半祝福', 'firstHalfBuff'], ['下半祝福', 'secondHalfBuff']]) {
      const text = plain(floor?.[key])
      if (text) fields.push({ label: name, value: text })
    }
    if (fields.length) sections.push({ title: `第 ${floor?.floorIndex ?? '?'} 层`, fields })
  }
  return sections
}

/** 月亮网剧诗：元素限制 + 本期角色 + 商店 */
function lunarisRolecombatSections (record) {
  const sections = []
  const elements = Array.isArray(record?.elementRestrictions) ? record.elementRestrictions : []
  const avatars = Array.isArray(record?.featuredAvatars) ? record.featuredAvatars : []
  const fields = []
  if (elements.length) fields.push({ label: '元素限制', value: elements.map((v) => String(v)).join(' / ') })
  if (avatars.length) fields.push({ label: '本期角色', value: avatars.map((v) => String(v)).join('、') })
  if (fields.length) sections.push({ title: '基础信息', fields })
  const shop = Array.isArray(record?.detail?.shopItems) ? record.detail.shopItems : []
  if (shop.length) {
    sections.push({
      title: '商店',
      fields: shop.slice(0, 12).map((item, index) => ({
        label: `商品 ${index + 1}`,
        value: plain(item?.name || item?.Name || JSON.stringify(item))
      }))
    })
  }
  return sections
}

/** 强度研究院危战：期信息 + 敌阵 */
function gensriStygianSections (record) {
  const detail = record?.detail || {}
  const sections = []
  const fields = []
  if (record?.name) fields.push({ label: '期名', value: plain(record.name) })
  if (detail?.title) fields.push({ label: '标题', value: plain(detail.title) })
  if (detail?.date) fields.push({ label: '日期', value: plain(detail.date) })
  if (fields.length) sections.push({ title: '基础信息', fields })
  const enemies = Array.isArray(detail?.enemies) ? detail.enemies : []
  if (enemies.length) {
    sections.push({
      title: '敌阵',
      fields: enemies.slice(0, 8).map((enemy, index) => ({
        label: `敌人 ${index + 1}`,
        value: plain(enemy?.name || enemy?.title || enemy?.chsName || enemy?.key || '')
      })).filter((field) => field.value)
    })
  }
  return sections
}

/** nanoka 末日幻影：增益 + 各档关卡 */
function nanokaMazeBossSections (record) {
  const detail = record?.detail || {}
  const sections = []
  const buff = detail.buff
  if (buff) {
    const name = plain(buff?.name || buff?.Name || '')
    const desc = plain(buff?.desc || buff?.Desc || buff?.description || '')
    if (name || desc) sections.push({ title: '增益', fields: [{ label: name || '增益', value: desc || '—' }] })
  }
  const levels = Array.isArray(detail.level) ? detail.level : []
  for (const [index, level] of levels.slice(0, 6).entries()) {
    const fields = []
    if (level?.damage_type1) fields.push({ label: '伤害类型（上）', value: plain(level.damage_type1) })
    if (level?.damage_type2) fields.push({ label: '伤害类型（下）', value: plain(level.damage_type2) })
    if (level?.boss_monster_id) fields.push({ label: '首领 id', value: String(level.boss_monster_id) })
    if (fields.length) sections.push({ title: `关卡 ${index + 1}`, fields })
  }
  return sections
}

/**
 * 预览期内容 → sections（结构与模板一致；末尾统一加数据来源说明）
 * @param {string} previewSource
 * @param {string} previewPage
 * @param {object} record
 * @returns {{title: string, fields: {label: string, value: string}[]}[]}
 */
export function buildPreviewSections (previewSource, previewPage, record) {
  if (!record || typeof record !== 'object') return []
  let sections = []
  if (previewSource === 'lunaris' && previewPage === 'tower') sections = lunarisTowerSections(record)
  else if (previewSource === 'lunaris' && previewPage === 'rolecombat') sections = lunarisRolecombatSections(record)
  else if (previewSource === 'gensri') sections = gensriStygianSections(record)
  else if (previewSource === 'nanoka') sections = nanokaMazeBossSections(record)
  if (!sections.length) return []
  return sections
}