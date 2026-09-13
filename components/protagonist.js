/**
 * 多形态角色（主角 / 同族变体）的形态族识别与变体命名
 *
 * 数据源把同一角色的各形态写成独立条目、且**共用同一个条目名**，索引按名字去重会只留下首条：
 * - 原神：旅行者 16 条（无属性占位 ×2 + 7 元素 × 男女）、奇偶·男性/女性 各 7 条（千星奇域主角）
 * - 星铁：{NICKNAME} 10 条（5 命途 × 男女）、三月七 2 条（存护 / 巡猎）
 *
 * 命名规则：形态族名 + `·<属性>`（原神取元素、星铁取命途）；同名条目里带 `·男性/·女性`
 * 的去掉性别标记后归为同一形态族，性别形态折叠为一条（索引保留首条，另一条记为
 * variantPair 供 hero 合体图使用）。无属性的形态保留族名本身（旅行者）。
 */
import { ELEMENT_CN, HSR_PATH_CN } from './constants.js'

/** 主角占位名 → 展示族名（星铁开拓者在数据里是游戏占位符 {NICKNAME}） */
const PROTAGONIST = {
  gi: { raw: '旅行者', display: '旅行者' },
  hsr: { raw: '{NICKNAME}', display: '开拓者' }
}

/**
 * 形态族的社区简称：条目名带 `·男性/·女性` 的族（奇偶 = 千星奇域人偶主角），
 * 习惯写作「偶」→ 男偶 / 女偶 / 火男偶
 */
const FAMILY_SHORT = { 奇偶: '偶' }

/**
 * 形态族名：主角占位名换可读名，其余去掉末尾性别标记（奇偶·男性 → 奇偶）
 * @param {string} gameId - gi/hsr/zzz
 * @param {string} name - 条目名
 * @returns {string}
 */
export function familyName (gameId, name) {
  const raw = String(name || '')
  const protagonist = PROTAGONIST[gameId]
  if (protagonist && protagonist.raw === raw) return protagonist.display
  return raw.replace(/[·・](男性|女性)$/, '')
}

/**
 * 是否主角形态族（`<属性>主` 一类简写只对主角生效）
 * @param {string} gameId
 * @param {string} family - 形态族名
 * @returns {boolean}
 */
export function isProtagonistFamily (gameId, family) {
  const protagonist = PROTAGONIST[gameId]
  return !!protagonist && protagonist.display === family
}

/**
 * 形态取值：原神取元素、星铁取命途（数据里只有英文码）
 * @param {string} gameId
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @returns {{ key: string, label: string }} key 为原始码（用于分组），label 为中文（可能为空）
 */
export function variantOf (gameId, list = {}, detail = {}) {
  if (gameId === 'gi') {
    const element = list?.element || detail?.element || ''
    return { key: String(element), label: ELEMENT_CN[element] || '' }
  }
  if (gameId === 'hsr') {
    const path = list?.baseType || detail?.base_type || ''
    return { key: String(path), label: HSR_PATH_CN[path] || '' }
  }
  return { key: '', label: '' }
}

/**
 * 变体展示名：`<族名>·<属性>`；无属性的形态保留族名（原神无属性旅行者）
 * @param {string} family - 形态族名
 * @param {string} label - 属性中文
 * @returns {string}
 */
export function variantDisplayName (family, label) {
  return label ? `${family}·${label}` : family
}

/**
 * 变体补充别名（索引期并入条目别名，供 `草主` / `巡猎三月七` 一类写法直接命中）
 * @param {string} gameId
 * @param {string} family - 形态族名
 * @param {string} label - 属性中文
 * @param {string} displayName - 变体展示名
 * @returns {string[]}
 */
export function variantAliases (gameId, family, label, displayName) {
  if (!label) return []
  const aliases = [displayName, `${label}${family}`]
  if (isProtagonistFamily(gameId, family)) aliases.push(`${label}主`)
  return aliases
}

/**
 * 带性别标记的形态族补充别名（奇偶 → 火偶 / 火男偶 / 火女偶；族名归属形态再挂 偶 / 男偶 / 女偶 / 族名）
 * 男女形态已折叠为同一条，故两性写法都指向该条
 * @param {string} family - 形态族名
 * @param {string} label - 属性中文
 * @param {boolean} isFamilyOwner - 是否为保留族名的形态
 * @returns {string[]}
 */
export function familyGenderAliases (family, label, isFamilyOwner) {
  const short = FAMILY_SHORT[family]
  if (!short) return []
  const aliases = [`${label}${short}`, `${label}男${short}`, `${label}女${short}`]
  if (isFamilyOwner) aliases.push(family, short, `男${short}`, `女${short}`)
  return aliases
}
