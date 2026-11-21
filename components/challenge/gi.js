/**
 * 原神终局视图（深渊 / 幻想真境剧诗 / 幽境危战）
 *
 * 版面仿玉璃站：怪物不单独成段，只作为「这一间 / 这一关 / 这张牌」里的战斗卡出现，
 * 每只怪带自己的图标（图标放大占位）、数量、血量与抗性。
 */
import { giCurveValue } from '../../model/monsterIndex/curve.js'
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
        title: `${floorNo}-${chamber?.Index ?? '?'} ${Number(chamber?.Half) === 2 ? '下半' : '上半'}`,
        sub: chamber?.Level ? `Lv.${chamber.Level}` : '',
        monsters: rows
      })
    }
    pushGroup(groups, battleGroup(`第 ${floorNo} 层`, cards))
  }
  return groups
}

/** 幻想真境剧诗：元素限制 → 开幕/特邀角色 → 首领 → 圣牌 → 各幕（含幕内血量） */
export function giTheaterView (record, ctx = {}) {
  const list = record?.content?.list || {}
  const groups = []
  const monsters = list.Monsters || {}
  const monsterData = list.MonsterData || {}
  const resolve = makeMonsterResolver('gi', record, monsters)
  const period = ctx.period || {}
  // 玉璃自己的成长曲线表（剧诗幕内血量按它算，才能与站点逐值一致）
  const growCurves = typeof ctx.readRecord === 'function' ? ctx.readRecord('gi', 'alioth', 'grow-curves', '__index')?.Curves : null

  const elems = Array.isArray(list.Elem) ? list.Elem : []
  pushGroup(groups, listGroup('本期限制', [
    elems.length ? { label: '可用元素', value: elems.map(elemLabel).join(' / ') } : null
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

  // 各幕：幕 → 配置 → 怪物；血量按「幕倍率 × 怪物倍率 × 成长曲线 × 曲线基准」算绝对值
  const mp = list.MP || {}
  const chamberCards = (list.Chambers || []).map((chamber) => {
    const chamberId = Number(chamber?._id)
    const multiplier = theaterMultiplier(period, chamberId)
    const rows = []
    for (const configId of Array.isArray(chamber?.Configs) ? chamber.Configs : []) {
      for (const monsterId of mp[configId] || []) {
        const id = String(monsterId)
        const info = resolve(id)
        const data = monsterData[id] || {}
        rows.push(battleMonster({
          name: info.name,
          icon: info.icon,
          hp: theaterHp(data, chamber?.Level, multiplier, growCurves),
          chips: [elemLabel(data.Color)]
        }))
      }
    }
    return {
      title: `第 ${chamberId ?? '?'} 幕`,
      sub: chamber?.Level ? `Lv.${chamber.Level}` : '',
      monsters: rows
    }
  })
  pushGroup(groups, battleGroup('各幕', chamberCards, { cols: 2 }))
  return groups
}

/** 阵容幕 1,2,4,5,7,9 用 `HPChamber`；Boss 幕 3,6,8,10,11,12 用 `HP` */
const THEATER_LINEUP_CHAMBERS = [1, 2, 4, 5, 7, 9]
const THEATER_BOSS_CHAMBERS = [3, 6, 8, 10, 11, 12]

/** 取某一幕的血量倍率（期对象上的 `hpByLineup` / `hpByBoss`，来自引擎带出的 manifest 期字段） */
function theaterMultiplier (period, chamberId) {
  const lineup = THEATER_LINEUP_CHAMBERS.indexOf(chamberId)
  if (lineup >= 0) return period?.hpByLineup?.[lineup]
  const boss = THEATER_BOSS_CHAMBERS.indexOf(chamberId)
  if (boss >= 0) return period?.hpByBoss?.[boss]
  return undefined
}

/**
 * 幕内绝对血量（口径抄自玉璃前端 `utils/giTheaterHp.ts`）：
 * `幕倍率 × 怪物倍率 × 成长曲线(等级) × 曲线基准系数`
 */
const THEATER_CURVE = {
  // 1 → [玉璃曲线号, 基准系数, 内置曲线名（回退用）]
  1: [10, 13.584, 'GROW_CURVE_HP'],
  2: [20, 27.168, 'GROW_CURVE_HP_2'],
  3: [30, 12.56, 'GROW_CURVE_ATTACK'],
  4: [40, 12.56, 'GROW_CURVE_ATTACK_2'],
  7: [70, 32.4689, 'GROW_CURVE_ACTIVITY_HP_1'],
  10: [10, 1, 'GROW_CURVE_HP'],
  20: [20, 1, 'GROW_CURVE_HP_2'],
  30: [30, 1, 'GROW_CURVE_ATTACK'],
  40: [40, 1, 'GROW_CURVE_ATTACK_2']
}

function theaterHp (monsterData, level, multiplier, curves) {
  if (!monsterData || multiplier === undefined || multiplier === null) return ''
  const curve = THEATER_CURVE[monsterData.HPCurve]
  if (!curve) return ''
  // 优先用玉璃自己的曲线表（`Curves[等级][曲线号]`，索引 0 不用；与站点逐值一致），
  // 没有这一页时回落到本插件内置的官方曲线（末尾可能差 1，因为上游表只保留 4 位小数）
  const growth = curves?.[Number(level)]?.[curve[0]] ?? giCurveValue(curve[2], Number(level))
  if (growth === null || growth === undefined) return ''
  const hp = Number(multiplier) * Number(monsterData.HP || 0) * growth * curve[1]
  return Number.isFinite(hp) ? num(Math.round(hp), 0) : ''
}

/** 幽境危战：三间各一个文本框（N5/6 主档 + N4/N1-3 尾注 + 玉璃研究），另附强度研究院解析 */
export function giStygianView (record, ctx = {}) {
  const list = record?.content?.list || {}
  const groups = []
  const monsters = list.Monsters || {}
  const resolve = makeMonsterResolver('gi', record, monsters)

  const levels = Array.isArray(list.Levels) ? list.Levels : []
  pushGroup(groups, listGroup('难度', levels.map((level) => ({
    label: `难度 ${level?.Level ?? '?'}`,
    value: (level?.Monsters || []).map((id) => resolve(id).name).join('、') || '—'
  }))))

  // 每个怪物 id → 该 Boss 的四档血量（N3/N4/N5/N6）
  const hpTiers = new Map()
  for (const item of Array.isArray(list.HPShow) ? list.HPShow : []) {
    const tiers = (item?.HP || []).map(Number).filter((n) => Number.isFinite(n))
    if (item?.ID && tiers.length) hpTiers.set(String(item.ID), tiers)
  }

  // 以最高难度档（N5）的三只为准，一团一张卡
  const strongIds = (levels.at(-1)?.Monsters || Object.keys(monsters)).map(String)
  const strongCards = []
  const bossCards = []
  for (const id of strongIds) {
    const raw = monsters[id] || {}
    const info = resolve(id)
    const tiers = hpTiers.get(String(raw?.ID || id)) || []
    const n5 = tiers[2]
    const n6 = tiers[3]
    const hpText = n5 && n6 ? `${num(n5, 0)} / ${num(n6, 0)}` : (n5 ? num(n5, 0) : '')
    const fields = []
    if (raw?.Title) fields.push({ label: '称号', value: plain(raw.Title) })
    // 尾注：N4 的名字与血量、N1-3 的「常形」与（有则给）血量
    const n4 = findMonsterByName(monsters, levels, 4, id, levels.length - 1)
    if (n4 && (n4.name || n4.hp)) fields.push({ label: '难度 4', value: [n4.name, n4.hp].filter(Boolean).join(' · ') })
    const common = findMonsterByName(monsters, levels, 3, id, levels.length - 1)
    if (common && common.hp) fields.push({ label: '难度 1-3', value: `${common.name || '常形'} · ${common.hp}` })
    // 「玉璃的研究」：怪物的说明与逐条机制
    if (raw?.Desc) fields.push({ label: '说明', value: plain(raw.Desc, 140) })
    for (const buff of raw?.Buff || []) fields.push({ label: plain(buff?.Name) || '机制', value: plain(buff?.Desc, 140) })
    const card = {
      title: '',
      sub: plain(raw.Title),
      monsters: [battleMonster({
        name: info.name,
        icon: info.icon,
        hp: hpText,
        chips: [raw?.Level ? `Lv.${raw.Level}` : '', ...resChips(raw.RES)]
      })],
      fields
    }
    strongCards.push(card)
    bossCards.push({ title: info.name, fields: [] })
  }
  pushGroup(groups, battleGroup('强敌', strongCards, { cols: 1 }))

  // 「强度研究院」：官方文案解析（按版本 join，敌人用自己的名字与 N5/6 血量）
  const research = buildGensriResearch(ctx)
  pushGroup(groups, cardsGroup('强度研究院', research))

  const hpRows = (Array.isArray(list.HPShow) ? list.HPShow : []).map((item, index) => ({
    label: `第 ${index + 1} 组`,
    value: (item?.HP || []).map((hp, i) => `${num(hp, 0)}${item?.HPMult?.[i] ? `（×${num(item.HPMult[i], 1)}）` : ''}`).join(' / ')
  }))
  pushGroup(groups, collapseGroup('血量档位', hpRows))
  return groups
}

/** 同一 Boss 在指定难度档里的名字与血量（玉璃 Levels 按档给 id） */
function findMonsterByName (monsters, levels, difficulty, baseId, fallbackIndex) {
  const tier = levels.find((level) => Number(level?.Level) === difficulty) || levels[fallbackIndex]
  if (!Array.isArray(tier?.Monsters)) return null
  // 各档的 id 不同，但同一位置的怪物是同一只；用最高档里的位置找同位置的档内 id
  const top = levels[levels.length - 1]?.Monsters || []
  const index = top.indexOf(Number(baseId))
  if (index < 0) return null
  const id = tier.Monsters[index]
  const raw = monsters[String(id)]
  if (!raw) return null
  return { name: plain(raw.Name) || '', hp: raw?.Stats?.HP ? num(raw.Stats.HP, 0) : '' }
}

/** 强度研究院的危战解析（同版本的 gensri 记录；没有就返回空） */
function buildGensriResearch (ctx) {
  const period = ctx.period || {}
  const version = String(period.version || '')
  if (!version || typeof ctx.readRecord !== 'function' || typeof ctx.rawPeriods !== 'function') return []
  const entry = (ctx.rawPeriods('gi', 'gensri', 'stygian') || []).find((item) => String(item.version) === version)
  if (!entry) return []
  const gensri = ctx.readRecord('gi', 'gensri', 'stygian', String(entry.id))
  const enemies = Array.isArray(gensri?.detail?.enemies) ? gensri.detail.enemies : []
  return enemies.map((enemy) => {
    const fields = []
    const five = enemy?.hp?.five
    const six = enemy?.hp?.six
    if (five || six) fields.push({ label: '血量（N5 / N6）', value: [five, six].filter(Boolean).map((hp) => num(hp, 0)).join(' / ') })
    for (const [index, text] of (enemy?.mechanism || []).entries()) {
      fields.push({ label: `解析 ${index + 1}`, value: plain(text, 220) })
    }
    return { title: plain(enemy?.name) || '敌人', fields, icons: [] }
  })
}