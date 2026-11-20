/**
 * 原神终局视图（深渊 / 幻想真境剧诗 / 幽境危战）
 *
 * 数据来自玉璃的 `abyss` / `theater` / `stygian` 三页；结构差异很大，这里各自适配成视图模型，
 * 字段缺失就不出该段（`pushGroup` 会丢弃空段）。
 */
import {
  plain, num, percent, fieldImage, makeMonsterResolver,
  listGroup, iconGroup, cardsGroup, collapseGroup, pushGroup
} from './view.js'

/** 元素/颜色码 → 中文（玉璃用英文枚举） */
const ELEM_LABEL = {
  Fire: '火', Water: '水', Wind: '风', Elec: '雷', Ice: '冰', Rock: '岩', Grass: '草',
  Quantum: '量子', Imaginary: '虚数', Physical: '物理', None: '无'
}

/** `["Ice"]` / `"Ice"` → `冰` */
function elemLabel (value) {
  if (Array.isArray(value)) return value.map((item) => ELEM_LABEL[item] || String(item)).join(' / ')
  return ELEM_LABEL[value] || plain(value)
}

/** 抗性数组（`[[元素...], "30%"]`）→ 文本 */
function resText (res) {
  if (!res) return ''
  if (typeof res === 'object' && !Array.isArray(res)) {
    return Object.entries(res).map(([key, value]) => `${elemLabel(key)} ${percent(value)}`).join('、')
  }
  if (Array.isArray(res)) {
    return res.map((item) => {
      if (!Array.isArray(item)) return plain(item)
      const [elems, value] = item
      return `${elemLabel(elems)} ${percent(value)}`
    }).filter(Boolean).join('、')
  }
  return ''
}

/** 深境螺旋：月之祝福 → 楼层 → 房间 → 怪物 */
export function giAbyssView (record) {
  const list = record?.content?.list || {}
  const groups = []
  const resolve = makeMonsterResolver('gi', record, list.Monsters || {})

  const blessings = Array.isArray(list.Blessings) ? list.Blessings : []
  pushGroup(groups, cardsGroup('月之祝福', blessings.map((item) => ({
    title: plain(item?.Name),
    fields: [{ label: '效果', value: plain(item?.Desc, 220) }]
  }))))

  const floors = Array.isArray(list.Floors) ? list.Floors : []
  pushGroup(groups, cardsGroup('楼层', floors.map((floor) => {
    const icons = []
    const rows = []
    for (const chamber of floor?.Chambers || []) {
      const half = chamber?.Half === 2 ? '下半' : '上半'
      const names = []
      for (const wave of chamber?.Waves || []) {
        for (const monster of wave?.Monsters || []) {
          const info = resolve(monster?.ID)
          names.push(info.name)
          if (info.icon) icons.push({ icon: info.icon, name: info.name })
        }
      }
      rows.push({
        label: `第 ${chamber?.Index ?? '?'} 间 · ${half} · Lv.${chamber?.Level ?? '-'}`,
        value: names.length ? [...new Set(names)].join('、') : '—'
      })
    }
    return {
      title: `第 ${floor?.Index ?? '?'} 层`,
      sub: floor?.HPRatio ? `生命倍率 ×${num(floor.HPRatio, 2)}` : '',
      fields: [
        ...(floor?.Disorder ? [{ label: '地脉异常', value: plain(floor.Disorder, 160) }] : []),
        ...rows
      ],
      icons
    }
  })))

  const monsters = Object.entries(list.Monsters || {}).map(([id, item]) => {
    const info = resolve(id)
    const tags = [elemLabel(item?.Color), resText(item?.RES)].filter(Boolean).join(' · ')
    return { icon: info.icon, name: info.name, sub: tags }
  })
  pushGroup(groups, iconGroup('怪物', monsters))
  return groups
}

/** 幻想真境剧诗：元素限制 → 角色 → 幕/房间 → 神谕 → 怪物 */
export function giTheaterView (record) {
  const list = record?.content?.list || {}
  const groups = []
  const resolve = makeMonsterResolver('gi', record, list.Monsters || {})

  const elems = Array.isArray(list.Elem) ? list.Elem : []
  pushGroup(groups, listGroup('本期限制', [
    elems.length ? { label: '可用元素', value: elems.map(elemLabel).join(' / ') } : null,
    list.Initial?.length ? { label: '开幕角色', value: String(list.Initial.length) + ' 名' } : null,
    list.Invitation?.length ? { label: '邀请角色', value: String(list.Invitation.length) + ' 名' } : null
  ]))

  const initial = (list.Initial || []).map((item, index) => ({
    icon: fieldImage(record, `Initial.${index}.Icon`),
    name: plain(item?.Name),
    sub: ''
  }))
  pushGroup(groups, iconGroup('开幕角色', initial))

  const invitation = (list.Invitation || []).map((item, index) => ({
    icon: fieldImage(record, `Invitation.${index}.Icon`),
    name: plain(item?.Name),
    sub: ''
  }))
  pushGroup(groups, iconGroup('邀请角色', invitation))

  const mp = list.MP || {}
  const chambers = (list.Chambers || []).map((chamber) => {
    const configs = Array.isArray(chamber?.Configs) ? chamber.Configs : []
    const names = []
    const icons = []
    for (const configId of configs) {
      for (const monsterId of mp[configId] || []) {
        const info = resolve(monsterId)
        names.push(info.name)
        if (info.icon) icons.push({ icon: info.icon, name: info.name })
      }
    }
    return {
      title: `第 ${chamber?._id ?? '?'} 幕 · Lv.${chamber?.Level ?? '-'}`,
      fields: names.length ? [{ label: '敌人', value: [...new Set(names)].join('、') }] : [],
      icons
    }
  })
  pushGroup(groups, cardsGroup('各幕', chambers))

  const arcana = (list.Arcana || []).map((item, index) => ({
    title: plain(item?.Time) || `神谕 ${index + 1}`,
    fields: (item?.Monsters || []).map((monster, i) => ({ label: `敌人 ${i + 1}`, value: `${plain(monster?.Name) || monster?.ID} · HP ${num(monster?.HP, 0)}` })),
    icons: (item?.Monsters || []).map((monster) => ({
      icon: fieldImage(record, `Arcana.${index}.Monsters.${(item?.Monsters || []).indexOf(monster)}.Icon`),
      name: plain(monster?.Name) || String(monster?.ID || '')
    }))
  }))
  pushGroup(groups, cardsGroup('神谕牌', arcana, { cols: 2 }))

  const boss = Array.isArray(list.Boss) ? list.Boss : []
  pushGroup(groups, cardsGroup('首领', boss.map((item, index) => ({
    title: plain(item?.Time) || `首领 ${index + 1}`,
    fields: (item?.Monsters || []).map((monster, i) => ({ label: `敌人 ${i + 1}`, value: `${plain(monster?.Name) || monster?.ID} · HP ${num(monster?.HP, 0)}` })),
    icons: []
  }))))

  pushGroup(groups, iconGroup('怪物', Object.entries(list.Monsters || {}).map(([id]) => {
    const info = resolve(id)
    return { icon: info.icon, name: info.name, sub: '' }
  })))
  return groups
}

/** 幽境危战：难度 → 强敌 → 血量档位（折叠） */
export function giStygianView (record) {
  const list = record?.content?.list || {}
  const groups = []
  const resolve = makeMonsterResolver('gi', record, list.Monsters || {})

  const levels = Array.isArray(list.Levels) ? list.Levels : []
  pushGroup(groups, listGroup('难度', levels.map((level) => ({
    label: `难度 ${level?.Level ?? '?'}`,
    value: (level?.Monsters || []).map((id) => resolve(id).name).join('、') || '—'
  }))))

  const enemies = Object.entries(list.Monsters || {}).map(([id, monster]) => {
    const info = resolve(id)
    const fields = []
    if (monster?.Title) fields.push({ label: '称号', value: plain(monster.Title) })
    if (monster?.Level) fields.push({ label: '等级', value: `Lv.${monster.Level}` })
    if (monster?.Stats?.HP) fields.push({ label: '生命', value: num(monster.Stats.HP, 0) })
    const res = resText(monster?.RES)
    if (res) fields.push({ label: '抗性', value: res })
    if (monster?.Advantage) fields.push({ label: '优势', value: plain(monster.Advantage, 120) })
    if (monster?.Disadvantage) fields.push({ label: '劣势', value: plain(monster.Disadvantage, 120) })
    if (monster?.Desc) fields.push({ label: '说明', value: plain(monster.Desc, 80) })
    for (const buff of monster?.Buff || []) {
      fields.push({ label: plain(buff?.Name) || '机制', value: plain(buff?.Desc, 80) })
    }
    return { title: info.name, sub: plain(monster?.Title), fields, icons: [] }
  })
  pushGroup(groups, cardsGroup('强敌', enemies, { cols: 2 }))

  const hpRows = (Array.isArray(list.HPShow) ? list.HPShow : []).map((item, index) => ({
    label: `第 ${index + 1} 组`,
    value: (item?.HP || []).map((hp, i) => `${num(hp, 0)}${item?.HPMult?.[i] ? `（×${num(item.HPMult[i], 1)}）` : ''}`).join(' / ')
  }))
  pushGroup(groups, collapseGroup('血量档位', hpRows))

  pushGroup(groups, iconGroup('怪物', Object.keys(list.Monsters || {}).map((id) => {
    const info = resolve(id)
    return { icon: info.icon, name: info.name, sub: '' }
  })))
  return groups
}