/**
 * 原神怪物归一化
 *
 * 数据形态：`detail.child` 是「变体 id → 战斗实体」的对象（全 585 条共 1512 个变体），
 * 每个变体带 `base{hp,atk,def,em}`、`prop[]`（声明该变体用哪条成长曲线）、`sub_hurt`（元素承伤系数）、
 * `hp_drops`（按血量掉的额外掉落）、`type`（MONSTER_ORDINARY / MONSTER_BOSS …）。
 * 条目本身没有 `detail.id`——map.json 的键就是它的代表 child id。
 *
 * 面板口径：世界等级 9（怪物等级 103），`base × prop 指定曲线(103)`；大世界无环境系数。
 * 反推验证：深境螺旋 `room.first/second[].hp` ÷ 本式 = 该层 `hp_ability` 的常数
 * （HpUp_Lv3 → 2.00000、HpUp_Lv4 → 2.50000、Stage12_New2 → 3.75000，6 期 × 全怪物零偏差）。
 */
import { giCurveValue } from './curve.js'

/** `sub_hurt` 键 → 中文元素名（数据沿用旧键名 grass/elec/rock） */
const SUB_HURT_LABEL = {
  physical: '物理',
  fire: '火',
  water: '水',
  elec: '雷',
  grass: '草',
  wind: '风',
  ice: '冰',
  rock: '岩'
}

/** `child.type` → 中文（全库只有普通与首领两类） */
const TYPE_LABEL = {
  MONSTER_ORDINARY: '普通',
  MONSTER_BOSS: '首领'
}

/** 面板属性：base 键 → [标签, prop[].type]（元素精通无对应 prop，按固定值出） */
const BASE_PROPS = [
  ['hp', '生命值', 'FIGHT_PROP_BASE_HP'],
  ['atk', '攻击力', 'FIGHT_PROP_BASE_ATTACK'],
  ['def', '防御力', 'FIGHT_PROP_BASE_DEFENSE'],
  ['em', '元素精通', null]
]

/**
 * 收集该条目可被引用的全部 id（变体 id 全集；map.json 的 record 键是其中之一）
 * @param {object} detail
 * @returns {string[]}
 */
export function giIndexIds (detail) {
  return Object.keys(detail?.child || {})
}

/**
 * 变体面板：base 值按该变体声明的曲线换算到基准等级
 * @param {object} child - 单个变体
 * @returns {Array<{label:string,value:string}>}
 */
function panelOf (child) {
  const base = child?.base || {}
  const propOf = new Map((child?.prop || []).map(p => [p?.type, p?.grow_curve]))
  const fields = []
  for (const [key, label, propType] of BASE_PROPS) {
    const raw = base[key]
    if (raw == null) continue
    if (!propType) {
      // 元素精通等固定值：0 不列
      if (Number(raw) !== 0) fields.push({ label, value: String(Math.round(Number(raw))) })
      continue
    }
    const curve = propOf.get(propType)
    const k = curve ? giCurveValue(curve) : null
    // 曲线未登记（GROW_CURVE_NONE）或该等级无值 → 算不出，不显示
    if (k == null) continue
    fields.push({ label, value: String(Math.round((Number(raw) || 0) * k)) })
  }
  return fields
}

/**
 * 元素抗性：`sub_hurt` 是承伤系数（0.1 → 10% 抗性）；全 0 表示无抗性，此时不列
 * @param {object} child
 * @returns {Array<{label:string,value:string}>}
 */
function resistancesOf (child) {
  const out = []
  for (const [key, label] of Object.entries(SUB_HURT_LABEL)) {
    const v = Number(child?.sub_hurt?.[key])
    if (!Number.isFinite(v) || v === 0) continue
    out.push({ label, value: `${Number((v * 100).toFixed(1))}%` })
  }
  return out
}

/**
 * 归一化全部变体
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {string} [entryName] - 条目名（变体自身没有中文名，展示名统一取条目名）
 * @returns {Array<object>} 变体数组
 */
export function giVariants (list, detail, entryName = '') {
  const name = detail?.name || list?.zh || entryName
  return Object.entries(detail?.child || {}).map(([id, child]) => ({
    id,
    name,
    codeName: child?.monster_name || '',
    kind: TYPE_LABEL[child?.type] || '',
    stats: panelOf(child),
    weak: [],
    resistances: resistancesOf(child)
  }))
}
