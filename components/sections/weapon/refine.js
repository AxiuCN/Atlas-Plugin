/**
 * 武器精炼 / 叠影 / 音擎天赋：1~5 档合并成一段
 *
 * 三家数据形状不同（原神/绝区零每档 desc 已代入数值，星铁是模板 + 各档 param_list），
 * 调用方统一传「每档原始富文本」进来，本模块只负责对齐与合并：
 * - 各档文本只有数值差异 → 合成一条，差异处按 `a/b/c/d/e` 用 `/` 连接
 * - 文本本身有差异（如原神「星锋剑」精炼1 比精炼2-5 多一句）→ 按相邻同形状分组，
 *   各组单独成条并标出档位区间；此时条数即组数（通常 2 条）
 *
 * 切词用「标签整体成块」的方式：`<color=#99FFFFFF>` 这类色号里的十六进制数字不会被
 * 误当成可比较的数值，数值只在标签外的文本里切。
 */
import { cleanMarkup } from '../util.js'

/** 数值 token：支持千分位与小数，允许尾随 %（如 12% / 2.3% / 1,200） */
const NUM_RE = /(\d+(?:,\d{3})*(?:\.\d+)?%?)/

/**
 * 把富文本切成 token 序列
 * @param {string} text
 * @returns {Array<{type: 'tag'|'text'|'num', text: string}>}
 */
function tokenize (text) {
  const tokens = []
  for (const chunk of String(text || '').match(/<[^>]*>|[^<]+/g) || []) {
    if (chunk.startsWith('<')) {
      tokens.push({ type: 'tag', text: chunk })
      continue
    }
    for (const part of chunk.split(NUM_RE)) {
      if (!part) continue
      tokens.push({ type: /^\d/.test(part) ? 'num' : 'text', text: part })
    }
  }
  return tokens
}

/**
 * 形状键：数值位置统一记 `#`，标签与文本原样保留（形状相同 = 文本骨架一致，只有数值可能不同）
 * @param {Array} tokens
 * @returns {string}
 */
function shapeKey (tokens) {
  return tokens.map(t => (t.type === 'num' ? '#' : `${t.type}|${t.text}`)).join('\u0001')
}

/**
 * 合并一组同形状档位的 token：数值位全同取单值，有差异按 `/` 连接
 *
 * 相邻两个多值槽之间若只有 `/`（原文本自带的分隔符），合并后会连成 10~15 个值的一长串，
 * 例如雾切之回光的「8/16/28%」→「8/10/…/32/28%/…/56%」。这类槽各自加圆括号区分：
 * `(8%/10%/12%/14%/16%)/(16%/20%/24%/28%/32%)/(28%/35%/42%/49%/56%)`
 * @param {Array<Array>} tokenList - 同形状的 token 序列（按档位顺序）
 * @returns {string} 合并后的富文本
 */
function mergeTokens (tokenList) {
  const base = tokenList[0]
  const merged = base.map((token, i) => {
    if (token.type !== 'num') return { type: token.type, text: token.text }
    const values = tokenList.map(tokens => tokens[i].text)
    const multi = new Set(values).size > 1
    return { type: 'num', text: multi ? values.join('/') : values[0], multi }
  })

  // 相邻（之间只有 / 文本）的两个多值槽 → 都加括号
  const wrap = new Set()
  const numIdx = merged.map((t, i) => (t.type === 'num' ? i : -1)).filter(i => i >= 0)
  for (let k = 1; k < numIdx.length; k++) {
    const prev = numIdx[k - 1]
    const cur = numIdx[k]
    const between = merged.slice(prev + 1, cur)
    const slashOnly = between.length > 0 && between.every(t => t.type === 'text' && /^[／/]+$/.test(t.text))
    if (slashOnly && merged[prev].multi && merged[cur].multi) {
      wrap.add(prev)
      wrap.add(cur)
    }
  }

  return merged
    .map((t, i) => (t.type === 'num' && wrap.has(i) ? `(${t.text})` : t.text))
    .join('')
}

/**
 * 合并各档文本
 * @param {Array<{level: string, name: string, desc: string}>} levels - 按档位升序；desc 为原始富文本
 * @param {string} prefix - 档位标签前缀（原神「精炼」/ 星铁「叠影」/ 绝区零「等级」）
 * @returns {Array<{level: string, name: string, desc: string}>} 合并后的条目（单组不带 level）
 */
export function mergeRefineLevels (levels, prefix) {
  const rows = (levels || [])
    .map(l => ({ ...l, tokens: tokenize(l.desc) }))
    .filter(r => r.tokens.length > 0)
  if (!rows.length) return []

  // 相邻同形状的档位归为一组；形状不同说明文本本身有差异，须分开显示
  const groups = []
  for (const row of rows) {
    const key = shapeKey(row.tokens)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(row)
    else groups.push({ key, rows: [row] })
  }

  // 只有一组（各档文本仅数值差异）时不标等级，标题只留效果名
  const split = groups.length > 1
  return groups.map(group => {
    const nums = group.rows.map(r => r.level).filter(Boolean)
    let level = ''
    if (split && nums.length) {
      level = nums.length > 1
        ? `${prefix}${nums[0]}-${nums[nums.length - 1]}`
        : `${prefix}${nums[0]}`
    }
    return {
      level,
      name: group.rows[0].name || '',
      desc: cleanMarkup(mergeTokens(group.rows.map(r => r.tokens)))
    }
  })
}
