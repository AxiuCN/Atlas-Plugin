/**
 * 星铁怪物归一化
 *
 * 数据形态：`detail.id` 是图鉴条目 id（map.json 键即它），`detail.child` 是**数组**——同一图鉴条目下的
 * 战斗实体变体（全 628 条共 2648 个），每个变体带 `stance_weak_list`（弱点）、`damage_type_resistance`（抗性）、
 * `skill_list`（技能）与各类 `*_modify_ratio` / `elite_group` / `hard_level_group`。
 *
 * 面板口径：基础值（`attack_base` / `hp_base` …）挂在 `detail` 上，各变体共用；
 * 实际数值 = 基础值 × `hard_level_group` 在**基准等级**（95）的比率（表见 model/monsterIndex/levelTable.js）。
 * `elite_group` 是终局（混沌/末日）按难度二次缩放的键，不属于怪物自身面板，不参与。
 *
 * 注意：628 条记录只有 373 个唯一名字——同名条目本质是同一怪被拆成多条索引，
 * 由索引期折叠为一条并把其余路径记入 `variantPaths`，本模块按「一条目 → 多记录」拼合变体。
 */
import { hsrLabel } from '../../components/constants.js'
import { hsrLevelRatio } from './levelTable.js'

/** 基准等级（与 constants 的 HSR_MONSTER_LEVEL 一致，由调用方传入更好；此处保持单一来源） */
import { HSR_MONSTER_LEVEL } from '../../components/constants.js'

/** 基础数值字段 → [面板标签, 比率键]（比率取自 HardLevelGroup；无对应比率的按原值出） */
const BASE_FIELDS = [
  ['hp_base', '生命值', 'hp'],
  ['attack_base', '攻击力', 'attack'],
  ['defence_base', '防御力', 'defence'],
  ['speed_base', '速度', null],
  ['stance_base', '韧性', null]
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
 * 面板基础数值：按硬等级组换算到基准等级（等级写进 label，供页面直接展示）
 * @param {object} detail
 * @returns {Array<{label:string,value:string}>}
 */
export function hsrPanel (detail) {
  const group = (Array.isArray(detail?.child) ? detail.child[0]?.hard_level_group : null) ?? 1
  const ratio = hsrLevelRatio(group, HSR_MONSTER_LEVEL)
  const out = []
  for (const [key, label, ratioKey] of BASE_FIELDS) {
    const raw = detail?.[key]
    if (raw == null) continue
    const k = ratioKey ? ratio?.[ratioKey] : null
    // 随等级换算的属性在标签后标注等级；速度/韧性无等级比率，按原值出
    const text = k == null ? String(raw) : String(Math.round((Number(raw) || 0) * k))
    out.push({ label: k == null ? label : `${label} (Lv.${HSR_MONSTER_LEVEL})`, value: text })
  }
  if (detail?.status_resistance_base != null) {
    out.push({ label: '效果抵抗', value: pct(detail.status_resistance_base) })
  }
  return out
}

/**
 * 归一化全部变体（弱点 / 抗性 / 技能均按变体取，面板取 detail）
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
