// 角色攻略的接管 / 放行语义回归
//   命中角色 + 仓库有攻略 → 消费（渲染）
//   命中角色 + 仓库无该角色攻略 → 消费并提示「暂无攻略数据」
//   没命中角色 → 放行（return false，交给其他插件）
//
// 「有攻略 / 无攻略」的角色在运行时从图鉴条目里动态取样，不写死角色名 ——
// 攻略仓库内容会持续增长（实测已从 44 个角色涨到 129 个），写死会让套件随数据变化误报。
import { mod, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { handleQuery, getPageRecords } = {
  ...(await import(mod('modules/atlasQuery.js'))),
  ...(await import(mod('model/AtlasService.js')))
}
const { getCharacterGuide } = await import(mod('model/codexIndex/index.js'))

/**
 * 在某个游戏的角色条目里取一个「有/无攻略」的条目名
 * @param {string} gameId
 * @param {boolean} wantGuide - true 取有攻略的，false 取没有攻略的
 * @returns {string} 取不到返回空串
 */
function pickCharacter (gameId, wantGuide) {
  for (const e of getPageRecords(gameId, 'character')) {
    if (e.name.includes('·')) continue // 跳过形态族变体（攻略键与变体名未必一致）
    if (Boolean(getCharacterGuide(gameId, e.name)) === wantGuide) return e.name
  }
  return ''
}

let pass = 0
let fail = 0

async function run (gameId, keyword, expect, expectReplyIncludes = '') {
  const replies = []
  const e = { msg: `#${keyword}`, reply: async (m) => { replies.push(typeof m === 'string' ? m : '[segment]') } }
  let ret
  try {
    ret = await handleQuery(e, gameId, keyword)
  } catch (err) {
    ret = `THROW: ${err.message}`
  }
  const consumed = ret !== false
  const okConsume = consumed === (expect !== 'pass')
  const okReply = !expectReplyIncludes || replies.some(m => m.includes(expectReplyIncludes))
  const ok = okConsume && okReply
  ok ? pass++ : fail++
  const reply = replies[0] ? `  reply=${String(replies[0]).slice(0, 40)}` : ''
  console.log(`  ${ok ? '✅' : '❌'} [${gameId}] #${keyword}  return=${ret} 期望=${expect === 'pass' ? '放行' : '消费'}${reply}`)
}

const giWith = pickCharacter('gi', true)
const giWithout = pickCharacter('gi', false)
const hsrWithout = pickCharacter('hsr', false)
const zzzWithout = pickCharacter('zzz', false)
console.log(`动态取样：原神 有攻略=${giWith || '(无)'}｜无攻略=${giWithout || '(无)'}｜星铁 无攻略=${hsrWithout || '(无)'}｜绝区零 无攻略=${zzzWithout || '(无)'}`)

console.log('\n=== A. 命中角色 + 攻略仓库有该角色 → 消费（渲染攻略页）===')
for (const kw of [`${giWith}攻略`, `${giWith}指南`]) {
  if (giWith) await run('gi', kw, 'consume')
}

console.log('\n=== B. 命中角色 + 攻略仓库没有该角色 → 消费并提示「暂无攻略数据」===')
if (giWithout) await run('gi', `${giWithout}攻略`, 'consume', '暂无攻略数据')
if (hsrWithout) await run('hsr', `${hsrWithout}攻略`, 'consume', '暂无攻略数据')
if (zzzWithout) await run('zzz', `${zzzWithout}攻略`, 'consume', '暂无攻略数据')

console.log('\n=== C. 没有命中角色 → 放行 ===')
await run('gi', '不存在的角色攻略', 'pass')
await run('gi', '如雷的盛怒攻略', 'pass')
await run('gi', '绝缘之旗印攻略', 'pass')
await run('hsr', '不老者的仙舟攻略', 'pass')
await run('zzz', '啄木鸟电音攻略', 'pass')
await run('gi', '摩拉攻略', 'pass')

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
