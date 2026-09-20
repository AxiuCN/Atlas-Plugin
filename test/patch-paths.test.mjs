// 公开命令不泄露服务器路径回归
//   #图鉴补丁 / #图鉴状态 都是 permission: all，回复里不得出现绝对路径（盘符 / UNC / 插件外的目录）
import { mod, requireAtlasData, checker, installFrameworkStubs } from './_helper.mjs'

installFrameworkStubs()
requireAtlasData()

const { AtlasStatus } = await import(mod('apps/status.js'))
const { check, finish } = checker()

const mkEvent = () => {
  const replies = []
  return { msg: '', user_id: '1', self_id: '1', group_id: '1', reply: async (m) => { replies.push(m); return true }, replies }
}
const textOf = (e) => e.replies.map(r => (typeof r === 'string' ? r : '[非文本]')).join('\n')

/** 绝对路径特征：盘符开头、反斜杠、UNC、常见根目录、插件目录名带分隔符 */
const ABS = /(^|\n)\s*[A-Za-z]:[\\/]|\\\\|\/home\/|\/Users\/|\/root\/|plugins[\\/]Atlas-Plugin/i

/** 索引补丁行是否仍是绝对路径 */
function mapLineHasAbs (text) {
  const line = text.split('\n').find(l => l.includes('【索引补丁】'))
  if (!line) return false // 无索引补丁时不出现该行
  return !/resources\/patch\/map\.json/.test(line) || ABS.test(line)
}

console.log('=== ① #图鉴补丁 ===')
{
  const e = mkEvent()
  const ret = await new AtlasStatus().handlePatch(e)
  const text = textOf(e)
  check('已消费消息', ret === true)
  check('回复不含绝对路径', !ABS.test(text), text.split('\n').slice(-2).join(' / '))
  check('改为展示插件内相对路径', /resources\/patch\/data/.test(text) && /resources\/patch\/gallery/.test(text))
  check('索引补丁行也是相对路径', !mapLineHasAbs(text))
  console.log('  实际输出尾部：')
  for (const line of text.split('\n').slice(-3)) console.log(`    ${line}`)
}

console.log('\n=== ② #图鉴状态（文字回退路径）===')
{
  const e = mkEvent()
  let ret
  try {
    ret = await new AtlasStatus().handleStatus(e)
  } catch (err) {
    ret = `THROW: ${err.message}`
  }
  const text = textOf(e)
  check('已消费消息', ret === true, `return=${ret}`)
  check('回复不含绝对路径', !ABS.test(text), text.split('\n')[0] || '(无回复)')
}

finish()
