/**
 * 数据来源署名片段
 *
 * 数据现在来自四个源，页脚第一行单独列出**这页实际用到的**数据库；
 * 混源页面（终局里的强度研究院解析、预览期的月亮网等）按出现顺序拼接。
 */
const SOURCE_LABELS = {
  nanoka: 'nanoka.cc',
  alioth: '玉璃 alioth.wiki',
  lunaris: 'Lunaris lunaris.moe',
  gensri: '强度研究院 gensri.wiki'
}

/** 所有源（缺来源信息时的回落） */
export const ALL_SOURCES = Object.keys(SOURCE_LABELS)

/**
 * 源 id 列表 → 展示文本
 * @param {string[]} sources
 * @returns {string}
 */
export function buildCredit (sources) {
  const list = (Array.isArray(sources) ? sources : [])
    .map((source) => String(source || '').trim().toLowerCase())
    .filter((source) => SOURCE_LABELS[source])
  const unique = [...new Set(list)]
  const picked = unique.length ? unique : ALL_SOURCES
  return picked.map((source) => SOURCE_LABELS[source]).join(' · ')
}