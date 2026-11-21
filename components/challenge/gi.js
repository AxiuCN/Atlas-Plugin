/**
 * 原神终局视图（深渊 / 幻想真境剧诗 / 幽境危战）
 *
 * 版面仿玉璃站：怪物不单独成段，只作为「这一间 / 这一关 / 这张牌」里的战斗卡出现，
 * 每只怪带自己的图标（图标放大占位）、数量、血量与抗性。
 */
import {
  plain, num, percent, fieldImage, makeMonsterResolver, nameByIcon,
  listGroup, iconGroup, cardsGroup, battleGroup, battleMonster, collapseGroup, pushGroup
} from './view.js'

/** 元素/颜色码 → 中文（玉璃用英文枚举） */
const ELEM_LABEL = {
  Fire: '火', Water: '水', Wind: '风', Elec: '雷', Ice: '冰', Rock: '岩', Grass: '草',
  Quantum: '量子', Imaginary: '虚数', Physical: '物理', None: '无', All: '全抗'
}

const elemLabel = (value) => (Array.isArray(value) ? value.map((item) => ELEM_LABEL[item] || String(item)).join(' / ') : (ELEM_LABEL[value] || plain(value)))

/** 抗性 → 小标签（`[[["Ice"],"30%"]]` 或 `{Water:0.7}`） */
function resChips (res) {
  if (!res) return []
  if (Array.isArray(res)) {
    return res.map((item) => {
      if (!Array.isArray(item)) return ''
      const [elems, value] = item
      return `${elemLabel(elems)} ${percent(value)}`
    }).filter(Boolean)
  }
  if (typeof res === 'object') {
    return Object.entries(res).map(([key, value]) => `${elemLabel(key)} ${percent(value)}`)
  }
  return []
}

/** 元素 + 抗性合并成标签：元素名与某条抗性同名时不重复写（`冰` + `冰 30%` → 只留后者） */
function composeChips (color, res) {
  const chips = resChips(res)
  const element = color ? elemLabel(color) : ''
  if (!element) return chips
  if (chips.some((chip) => chip.startsWith(element))) return chips
  return [element, ...chips]
}

/** 深境螺旋：月之祝福 → 每层（地脉异常 + 各间战斗卡） */
export function giAbyssView (record) {
  const list = record?.content?.list || {}
  const groups = []
  const monsters = list.Monsters || {}
  const resolve = makeMonsterResolver('gi', record, monsters)

  const blessings = Array.isArray(list.Blessings) ? list.Blessings : []
  pushGroup(groups, cardsGroup('月之祝福', blessings.map((item) => ({
    title: plain(item?.Name),
    fields: [{ label: '效果', value: plain(item?.Desc, 220) }]
  }))))

  for (const floor of Array.isArray(list.Floors) ? list.Floors : []) {
    const floorNo = floor?.Index ?? '?'
    if (floor?.Disorder || floor?.HPRatio) {
      pushGroup(groups, listGroup(`第 ${floorNo} 层 · 地脉异常`, [
        { label: '生命倍率', value: floor?.HPRatio ? `×${num(floor.HPRatio, 2)}` : '' },
        { label: '效果', value: floor?.Disorder ? plain(floor.Disorder, 240) : '' }
      ]))
    }
    const cards = []
    for (const chamber of floor?.Chambers || []) {
      const rows = []
      for (const wave of chamber?.Waves || []) {
        for (const monster of wave?.Monsters || []) {
          const id = String(monster?.ID ?? '')
          const raw = monsters[id] || {}
          const info = resolve(id)
          rows.push(battleMonster({
            name: info.name,
            icon: info.icon,
            count: monster?.Num,
            hp: monster?.HP ? num(monster.HP, 0) : '',
            chips: composeChips(raw.Color, raw.RES)
          }))
        }
      }
      cards.push({
        title: `${floorNo}-${chamber?.Index ?? '?'} P${chamber?.Half ?? 1}`,
        sub: chamber?.Level ? `Lv.${chamber.Level}` : '',
        monsters: rows
      })
    }
    pushGroup(groups, battleGroup(`第 ${floorNo} 层`, cards))
  }
  return groups
}

/** 幻想真境剧诗：元素限制 → 开幕/特邀角色 → 首领 → 圣牌 */
export function giTheaterView (record) {
  const list = record?.content?.list || {}
  const groups = []
  const monsters = list.Monsters || {}
  const resolve = makeMonsterResolver('gi', record, monsters)

  const elems = Array.isArray(list.Elem) ? list.Elem : []
  pushGroup(groups, listGroup('本期限制', [
    elems.length ? { label: '可用元素', value: elems.map(elemLabel).join(' / ') } : null,
    list.Initial?.length ? { label: '开幕角色', value: `${list.Initial.length} 名` } : null,
    list.Invitation?.length ? { label: '特邀角色', value: `${list.Invitation.length} 名` } : null
  ]))

  pushGroup(groups, iconGroup('开幕角色', (list.Initial || []).map((item, index) => ({
    icon: fieldImage(record, `Initial.${index}.Icon`),
    name: plain(item?.Name) || nameByIcon('gi', item?.Icon),
    sub: ''
  }))))
  pushGroup(groups, iconGroup('特邀角色', (list.Invitation || []).map((item, index) => ({
    icon: fieldImage(record, `Invitation.${index}.Icon`),
    name: plain(item?.Name) || nameByIcon('gi', item?.Icon),
    sub: ''
  }))))

  const bossCards = (Array.isArray(list.Boss) ? list.Boss : []).map((item, index) => ({
    title: '',
    sub: plain(item?.Time) || `首领 ${index + 1}`,
    monsters: (item?.Monsters || []).map((monster, i) => {
      const id = String(monster?.ID ?? '')
      const info = resolve(id)
      return battleMonster({
        name: plain(monster?.Name) || nameByIcon('gi', monster?.Icon) || info.name,
        icon: info.icon || fieldImage(record, `Boss.${index}.Monsters.${i}.Icon`),
        hp: monster?.HP ? num(monster.HP, 0) : '',
        chips: [elemLabel(monster?.Color)]
      })
    })
  }))
  pushGroup(groups, battleGroup('首领', bossCards))

  const arcanaCards = (Array.isArray(list.Arcana) ? list.Arcana : []).map((item, index) => {
    const count = /^x?(\d+)$/i.exec(String(item?.Time || '').trim())
    return {
      title: '',
      sub: item?.Time ? String(item.Time) : '',
      monsters: (item?.Monsters || []).map((monster, i) => {
        const id = String(monster?.ID ?? '')
        const info = resolve(id)
        return battleMonster({
          name: plain(monster?.Name) || nameByIcon('gi', monster?.Icon) || info.name,
          icon: info.icon || fieldImage(record, `Arcana.${index}.Monsters.${i}.Icon`),
          count: count ? count[1] : '',
          hp: monster?.HP ? num(monster.HP, 0) : '',
          chips: [elemLabel(monster?.Color)]
        })
      })
    }
  })
  pushGroup(groups, battleGroup('圣牌', arcanaCards, { cols: 2 }))
  return groups
}

/** 幽境危战：难度档 → 强敌战斗卡 → 每个强敌的机制卡 → 血量档位 */
export function giStygianView (record) {
  const list = record?.content?.list || {}
  const groups = []
  const monsters = list.Monsters || {}
  const resolve = makeMonsterResolver('gi', record, monsters)

  const levels = Array.isArray(list.Levels) ? list.Levels : []
  pushGroup(groups, listGroup('难度', levels.map((level) => ({
    label: `难度 ${level?.Level ?? '?'}`,
    value: (level?.Monsters || []).map((id) => resolve(id).name).join('、') || '—'
  }))))

  // 强敌取最高难度档的那批（玉璃站首页只摆这几个）
  const strongIds = (levels.at(-1)?.Monsters || Object.keys(monsters)).map(String)
  // 血量双档：基础 HP / 最高档 HP（对应站点的「普通 / 困难」两行）
  const hpTiers = new Map()
  for (const item of Array.isArray(list.HPShow) ? list.HPShow : []) {
    const tiers = (item?.HP || []).map(Number).filter((n) => Number.isFinite(n))
    if (item?.ID && tiers.length) hpTiers.set(String(item.ID), tiers)
  }
  const strongCards = []
  const mechanisms = []
  for (const id of strongIds) {
    const raw = monsters[id] || {}
    const info = resolve(id)
    const res = resChips(raw.RES)
    const baseHp = Number(raw?.Stats?.HP || 0)
    const tiers = hpTiers.get(String(raw?.ID || id)) || []
    const topHp = tiers.length ? Math.max(...tiers) : 0
    const hpText = baseHp
      ? (topHp > baseHp ? `${num(baseHp, 0)} / ${num(topHp, 0)}` : num(baseHp, 0))
      : ''
    strongCards.push({
      title: '',
      sub: plain(raw.Title),
      monsters: [battleMonster({
        name: info.name,
        icon: info.icon,
        hp: hpText,
        chips: [raw?.Level ? `Lv.${raw.Level}` : '', ...res]
      })]
    })
    const fields = []
    if (raw?.Desc) fields.push({ label: '说明', value: plain(raw.Desc, 220) })
    for (const buff of raw?.Buff || []) fields.push({ label: plain(buff?.Name) || '机制', value: plain(buff?.Desc, 220) })
    if (fields.length) mechanisms.push({ title: info.name, sub: plain(raw.Title), fields, icons: [] })
  }
  pushGroup(groups, battleGroup('强敌', strongCards))
  pushGroup(groups, cardsGroup('机制', mechanisms))

  const hpRows = (Array.isArray(list.HPShow) ? list.HPShow : []).map((item, index) => ({
    label: `第 ${index + 1} 组`,
    value: (item?.HP || []).map((hp, i) => `${num(hp, 0)}${item?.HPMult?.[i] ? `（×${num(item.HPMult[i], 1)}）` : ''}`).join(' / ')
  }))
  pushGroup(groups, collapseGroup('血量档位', hpRows))
  return groups
}