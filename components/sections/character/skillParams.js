/**
 * 角色技能参数表构建
 * 将三游戏异构的等级数据归一化为统一参数表 { headers, rows }
 */
import { fmtNum } from '../util.js'

/**
 * 按格式说明符格式化参数值
 * @param {*} value
 * @param {string} format - F1P | P | F1 | F2 | undefined
 * @returns {string}
 */
function fmtParam (value, format) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)

  if (!format) return fmtNum(n)

  // 百分比格式
  if (format.includes('P')) {
    const pct = n * 100
    const decimals = format.match(/F(\d+)/)
    if (decimals) return pct.toFixed(Number(decimals[1])) + '%'
    if (Number.isInteger(pct)) return pct + '%'
    return pct.toFixed(1) + '%'
  }

  // 浮点数格式
  if (format.startsWith('F') && format.length > 1) {
    const decimals = Number(format.slice(1))
    if (!Number.isNaN(decimals)) return n.toFixed(decimals)
  }

  return fmtNum(n)
}

/**
 * 文本段归一（无空格拼接，节省排版空间，保留语义文字与单位）
 * - 纯 `+` → `+`；`,` / `，` → `/`；`*` / `×` → `×`
 * - 其余文字原样保留（如「每点」「攻击力」「秒」「*2」→「×2」）
 * @param {string} text - 原始文本段
 * @returns {string}
 */
function normalizeText (text) {
  const s = String(text || '').trim().replace(/\s+/g, ' ')
  if (!s) return ''
  return s.replace(/[,，]/g, '/').replace(/[*×xX]/g, '×')
}

/** 判断文本段是否为纯运算符号（用于同参重复合并判定） */
function isPureOp (text) {
  return /^[+×*/,\s]+$/.test(String(text || '').trim())
}

/**
 * 解析 GI desc 行为 token 流：文本段与参数引用段交替
 * @param {string} d - desc 行（「标签|正文」）
 * @returns {{label:string, tokens:Array<{type:'text'|'ref', text?:string, paramIndex?:number, format?:string}>}|null}
 */
function parseDescTokens (d) {
  const s = String(d)
  const bar = s.indexOf('|')
  const label = s.slice(0, bar).trim()
  const body = s.slice(bar + 1)
  if (!label) return null
  const tokens = []
  const re = /\{param(\d+)(?::([^}]+))?\}/g
  let pos = 0
  let m
  while ((m = re.exec(body))) {
    if (m.index > pos) tokens.push({ type: 'text', text: body.slice(pos, m.index) })
    tokens.push({ type: 'ref', paramIndex: Number(m[1]) - 1, format: m[2] || undefined })
    pos = m.index + m[0].length
  }
  if (pos < body.length) tokens.push({ type: 'text', text: body.slice(pos) })
  if (!tokens.some(t => t.type === 'ref')) return null
  return { label, tokens }
}

/**
 * 合并连续同参重复引用（如「{p}+{p}」→ 单个引用，避免「88.1%+88.1%」重复展示）
 * 仅当引用间文本为纯运算符号时合并；带文字/乘数（如「{p}*2」）不合并
 * @param {Array} tokens
 * @returns {Array}
 */
function mergeSameRefs (tokens) {
  const out = tokens.slice()
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i + 2 < out.length; i++) {
      const a = out[i]
      const b = out[i + 1]
      const c = out[i + 2]
      if (
        a.type === 'ref' && b.type === 'text' && c.type === 'ref'
        && isPureOp(b.text)
        && a.paramIndex === c.paramIndex && a.format === c.format
      ) {
        out.splice(i + 1, 2)
        changed = true
        break
      }
    }
  }
  return out
}

/**
 * 将 token 流渲染为段数组：引用段取值、文本段归一化，
 * 每段是独立原子（模板中 nowrap），换行只发生在段边界、不会断在段内
 * @param {Array} tokens
 * @param {Array} param - 该等级 param 数组
 * @returns {string[]}
 */
function renderTokens (tokens, param) {
  const segs = []
  for (const t of tokens) {
    const s = t.type === 'ref' ? fmtParam(param[t.paramIndex], t.format) : normalizeText(t.text)
    if (s) segs.push(s)
  }
  return segs
}

/** 单元格值 → 段数组（原子多段，模板逐段 nowrap；字符串值包为单段） */
function toSegs (v) {
  return Array.isArray(v) ? v : [String(v ?? '')]
}

/**
 * 横表 → 转置（行=属性，列=等级）
 * GI/HSR/ZZZ 统一表格形态，等级列收敛、属性名做行标签，避免属性列过多横向溢出
 * @param {object} params - 横表结构 { headers, rows, fixed?, ... }
 * @returns {object} 转置后 { headers: ['属性','LvN',...], rows: [{name, values: segs[]}], ... }
 */
export function transposeTable (params) {
  if (!params || !Array.isArray(params.headers) || !Array.isArray(params.rows) || !params.rows.length) {
    return params
  }
  const [, ...attrHeaders] = params.headers
  const lvLabels = params.rows.map(row => `Lv${row[0]}`)
  const newHeaders = ['属性', ...lvLabels]
  const newRows = attrHeaders.map((attr, ai) => ({
    name: attr,
    values: params.rows.map(row => toSegs(row[ai + 1]))
  }))
  return { ...params, headers: newHeaders, rows: newRows }
}

/** GI 转置前保留的代表等级（实战常用区间，收敛列数） */
const GI_LEVEL_TARGETS = [9, 10, 11, 12, 13, 14]

/**
 * 从技能 promote/level 数据构建参数表
 * @param {object} levelData — s.promote (GI) 或 s.level (HSR)
 * @param {string} game — 'gi' | 'hsr'
 * @param {object} [opts] - 选项
 * @param {boolean} [opts.allLevels] - 全等级输出（倍率视图用；默认 GI 抽样到 Lv9-14）
 * @returns {object|null} { headers: string[], rows: string[][], fixed: [] } | null
 */
export function buildSkillParams (levelData, game, opts = {}) {
  if (!levelData || typeof levelData !== 'object') return null

  const levels = Object.keys(levelData).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
  if (!levels.length) return null

  const first = levelData[levels[0]]
  let paramHeaders = []
  let getValues

  const paramArr = first?.param
  const paramList = first?.param_list
  const paramsObj = first?.params

  if (Array.isArray(paramArr) && paramArr.length > 0) {
    // GI: first.param 是数组，first.desc 含标签和格式说明符
    // 按 token 流解析整行（文本段与引用段），原文文字/单位/乘数原样保留，
    // 数值由引用段取值；同参重复引用（{p}+{p}）合并为单值
    const descMappings = []
    for (let i = 0; i < (first.desc || []).length; i++) {
      const parsed = parseDescTokens(first.desc[i])
      if (!parsed) continue
      descMappings.push({ label: parsed.label, tokens: mergeSameRefs(parsed.tokens) })
    }
    if (descMappings.length > 0) {
      paramHeaders = descMappings.map(dm => dm.label)
      getValues = (entry) => {
        const arr = entry?.param || []
        return descMappings.map(dm => renderTokens(dm.tokens, arr))
      }
    }
  }

  if (!paramHeaders.length && paramList != null) {
    if (Array.isArray(paramList) && paramList.length > 0) {
      paramHeaders = paramList.map((_, i) => `属性${i + 1}`)
      getValues = (entry) => {
        const arr = entry?.param_list || []
        return paramHeaders.map((_, i) => fmtNum(arr[i]))
      }
    } else if (typeof paramList === 'object') {
      paramHeaders = Object.keys(paramList)
      getValues = (entry) => paramHeaders.map(k => fmtNum(entry?.param_list?.[k]))
    }
  }

  if (!paramHeaders.length && paramsObj && typeof paramsObj === 'object') {
    paramHeaders = Object.keys(paramsObj)
    getValues = (entry) => paramHeaders.map(k => fmtNum(entry?.params?.[k]))
  }

  if (!paramHeaders.length) return null

  // 等级偏移：GI promote 键 0-14 对应游戏内等级 1-15
  const levelOffset = game === 'gi' ? 1 : 0

  const headers = ['等级', ...paramHeaders]
  const rows = levels.map(lv => {
    const entry = levelData[lv]
    return [String(Number(lv) + levelOffset), ...getValues(entry)]
  })

  // 固定属性（仅 GI）：非等级列中全部等级值相同 → 不随技能等级变化（冷却/能量/体力等），
  // 从参数表剔除并单独抽出，由模板渲染为技能卡上的独立小格。
  // HSR/ZZZ 不提取——HSR 的 param_list 数组无标签名（只能占位"属性N"），
  // 且其多列为跨等级常量本就合理显示在表中，硬抽无意义。
  const fixed = []
  const fixedCols = new Set()
  if (game === 'gi') {
    for (let ci = 1; ci < headers.length; ci++) {
      // 单元格为段数组 → 按 join 后全文比较是否跨等级恒定
      const values = rows.map(row => toSegs(row[ci]).join(''))
      if (values.length > 0 && values.every(v => v === values[0])) {
        fixed.push({ label: headers[ci], value: values[0] })
        fixedCols.add(ci)
      }
    }
  }
  if (fixed.length > 0) {
    // 从后往前剔除固定列，避免索引错位
    for (const ci of [...fixedCols].sort((a, b) => b - a)) {
      headers.splice(ci, 1)
      for (const row of rows) row.splice(ci, 1)
    }
  }

  // 等级抽样（仅 GI 默认视图）：固定列提取后（基于全等级判定）再抽样代表等级，收敛转置列数；
  // 倍率视图（allLevels）保留全等级
  let finalRows = rows
  if (game === 'gi' && !opts.allLevels) {
    const targets = new Set(GI_LEVEL_TARGETS)
    const sampled = rows.filter(row => targets.has(Number(row[0])))
    // 理论必中（promote 均含 0-14）；异常缺失时退化为全等级
    if (sampled.length > 0) finalRows = sampled
  }

  return transposeTable({ headers, rows: finalRows, fixed })
}