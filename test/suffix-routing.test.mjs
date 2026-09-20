// 后缀路由回归：用真实 handleQuery 验证后缀抢占后是「放行(false)」还是「消费(true)」
// 说明：脱离 bot 环境时 renderAtlas 会失败，故「消费」的判定 = return true（可能伴随渲染失败提示）
import { mod, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { handleQuery } = await import(mod('modules/atlasQuery.js'))

let pass = 0
let fail = 0

async function run (gameId, keyword, expectConsume) {
  const replies = []
  const e = { msg: `#${keyword}`, reply: async (m) => { replies.push(typeof m === 'string' ? m : '[segment]') } }
  let ret
  try {
    ret = await handleQuery(e, gameId, keyword)
  } catch (err) {
    ret = `THROW: ${err.message}`
  }
  const consumed = ret !== false
  const ok = consumed === expectConsume
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} [${gameId}] #${keyword}  return=${ret} 期望=${expectConsume ? '消费' : '放行'}${replies[0] ? '  reply=' + String(replies[0]).slice(0, 30) : ''}`)
}

console.log('=== A. 角色 + 套装类后缀：图鉴无该页 → 必须放行给 miao ===')
await run('gi', '丝柯克圣遗物', false)
await run('gi', '胡桃圣遗物', false)
await run('gi', '甘雨圣遗物', false)
await run('gi', '胡桃驱动盘', false)
await run('zzz', '雅圣遗物', false)
await run('hsr', '符玄圣遗物', false)
await run('hsr', '符玄遗器', false)
await run('gi', '绝缘之旗印遗器', false)
await run('gi', '丘丘人圣遗物', false)

console.log('\n=== B. 真正命中对应页面类型 → 必须消费 ===')
await run('gi', '绝缘之旗印圣遗物', true)
await run('hsr', '不老者的仙舟遗器', true)
await run('zzz', '原始朋克驱动盘', true)

console.log('\n=== C. 角色子视图 → 必须消费 ===')
await run('gi', '胡桃天赋', true)
await run('gi', '胡桃命座', true)
await run('gi', '胡桃养成', true)
await run('gi', '胡桃资料', true)
await run('gi', '胡桃故事', true)
await run('hsr', '符玄行迹', true)
await run('zzz', '雅影画', true)

console.log('\n=== D. 怪物页后缀 → 只导向怪物页，必须消费（渲染完整怪物页） ===')
await run('gi', '丘丘人掉落', true)
await run('gi', '丘丘人资料', true)
await run('hsr', '冰锋技能', true)
await run('zzz', '提尔锋变种个体', true)
await run('zzz', '提尔锋变种', true)

console.log('\n=== E. 查不到 → 放行 ===')
await run('gi', '不存在的角色天赋', false)
await run('gi', '不存在的角色圣遗物', false)

console.log('\n=== F. 泛用「套」后缀 → 按游戏对应各自套装页 ===')
await run('gi', '如雷套', true)
await run('gi', '绝缘套', true)
await run('hsr', '铁卫套', true)
await run('zzz', '啄木鸟套', true)
await run('gi', '皇女套', false)
await run('hsr', '符玄套', false)
// miao 面板换装指令也以「套」结尾（#胡桃换绝缘套）→ 必须放行，否则 miao 收不到
await run('gi', '胡桃换绝缘套', false)
// 「套」单独出现 → 剥离后关键词为空，不走套装后缀分支，与加后缀前行为一致（普通搜索消费）
await run('gi', '套', true)
// 「套装」不以「套」结尾 → 不受后缀影响
await run('gi', '套装', true)

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
