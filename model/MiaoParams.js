/**
 * miao-plugin 星铁技能参数名读取
 *
 * nanoka 星铁技能只有无标签 param_list（序号 + 各级数值），没有任何参数名字段；
 * 参数名的唯一来源是 miao-plugin 的星铁角色数据：talent.<键>.tables[N].name。
 *
 * nanoka 数据通常快于 miao（新角色、新技能 miao 尚未收录，或大版本数值不一致），
 * 因此各取用路径一律按「取不到就返回空」降级，由调用方回退为「属性 N」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** miao-plugin 星铁角色数据目录（同工作区兄弟插件） */
const MIAO_CHAR_DIR = path.resolve(__dirname, '../../miao-plugin/resources/meta-sr/character')

/** 角色名 → 参数表数组 `[{ name, values }]` 缓存；取不到时缓存空数组，避免重复 IO */
const TABLE_CACHE = new Map()

/** miao 中的占位名（不是真实参数名，命中时按未命名处理） */
const PLACEHOLDER_NAME = /^(TODO|参数\s*\d+|技能伤害\d+|伤害提高\d+|受到的伤害提高\d+)$/i

/**
 * 读取某角色的全部技能参数表（跨 talent 键收集：a 普攻 / e 战技 / q 终结技 / t 天赋 / z 秘技 /
 * me 忆灵技 / mt 忆灵天赋 / a2·e2 等强化变体）
 * @param {string} charName - 角色名（nanoka 的 list.zh）
 * @returns {Array<{name: string, values: number[]}>}
 */
function loadTables (charName) {
  if (!charName) return []
  if (TABLE_CACHE.has(charName)) return TABLE_CACHE.get(charName)

  const tables = []
  const file = path.join(MIAO_CHAR_DIR, charName, 'data.json')
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      for (const talent of Object.values(data?.talent || {})) {
        for (const table of Object.values(talent?.tables || {})) {
          const values = Array.isArray(table?.values) ? table.values.map(Number) : []
          if (values.length && table?.name) tables.push({ name: String(table.name), values })
        }
      }
    }
  } catch {
    // miao 数据缺失/损坏按无参数名降级
  }
  TABLE_CACHE.set(charName, tables)
  return tables
}

/** 值序列是否一致（取两者较短长度逐项比较，至少 3 个采样点） */
function isSameSeries (a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    if (!(Math.abs(a[i] - b[i]) < 1e-6)) return false
  }
  return true
}

/**
 * 按各级数值序列为技能参数匹配 miao 参数名
 * 常量参数（各级同值）不参与匹配——它们在天赋视图会被过滤，且 miao 侧同值表无法区分
 * @param {string} charName - 角色名
 * @param {Array<Array>} byLevel - 各等级 param_list（按等级升序）
 * @returns {Object<number, string>} 参数索引（0-based）→ 参数名；未匹配的索引不出现在结果中
 */
export function matchParamNames (charName, byLevel) {
  const names = {}
  if (!charName || !Array.isArray(byLevel) || byLevel.length === 0) return names
  const tables = loadTables(charName)
  if (tables.length === 0) return names

  const count = (byLevel[0] || []).length
  for (let i = 0; i < count; i++) {
    const values = byLevel.map(list => Number(list?.[i]))
    if (values.every(v => !Number.isFinite(v))) continue
    if (values.every(v => v === values[0])) continue // 常量参数跳过
    const hit = tables.find(t => isSameSeries(t.values, values))
    if (!hit || PLACEHOLDER_NAME.test(hit.name)) continue
    names[i] = hit.name
  }
  return names
}

/**
 * 清空参数名缓存（图鉴数据更新后由 AtlasService.reloadIndex 调用）
 */
export function clearMiaoParamCache () {
  TABLE_CACHE.clear()
}
