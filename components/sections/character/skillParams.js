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
 * 从技能 promote/level 数据构建参数表
 * @param {object} levelData — s.promote (GI) 或 s.level (HSR)
 * @param {string} game — 'gi' | 'hsr'
 * @returns {object|null} { headers: string[], rows: string[][] } | null
 */
export function buildSkillParams (levelData, game) {
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
    // 从 {paramN} 提取真实的 param 下标，处理非顺序引用（如 desc[3] 引用 param6）
    const descMappings = []
    for (let i = 0; i < (first.desc || []).length; i++) {
      const d = String(first.desc[i])
      const label = d.split('|')[0].trim()
      if (!label) continue
      const paramMatch = d.match(/\{param(\d+)(?::([^}]+))?\}/)
      const paramIndex = paramMatch ? Number(paramMatch[1]) - 1 : i
      const format = paramMatch?.[2] || undefined
      descMappings.push({ label, paramIndex, format })
    }
    if (descMappings.length > 0) {
      paramHeaders = descMappings.map(dm => dm.label)
      getValues = (entry) => {
        const arr = entry?.param || []
        return descMappings.map(dm => fmtParam(arr[dm.paramIndex], dm.format))
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

  return { headers, rows }
}