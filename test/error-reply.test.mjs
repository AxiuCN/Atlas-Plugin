// 查询异常对外文案回归
//   ① 内部异常时，群里只收到通用提示：不含异常名 / 绝对路径 / 文件名 / 实现细节
//   ② 细节仍写进日志（logger.error 收到完整 err）
//   ③ 不同内部异常给出同一句文案（不向外区分）
//   ④ 正常查询不受影响（不会误报「查询出错」）
// 注：正常查询一档在本机渲染器不可用时回「渲染失败」，属环境行为，断言只看「未误报查询出错」
import { mod, requireAtlasData, checker, installFrameworkStubs, logs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { handleQuery } = await import(mod('modules/atlasQuery.js'))
const { check, finish } = checker()

const mkEvent = () => {
  const replies = []
  return { msg: '', user_id: '10000', self_id: '10000', group_id: '1', reply: async (m) => { replies.push(m); return true }, replies }
}

/** 不该出现在群聊文案里的东西：异常名、绝对路径、文件名、内部标识 */
const LEAKY = /(TypeError|ReferenceError|Error:|is not a function|undefined|ENOENT|\\|\/|\.json|\.js|map\.json|nanoka|Atlas-Plugin|at file:)/
const textOf = (e) => e.replies.map(r => (typeof r === 'string' ? r : '[非文本]')).join('\n')

console.log('=== ① 内部异常 → 只给通用提示 ===')
const cases = [
  ['非字符串关键词（对象）', {}],
  ['非字符串关键词（数字）', 12345]
]
const texts = []
for (const [label, keyword] of cases) {
  logs.length = 0
  const e = mkEvent()
  let ret
  try {
    ret = await handleQuery(e, 'gi', keyword)
  } catch (err) {
    ret = `THROW: ${err.message}`
  }
  const text = textOf(e)
  texts.push(text)
  check(`${label}：已消费消息`, ret === true, `return=${ret}`)
  check(`${label}：回复不含内部细节`, !LEAKY.test(text), text || '(无回复)')
  check(`${label}：细节进了日志`, logs.some(args => args.some(a => a && String(a.message || a).length > 0)))
}

console.log('\n=== ② 不同异常同一句文案 ===')
check('两句文案完全一致', texts[0] === texts[1] && texts[0].length > 0, texts[0])

console.log('\n=== ③ 正常查询不受影响 ===')
for (const kw of ['胡桃', '班尼特天赋', '绝缘之旗印圣遗物']) {
  logs.length = 0
  const e = mkEvent()
  const ret = await handleQuery(e, 'gi', kw)
  const text = textOf(e)
  check(`#${kw}：未误报「查询出错」`, !/查询出错/.test(text), `return=${ret} reply=${text.replace(/\n/g, ' ').slice(0, 40)}`)
}

finish()
