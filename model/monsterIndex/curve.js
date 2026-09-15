/**
 * 原神怪物成长曲线表（惰性加载，进程内仅解析一次）
 * 表来源：官方 MonsterCurveExcelConfigData（见 resources/data/gi-monster-curve.json 头部注释），
 * 数组下标 0 = Lv1，共 200 级。
 * 怪物实际面板 = `child.base.<stat>` × 该变体 `child.prop[].grow_curve` 指定的曲线(等级)——
 * 同一「怪物」的不同变体会声明不同曲线（HP 与 HP_2 在 103 级相差 55%），必须按变体取。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GI_MONSTER_CURVE_FILE, GI_MONSTER_LEVEL } from '../../components/constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const curvePath = path.resolve(__dirname, '..', '..', 'resources', GI_MONSTER_CURVE_FILE)

/** @type {{curves: Object<string, Array<number|null>>}|null} */
let cache = null

/**
 * 读取曲线表（缺失或损坏时返回空表，调用方按「算不出」处理）
 * @returns {{curves: Object<string, Array<number|null>>}}
 */
function loadCurves () {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(curvePath, 'utf8'))
    } catch {
      cache = { curves: {} }
    }
  }
  return cache
}

/**
 * 取指定曲线在指定等级的系数
 * @param {string} type - 曲线名，如 'GROW_CURVE_HP_2'
 * @param {number} [level] - 等级，缺省为面板基准等级（世界等级 9 → 103）
 * @returns {number|null} 曲线未登记或该等级无数值时返回 null
 */
export function giCurveValue (type, level = GI_MONSTER_LEVEL) {
  const v = loadCurves().curves?.[type]?.[Number(level) - 1]
  return typeof v === 'number' ? v : null
}
