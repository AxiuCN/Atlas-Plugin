/**
 * 绝区零怪物归一化
 *
 * 数据形态：`detail.id` 是图鉴条目 id（map.json 键即它），`detail.monster_id` 是代表变体 id，
 * `detail.monster_info` 是「战斗实体 id → 信息」的对象（全 306 条共 655 个变体），
 * 每个变体带 `element`（0/1 标记，值为 1 的即该怪弱点属性）、`tag`（族群标签）、`type`、
 * `stats`（面板 + 各类抗性 `*_damage_res`）、`curves`（各等级血量曲线）。
 *
 * 面板口径取游戏自用的一套（式舆防卫战 `layer_room.monster_list[].stats` 同款）：
 * 生命值 / 攻击力 / 防御力 / 失衡值（`stun`）。数据里 70+ 个内部字段（`crit_res` / `ice_buildup_curve`
 * / `is_stun` …）不是面板口径，不铺出来。
 * `element_abnormal`（异常积蓄）的键是内部属性 id、全库无名称映射，故不出。
 */

/** element 键 → 中文（绝区零属性名与其它两作不同：电/以太） */
const ZZZ_ELEMENT_LABEL = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风'
}

/** 面板字段（顺序同游戏内） */
const PANEL_FIELDS = [
  ['hp', '生命值'],
  ['attack', '攻击力'],
  ['defence', '防御力'],
  ['stun', '失衡值']
]

/** 属性抗性字段后缀 → 元素键（`fire_damage_res` → fire） */
const RES_KEYS = ['physical', 'fire', 'ice', 'electric', 'ether', 'wind']

/** 小数 → 百分比文本；抗性数据域为 ×100（-2000 → -20%） */
function resPct (v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return `${Number((n / 100).toFixed(1))}%`
}

/**
 * 收集该条目可被引用的全部 id
 * @param {object} detail
 * @returns {string[]}
 */
export function zzzIndexIds (detail) {
  const ids = []
  if (detail?.id != null) ids.push(String(detail.id))
  if (detail?.monster_id != null) ids.push(String(detail.monster_id))
  for (const key of Object.keys(detail?.monster_info || {})) ids.push(key)
  return ids
}

/** 单个变体的面板 */
function panelOf (info) {
  const stats = info?.stats || {}
  const out = []
  for (const [key, label] of PANEL_FIELDS) {
    const v = stats[key]
    if (v != null) out.push({ label, value: String(Math.round(Number(v))) })
  }
  return out
}

/** 单个变体的抗性（值为 0 表示无该属性抗性，不列） */
function resistancesOf (info) {
  const stats = info?.stats || {}
  const out = []
  for (const key of RES_KEYS) {
    const raw = Number(stats[`${key}_damage_res`])
    if (!Number.isFinite(raw) || raw === 0) continue
    out.push({ label: `${ZZZ_ELEMENT_LABEL[key]}抗性`, value: resPct(raw) })
  }
  return out
}

/** 单个变体的弱点（`element` 中值为 1 的键） */
function weakOf (info) {
  return Object.entries(info?.element || {})
    .filter(([, v]) => Number(v) === 1)
    .map(([k]) => ZZZ_ELEMENT_LABEL[k] || k)
}

/**
 * 归一化全部变体（代表变体 = `detail.monster_id` 指向的那个，排在最前）
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @returns {Array<object>}
 */
export function zzzVariants (list, detail) {
  const primary = detail?.monster_id != null ? String(detail.monster_id) : ''
  const entries = Object.entries(detail?.monster_info || {})
  const variants = entries.map(([id, info]) => ({
    id,
    codeName: info?.code_name || '',
    // `info.type` 恒为 'Monster'（40 条为空），不具区分度，不作为分类展示
    kind: '',
    stats: panelOf(info),
    weak: weakOf(info),
    resistances: resistancesOf(info),
    skills: []
  }))
  const idx = variants.findIndex(v => v.id === primary)
  if (idx > 0) variants.unshift(...variants.splice(idx, 1))
  return variants
}
