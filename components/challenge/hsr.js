/**
 * 星铁终局视图（混沌回忆 / 虚构叙事 / 末日幻影 / 异相仲裁）
 *
 * 四页来自玉璃的 `chaos` / `fiction` / `as` / `arbitration`。它们的公共骨架是
 * `Buff(s)` + `Floors`/`Stages` + `Monsters`，差异在：
 *   - 虚构叙事多一组 `NewBuffs` / `Skills`；
 *   - 末日幻影把楼层特性放在 `Tags`（按层号分组），另有 `Tutorials`；
 *   - 异相仲裁换成 `Knight` / `King` / `KnightFormation`，血量档位在 `HP_*`。
 */
import {
  plain, num, fieldImage,
  listGroup, iconGroup, cardsGroup, battleGroup, battleMonster, collapseGroup, pushGroup
} from './view.js'

const ELEM_LABEL = {
  Fire: '火', Ice: '冰', Wind: '风', Elec: '雷', Quantum: '量子', Imaginary: '虚数',
  Physical: '物理', Thunder: '雷', Water: '水', Rock: '岩', Grass: '草'
}

const elemLabel = (value) => ELEM_LABEL[value] || plain(value)

const elemsText = (list) => (Array.isArray(list) ? list.map(elemLabel).join(' / ') : elemLabel(list))

/** `{Name, Desc}` 数组 → 增益卡片 */
function buffCards (list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    title: plain(item?.Name),
    fields: item?.Desc ? [{ label: '效果', value: plain(item.Desc, 220) }] : []
  }))
}

/** `{1:[{Name,Desc}],2:[...]}` → 按层号成卡 */
function tagCards (tags) {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return []
  const cards = []
  for (const [key, list] of Object.entries(tags)) {
    for (const item of Array.isArray(list) ? list : []) {
      cards.push({
        title: `${/^\d+$/.test(key) ? `第 ${key} 层 · ` : ''}${plain(item?.Name) || '特性'}`,
        fields: item?.Desc ? [{ label: '效果', value: plain(item.Desc, 220) }] : []
      })
    }
  }
  return cards
}

/** 楼层 → 卡片（含半场元素与血量档位） */
function floorCards (floors) {
  return (Array.isArray(floors) ? floors : []).map((floor) => {
    const fields = []
    for (const stage of floor?.Stages || []) {
      const half = stage?.Half === 2 ? '下半' : '上半'
      const elems = elemsText(stage?.Elem)
      if (elems) fields.push({ label: half, value: elems })
    }
    if (floor?.HP_S) fields.push({ label: '生命（单）', value: num(floor.HP_S, 0) })
    if (floor?.HP_M) fields.push({ label: '生命（多）', value: num(floor.HP_M, 0) })
    return { title: `第 ${floor?.Floor ?? '?'} 层`, fields, icons: [] }
  })
}

/** 敌方阵容（战斗卡：大图 + 弱点/抗性小标签） */
function monsterBattleCards (record, monsters, container = 'Monsters') {
  return Object.entries(monsters || {}).map(([id, item]) => {
    const chips = []
    if (Array.isArray(item?.Weak) && item.Weak.length) chips.push(`弱点 ${item.Weak.map(elemLabel).join(' / ')}`)
    for (const [key, value] of Object.entries(item?.RES || {})) chips.push(`${elemLabel(key)} ${num(Number(value) * 100)}%`)
    return {
      title: '',
      sub: '',
      monsters: [battleMonster({
        name: plain(item?.Name) || String(id),
        icon: fieldImage(record, `${container}.${id}.Icon`) || fieldImage(record, `${container}.${id}`) || fieldImage(record, `${container}.${id}.Figure`),
        chips
      })]
    }
  })
}

/** 一层通用拼装：增益 → 楼层 → 特性 → 阵容 */
function commonGroups (record, list, { buffs = [], tags = null, tutorials = null } = {}) {
  const groups = []
  for (const item of buffs) pushGroup(groups, cardsGroup(item.title, buffCards(item.list), { cols: 2 }))
  pushGroup(groups, cardsGroup('楼层', floorCards(list.Floors)))
  if (tags) pushGroup(groups, cardsGroup('楼层特性', tagCards(tags)))
  pushGroup(groups, battleGroup('敌方阵容', monsterBattleCards(record, list.Monsters)))
  if (tutorials) {
    pushGroup(groups, collapseGroup('机制说明', (Array.isArray(tutorials) ? tutorials : []).map((item, index) => ({
      label: plain(item?.Name) || `说明 ${index + 1}`,
      value: plain(item?.Desc, 200)
    }))))
  }
  return groups
}

/** 混沌回忆 */
export function hsrChaosView (record) {
  const list = record?.content?.list || {}
  return commonGroups(record, list, { buffs: [{ title: '本期增益', list: [list.Buff] }] })
}

/** 虚构叙事 */
export function hsrFictionView (record) {
  const list = record?.content?.list || {}
  return commonGroups(record, list, {
    buffs: [
      { title: '本期增益', list: [list.Buff] },
      { title: '新增增益', list: list.NewBuffs },
      { title: '技能效果', list: list.Skills }
    ]
  })
}

/** 末日幻影 */
export function hsrAsView (record) {
  const list = record?.content?.list || {}
  return commonGroups(record, list, {
    buffs: [
      { title: '本期增益', list: [list.Buff] },
      { title: '技能效果', list: list.Skills }
    ],
    tags: list.Tags,
    tutorials: list.Tutorials
  })
}

/** 异相仲裁：骑士 / 国王 / 增益 / 血量档位 */
export function hsrArbitrationView (record) {
  const list = record?.content?.list || {}
  const groups = []

  const sides = [
    { title: '骑士', list: list.Knight, tags: list.KnightTags },
    { title: '国王', list: list.King, tags: list.KingTags }
  ]
  for (const side of sides) {
    pushGroup(groups, listGroup(`${side.title}关卡`, (side.list || []).map((item) => ({
      label: `第 ${item?.Index ?? '?'} 关`,
      value: elemsText(item?.Elem) || `阶段 ${item?.StageID ?? '-'}`
    }))))
    pushGroup(groups, cardsGroup(`${side.title}特性`, tagCards(side.tags)))
  }

  pushGroup(groups, cardsGroup('增益', buffCards(list.Buffs), { cols: 2 }))
  pushGroup(groups, battleGroup('敌方阵容', monsterBattleCards(record, list.Monsters)))

  const hp = []
  if (list.HP_Knight) hp.push({ label: '骑士生命', value: num(list.HP_Knight, 0) })
  if (list.HP_King) hp.push({ label: '国王生命', value: num(list.HP_King, 0) })
  if (list.HP_King_Hard) hp.push({ label: '国王生命（高难）', value: num(list.HP_King_Hard, 0) })
  pushGroup(groups, collapseGroup('血量档位', hp))
  return groups
}