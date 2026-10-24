// 后缀路由回归：用真实 handleQuery 验证后缀抢占后是「放行(false)」还是「消费(true)」
// 说明：脱离 bot 环境时 renderAtlas 会失败，故「消费」的判定 = return true（可能伴随渲染失败提示）
import { mod, requireAtlasData, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { handleQuery } = await import(mod('modules/atlasQuery.js'))

let pass = 0
let fail = 0

/** 非「消费/放行」型的断言（数据侧前提、落点校验） */
function check (name, ok, extra = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
}

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

/** 断言「消费 + 回复文案包含某段文字」（用于专武未收录这类提示） */
async function runReply (gameId, keyword, expectText) {
  const replies = []
  const e = { msg: `#${keyword}`, reply: async (m) => { replies.push(typeof m === 'string' ? m : '[segment]') } }
  const ret = await handleQuery(e, gameId, keyword)
  const text = replies.find(r => typeof r === 'string') || ''
  check(`[${gameId}] #${keyword} 回复「${expectText}」`, ret !== false && text.includes(expectText), text.slice(0, 40) || '无文本回复')
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

console.log('\n=== G. 别名本身带后缀 → 不剥离（#风套 = 翠绿之影，而非「风」+套）===')
// 数据侧前提：这些名字在别名表里本来就是别名（风套→翠绿之影 …）。
// 断言只校验「原词直接落到套装页」，不写死条目 id；别名缺失时此断言会变红，正是要暴露的信号。
const { search } = await import(mod('model/AtlasService.js'))
for (const kw of ['风套', '冰套', '水套', '岩套', '草套', '沙套', '奶套', '火套']) {
  const top = search('gi', kw)?.results?.[0]
  check(`「${kw}」原词直接命中套装页`, top?.pageKey === 'artifact', top ? top.name : '无命中')
}
for (const kw of ['风套', '冰套', '水套', '岩套', '草套', '沙套', '奶套', '火套']) {
  await run('gi', kw, true)
}
// 「行迹」是星铁的角色子视图后缀，而原神武器「虹的行迹」名字里就带它（跨类别的同类冲突）
const hong = search('gi', '虹的行迹')?.results?.[0]
check('「虹的行迹」原词命中武器页（不被「行迹」后缀打散）', hong?.pageKey === 'weapon', hong ? hong.name : '无命中')
await run('gi', '虹的行迹', true)

console.log('\n=== H. 落点一致性：别名与标准名渲染同一页（后缀没把名字打散）===')
// 「消费 true」不足以说明落点对不对：剥离后的残词可能"擦边"收敛到别的套装页。
// 故直接比对渲染结果——指定别名与它的标准名必须出同一张图（segment 桩是恒等函数，reply 拿到的就是缓冲区）。
async function renderOf (gameId, keyword) {
  const replies = []
  const e = { msg: `#${keyword}`, reply: async (m) => { replies.push(m) } }
  try {
    await handleQuery(e, gameId, keyword)
  } catch (err) {
    return `THROW: ${err.message}`
  }
  return replies[0]
}
const sameImage = (a, b) => Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length > 0 && Buffer.compare(a, b) === 0
for (const [alias, target] of [['风套', '翠绿之影'], ['冰套', '冰风迷途的勇士'], ['火套', '炽烈的炎之魔女'], ['奶套', '被怜爱的少女']]) {
  const a = await renderOf('gi', alias)
  const b = await renderOf('gi', target)
  const detail = Buffer.isBuffer(a)
    ? `${a.length}B vs ${Buffer.isBuffer(b) ? b.length + 'B' : String(b)}`
    : `非缓冲区：${typeof a === 'string' ? a : typeof a}`
  check(`#${alias} 与 #${target} 渲染同一页`, sameImage(a, b), detail)
}

console.log('\n=== I. 「专武」后缀：别名表登记 → 武器页；无数据要明说 ===')
// 官方名 / 别名 / 全名 三种写法都要能落到武器页（组合解析，不再依赖逐条字符串）
await run('gi', '胡桃专武', true)
await run('gi', '雷神专武', true)
await run('gi', '枫原万叶专武', true)
await run('gi', '温迪专武', true)    // 多把 → 列表页
await run('gi', '温迪新专武', true)  // 显式修饰 → 单条
await run('hsr', '黄泉专武', true)   // 星铁 aliasCfg 已加载
// 没有专武数据的角色：必须明确回复，不能静默落到角色页
await runReply('gi', '香菱专武', '暂未收录')
await runReply('gi', '阿罗夏专武', '暂未收录')
await runReply('zzz', '雅专武', '暂未收录')
// 有专武、只是没有该修饰的专武（钟离有贯虹之槊，但没有新专武）——不能笼统说「暂未收录」
await runReply('gi', '钟离新专武', '没有新专武')
await runReply('gi', '钟离新专武', '贯虹之槊')
await runReply('gi', '香菱新专武', '暂未收录')
// 认不出角色 → 放行给其它插件（与其它后缀的放行语义一致）
await run('gi', '绝对不存在的名字专武', false)

// 落点校验：只断言「消费」不够——`#枫原万叶专武` 若解析失败也会回「暂未收录」而照样消费。
// 故与对应武器名渲染比对（同 H 节手法）。
check('#雷神专武 与 #薙草之稻光 渲染同一页',
  sameImage(await renderOf('gi', '雷神专武'), await renderOf('gi', '薙草之稻光')))
check('#枫原万叶专武 与 #苍古自由之誓 渲染同一页（全名经简称闭合）',
  sameImage(await renderOf('gi', '枫原万叶专武'), await renderOf('gi', '苍古自由之誓')))
check('#胡桃专武 与 #护摩之杖 渲染同一页',
  sameImage(await renderOf('gi', '胡桃专武'), await renderOf('gi', '护摩之杖')))
check('#温迪新专武 与 #黎明破晓之史 渲染同一页（显式修饰单条）',
  sameImage(await renderOf('gi', '温迪新专武'), await renderOf('gi', '黎明破晓之史')))
// 多把专武：`#X专武` 落在不带修饰的那把（单条），不是列表页
check('#温迪专武 与 #终末嗟叹之诗 渲染同一页（多把时取无修饰那条）',
  sameImage(await renderOf('gi', '温迪专武'), await renderOf('gi', '终末嗟叹之诗')))
// 别名 + 修饰词：必须经闭包落到「新专武」，而不是回「暂未收录」
check('#风神专武 与 #终末嗟叹之诗 渲染同一页（别名）',
  sameImage(await renderOf('gi', '风神专武'), await renderOf('gi', '终末嗟叹之诗')))
check('#风神新专武 与 #黎明破晓之史 渲染同一页（别名 + 修饰词）',
  sameImage(await renderOf('gi', '风神新专武'), await renderOf('gi', '黎明破晓之史')))

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)