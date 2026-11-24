/**
 * 星铁终局视图（混沌回忆 / 虚构叙事 / 末日幻影 / 异相仲裁）
 *
 * 前三个页面与原神深渊同一套骨架：**关卡（层）→ 上下半 → 波次**。
 *   - `Floors[].Stages[]`：每层上半/下半，`StageID` 指向 `Stages`；
 *   - `Stages[stageId].Waves[]`：每波的怪物（`ID/HP/SPD/Stance`），`WaveName` 是首领波的名字；
 *   - `Monsters[id]`：名字、图标、弱点、抗性。
 * 差异只在层前增益：
 *   - 虚构叙事多 `NewBuffs` / `Skills`；
 *   - 末日幻影把楼层特性放在 `Tags`（按层号分组），另有 `Tutorials`；
 *   - 异相仲裁换成 `Knight` / `King` / `KnightFormation`，血量档位在 `HP_*`。
 */
import {
  plain, rich, num, fieldImage,
  listGroup, cardsGroup, battleGroup, battleMonster, collapseGroup, pushGroup
} from './view.js'

const ELEM_LABEL = {
  Fire: '火', Ice: '冰', Wind: '风', Elec: '雷', Quantum: '量子', Imaginary: '虚数',
  Physical: '物理', Phys: '物理', Thunder: '雷', Water: '水', Rock: '岩', Grass: '草'
}

const elemLabel = (value) => ELEM_LABEL[value] || plain(value)

const elemsText = (list) => (Array.isArray(list) ? list.map(elemLabel).join(' / ') : elemLabel(list))

/** `{Name, Desc}` 数组 → 增益卡片 */
function buffCards (list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    title: plain(item?.Name),
    fields: item?.Desc ? [{ label: '效果', value: rich(item.Desc, 220, { highlight: true }) }] : []
  }))
}

/** 特性归一：`{1:[{Name,Desc}]}`（混沌/末日）或 `[{Index:1,Tags:[{Name,Desc}]}]`（异相） */
function tagCards (tags, unit = '层') {
  const cards = []
  const append = (key, list) => {
    for (const item of Array.isArray(list) ? list : []) {
      cards.push({
        title: `${key !== null && key !== undefined ? `第 ${key} ${unit} · ` : ''}${plain(item?.Name) || '特性'}`,
        fields: item?.Desc ? [{ label: '效果', value: rich(item.Desc, 220, { highlight: true }) }] : []
      })
    }
  }
  if (Array.isArray(tags)) {
    for (const entry of tags) append(entry?.Index, entry?.Tags)
  } else if (tags && typeof tags === 'object') {
    for (const [key, list] of Object.entries(tags)) append(/^\d+$/.test(key) ? key : null, list)
  }
  return cards
}

/** 波次归一：混沌/虚构是数组，末日幻影整波是一个对象（ID/HP/SPD/Stance + Summons） */
function waveList (waves) {
  if (Array.isArray(waves)) return waves
  if (!waves || typeof waves !== 'object') return []
  if (waves.ID !== undefined) {
    const extras = Array.isArray(waves.Summons) ? waves.Summons : []
    return [{ Wave: 1, Monsters: [waves, ...extras] }]
  }
  return Object.values(waves)
}

/**
 * 单个关卡（StageID）→ 波次行
 * @param {object} record
 * @param {object} list
 * @param {number|string} stageId
 * @returns {object[]}
 */
function stageLineups (record, list, stageId) {
  const monsters = list.Monsters || {}
  const stageData = (list.Stages || {})[String(stageId)] || {}
  const lineups = []
  for (const wave of waveList(stageData?.Waves)) {
    const rows = (wave?.Monsters || []).map((monster) => {
      const id = String(monster?.ID ?? '')
      const meta = monsters[id] || {}
      const chips = []
      if (Array.isArray(meta.Weak) && meta.Weak.length) chips.push(`弱点 ${meta.Weak.map(elemLabel).join(' / ')}`)
      if (monster?.Stance) chips.push(`韧性 ${num(monster.Stance, 0)}`)
      for (const [key, value] of Object.entries(meta.RES || {})) chips.push(`${elemLabel(key)} ${num(Number(value) * 100)}%`)
      return battleMonster({
        name: plain(meta.Name) || id,
        icon: fieldImage(record, `Monsters.${id}.Icon`),
        hp: monster?.HP ? num(monster.HP, 0) : '',
        chips
      })
    })
    if (!rows.length) continue
    lineups.push({
      title: plain(wave?.WaveName) ? `第 ${wave.Wave} 波 · ${plain(wave.WaveName)}` : `第 ${wave.Wave ?? lineups.length + 1} 波`,
      monsters: rows
    })
  }
  return { lineups, stageData }
}

/**
 * 关卡（层）→ 段；段内上半/下半各一张卡，卡内按波次分行
 * @param {object} record - 插件记录（取图片引用）
 * @param {object} list - 记录的 content.list
 * @param {{floorLabel?: string}} options - `层` / `关`
 * @returns {object[]}
 */
function stageGroups (record, list, { floorLabel = '层' } = {}) {
  const groups = []
  const monsters = list.Monsters || {}

  for (const floor of Array.isArray(list.Floors) ? list.Floors : []) {
    const no = floor?.Floor ?? '?'

    // 层血量（单 / 多）先单列一条，和深渊的「地脉异常」同位
    const hpRows = []
    if (floor?.HP_S) hpRows.push({ label: '生命（单）', value: num(floor.HP_S, 0) })
    if (floor?.HP_M) hpRows.push({ label: '生命（多）', value: num(floor.HP_M, 0) })
    if (!floor?.HP_S && !floor?.HP_M && floor?.HP) hpRows.push({ label: '生命', value: num(floor.HP, 0) })
    if (hpRows.length) pushGroup(groups, listGroup(`第 ${no} ${floorLabel} · 血量`, hpRows))

    const cards = []
    for (const stage of floor?.Stages || []) {
      const { lineups, stageData } = stageLineups(record, list, stage?.StageID)
      if (!lineups.length) continue
      cards.push({
        title: `第 ${stage?.Half ?? lineups.length + 1} 间`,
        sub: [elemsText(stage?.Elem), stageData?.Level ? `Lv.${stageData.Level}` : ''].filter(Boolean).join(' · '),
        lineups
      })
    }
    pushGroup(groups, battleGroup(`第 ${no} ${floorLabel}`, cards))
  }
  return groups
}

/** 混沌回忆：本期增益 → 每层（血量 + 上半/下半 × 波次） */
export function hsrChaosView (record) {
  const list = record?.content?.list || {}
  const groups = []
  pushGroup(groups, cardsGroup('本期增益', buffCards([list.Buff]), { cols: 2 }))
  for (const group of stageGroups(record, list, { floorLabel: '层' })) pushGroup(groups, group)
  return groups
}

/** 虚构叙事：本期增益 / 新增增益 / 技能效果 → 每关 */
export function hsrFictionView (record) {
  const list = record?.content?.list || {}
  const groups = []
  pushGroup(groups, cardsGroup('本期增益', buffCards([list.Buff]), { cols: 2 }))
  pushGroup(groups, cardsGroup('新增增益', buffCards(list.NewBuffs), { cols: 2 }))
  pushGroup(groups, cardsGroup('技能效果', buffCards(list.Skills), { cols: 2 }))
  for (const group of stageGroups(record, list, { floorLabel: '关' })) pushGroup(groups, group)
  return groups
}

/** 末日幻影：本期增益 / 技能效果 → 每关（血量 + 上下半）→ 楼层特性 → 机制说明 */
export function hsrAsView (record) {
  const list = record?.content?.list || {}
  const groups = []
  pushGroup(groups, cardsGroup('本期增益', buffCards([list.Buff]), { cols: 2 }))
  pushGroup(groups, cardsGroup('技能效果', buffCards(list.Skills), { cols: 2 }))
  for (const group of stageGroups(record, list, { floorLabel: '关' })) pushGroup(groups, group)
  pushGroup(groups, cardsGroup('楼层特性', tagCards(list.Tags, '关'), { cols: 2 }))
  pushGroup(groups, collapseGroup('机制说明', (Array.isArray(list.Tutorials) ? list.Tutorials : []).map((item, index) => ({
    label: plain(item?.Name) || `说明 ${index + 1}`,
    value: rich(item?.Desc, 200, { highlight: true })
  }))))
  return groups
}

/**
 * 异相仲裁：本期增益 → 骑士（N 关）/ 王棋（M 关），每关一张卡（卡内按波次分行），
 * 段后跟本段特性；血量是整段的总生命，单列一条。
 */
export function hsrArbitrationView (record) {
  const list = record?.content?.list || {}
  const groups = []
  pushGroup(groups, cardsGroup('本期增益', buffCards(list.Buffs), { cols: 2 }))

  const sides = [
    { title: '骑士', entries: list.Knight, tags: list.KnightTags, hp: [['总生命', list.HP_Knight]] },
    {
      title: '王棋',
      entries: list.King,
      tags: list.KingTags,
      hp: [['总生命', list.HP_King], ['高难总生命', list.HP_King_Hard]]
    }
  ]

  for (const side of sides) {
    const hpRows = (side.hp || []).filter(([, value]) => value).map(([label, value]) => ({ label, value: num(value, 0) }))
    if (hpRows.length) pushGroup(groups, listGroup(`${side.title} · 血量`, hpRows))

    const cards = (side.entries || []).map((entry) => {
      const { lineups, stageData } = stageLineups(record, list, entry?.StageID)
      return {
        title: `第 ${entry?.Index ?? '?'} 关`,
        sub: [elemsText(entry?.Elem), stageData?.Level ? `Lv.${stageData.Level}` : ''].filter(Boolean).join(' · '),
        lineups
      }
    }).filter((card) => card.lineups.length)
    pushGroup(groups, battleGroup(side.title, cards))

    pushGroup(groups, cardsGroup(`${side.title}特性`, tagCards(side.tags, '关'), { cols: 2 }))
  }
  return groups
}