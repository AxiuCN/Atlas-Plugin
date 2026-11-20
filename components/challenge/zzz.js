/**
 * 绝区零终局视图（式舆防卫战 / 危局强袭战）
 *
 * 数据来自 nanoka 的 `shiyu` / `boss` 两页，形状与玉璃完全不同：
 *   - `detail.zone.<zoneId>`：一个防区（名字、关卡数、怪物等级、`layer_buff`、`layer_room`）
 *   - `detail.modes[].zone`：危局的模式（多一组 S/A/B 评分线）
 *   - `layer_room.<roomId>.monster_list` 只有 id（值为空串），名字要回落到怪物索引
 */
import { plain, fieldImage } from './view.js'
import { iconGroup, cardsGroup, pushGroup } from './view.js'
import { getMonsterEntry } from '../../model/monsterIndex/index.js'

/** `{200:"物理", 201:"火属性"}` → `物理 / 火属性` */
function mapValues (object) {
  if (!object || typeof object !== 'object') return ''
  return Object.values(object).map((value) => plain(value)).filter(Boolean).join(' / ')
}

/** 房间里的怪物 id → 名称与图标 */
function roomMonsters (record, room, fieldPathBase) {
  const ids = Object.keys(room?.monster_list || {})
  return ids.map((id) => {
    const entry = getMonsterEntry('zzz', id)
    const icon = fieldImage(record, `${fieldPathBase}.monster_icon.${id}`) ||
      fieldImage(record, `${fieldPathBase}.monster_icon`)
    return { icon, name: entry?.name || `怪物 ${id}`, sub: '' }
  })
}

/** 房间 → 一行摘要（波次 / 弱点 / 抗性 / 怪物名） */
function roomRow (room, monsters, label) {
  return {
    label,
    value: [
      room?.waves_num ? `${room.waves_num} 波` : '',
      mapValues(room?.monster_weakness) ? `弱点 ${mapValues(room.monster_weakness)}` : '',
      mapValues(room?.monster_resistance) ? `抗性 ${mapValues(room.monster_resistance)}` : '',
      monsters.slice(0, 6).map((monster) => monster.name).join('、') +
        (monsters.length > 6 ? ` 等 ${monsters.length} 种` : '')
    ].filter(Boolean).join(' · ')
  }
}

/** 单个防区 → 卡片（含房间行）与怪物图标 */
function zoneCard (record, item, zoneId, pathBase) {
  const fields = []
  const icons = []
  if (item?.stage_num) fields.push({ label: '关卡数', value: String(item.stage_num) })
  if (item?.monster_level) fields.push({ label: '怪物等级', value: `Lv.${item.monster_level}` })
  for (const [key, label] of [['s_rank_goal', 'S'], ['a_rank_goal', 'A'], ['b_rank_goal', 'B']]) {
    if (item?.[key]) fields.push({ label: `${label} 评级线`, value: String(item[key]) })
  }
  for (const buff of Object.values(item?.layer_buff || {})) {
    if (buff?.title) fields.push({ label: plain(buff.title), value: plain(buff.desc, 200) })
  }
  for (const [roomId, room] of Object.entries(item?.layer_room || {})) {
    const monsters = roomMonsters(record, room, `${pathBase}.layer_room.${roomId}`)
    icons.push(...monsters)
    fields.push(roomRow(room, monsters, `房间 ${roomId}`))
  }
  return {
    card: {
      title: plain(item?.name) || `防区 ${zoneId}`,
      sub: item?.monster_level ? `Lv.${item.monster_level}` : '',
      fields,
      icons: []
    },
    icons
  }
}

/** 式舆防卫战：防区 → 房间 → 怪物 */
export function zzzShiyuView (record) {
  const detail = record?.content?.detail || {}
  const cards = []
  const icons = []
  for (const [zoneId, item] of Object.entries(detail.zone || {})) {
    const result = zoneCard(record, item, zoneId, `detail.zone.${zoneId}`)
    cards.push(result.card)
    icons.push(...result.icons)
  }
  const groups = []
  pushGroup(groups, cardsGroup('防区', cards))
  pushGroup(groups, iconGroup('怪物', icons))
  return groups
}

/** 危局强袭战：模式 → 防区（含评分线）→ 怪物 */
export function zzzBossView (record) {
  const detail = record?.content?.detail || {}
  const cards = []
  const icons = []
  const entries = []
  for (const mode of Array.isArray(detail.modes) ? detail.modes : []) {
    for (const [zoneId, item] of Object.entries(mode?.zone || {})) entries.push([zoneId, item, `detail.modes.${mode?.id ?? zoneId}.zone.${zoneId}`])
  }
  if (!entries.length) {
    for (const [zoneId, item] of Object.entries(detail.zone || {})) entries.push([zoneId, item, `detail.zone.${zoneId}`])
  }
  for (const [zoneId, item, pathBase] of entries) {
    const result = zoneCard(record, item, zoneId, pathBase)
    cards.push(result.card)
    icons.push(...result.icons)
  }
  const groups = []
  pushGroup(groups, cardsGroup('防区', cards))
  pushGroup(groups, iconGroup('怪物', icons))
  return groups
}