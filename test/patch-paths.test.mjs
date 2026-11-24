// 公开命令不泄露服务器路径回归
//   #图鉴状态 / #图鉴版本 都是 permission: all，回复（含文字回退）里不得出现绝对路径
//   （盘符 / UNC / 插件外的目录）。#图鉴补丁 已在 1.6.9 删除，本套件随之收窄。
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

console.log('=== #图鉴状态 / #图鉴版本（文字回退路径）===')
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

console.log('\n=== 命令面 ===')
{
  const rules = new AtlasStatus().rule.map((rule) => rule.reg)
  check('#图鉴版本 是同一入口的别名', rules.some((re) => re.test('#图鉴版本')))
  check('#图鉴状态 仍可用', rules.some((re) => re.test('#图鉴状态')))
  check('#图鉴补丁 已删除', !rules.some((re) => re.test('#图鉴补丁')))
}

console.log('\n=== 版本更新记录的别名 ===')
{
  const { AtlasUpdateLog } = await import(mod('apps/updateLog.js'))
  const rules = new AtlasUpdateLog().rule.map((rule) => rule.reg)
  const hits = (text) => rules.some((re) => re.test(text))
  for (const text of ['#版本更新记录', '#版本更新日志', '#更新记录', '#变更项目', '#新版本改动', '#星铁更新记录', '#绝区零版本更新日志']) {
    check(`${text} 命中版本更新记录`, hits(text), text)
  }
  check('#图鉴更新 不被误捕', !hits('#图鉴更新'))
  check('#更新记录转发 不被误捕（只认整词）', !hits('#更新记录转发'))
}

finish()