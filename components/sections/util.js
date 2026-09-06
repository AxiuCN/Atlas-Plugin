/**
 * sections 共享工具函数
 * 图标解析 / 文本清洗 / 数值格式化 / 标签映射
 * 供所有页面 builder 复用（character / weapon / relic / monster / bangboo / item）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backendRoot } from '../../model/AtlasService.js'

/**
 * 从 meta.images 数组查找指定 fieldPath 的本地文件 URL
 * @param {Array} images — record.meta.images
 * @param {string} fieldPath — 如 "detail.skills.0.promote.0.icon"
 * @returns {string} file:// URL，查不到返回空串
 */
export function imgUrl (images, fieldPath) {
  if (!images || !Array.isArray(images)) return ''
  const img = images.find(i => i.fieldPath === fieldPath)
  if (img?.localPath) {
    const fullPath = path.join(backendRoot, img.localPath)
    if (fs.existsSync(fullPath)) {
      return pathToFileURL(fullPath).href
    }
  }
  return ''
}

/** 数值格式化：保留合理小数位 */
export function fmtNum (v) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  if (Number.isInteger(n)) return String(n)
  if (Math.abs(n) >= 1) return n.toFixed(1)
  if (Math.abs(n) >= 0.01) return n.toFixed(2)
  return String(n)
}

/** 格式化百分比（小数 → 百分比字符串） */
export function fmtPercent (v) {
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  if (n > 1) return n.toFixed(1) + '%' // 已经是百分比整数
  return (n * 100).toFixed(1) + '%'
}

/** 生日格式化：[1, 1] → "1月1日" */
export function formatBirthday (birth) {
  if (!birth || !Array.isArray(birth) || birth.length < 2) return ''
  return `${birth[0]}月${birth[1]}日`
}

/**
 * 原神 fight_prop_* 属性共用映射（角色突破属性 / 武器副属性同源键集）
 * 值类型：percent — 小数倍率（0.24 → 24%）；flat — 固定数值（元素精通点数）
 */
const GI_PROP = {
  'fight_prop_critical': ['暴击率', 'percent'],
  'fight_prop_critical_hurt': ['暴击伤害', 'percent'],
  'fight_prop_element_mastery': ['元素精通', 'flat'],
  'fight_prop_charge_efficiency': ['元素充能效率', 'percent'],
  'fight_prop_attack_percent': ['攻击力', 'percent'],
  'fight_prop_hp_percent': ['生命值', 'percent'],
  'fight_prop_defense_percent': ['防御力', 'percent'],
  'fight_prop_heal_add': ['治疗加成', 'percent'],
  'fight_prop_fire_add_hurt': ['火元素伤害加成', 'percent'],
  'fight_prop_water_add_hurt': ['水元素伤害加成', 'percent'],
  'fight_prop_elec_add_hurt': ['雷元素伤害加成', 'percent'],
  'fight_prop_grass_add_hurt': ['草元素伤害加成', 'percent'],
  'fight_prop_wind_add_hurt': ['风元素伤害加成', 'percent'],
  'fight_prop_ice_add_hurt': ['冰元素伤害加成', 'percent'],
  'fight_prop_rock_add_hurt': ['岩元素伤害加成', 'percent'],
  'fight_prop_physical_add_hurt': ['物理伤害加成', 'percent']
}

/**
 * fight_prop_* 键顺序（用于角色突破属性等单值场景的优先级遍历）
 */
export const GI_PROP_KEYS = Object.freeze(Object.keys(GI_PROP))

/**
 * 查询 fight_prop_* 属性信息（未知键返回原文标签 + raw 类型）
 * @param {string} key
 * @param {string} [prefix] - 标签前缀（如「突破·」「副属性·」），默认无
 * @returns {{label: string, kind: 'percent'|'flat'|'raw'}}
 */
export function giPropInfo (key, prefix = '') {
  const info = GI_PROP[key]
  if (!info) return { label: key, kind: 'raw' }
  return { label: prefix + info[0], kind: info[1] }
}

/**
 * 按属性值类型格式化（percent 小数转百分比；flat 固定值取整；0/空跳过返回空串）
 * @param {*} value
 * @param {'percent'|'flat'|'raw'} kind
 * @returns {string}
 */
export function formatGiProp (value, kind) {
  if (value == null || kind === 'raw') return value == null ? '' : String(value)
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  if (kind === 'percent') return fmtPercent(n)
  if (kind === 'flat') return String(Math.round(n))
  return String(value)
}

/** 格式化特殊食物描述 */
export function formatFoodDesc (sf) {
  const parts = []
  if (sf.name) parts.push(sf.name)
  if (sf.recipe) parts.push(`食谱ID: ${sf.recipe}`)
  return parts.join(' | ')
}

/** 武器类型中文映射 */
export function weaponLabel (weapon) {
  const map = {
    WEAPON_SWORD_ONE_HAND: '单手剑',
    WEAPON_CLAYMORE: '双手剑',
    WEAPON_POLE: '长柄武器',
    WEAPON_CATALYST: '法器',
    WEAPON_BOW: '弓'
  }
  return map[weapon] || weapon
}

/** 元素类型中文映射（fallback，优先用 chara_info.vision 中文值） */
export function elementLabel (element) {
  const map = {
    Cryo: '冰', Pyro: '火', Hydro: '水', Electro: '雷',
    Anemo: '风', Geo: '岩', Dendro: '草'
  }
  return map[element] || element
}

/** 固有天赋解锁标签 */
export function passiveUnlock (unlock) {
  if (unlock === 1) return '突破1解锁'
  if (unlock === 4) return '突破4解锁'
  return ''
}

/**
 * 渲染用清洗：保留 HTML 标签（span 高亮等），清理 RUBY 标记和换行符
 * 同时将 <color=#RGB>text</color> 转为 <span style="color:#RGB">text</span>
 */
export function cleanForRender (str) {
  if (!str) return ''
  return String(str)
    .replace(/\\n/g, '\n')
    .replace(/\{RUBY_B#[^}]*}/g, '')
    .replace(/\{RUBY_E#}/g, '')
    .replace(/<color=([^>]+)>([\s\S]*?)<\/color>/g, (m, color, inner) => {
      return `<span style="color:${color}">${inner}</span>`
    })
    .trim()
}

/** 清理 HTML、RUBY 标记、LINK 占位符、换行符（纯文本场景） */
export function cleanText (str) {
  if (!str) return ''
  return String(str)
    .replace(/\\n/g, '\n')
    .replace(/\{RUBY_B#[^}]*}/g, '')
    .replace(/\{RUBY_E#}/g, '')
    .replace(/\{LINK#[^}]*}/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** 技能类型标签 */
export function skillTag (type, game) {
  if (game === 'gi') {
    const tags = { '普通攻击': '普通攻击', '元素战技': '元素战技', '元素爆发': '元素爆发', '冲刺': '冲刺' }
    for (const [k, v] of Object.entries(tags)) {
      if (type.includes(k)) return v
    }
    return '天赋'
  }
  if (game === 'hsr') {
    const tags = { 'Normal': '普攻', 'BPSkill': '战技', 'Ultra': '终结技', 'Talent': '天赋', 'Maze': '秘技' }
    return tags[type] || type
  }
  return type
}

/** 属性名/字段名转中文（覆盖游戏属性、怪物、邦布字段） */
export function propLabel (key) {
  const labels = {
    // 角色/武器基础属性
    hp: '生命值', hp_max: '生命值', MaxHP: '生命值',
    atk: '攻击力', attack: '攻击力', Attack: '攻击力',
    def: '防御力', defence: '防御力', Defence: '防御力',
    speed: '速度', SpeedBase: '速度',
    crit: '暴击率', crit_damage: '暴击伤害', crit_dmg: '暴击伤害',
    pen_rate: '穿透率', pen_ratio: '穿透率',
    stun: '击破', break_stun: '击破',
    sp_need: '能量上限',
    // 怪物字段
    attack_base: '攻击力', hp_base: '生命值', defence_base: '防御力',
    speed_base: '速度', stance_base: '韧性', em: '元素精通',
    // 邦布字段
    endurance: '耐久',
    // 圣遗物等
    HateBase: '嘲讽', CriticalDamage: '暴击伤害', CriticalChance: '暴击率',
    BreakStun: '击破'
  }
  return labels[key] || key
}

/** 星铁属性类型 → 中文 */
const HSR_DAMAGE_TYPE = {
  Physical: '物理', Fire: '火', Ice: '冰', Lightning: '雷', Thunder: '雷',
  Wind: '风', Quantum: '量子', Imaginary: '虚数'
}

/** 星铁命途 → 中文（含数据源职业码与官方命途名） */
const HSR_PATH = {
  Destruction: '毁灭', TheHunt: '巡猎', Erudition: '智识', Harmony: '同谐',
  Nihility: '虚无', Preservation: '存护', Abundance: '丰饶', Elation: '欢愉',
  Remembrance: '记忆',
  // 数据源 base_type 职业码
  Rogue: '巡猎', Warrior: '毁灭', Mage: '智识', Knight: '存护',
  Priest: '丰饶', Warlock: '虚无', Shaman: '同谐', Memory: '记忆'
}

/** 星铁属性/命途英文 → 中文（未知值原样返回） */
export function hsrLabel (value) {
  if (!value) return ''
  return HSR_DAMAGE_TYPE[value] || HSR_PATH[value] || value
}