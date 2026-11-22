/**
 * 原神终局视图（深渊 / 幻想真境剧诗 / 幽境危战）
 *
 * 版面仿玉璃站：怪物不单独成段，只作为「这一间 / 这一关 / 这张牌」里的战斗卡出现；
 * 卡内再按「研究 / 官方解释」分块（小标题独立成行，不占左列）。
 */
import { giCurveValue } from '../../model/monsterIndex/curve.js'
import { listMonsterEntries } from '../../model/monsterIndex/index.js'
import {
  plain, num, percent, fieldImage, makeMonsterResolver, nameByIcon, monsterIconImage,
  listGroup, iconGroup, cardsGroup, battleGroup, battleMonster, block, pushGroup
} from './view.js'

/** 元素/颜色码 → 中文（玉璃用英文枚举） */
const ELEM_LABEL = {
  Fire: '火', Water: '水', Wind: '风', Elec: '雷', Ice: '冰', Rock: '岩', Grass: '草',
  Quantum: '量子', Imaginary: '虚数', Physical: '物理', None: '无', All: '全抗'
}

const elemLabel = (value) => (Array.isArray(value)
  ? value.map((item) => ELEM_LABEL[item] || String(item)).join(' / ')
  : (ELEM_LABEL[value] || plain(value)))

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

/* ============================================================
 *  深境螺旋
 * ============================================================ */

/** 深渊：月之祝福 → 每层（地脉异常 + 各间战斗卡，上半/下半） */
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

/* ============================================================
 *  幻想真境剧诗
 * ============================================================ */

/** 阵容幕 1,2,4,5,7,9 用 `HPChamber`；Boss 幕 3,6,8,10,11,12 用 `HP` */
const THEATER_LINEUP_CHAMBERS = [1, 2, 4, 5, 7, 9]
const THEATER_BOSS_CHAMBERS = [3, 6, 8, 10]
/** 圣牌幕（P11 / P12）：与 Arcana 两组一一对应 */
const THEATER_ARCANA_CHAMBERS = [11, 12]
/** 幕倍率表里的 Boss 序列（引擎 HP 数组含 4 个首领 + 2 个圣牌共 6 项） */
const THEATER_HP_BOSS_ORDER = [3, 6, 8, 10, 11, 12]

/** 取某一幕的血量倍率（期对象上的 `hpByLineup` / `hpByBoss`，来自引擎带出的 manifest 期字段） */
function theaterMultiplier (period, chamberId) {
  const lineup = THEATER_LINEUP_CHAMBERS.indexOf(chamberId)
  if (lineup >= 0) return period?.hpByLineup?.[lineup]
  const boss = THEATER_HP_BOSS_ORDER.indexOf(chamberId)
  if (boss >= 0) return period?.hpByBoss?.[boss]
  return undefined
}

/**
 * 幕内绝对血量（口径抄自玉璃前端 `utils/giTheaterHp.ts`）：
 * `幕倍率 × 怪物倍率 × 成长曲线(等级) × 曲线基准系数`
 */
const THEATER_CURVE = {
  // HPCurve → [玉璃曲线号, 基准系数, 内置曲线名（回退用）]
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

/** 剧诗：元素限制 → 开幕/特邀角色 → 首领 → 圣牌 → 各幕（含幕内血量） */
export function giTheaterView (record, ctx = {}) {
  const list = record?.content?.list || {}
  const groups = []
  const monsters = list.Monsters || {}
  const monsterData = list.MonsterData || {}
  const resolve = makeMonsterResolver('gi', record, monsters)
  const period = ctx.period || {}
  // 玉璃自己的成长曲线表（剧诗幕内血量按它算，才能与站点逐值一致）
  const growCurves = typeof ctx.readRecord === 'function'
    ? ctx.readRecord('gi', 'alioth', 'grow-curves', '__index')?.Curves
    : null

  const elems = Array.isArray(list.Elem) ? list.Elem : []
  pushGroup(groups, listGroup('本期限制', [
    elems.length ? { label: '可用元素', value: elems.map(elemLabel).join(' / ') } : null
  ]))

  pushGroup(groups, iconGroup('开幕角色', (list.Initial || []).map((item, index) => ({
    icon: fieldImage(record, `Initial.${index}.Icon`),
    name: plain(item?.Name) || nameByIcon('gi', item?.Icon),
    sub: ''
  })), { cols: 6 }))
  pushGroup(groups, iconGroup('特邀角色', (list.Invitation || []).map((item, index) => ({
    icon: fieldImage(record, `Invitation.${index}.Icon`),
    name: plain(item?.Name) || nameByIcon('gi', item?.Icon),
    sub: ''
  })), { cols: 6 }))

  const bossCards = (Array.isArray(list.Boss) ? list.Boss : []).map((item, index) => {
    const chamberId = THEATER_BOSS_CHAMBERS[index]
    const monsters = (item?.Monsters || []).map((monster, i) => {
      const id = String(monster?.ID ?? '')
      const info = resolve(id)
      return battleMonster({
        name: plain(monster?.Name) || nameByIcon('gi', monster?.Icon) || info.name,
        icon: info.icon || monsterIconImage('gi', monster?.Icon) || fieldImage(record, `Boss.${index}.Monsters.${i}.Icon`),
        hp: monster?.HP ? num(monster.HP, 0) : '',
        chips: [elemLabel(monster?.Color)]
      })
    })
    const first = monsters.find((monster) => monster.name)?.name || `首领 ${index + 1}`
    return {
      title: monsters.length > 1 ? `${first} 等 ${monsters.length}` : first,
      sub: [chamberId ? `P${chamberId}` : '', plain(item?.Time) ? `限时 ${plain(item.Time)}` : ''].filter(Boolean).join(' · '),
      monsters
    }
  })
  pushGroup(groups, battleGroup('首领', bossCards, { cols: 2 }))

  const arcanaCards = (Array.isArray(list.Arcana) ? list.Arcana : []).map((item, index) => {
    const chamberId = THEATER_ARCANA_CHAMBERS[index]
    return {
      title: `圣牌 ${index + 1}`,
      sub: [chamberId ? `P${chamberId}` : '', item?.Time ? String(item.Time) : ''].filter(Boolean).join(' · '),
      monsters: (item?.Monsters || []).map((monster, i) => {
        const id = String(monster?.ID ?? '')
        const info = resolve(id)
        return battleMonster({
          name: plain(monster?.Name) || nameByIcon('gi', monster?.Icon) || info.name,
          icon: info.icon || monsterIconImage('gi', monster?.Icon) || fieldImage(record, `Arcana.${index}.Monsters.${i}.Icon`),
          hp: monster?.HP ? num(monster.HP, 0) : '',
          chips: [elemLabel(monster?.Color)]
        })
      })
    }
  })
  pushGroup(groups, battleGroup('圣牌', arcanaCards, { cols: 2 }))

  // 各幕：只留阵容幕（P1/2/4/5/7/9），原编号给首领/圣牌；卡内按阵容分行
  const mp = list.MP || {}
  const chamberCards = []
  let actNo = 0
  for (const chamber of list.Chambers || []) {
    const chamberId = Number(chamber?._id)
    if (!THEATER_LINEUP_CHAMBERS.includes(chamberId)) continue
    actNo += 1
    const multiplier = theaterMultiplier(period, chamberId)
    const configs = Array.isArray(chamber?.Configs) ? chamber.Configs : []
    const lineups = []
    configs.forEach((configId, choiceIndex) => {
      const rows = (mp[configId] || []).map((monsterId) => {
        const id = String(monsterId)
        const info = resolve(id)
        const data = monsterData[id] || {}
        return battleMonster({
          name: info.name,
          icon: info.icon || monsterIconImage('gi', monsters[id]),
          hp: theaterHp(data, chamber?.Level, multiplier, growCurves),
          chips: [elemLabel(data.Color)]
        })
      })
      if (rows.length) lineups.push({ title: `阵容 ${choiceIndex + 1}`, monsters: rows })
    })
    if (!lineups.length) continue
    chamberCards.push({
      title: `第 ${actNo} 幕`,
      sub: [chamber?.Level ? `Lv.${chamber.Level}` : '', `P${chamberId}`].filter(Boolean).join(' · '),
      lineups,
      lead: plain(list.MonDesc?.[configs[0]], 200)
    })
  }
  pushGroup(groups, battleGroup('各幕', chamberCards, { cols: 2, dense: true }))
  return groups
}

/* ============================================================
 *  幽境危战
 * ============================================================ */

/** 幽境危战：一敌一框 —— 名字 → 玉璃的研究（官方解析）→ 首领特性（概述）→ 其他难度 */
export function giStygianView (record, ctx = {}) {
  const list = record?.content?.list || {}
  const groups = []
  const monsters = list.Monsters || {}
  const resolve = makeMonsterResolver('gi', record, monsters)
  const levels = Array.isArray(list.Levels) ? list.Levels : []

  // 每个 Boss 的四档血量（N3/N4/N5/N6），主档展示 N5/N6
  const hpTiers = new Map()
  for (const item of Array.isArray(list.HPShow) ? list.HPShow : []) {
    const tiers = (item?.HP || []).map(Number).filter((n) => Number.isFinite(n))
    if (item?.ID && tiers.length) hpTiers.set(String(item.ID), tiers)
  }

  const strongIds = (levels.at(-1)?.Monsters || Object.keys(monsters)).map(String)
  const gensri = readGensri(ctx)
  const gensriEnemies = Array.isArray(gensri?.raw?.detail?.enemies) ? gensri.raw.detail.enemies : []
  const cards = []
  for (const [index, id] of strongIds.entries()) {
    const raw = monsters[id] || {}
    const info = resolve(id)
    const tiers = hpTiers.get(String(raw?.ID || id)) || []
    const n5 = tiers[2]
    const n6 = tiers[3]
    const hpText = n5 && n6 ? `${num(n5, 0)} / ${num(n6, 0)}` : (n5 ? num(n5, 0) : '')

    const blocks = []
    // 「玉璃的研究」= Tutorial[]（官方文案的编号解析，站点就是这一份）；
    // 「首领特性」= Buff[]（同名机制的一段式概述）——两者顺序不能反
    pushGroup(blocks, block('「玉璃的研究」', (raw.Tutorial || []).map((tutorial) => ({
      name: plain(tutorial?.Title),
      paragraphs: (tutorial?.DescList || []).map((text) => plain(stripHighlight(text), 220))
    }))))
    pushGroup(blocks, block('首领特性', (raw.Buff || []).map((buff) => ({
      name: plain(buff?.Name),
      paragraphs: [plain(stripHighlight(buff?.Desc), 200)]
    }))))
    // 其他难度：N4 与 N1-3（N1/N2 无血量数据就不写）
    // 其他难度：逐档列出（N3 常形 / N4 各有自己的名字与血量，不能合并成「1-3」）
    const others = []
    for (const difficulty of [4, 3]) {
      const tier = findTierMonster(monsters, levels, difficulty, id, levels.length - 1)
      if (tier && (tier.name || tier.hp)) {
        others.push({ name: `难度 ${difficulty}`, paragraphs: [[tier.name, tier.hp].filter(Boolean).join(' · ')] })
      }
    }
    pushGroup(blocks, block('其他难度', others))

    cards.push({
      title: info.name,
      sub: plain(raw.Title),
      big: true,
      // 头图优先强度研究院的怪物立绘（玉璃只给小图标，放大到 380px 会糊），取不到才回落图标
      monsters: [battleMonster({
        icon: fieldImage(gensri?.record, `detail.enemies.${index}.image`) || info.icon,
        hp: hpText,
        chips: [...new Set([...roleChips(raw.Advantage), ...roleChips(raw.Disadvantage), ...resChips(raw.RES)])]
      })],
      lead: plain(raw.Desc, 160),
      blocks
    })
  }
  pushGroup(groups, battleGroup('强敌', cards, { cols: 1 }))

  // 强度研究院：同版本的官方文案解析（一敌一卡，按解析条目分段）
  pushGroup(groups, cardsGroup('强度研究院', buildGensriResearch(ctx), { cols: 1 }))

  return groups
}

/** 同版本的强度研究院危战记录（原始 + 插件记录；后者带 imagerefs，用来取怪物立绘） */
function readGensri (ctx) {
  const version = String(ctx?.period?.version || '')
  if (!version || typeof ctx?.rawPeriods !== 'function' || typeof ctx?.readRecord !== 'function') return null
  const entry = (ctx.rawPeriods('gi', 'gensri', 'stygian') || []).find((item) => String(item.version) === version)
  if (!entry) return null
  const id = String(entry.id)
  return {
    raw: ctx.readRecord('gi', 'gensri', 'stygian', id),
    record: typeof ctx.loadRecord === 'function' ? ctx.loadRecord('gi', 'gensri', 'stygian', id) : null,
    id
  }
}
/**
 * 月亮网（预览期）深渊：月之祝福 → 每层（地脉异常）→ 各间战斗卡（上半/下半）
 *
 * 预览期玉璃还没有这一期，数据只有月亮网的 `tower/<id>.json`：
 *   `detail.floors[].chambers[].{firstHalfMonsters, secondHalfMonsters, monsterLevel, levelId}`
 * 怪物带 `id/name/hp/icon`；**id 与 nanoka 怪物页同号**，图标按 id 去 nanoka 取本地图。
 */
export function lunarisAbyssView (record, raw, ctx = {}) {
  const detail = raw?.detail || {}
  const groups = []
  const buffName = plain(raw?.chsBuffName) || plain(detail?.buffName)
  const buffDesc = plain(detail?.monthlyBuff?.description, 240)
  if (buffName || buffDesc) {
    pushGroup(groups, cardsGroup('月之祝福', [{ title: buffName, fields: buffDesc ? [{ label: '效果', value: buffDesc }] : [] }]))
  }

  // 图标：先按 id 取 nanoka 怪物图；id 对不上（月亮网用另一套 id）时按名字反查
  let nameIndex = null
  const monsterIcon = (id, name) => {
    if (typeof ctx.loadRecord !== 'function') return ''
    const byId = id ? ctx.loadRecord('gi', 'nanoka', 'monster', String(id)) : null
    if (byId) return fieldImage(byId, 'icon')
    if (!name) return ''
    if (!nameIndex) {
      nameIndex = new Map()
      for (const entry of listMonsterEntries('gi') || []) nameIndex.set(entry.name, entry.recordId)
    }
    const recordId = nameIndex.get(String(name))
    if (!recordId) return ''
    const byName = ctx.loadRecord('gi', 'nanoka', 'monster', String(recordId))
    return byName ? fieldImage(byName, 'icon') : ''
  }
  const toRows = (value) => {
    const list = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : [])
    return list.map((monster) => battleMonster({
      name: plain(monster?.name),
      icon: monsterIcon(monster?.id, monster?.name),
      hp: monster?.hp ? num(monster.hp, 0) : ''
    })).filter((row) => row.name)
  }

  for (const floor of Array.isArray(detail.floors) ? detail.floors : []) {
    const floorNo = floor?.floorIndex ?? '?'
    if (floor?.firstHalfBuff || floor?.secondHalfBuff) {
      pushGroup(groups, listGroup(`第 ${floorNo} 层 · 地脉异常`, [
        { label: '上半', value: plain(floor.firstHalfBuff?.description || floor.firstHalfBuff, 200) },
        { label: '下半', value: plain(floor.secondHalfBuff?.description || floor.secondHalfBuff, 200) }
      ]))
    }
    const cards = []
    for (const [index, chamber] of (floor?.chambers || []).entries()) {
      const level = chamber?.monsterLevel ? `Lv.${chamber.monsterLevel}` : ''
      const first = toRows(chamber?.firstHalfMonsters)
      const second = toRows(chamber?.secondHalfMonsters)
      if (first.length) cards.push({ title: `${floorNo}-${index + 1} 上半`, sub: level, monsters: first })
      if (second.length) cards.push({ title: `${floorNo}-${index + 1} 下半`, sub: level, monsters: second })
    }
    pushGroup(groups, battleGroup(`第 ${floorNo} 层`, cards))
  }
  return groups
}
/** 强度研究院（预览期）危战：一敌一框（大图 + N5/N6 血量 + 强敌机制） */
export function gensriStygianView (record, raw) {
  const detail = raw?.detail || {}
  const groups = []

  const cards = (Array.isArray(detail.enemies) ? detail.enemies : []).map((enemy, index) => {
    const five = enemy?.hp?.five
    const six = enemy?.hp?.six
    const hpText = five || six ? [five, six].filter(Boolean).map((hp) => num(hp, 0)).join(' / ') : ''
    return {
      title: plain(enemy?.name),
      big: true,
      monsters: [battleMonster({ icon: fieldImage(record, `detail.enemies.${index}.image`), hp: hpText })],
      blocks: [block('强敌机制', (enemy?.mechanism || []).map((text, i) => ({
        name: `解析 ${i + 1}`,
        paragraphs: [plain(text, 260)]
      })))].filter(Boolean)
    }
  })
  pushGroup(groups, battleGroup('强敌', cards, { cols: 1 }))
  return groups
}
/** 优势/劣势里的角色标签（去掉内联 `<img>` 后按 `|` 拆开） */
function roleChips (text) {
  return String(text ?? '').replace(/<[^>]*>/g, '').split('|').map((item) => item.trim()).filter(Boolean)
}

/** 官方文案里的 `@高亮#` 标记：只留正文 */
function stripHighlight (text) {
  return String(text ?? '').replace(/[@#]/g, '')
}

/** 同一 Boss 在指定难度档里的名字与血量（玉璃 Levels 按档给 id，档内位置对齐） */
function findTierMonster (monsters, levels, difficulty, baseId, fallbackIndex) {
  const tier = levels.find((level) => Number(level?.Level) === difficulty) || levels[fallbackIndex]
  if (!Array.isArray(tier?.Monsters)) return null
  const top = levels[levels.length - 1]?.Monsters || []
  const index = top.indexOf(Number(baseId))
  if (index < 0) return null
  const raw = monsters[String(tier.Monsters[index])]
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
    const five = enemy?.hp?.five
    const six = enemy?.hp?.six
    const blocks = []
    pushGroup(blocks, block('强敌机制', (enemy?.mechanism || []).map((text, index) => ({
      name: `解析 ${index + 1}`,
      paragraphs: [plain(text, 220)]
    }))))
    return {
      title: plain(enemy?.name) || '敌人',
      fields: [],
      icons: [],
      blocks
    }
  })
}