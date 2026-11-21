/**
 * 绝区零终局视图（式舆防卫战 / 危局强袭战）
 *
 * 版面仿玉璃：防区只作概览，怪物按「房间」成战斗卡（大图图标占位 + 波次 + 弱点/抗性）。
 * nanoka 的 `layer_room.<roomId>.monster_list` 只有 id，名字回落到怪物索引。
 */
import { plain, fieldImage, battleGroup, battleMonster, cardsGroup, pushGroup } from './view.js'
import { getMonsterEntry } from '../../model/monsterIndex/index.js'

/** `{200:"物理", 201:"火属性"}` → `物理 / 火属性` */
function mapValues (object) {
  if (!object || typeof object !== 'object') return ''
  return Object.values(object).map((value) => plain(value)).filter(Boolean).join(' / ')
}

/** 房间里的怪物 id → 战斗卡条目 */
function roomMonsters (record, room, fieldPathBase) {
  return Object.keys(room?.monster_list || {}).map((id) => {
    const entry = getMonsterEntry('zzz', id)
    const icon = fieldImage(record, `${fieldPathBase}.monster_icon.${id}`) ||
      fieldImage(record, `${fieldPathBase}.monster_icon`)
    return battleMonster({ name: entry?.name || `怪物 ${id}`, icon })
  })
}

/** 房间 → 战斗卡（标题：房间号；副标题：波次；标签：弱点/抗性） */
function roomBattleCard (record, zoneName, roomId, room, fieldPathBase) {
  const chips = []
  const weakness = mapValues(room?.monster_weakness)
  const resistance = mapValues(room?.monster_resistance)
  if (weakness) chips.push(`弱点 ${weakness}`)
  if (resistance) chips.push(`抗性 ${resistance}`)
  return {
    title: `${zoneName} · 房间 ${roomId}`,
    sub: [room?.waves_num ? `${room.waves_num} 波` : '', chips.join(' · ')].filter(Boolean).join(' · '),
    monsters: roomMonsters(record, room, fieldPathBase)
  }
}

/** 防区概览（名字 / 关卡数 / 评分线 / 增益） */
function zoneSummaryCard (item, zoneId) {
  const fields = []
  if (item?.stage_num) fields.push({ label: '关卡数', value: String(item.stage_num) })
  if (item?.monster_level) fields.push({ label: '怪物等级', value: `Lv.${item.monster_level}` })
  for (const [key, label] of [['s_rank_goal', 'S'], ['a_rank_goal', 'A'], ['b_rank_goal', 'B']]) {
    if (item?.[key]) fields.push({ label: `${label} 评级线`, value: String(item[key]) })
  }
  for (const buff of Object.values(item?.layer_buff || {})) {
    if (buff?.title) fields.push({ label: plain(buff.title), value: plain(buff.desc, 200) })
  }
  return {
    title: plain(item?.name) || `防区 ${zoneId}`,
    sub: item?.monster_level ? `Lv.${item.monster_level}` : '',
    fields,
    icons: []
  }
}

/** 式舆防卫战 */
export function zzzShiyuView (record) {
  const detail = record?.content?.detail || {}
  const summary = []
  const battles = []
  for (const [zoneId, item] of Object.entries(detail.zone || {})) {
    summary.push(zoneSummaryCard(item, zoneId))
    for (const [roomId, room] of Object.entries(item?.layer_room || {})) {
      battles.push(roomBattleCard(record, plain(item?.name) || `防区 ${zoneId}`, roomId, room, `detail.zone.${zoneId}.layer_room.${roomId}`))
    }
  }
  const groups = []
  pushGroup(groups, cardsGroup('防区', summary, { cols: 2 }))
  pushGroup(groups, battleGroup('房间', battles))
  return groups
}

/** 危局强袭战 */
export function zzzBossView (record) {
  const detail = record?.content?.detail || {}
  const summary = []
  const battles = []
  const entries = []
  for (const mode of Array.isArray(detail.modes) ? detail.modes : []) {
    for (const [zoneId, item] of Object.entries(mode?.zone || {})) {
      entries.push([zoneId, item, `detail.modes.${mode?.id ?? zoneId}.zone.${zoneId}`])
    }
  }
  if (!entries.length) {
    for (const [zoneId, item] of Object.entries(detail.zone || {})) entries.push([zoneId, item, `detail.zone.${zoneId}`])
  }
  for (const [zoneId, item, pathBase] of entries) {
    summary.push(zoneSummaryCard(item, zoneId))
    for (const [roomId, room] of Object.entries(item?.layer_room || {})) {
      battles.push(roomBattleCard(record, plain(item?.name) || `防区 ${zoneId}`, roomId, room, `${pathBase}.layer_room.${roomId}`))
    }
  }
  const groups = []
  pushGroup(groups, cardsGroup('防区', summary, { cols: 2 }))
  pushGroup(groups, battleGroup('房间', battles))
  return groups
}