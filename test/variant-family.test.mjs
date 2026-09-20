// 形态族 / 同名折叠回归
//   盯住 ensureIndex 里那条闸门：只有真正的形态族才派生变体名，非同名的多形态页不读 JSON，
//   但「同名条目的 id / 文件名别名合并 + variantPair」必须仍然生效。
import { mod, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { search, getPageRecords, resolveEntryPageKey } = await import(mod('model/AtlasService.js'))
const { check, finish } = checker()

/** 关键词 → 期望首条（名字） */
function topIs (gameId, keyword, expectName) {
  const res = search(gameId, keyword)
  const top = res?.results?.[0]
  check(`[${gameId}] ${keyword} → ${expectName}`, top?.name === expectName && top?.pageKey === 'character',
    `实际 ${top?.name || '-'}(${top?.pageKey || '-'}) type=${res?.type}`)
}

console.log('=== ① 原神形态族 ===')
topIs('gi', '旅行者', '旅行者')
topIs('gi', '火主', '旅行者·火')
topIs('gi', '草主', '旅行者·草')
topIs('gi', '风主', '旅行者·风')
topIs('gi', '枪主', '旅行者')
topIs('gi', '奇偶', '奇偶·火')
topIs('gi', '火偶', '奇偶·火')
topIs('gi', '男偶', '奇偶·火')

console.log('\n=== ② 星铁形态族 ===')
// 星铁每个形态都有命途标签，无「无属性形态」，故族名归属首个形态（开拓者·毁灭 / 三月七·存护）
topIs('hsr', '开拓者', '开拓者·毁灭')
topIs('hsr', '同谐主', '开拓者·同谐')
topIs('hsr', '毁灭主', '开拓者·毁灭')
topIs('hsr', '三月七', '三月七·存护')
topIs('hsr', '三月七巡猎', '三月七·巡猎')

console.log('\n=== ③ 同名条目的别名合并（改动前口径必须保持）===')
{
  // 武器：星锋剑 3 条同名，其余两条的 id / 文件名必须并入首条别名
  const res = search('gi', '390002')
  check('[gi] 390002 → 星锋剑（重名武器 id 别名）', res?.results?.[0]?.name === '星锋剑',
    `实际 ${res?.results?.[0]?.name || '-'}`)
  const wp = getPageRecords('gi', 'weapon').find(e => e.name === '星锋剑')
  check('[gi] 星锋剑 保留 variantPair', Boolean(wp?.variantPair), `variantPair=${wp?.variantPair || 'null'}`)
}
{
  // ZZZ 物品：齿轮硬币 上百条同名 id 别名
  const res = search('zzz', '1340120')
  check('[zzz] 1340120 → 齿轮硬币（重名物品 id 别名）', res?.results?.[0]?.name === '齿轮硬币',
    `实际 ${res?.results?.[0]?.name || '-'}`)
}
{
  // 星铁货币角色页的 {NICKNAME} 必须仍归一为族名「开拓者」
  const rows = getPageRecords('hsr', 'currency/role').filter(e => e.filePath.includes('{NICKNAME}') || e.name === '开拓者')
  check('[hsr] 货币角色页 {NICKNAME} → 开拓者', rows.length > 0 && rows.every(e => e.name === '开拓者'),
    `实际 ${JSON.stringify([...new Set(rows.map(e => e.name))])}`)
}
{
  // 非形态族的同名页仍折叠为一条（不因闸门收紧而变成多条）
  const itemRows = getPageRecords('zzz', 'item').filter(e => e.name === '齿轮硬币')
  check('[zzz] 齿轮硬币 仍折叠为一条', itemRows.length === 1, `条目数 ${itemRows.length}`)
}

console.log('\n=== ④ 页面类别解析（别名的双闸路径）===')
check('[gi] resolveEntryPageKey(胡桃) = character', resolveEntryPageKey('gi', '胡桃') === 'character')
check('[gi] resolveEntryPageKey(冰风迷途的勇士) = artifact', resolveEntryPageKey('gi', '冰风迷途的勇士') === 'artifact')

finish()
