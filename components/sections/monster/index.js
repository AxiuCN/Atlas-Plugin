/**
 * 敌人/怪物 sections builder 入口
 * 按游戏分发归一化；承接子视图（资料 / 技能 / 掉落 / 变体）
 *
 * 同名折叠：索引期把同名记录折叠为一条，其余路径记在 `opts.variantPaths`，
 * 详情页「变体」栏据主条目 + 这些路径逐一取变体后合并展示。
 */
import { buildGIMonster } from './gi.js'
import { buildHSRMonster } from './hsr.js'
import { buildZZZMonster } from './zzz.js'

/**
 * 构建敌人/怪物页面数据
 * @param {string} gameId - 'gi' | 'hsr' | 'zzz'
 * @param {object} record - 完整 JSON（含 meta, content.list, content.detail）
 * @param {string|null} subView - 'profile' | 'skills' | 'materials' | 'variants' | null
 * @param {object} [opts] - { filePath: string 主条目路径, variantPaths: string[] 同名折叠掉的其余记录路径, indexName: string 索引展示名 }
 * @returns {object|null} { hero, metaFields, sections }
 */
export function buildMonsterData (gameId, record, subView = null, opts = {}) {
  const ctx = {
    list: record?.content?.list || {},
    detail: record?.content?.detail || {},
    meta: record?.meta || {},
    filePath: opts?.filePath || '',
    subView,
    variantPaths: Array.isArray(opts?.variantPaths) ? opts.variantPaths : [],
    indexName: opts?.indexName || ''
  }
  if (gameId === 'gi') return buildGIMonster(ctx)
  if (gameId === 'hsr') return buildHSRMonster(ctx)
  if (gameId === 'zzz') return buildZZZMonster(ctx)
  return null
}
