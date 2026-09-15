/**
 * 星铁怪物归一化
 *
 * 数据形态：`detail.id` 是图鉴条目 id（map.json 键即它），`detail.child` 是**数组**——同一图鉴条目下的
 * 战斗实体变体（全 628 条共 2648 个），每个变体带 `stance_weak_list`（弱点）、`damage_type_resistance`（抗性）、
 * `skill_list`（技能）与各类 `*_modify_ratio` / `elite_group` / `hard_level_group`（终局数值缩放键）。
 * 基础数值（`attack_base` / `hp_base` …）挂在 `detail` 上，各变体共用。
 *
 * 注意：628 条记录只有 373 个唯一名字——「冰锋」这类同名条目本质是同一怪被拆成多条索引，
 * 现由索引期折叠为一条并把其余路径记入 `variantPaths`，本模块按「一条目 → 多记录」拼合变体。
 */
import { hsrLabel } from '../../components/constants.js'

/** detail 上的基础数值 → 面板标签 */
const BASE_FIELDS = [
  ['hp_base', '生命值'],
  ['attack_base', '攻击力'],
  ['defence_base', '防御力'],
  ['speed_base', '速度'],
  ['stance_base', '韧性']
]

/** 小数 → 百分比文本（抗性/效果抵抗：0.2 → 20%） */
function pct (v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return `${Number((n * 100).toFixed(1))}%`
}

/**
 * 收集该条目可被引用的全部 id
 * @param {object} detail
 * @returns {string[]}
 */
export function hsrIndexIds (detail) {
  const ids = []
  if (detail?.id != null) ids.push(String(detail.id))
  for (const c of Array.isArray(detail?.child) ? detail.child : []) {
    if (c?.id != null) ids.push(String(c.id))
  }
  return ids
}

/**
 * 面板基础数值（各变体共用 detail 上的字段）
 * @param {object} detail
 * @returns {Array<{label:string,value:string}>}
 */
export function hsrPanel (detail) {
  const out = []
  for (const [key, label] of BASE_FIELDS) {
    const v = detail?.[key]
    if (v != null) out.push({ label, value: String(v) })
  }
  if (detail?.status_resistance_base != null) {
    out.push({ label: '效果抵抗', value: pct(detail.status_resistance_base) })
  }
  return out
}

/**
 * 归一化全部变体（弱点 / 抗性 / 技能均按变体取，基础数值取 detail）
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @returns {Array<object>}
 */
export function hsrVariants (list, detail) {
  const panel = hsrPanel(detail)
  const children = Array.isArray(detail?.child) ? detail.child : []
  const variants = children.map(c => ({
    id: c?.id != null ? String(c.id) : '',
    codeName: '',
    kind: '',
    stats: panel,
    weak: (Array.isArray(c?.stance_weak_list) ? c.stance_weak_list : []).map(hsrLabel),
    resistances: (Array.isArray(c?.damage_type_resistance) ? c.damage_type_resistance : [])
      .filter(r => Number(r?.value))
      .map(r => ({ label: `${hsrLabel(r?.damage_type)}抗性`, value: pct(r?.value) })),
    skills: (Array.isArray(c?.skill_list) ? c.skill_list : []).map(s => ({
      name: s?.skill_name || '',
      tag: hsrLabel(s?.damage_type),
      desc: s?.skill_desc || ''
    }))
  }))
  // 无 child 的条目（1 条）仍要出面板
  if (!variants.length) {
    variants.push({ id: detail?.id != null ? String(detail.id) : '', codeName: '', kind: '', stats: panel, weak: [], resistances: [], skills: [] })
  }
  return variants
}
