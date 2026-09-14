/**
 * 绝区零音擎构建（ZZZ）
 * 满级主/副属性 + 音擎天赋 + 音擎故事 + 突破素材
 */
import { cleanMarkup } from '../util.js'
import { aggregateMats } from '../materials.js'
import { getZZZItemName, getZZZItemIcon } from '../../../model/itemIndex/zzz.js'
import { zzzRank } from '../../constants.js'

/** 音擎满级等级与满星级（数据 level 键 0~60、stars 键 0~5） */
const ZZZ_MAX_WEAPON_LEVEL = 60
const ZZZ_MAX_WEAPON_STAR = 5

/**
 * 音擎数值格式化（format 形如 `{0:0.#}` / `{0:0.#%}`）
 * 百分比类数据域为 ×100（3000 → 30%）；固定值按游戏口径截断取整
 * @param {number} value
 * @param {string} [format]
 * @returns {string}
 */
function fmtZZZValue (value, format) {
  if (value == null) return ''
  const inner = String(format || '').match(/\{0:(.+)\}/)?.[1] || ''
  if (inner.includes('%')) return `${Number((Number(value) / 100).toFixed(1))}%`
  return String(Math.trunc(Number(value)))
}

/**
 * 满级（Lv60 + 满星级）主属性
 * 数据只存 1 级基础值与逐级/逐星成长率：value × (1 + (level[60].rate + stars[5].star_rate) / 10000)
 * （已与 nanoka list.atk 全 100 件逐一核对）
 * @param {object} detail
 * @returns {{label:string,value:string}|null}
 */
function _maxBaseProperty (detail) {
  const p = detail?.base_property
  if (!p) return null
  const rate = Number(detail.level?.[ZZZ_MAX_WEAPON_LEVEL]?.rate) || 0
  const starRate = Number(detail.stars?.[ZZZ_MAX_WEAPON_STAR]?.star_rate) || 0
  const value = (Number(p.value) || 0) * (1 + (rate + starRate) / 10000)
  return { label: p.name || '基础属性', value: fmtZZZValue(value, p.format) }
}

/**
 * 满星级副属性：value × (1 + stars[5].rand_rate / 10000)（即 ×2.5，S 级音擎暴击率 24%、暴伤 48% 等可自洽）
 * @param {object} detail
 * @returns {{label:string,value:string}|null}
 */
function _maxRandProperty (detail) {
  const p = detail?.rand_property
  if (!p) return null
  const randRate = Number(detail.stars?.[ZZZ_MAX_WEAPON_STAR]?.rand_rate) || 0
  const value = (Number(p.value) || 0) * (1 + randRate / 10000)
  // 标签同原神武器页口径加「副属性 · 」前缀，与主属性（基础攻击力/基础防御力）区分
  return { label: `副属性 · ${p.name || '副属性'}`, value: fmtZZZValue(value, p.format) }
}

/**
 * 清洗后的文案；源站对未录入的文案用纯标点占位（如 "..."），按空处理不显示
 * @param {string} text
 * @returns {string}
 */
function realText (text) {
  const s = cleanMarkup(text || '')
  return /[\u4e00-\u9fa5A-Za-z0-9]/.test(s.replace(/<[^>]*>/g, '')) ? s : ''
}

/**
 * 构建绝区零音擎数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { hero, metaFields, sections }
 */
export function buildZZZWeapon (list, detail, meta) {
  // hero 小方框：特性（强攻/击破/异常/支援/防护/命破/锋御）；描述补充取一句话版 desc3
  const hero = {
    weapon: detail.weapon_type ? Object.values(detail.weapon_type)[0] : '',
    desc: realText(detail.desc3)
  }

  const metaFields = [
    { label: '稀有度', value: zzzRank(list.rank ?? detail.rarity ?? meta?.rarity, 'weapon') },
    _maxBaseProperty(detail),
    _maxRandProperty(detail)
  ].filter(f => f?.value)

  const sections = []

  // 音擎天赋（类似精炼）
  if (detail.talents && typeof detail.talents === 'object') {
    const refs = Object.entries(detail.talents)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, t]) => ({
        level: `等级 ${k}`,
        name: t.name || '',
        desc: cleanMarkup(t.desc || '')
      }))
    if (refs.length > 0) {
      sections.push({ title: '音擎天赋', type: 'refinements', items: refs })
    }
  }

  // 突破素材（detail.materials 扁平字符串："10:9600,101011:3|10:22400,101021:10|..."）
  // 格式：| 分档、, 分材料、id:count；id=10 为货币丁尼（转 cost）
  // 注意：detail.level[*].exp 为升级经验表，不计入素材（与角色素材口径一致）
  if (detail.materials && typeof detail.materials === 'string') {
    const levels = detail.materials.split('|').map(lvl => {
      const parts = lvl.split(',').map(pair => {
        const [id, count] = pair.split(':')
        return { id, count: count != null ? Number(count) : 0 }
      })
      const currency = parts.find(p => p.id === '10')
      const mats = parts
        .filter(p => p.id !== '10')
        .map(p => ({ id: p.id, count: p.count, name: getZZZItemName(p.id) || String(p.id), rank: 0 }))
      return { cost: currency?.count || 0, mats }
    }).filter(l => l.mats.length > 0 || l.cost > 0)
    if (levels.length > 0) {
      const agg = aggregateMats(levels)
      // ZZZ 素材名称/图标需走 itemIndex（图标命名不统一，不能按 id 直拼）
      const items = []
      if (agg.cost > 0) {
        items.push({ name: '丁尼', count: agg.cost, icon: getZZZItemIcon('10'), id: 10, rank: 0 })
      }
      for (const m of agg.mats) {
        items.push({ name: m.name, count: m.count, icon: getZZZItemIcon(m.id), id: m.id, rank: m.rank })
      }
      if (items.length > 0) {
        sections.push({ title: '突破素材', type: 'materials', items })
      }
    }
  }

  // 音擎故事（desc 为完整故事正文，含灰色引用；与 hero 底部的一句话 desc3 互补），置于素材之后
  const story = realText(detail.desc)
  if (story) {
    sections.push({ title: '音擎故事', type: 'text', text: story })
  }

  return { hero, metaFields, sections }
}