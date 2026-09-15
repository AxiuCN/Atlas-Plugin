/**
 * sections 共享工具函数
 * 图标解析 / 文本清洗 / 数值格式化 / 标签映射
 * 供所有页面 builder 复用（character / weapon / relic / monster / bangboo / item）
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backendRoot } from '../../model/AtlasService.js'
import { patchImageUrl, imageGameFolder } from '../patch.js'

// 元素/命途中文映射定义在 components/constants.js（索引层同样需要，避免循环依赖）
export { elementLabel, hsrLabel } from '../constants.js'

/**
 * 从 meta.images 数组查找指定 fieldPath 的本地文件 URL
 * 插件图片补丁（resources/patch/gallery/）优先，用于补缺图与覆盖错图
 * @param {Array} images — record.meta.images
 * @param {string} fieldPath — 如 "detail.skills.0.promote.0.icon"
 * @returns {string} file:// URL，查不到返回空串
 */
export function imgUrl (images, fieldPath) {
  if (!images || !Array.isArray(images)) return ''
  const img = images.find(i => i.fieldPath === fieldPath)
  if (!img) return ''
  const patch = patchImageUrl(imageGameFolder(img, images), img.originalValue)
  if (patch) return patch
  if (img.localPath) {
    const fullPath = path.join(backendRoot, img.localPath)
    if (fs.existsSync(fullPath)) {
      return pathToFileURL(fullPath).href
    }
  }
  return ''
}

/**
 * 按资源名直接取 gallery 图片（数据 meta.images 未引用的素材，如主角各元素形态的地区名片）
 * 同样优先取插件图片补丁
 * @param {string} gameId - gi/hsr/zzz（对应 gallery/<gameId>/ 目录）
 * @param {string} fileName - 资源名（不含扩展名），如 UI_NameCardIcon_Tps1
 * @returns {string} file:// URL，本地不存在返回空串
 */
export function galleryUrl (gameId, fileName) {
  if (!gameId || !fileName) return ''
  const patch = patchImageUrl(gameId, fileName)
  if (patch) return patch
  const fullPath = path.join(backendRoot, 'gallery', gameId, `${fileName}.webp`)
  return fs.existsSync(fullPath) ? pathToFileURL(fullPath).href : ''
}

/**
 * 算术表达式求值（只含数字、+ - * / ( ) 与空白）
 * 绝区零技能/邦布倍率的复合公式（把 `{Skill:…}` 引用替换成数值后）用它求值，
 * 手写递归下降以避免 eval / new Function
 * @param {string} expr
 * @returns {number|null} 含其它字符或语法非法时返回 null
 */
export function evalArith (expr) {
  const s = String(expr).replace(/\s+/g, '')
  if (!s || !/^[\d+\-*/().]+$/.test(s)) return null
  let i = 0
  const peek = () => s[i]
  const parseFactor = () => {
    if (peek() === '-') {
      i++
      const v = parseFactor()
      return v == null ? null : -v
    }
    if (peek() === '(') {
      i++
      const v = parseExpr()
      if (v == null || peek() !== ')') return null
      i++
      return v
    }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    return Number(m[0])
  }
  const parseTerm = () => {
    let v = parseFactor()
    if (v == null) return null
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]
      const r = parseFactor()
      if (r == null) return null
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const parseExpr = () => {
    let v = parseTerm()
    if (v == null) return null
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]
      const r = parseTerm()
      if (r == null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const out = parseExpr()
  return out != null && i === s.length && Number.isFinite(out) ? out : null
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

/** 生日格式化：[1, 1] → "1月1日"（缺月/日时返回空串，如枪主条目的 [null, null]） */
export function formatBirthday (birth) {
  if (!birth || !Array.isArray(birth) || birth.length < 2) return ''
  if (birth[0] == null || birth[1] == null) return ''
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
    WEAPON_BOW: '弓',
    WEAPON_CROSSBOW: '枪', // 第三人称射击旅行者（枪主）条目残留的武器码
    ITEM_TPS_WEAPON: '枪' // 第三人称射击模式的武器条目（榴晶·各元素等 8 件，与枪主同族）
  }
  return map[weapon] || weapon
}

/** 固有天赋解锁标签 */
export function passiveUnlock (unlock) {
  if (unlock === 1) return '突破1解锁'
  if (unlock === 4) return '突破4解锁'
  return ''
}

/**
 * 内联色号归一化：8 位十六进制去掉 alpha、统一大写；非十六进制（如 ZZZ 的 POSITIVE_WITH_GREYITE）返回 null
 * 归一后 CSS 侧每个色相只需写一条 6 位大写选择器
 * @param {string} color
 * @returns {string|null}
 */
export function normalizeInlineColor (color) {
  const c = String(color || '').trim()
  const m8 = c.match(/^#([0-9a-fA-F]{8})$/)
  if (m8) return '#' + m8[1].slice(0, 6).toUpperCase()
  const m6 = c.match(/^#([0-9a-fA-F]{6})$/)
  if (m6) return '#' + m6[1].toUpperCase()
  const m3 = c.match(/^#([0-9a-fA-F]{3})$/)
  if (m3) return '#' + m3[1].split('').map(x => x + x).join('').toUpperCase()
  return null
}

/**
 * 渲染用清洗：保留官方内联标注（高亮色/下划线词条/斜体注记），其余标签剥除
 * - `<color=#RGB>…</color>`（含 LINK 解析后残留的 `<span style="color:#RGB">`）→ 归一为 6 位大写色号的内联 span，
 *   由 components.css 按色相映射为浅底可读色
 * - `<u>…</u>` → `<span class="kw">`（机制度词条）
 * - `<i>…</i>` → `<span class="note">`（补充说明）
 * - `<unbreak>` / `<iconmap>` / `<term>` / `<icon>` 等其余标签一律剥除
 * 模板以 `{{@}}` 原样渲染本函数输出，故只放行函数自身生成的 span
 * @param {string} str
 * @returns {string}
 */
export function cleanMarkup (str) {
  if (!str) return ''
  return String(str)
    .replace(/\\n/g, '\n')
    .replace(/\{RUBY_B#[^}]*}/g, '')
    .replace(/\{RUBY_E#}/g, '')
    .replace(/\{LINK#[^}]*}/g, '')
    .replace(/<color=([^>]+)>([\s\S]*?)<\/color>/g, (m, color, inner) => {
      const hex = normalizeInlineColor(color)
      return hex ? `<span style="color:${hex}">${inner}</span>` : inner
    })
    .replace(/<span style="color:([^"]+)"([^>]*)>/g, (m, color, rest) => {
      const hex = normalizeInlineColor(color)
      return hex ? `<span style="color:${hex}"${rest}>` : `<span${rest}>`
    })
    .replace(/<u>([\s\S]*?)<\/u>/g, '<span class="kw">$1</span>')
    .replace(/<i>([\s\S]*?)<\/i>/g, '<span class="note">$1</span>')
    .replace(/<(?!\/?span\b)[^>]*>/g, '')
    .trim()
}

/**
 * 渲染用清洗（旧路径）：保留任意 HTML 标签，仅转 <color>
 * 保留供故事/语音等已确定无其它标签的字段使用
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

/**
 * 清理 HTML、RUBY 标记、LINK 占位符、换行符（纯文本场景）
 * 描述类字段请用 cleanMarkup()（保留官方高亮）；本函数用于确需无标签纯文本的字段
 */
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

/**
 * 替换星铁文本中的参数占位符（角色技能 / 忆灵技能 / 行迹 / 星魂 / 光锥叠影共用）
 * 格式：#N[i] 整数 / #N[f1] 1 位小数；占位符后紧跟 % 时值 ×100（0.3 → 30%，2 → 200%）
 * <unbreak> 仅作显示包裹，剥除标签后统一处理占位符
 * @param {string} text
 * @param {Array} paramList - 对应档位的 param_list
 * @param {object} [opts] - 档位标注选项
 * @param {number} [opts.level] - 取值档位（标注在数值后，miao 图鉴同款提示）
 * @param {Set<number>} [opts.varying] - 随等级变化的参数索引；常量参数与等级无关，不标注
 * @returns {string}
 */
export function resolveHsrParams (text, paramList, opts = {}) {
  if (!text) return ''
  return String(text)
    .replace(/<\/?unbreak>/g, '')
    .replace(/#(\d+)\[([^\]]+)\](%?)/g, (m, n, fmt, pct) => {
      const idx = Number(n) - 1
      const val = paramList?.[idx]
      if (val == null) return m
      let out = Number(val)
      if (Number.isNaN(out)) return m
      if (pct === '%') out = out * 100
      if (fmt === 'i') out = Math.round(out)
      else if (/^f\d+$/.test(fmt)) out = Number(out).toFixed(Number(fmt.slice(1)))
      const tag = opts.level != null && opts.varying?.has(idx)
        ? `<span class="lv-tag">（Lv.${opts.level}）</span>`
        : ''
      return out + pct + tag
    })
}