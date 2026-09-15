/**
 * 绝区零邦布构建（ZZZ）
 * hero 一句话 + 满级属性（含突破加成）+ 三招技能（A/B/C）倍率表 + 突破素材
 *
 * 数据形态（42 只一致）：
 * - `detail.stats`：基础值与成长值（成长字段名与角色不同：`hpupgrade` / `attack_upgrade` / `def_upgrade`），
 *   另有全表恒定项 `endurance`(180) / `crit`(500) / `crit_dmg`(5000) / `pen_ratio`(0)，无区分度故不列
 * - `detail.level`：6 档突破（上限 10/20/…/60），`hp_max/attack/defence` 为累计增量，`extra` 为该档累计的
 *   突破加成（暴击率 / 暴击伤害），`materials` 为突破素材
 * - `detail.skill.a/b/c`：主动技 / 额外能力 / 连携技，**档数各不相同**（a 10 档、b 5 档、c 10 档，部分邦布无 c）；
 *   每档 `{name, desc, property[], param}`，`property` 是行名数组，`param` 是 `|` 分隔的字符串，
 *   每段要么是 `{Skill:<id>, Prop:<n>}` 引用（值在 `detail.skill_prop[<id>][<n>]`，`main + growth×(Lv-1)`，`%` 则 ÷100），
 *   要么是数据已按档算好的文本（如 `25秒`、`45%`）
 * - 无 `talent` 字段（旧实现的「影画」段是死代码）；无技能图标与 `<IconMap>`
 * - 单元格文本按「数值原子 / 文字原子」分段（`8.4%生命值`），避免整串撑破等宽单元格；含 `[表达式]` 的
 *   未求值公式行（变量是自身等级）改走固定小格
 * - 特例伊埃斯：无 `level` 表、三招均 0 档、`desc` 即条目名，属占位条目
 */
import { cleanMarkup, evalArith } from '../util.js'
import { aggregateMats, sortMatItems } from '../materials.js'
import { getZZZItemName, getZZZItemIcon } from '../../../model/itemIndex/zzz.js'
import { zzzRankOf } from '../../constants.js'
import { transposeTable } from '../character/skillParams.js'

/** 邦布满级等级（level 表 6 档，上限 60） */
const ZZZ_MAX_BANGBOO_LEVEL = 60

/** 属性表格展示项与标签（propLabel 缺冲击力/异常掌控） */
const BANGBOO_STAT_LABEL = {
  hp_max: '生命值',
  attack: '攻击力',
  defence: '防御力',
  break_stun: '冲击力',
  element_abnormal_power: '异常掌控'
}

/** 随等级成长的属性 → 成长值字段（邦布用 xxxupgrade / xxx_upgrade，与角色命名不同） */
const BANGBOO_GROWTH_KEY = {
  hp_max: 'hpupgrade',
  attack: 'attack_upgrade',
  defence: 'def_upgrade'
}

/** 三招技能的数据键与官方叫法 */
const BANGBOO_SKILLS = [['a', '主动技'], ['b', '额外能力'], ['c', '连携技']]

/** 技能视图保留的末尾档数（同角色/星铁口径：档位多时只出末尾 7 档，长技能 10 档全出会撑破表宽） */
const BANGBOO_TALENT_LEVEL_SPAN = 7

/** 数据自带的未求值公式（如 `[4.4+自身等级*0.08]点`）：变量是自身等级，技能等级代入不了 */
const BANGBOO_FORMULA_RE = /\[[^[\]]+\]/

/** 突破加成的数值格式化：`format` 含 % 的按 ×100 存储（4500 → 45%） */
function _fmtBreakBonus (item) {
  const v = Number(item?.value) || 0
  if (String(item?.format || '').includes('%')) return `${Number((v / 100).toFixed(2))}%`
  return String(v)
}

/**
 * 属性表格：满级（Lv60，含突破累计）基础值 + 最高突破档的加成
 * 满级 = 基础 + (60-1) × 成长/10000 + 最高突破档累计（与角色/音擎同一套口径，已用游戏内 8863 攻击力核对）
 * @param {object} detail
 * @returns {Array<{label:string,value:string}>}
 */
function _statFields (detail) {
  const stats = detail.stats || {}
  const level = detail.level || {}
  const maxKey = Object.keys(level).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).pop()
  const breakthrough = level[maxKey] || {}

  const fields = []
  for (const [key, label] of Object.entries(BANGBOO_STAT_LABEL)) {
    if (stats[key] == null) continue
    const growth = stats[BANGBOO_GROWTH_KEY[key]]
    const value = growth == null
      ? Math.trunc(Number(stats[key]))
      : Math.trunc((Number(stats[key]) || 0) + (ZZZ_MAX_BANGBOO_LEVEL - 1) * (Number(growth) || 0) / 10000 + (Number(breakthrough[key]) || 0))
    fields.push({ label, value: String(value) })
  }
  // 突破加成（最高档累计值；值为 0 的不列）
  for (const [, item] of Object.entries(breakthrough.extra || {})) {
    const v = Number(item?.value) || 0
    if (!v) continue
    fields.push({ label: `突破 · ${item?.name || ''}`, value: _fmtBreakBonus(item) })
  }
  return fields
}

/**
 * 单段取值
 * 含 `{Skill:<id>, Prop:<n>}` 引用时（可为复合公式，如 `{Skill:A}*2+{Skill:B}`、`{{Skill:A}/3}*3`），
 * 把各引用替换为该档数值后求值，`format` 含 % 则 ÷100；不含引用的段是数据已按档算好的文本（如 `25秒`），原样返回
 * @param {string} part - `param` 按 `|` 拆出的一段
 * @param {number} level - 该档等级
 * @param {object} prop - detail.skill_prop
 * @returns {string}
 */
function _cellText (part, level, prop) {
  const src = String(part || '').trim()
  if (!src) return ''
  const refs = [...src.matchAll(/\{+Skill:(\d+),\s*Prop:(\d+)\}+/g)]
  if (!refs.length) return src
  let expr = src
  let isPercent = true
  // 从后往前替换引用，避免索引位移
  for (let i = refs.length - 1; i >= 0; i--) {
    const m = refs[i]
    const item = prop?.[m[1]]?.[m[2]]
    if (!item) return src
    if (!String(item.format || '').includes('%')) isPercent = false
    const value = (Number(item.main) || 0) + (Number(item.growth) || 0) * (level - 1)
    expr = expr.slice(0, m.index) + String(value) + expr.slice(m.index + m[0].length)
  }
  const out = evalArith(expr.replace(/[{}]/g, ''))
  if (out == null) return src
  return isPercent ? `${Number((out / 100).toFixed(2))}%` : String(Math.trunc(out))
}

/**
 * 单元格文本 → 段数组（数值原子与文字原子分开）
 * 模板逐段渲染 `.param-seg`（段内 nowrap），段间由 `<wbr>` 提供换行点。
 * 整条文本作为一个段时，像 `8.4%生命值`（118px）会撑破等宽单元格（7 档表每格内容宽仅 86px）并压住相邻格，
 * 故在数值与文字的交界处切段；纯数值（如 `1722.6%`）本身没有断点，仍按单段输出
 * @param {string} text
 * @returns {string[]}
 */
function _splitSegs (text) {
  const s = String(text ?? '')
  if (!s) return ['']
  return s.match(/[\d.]+%?|[^\d.]+/g) || [s]
}

/**
 * 二招技能 → 技能卡（每招一张卡）
 * 表格取该技能末尾 7 档（与角色/星铁口径一致，a/c 招 10 档只出 Lv4~Lv10）；各级同值的行（如「冷却时间 25秒」）走固定小格
 * @param {object} detail
 * @returns {Array<{name,tag,desc,params}>}
 */
function _skillCards (detail) {
  const cards = []
  for (const [key, label] of BANGBOO_SKILLS) {
    const sk = detail?.skill?.[key]
    const levels = Object.keys(sk?.level || {}).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
    if (!levels.length) continue
    const first = sk.level[levels[0]] || {}
    const props = Array.isArray(first.property) ? first.property : []
    const rowsOf = levels.map(lv => String(sk.level[lv]?.param || '').split('|'))

    const fixed = []
    const varying = []
    props.forEach((name, i) => {
      // 是否随等级变化按全部档判定（同原神：先判固定属性再抽样），展示只取末尾若干档
      const cells = levels.map((lv, li) => _cellText(rowsOf[li][i], Number(lv), detail.skill_prop))
      // 未求值公式（如「能量回复 [4.4+自身等级*0.08]点」）：变量是自身等级，页面无从代入，
      // 且整串（约 230px）远超等宽单元格，故与「冷却时间 25秒」一样进固定小格（取末档，同满级口径），不占表格列
      if (cells.every(c => c !== '' && BANGBOO_FORMULA_RE.test(c))) {
        fixed.push({ label: name, value: cells[cells.length - 1] })
        return
      }
      if (cells.every(c => c === cells[0])) {
        if (cells[0] !== '') fixed.push({ label: name, value: cells[0] })
      } else {
        varying.push({ name, cells: cells.map(_splitSegs) })
      }
    })

    let params = null
    if (varying.length) {
      const offset = Math.max(levels.length - BANGBOO_TALENT_LEVEL_SPAN, 0)
      const shownLevels = levels.slice(offset)
      const headers = ['等级', ...varying.map(r => r.name)]
      const body = shownLevels.map((lv, si) => [String(lv), ...varying.map(r => r.cells[offset + si])])
      params = { ...transposeTable({ headers, rows: body }), fixed }
    } else if (fixed.length) {
      params = { fixed }
    }

    cards.push({
      name: first.name || label,
      tag: label,
      desc: cleanMarkup(first.desc || ''),
      params
    })
  }
  return cards
}

/**
 * 构建绝区零邦布数据
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @returns {object} { hero, metaFields, sections }
 */
export function buildZZZBangboo (record) {
  const detail = record?.content?.detail || {}
  const name = detail.name || record?.meta?.name || ''

  // hero 一句话（伊埃斯等占位条目的 desc 就是条目名，此时不出）
  const desc = cleanMarkup(detail.desc || '')
  const hero = desc && desc.replace(/\s+/g, '') !== String(name).replace(/\s+/g, '') ? { desc } : null

  const metaFields = [
    { label: '稀有度', value: zzzRankOf(record, 'bangboo') },
    ..._statFields(detail)
  ].filter(f => f.value)

  const sections = []

  const skills = _skillCards(detail)
  if (skills.length) {
    sections.push({ title: '技能', type: 'skill-cards', skills })
  }

  // 突破素材（detail.level[1~6].materials 对象：{ "10": 15000, "102010": 4 }，id=10 为丁尼）
  if (detail.level && typeof detail.level === 'object') {
    const levels = Object.values(detail.level).map(lv => {
      const mats = lv?.materials && typeof lv.materials === 'object'
        ? Object.entries(lv.materials)
            .filter(([id]) => id !== '10')
            .map(([id, count]) => ({
              id,
              count: Number(count) || 0,
              name: getZZZItemName(id) || String(id),
              rank: 0
            }))
        : []
      const currency = lv?.materials?.['10']
      return { cost: Number(currency) || 0, mats }
    }).filter(l => l.mats.length > 0 || l.cost > 0)
    if (levels.length > 0) {
      const agg = aggregateMats(levels)
      const items = []
      if (agg.cost > 0) {
        items.push({ name: '丁尼', count: agg.cost, icon: getZZZItemIcon('10'), id: 10, rank: 0 })
      }
      for (const m of agg.mats) {
        items.push({ name: m.name, count: m.count, icon: getZZZItemIcon(m.id), id: m.id, rank: m.rank })
      }
      sortMatItems(items, 'zzz')
      if (items.length > 0) {
        sections.push({ title: '突破素材', type: 'materials', items })
      }
    }
  }

  return { hero, metaFields, sections }
}
