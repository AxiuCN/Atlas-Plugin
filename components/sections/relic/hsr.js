/**
 * 星铁遗器套装构建（HSR）
 * 套装效果 + 部件
 */
import { cleanMarkup, resolveHsrParams } from '../util.js'

/** 部件槽位名：四件套（隧洞遗器）与两件套（位面饰品）各一套；数据顺序已为官方槽位序 */
const HSR_RELIC_SLOTS = {
  4: ['头部', '手部', '躯干', '脚部'],
  2: ['位面球', '连结绳']
}

/**
 * 构建星铁遗器套装数据
 * @param {object} list - record.content.list
 * @param {object} detail - record.content.detail
 * @param {object} meta - record.meta
 * @returns {object} { metaFields, sections }
 */
export function buildHSRRelicset (list, detail, meta) {
  const sections = []

  // 套装效果（desc 内含 #N[fmt]% 占位符，按同档 param_list 取值后再清洗标记）
  if (detail.require_num && typeof detail.require_num === 'object') {
    const bonuses = Object.entries(detail.require_num)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([num, data]) => ({
        require: Number(num),
        desc: cleanMarkup(resolveHsrParams(data?.desc || '', data?.param_list))
      }))
    if (bonuses.length > 0) {
      sections.push({ title: '套装效果', type: 'list', items: bonuses.map(b => ({
        name: `${b.require}件套`,
        desc: b.desc
      })) })
    }
  }

  // 部件（名称前标槽位；槽位名按套装类型判定：require_num 含 4 → 隧洞遗器四件套，否则位面饰品两件套）
  if (detail.parts && typeof detail.parts === 'object') {
    const isCavern = Object.keys(detail.require_num || {}).includes('4')
    const slots = HSR_RELIC_SLOTS[isCavern ? 4 : 2]
    const pieces = Object.values(detail.parts)
      .filter(p => p?.name)
      .map((p, i) => ({
        name: slots[i] ? `${slots[i]} · ${p.name}` : p.name,
        desc: cleanMarkup(p.desc || '')
      }))
    if (pieces.length > 0) {
      sections.push({ title: '部件', type: 'list', items: pieces })
    }
  }

  return { metaFields: [], sections }
}