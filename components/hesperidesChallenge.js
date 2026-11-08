/**
 * 挑战页通用渲染器（Hesperides 原始记录 → sections）
 *
 * 背景：玉璃的 7 个终局玩法各有各的结构（`Floors` / `Stages` / `Levels` / `Chambers`…），
 * 与旧数据（`content.detail` 的楼层字典）完全不同。这里先用**一套通用启发式**出图：
 * 找到列表型字段 → 每条渲染一张表；标量字段进 hero 或「基础信息」；其余忽略。
 *
 * 这是「简单统一模板」阶段：先保证能看、能验证数据对不对，后续再按玩法做专用版式。
 */

/** 会被当作"列表"渲染的字段（按优先级） */
const LIST_KEYS = ['Floors', 'Stages', 'Levels', 'Chambers', 'Modes', 'Waves', 'Rounds']

/** 会被当作"增益/祝福"渲染的字段 */
const BUFF_KEYS = ['Buff', 'Buffs', 'Blessings', 'Skills']

/** hero 里取的名称字段 */
const NAME_KEYS = ['Name', 'Title', 'name', 'title']

const MAX_TEXT = 120
const MAX_ITEMS = 20

/** 去标签 + 截断 */
function plain (value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
}

/** 取数组里的名字/编号做单行摘要 */
function summarizeItem (item) {
  if (item === null || item === undefined) return ''
  if (typeof item !== 'object') return plain(item)
  for (const key of ['Name', 'Title', 'name', 'title', 'Monster', 'Id', 'ID', '_id']) {
    if (item[key] !== undefined) return plain(item[key])
  }
  return ''
}

/**
 * 把玉璃/nanoka 的挑战记录转成模板 sections
 * @param {string} pageKey - 插件页键
 * @param {object} record - Hesperides 里的原始记录
 * @returns {{title: string, fields: {label: string, value: string}[]}[]}
 */
export function buildHesperidesChallengeSections (pageKey, record) {
  if (!record || typeof record !== 'object') return []
  const sections = []

  // 增益 / 祝福：标量描述或数组
  for (const key of BUFF_KEYS) {
    const value = record[key]
    if (!value) continue
    const fields = []
    if (Array.isArray(value)) {
      for (const item of value.slice(0, MAX_ITEMS)) {
        const name = summarizeItem(item)
        const desc = typeof item === 'object' ? plain(item.Desc || item.Description || item.desc || '') : ''
        if (name || desc) fields.push({ label: name || '—', value: desc || '—' })
      }
    } else if (typeof value === 'object') {
      const name = summarizeItem(value)
      const desc = plain(value.Desc || value.Description || value.desc || '')
      if (name || desc) fields.push({ label: name || '增益', value: desc || '—' })
    } else {
      fields.push({ label: '增益', value: plain(value) })
    }
    if (fields.length) sections.push({ title: key === 'Skills' ? '技能 / 机制' : '增益', fields })
  }

  // 列表型结构：楼层 / 阶段 / 关卡
  for (const key of LIST_KEYS) {
    const list = record[key]
    if (!Array.isArray(list) || !list.length) continue
    for (const [index, item] of list.slice(0, MAX_ITEMS).entries()) {
      if (!item || typeof item !== 'object') continue
      const fields = []
      const name = summarizeItem(item)
      if (name) fields.push({ label: '名称', value: name })
      for (const [fieldKey, fieldValue] of Object.entries(item)) {
        if (['Name', 'Title', 'name', 'title', '_id', 'Id', 'ID'].includes(fieldKey)) continue
        if (typeof fieldValue === 'string' || typeof fieldValue === 'number') {
          const text = plain(fieldValue)
          if (text) fields.push({ label: fieldKey, value: text })
        } else if (Array.isArray(fieldValue) && fieldValue.length) {
          const text = fieldValue.slice(0, 8).map(summarizeItem).filter(Boolean).join('、')
          if (text) fields.push({ label: fieldKey, value: plain(text) })
        }
        if (fields.length >= 8) break
      }
      if (fields.length) sections.push({ title: `${key} ${index + 1}`, fields })
    }
  }

  // 敌人列表（顶层）
  if (!sections.length && Array.isArray(record.Monsters)) {
    const text = record.Monsters.slice(0, 12).map(summarizeItem).filter(Boolean).join('、')
    if (text) sections.push({ title: '敌人', fields: [{ label: '敌人', value: text }] })
  }

  return sections
}

/**
 * 从记录里取一个可展示的标题
 * @param {object} record
 * @returns {string}
 */
export function pickHesperidesTitle (record) {
  if (!record || typeof record !== 'object') return ''
  for (const key of NAME_KEYS) {
    if (record[key]) return plain(record[key])
  }
  return ''
}
