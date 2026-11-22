/**
 * 绝区零终局视图（式舆防卫战 / 危局强袭战）
 *
 * 两页都按原神深渊那套「防线/Boss（段）→ 房间（卡）→ 怪物」组织：
 *   - 式舆：`detail.zone.<zoneId>` 是防线，`layer_room.<roomId>` 是房间；
 *   - 危局：`detail.modes[].zone.<zoneId>` 是各难度下的 Boss 区，房间同样在 `layer_room`。
 * 房间的 `monster_list` 直接带 `name / image / stats{hp,attack,defence,stun,attribute_infliction}`，
 * 所以怪物行给「HP + ATK/DEF/韧性/异常」；弱点/抗性放在房间卡副标题。
 */
import { plain, fieldImage, battleGroup, battleMonster, listGroup, pushGroup } from './view.js'

/** 数值加千分位（绝区零的数值都很长，不加分隔看不清） */
function thousands (value, digits = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}

/** `{200:"物理", 201:"火属性"}` → `物理 / 火属性` */
function mapValues (object) {
  if (!object || typeof object !== 'object') return ''
  return Object.values(object).map((value) => plain(value)).filter(Boolean).join(' / ')
}

/** 等级条件：S / A / B 三条评级线 */
function goalRows (zone) {
  const parts = [
    zone?.s_rank_goal ? `S ${thousands(zone.s_rank_goal)}` : '',
    zone?.a_rank_goal ? `A ${thousands(zone.a_rank_goal)}` : '',
    zone?.b_rank_goal ? `B ${thousands(zone.b_rank_goal)}` : ''
  ].filter(Boolean)
  return parts.length ? [{ label: '等级条件', value: parts.join(' · ') }] : []
}

/** `layer_buff` / `selectable_buff`：`{id:{title,desc}}` → 列表行 */
function buffRows (buffs, fallback = '增益') {
  return Object.values(buffs || {})
    .filter((buff) => buff && (buff.title || buff.desc))
    .map((buff) => ({ label: plain(buff.title) || fallback, value: plain(buff.desc, 240) }))
}

/** 房间 → 战斗卡（房间名 + Lv/波次/弱点抗性 + 怪物数值行） */
function roomCard (record, roomPath, room, title) {
  const chips = []
  const weakness = mapValues(room?.monster_weakness)
  const resistance = mapValues(room?.monster_resistance)
  if (weakness) chips.push(`弱点 ${weakness}`)
  if (resistance) chips.push(`抗性 ${resistance}`)

  const monsters = Object.entries(room?.monster_list || {}).map(([key, monster]) => {
    const stats = monster?.stats || {}
    const statsChips = []
    if (stats.attack) statsChips.push(`ATK ${thousands(stats.attack)}`)
    if (stats.defence) statsChips.push(`DEF ${thousands(stats.defence)}`)
    if (stats.stun) statsChips.push(`韧性 ${thousands(stats.stun)}`)
    if (stats.attribute_infliction) statsChips.push(`异常 ${thousands(stats.attribute_infliction)}`)
    return battleMonster({
      name: plain(monster?.name),
      icon: fieldImage(record, `${roomPath}.monster_list.${key}.image`),
      hp: thousands(stats.hp),
      chips: statsChips
    })
  }).filter((monster) => monster.name || monster.icon)

  return {
    title,
    sub: [room?.waves_num ? `${room.waves_num} 波` : '', chips.join(' · ')].filter(Boolean).join(' · '),
    monsters
  }
}

const ROOM_NAMES = ['房间一', '房间二', '房间三', '房间四', '房间五', '房间六']

/** 1..10 → 中文数字（第五防线的 zone 没有名字，用序号补） */
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
function cnNum (value) {
  const n = Number(value)
  return CN_NUM[n - 1] || String(value ?? '')
}

/** 把「父 zone + child 房间」摊平成房间列表：`[{ room, path, title }]` */
function collectRooms (zoneMap, zone, pathBase, roomNames) {
  const rooms = []
  for (const [roomId, room] of Object.entries(zone?.layer_room || {})) {
    rooms.push({ room, path: `${pathBase}.layer_room.${roomId}` })
  }
  for (const childId of zone?.child || []) {
    const child = (zoneMap || {})[childId]
    if (!child) continue
    for (const [roomId, room] of Object.entries(child.layer_room || {})) {
      rooms.push({
        room,
        path: `${pathBase}.child.${childId}.layer_room.${roomId}`,
        title: plain(child.name)
      })
    }
  }
  return rooms.map((item, index) => ({ ...item, title: item.title || roomNames[index] || `房间 ${index + 1}` }))
}

/** 一道防线 / 一个 Boss 区 → 段（等级条件 + 增益列表 + 房间卡） */
function zoneGroups (record, zone, zoneName, pathBase, { roomNames = ROOM_NAMES, zoneMap = null } = {}) {
  const groups = []
  const levels = goalRows(zone)
  if (levels.length) pushGroup(groups, listGroup(`${zoneName} · 等级条件`, levels))

  const selectable = buffRows(zone?.selectable_buff, '可选增益')
  if (selectable.length) pushGroup(groups, listGroup(`${zoneName} · 可选增益`, selectable))
  const area = buffRows(zone?.layer_buff, '区域增益')
  if (area.length) pushGroup(groups, listGroup(`${zoneName} · 区域增益`, area))

  const cards = collectRooms(zoneMap, zone, pathBase, roomNames)
    .map(({ room, path, title }) => roomCard(record, path, room, title))
    .filter((card) => card.monsters.length)
  pushGroup(groups, battleGroup(zoneName, cards))
  return groups
}

/** 式舆防卫战：每道防线一段（等级条件 / 区域增益 / 房间卡；父防线的 child 房间并入本段） */
export function zzzShiyuView (record) {
  const detail = record?.content?.detail || {}
  const zoneMap = detail.zone || {}
  const groups = []

  // 被父防线 `child` 引用的 zone 不单独成段
  const childIds = new Set()
  for (const zone of Object.values(zoneMap)) {
    for (const childId of zone?.child || []) childIds.add(String(childId))
  }

  for (const [zoneId, zone] of Object.entries(zoneMap)) {
    if (childIds.has(String(zoneId))) continue
    const zoneName = plain(zone?.name) || (zone?.stage_num ? `剧变节点第 ${zone.stage_num} 防线` : `防线 ${zoneId}`)
    for (const group of zoneGroups(record, zone, zoneName, `detail.zone.${zoneId}`, { zoneMap })) pushGroup(groups, group)
  }
  return groups
}

/** 危局强袭战：各难度模式下的 Boss 区各成一段（等级条件 / 可选增益 / 区域增益 / 房间卡） */
export function zzzBossView (record) {
  const detail = record?.content?.detail || {}
  const groups = []
  const modes = Array.isArray(detail.modes) ? detail.modes : []
  const entries = []
  for (const [modeIndex, mode] of modes.entries()) {
    for (const [zoneId, zone] of Object.entries(mode?.zone || {})) {
      entries.push([zone, `detail.modes.${modeIndex}.zone.${zoneId}`, zoneId])
    }
  }
  if (!entries.length) {
    for (const [zoneId, zone] of Object.entries(detail.zone || {})) entries.push([zone, `detail.zone.${zoneId}`, zoneId])
  }
  for (const [zone, pathBase, zoneId] of entries) {
    const zoneName = plain(zone?.name) || `Boss ${zoneId}`
    for (const group of zoneGroups(record, zone, zoneName, pathBase, { roomNames: ['战斗房间 1', '战斗房间 2', '战斗房间 3'] })) {
      pushGroup(groups, group)
    }
  }
  return groups
}