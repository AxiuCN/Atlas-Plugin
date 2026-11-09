// 通知目标解析与文本路由（不启动 bot，用假 Bot 记录每次发送）
//
// 这是「异常详情只给主人、群里只留结论」的落点：主人收 `msg`、配置群收 `groupMsg`。
// 早先两条线发同一份文本，`err.message` 里的服务器绝对路径会直接进群。
import { mod, checker } from './_helper.mjs'

const { resolveNotifyTargets, dispatchNotify } = await import(mod('components/notify.js'))
const { check, finish } = checker()

const FRIEND = { botId: '10000', userId: '10001' }
const GROUPS = ['111', '222']

/** 假 Bot：把每次发送记下来 */
function fakeBot () {
  const calls = []
  return {
    calls,
    sendMasterMsg: (msg) => { calls.push({ kind: 'masters', target: '', msg }); return Promise.resolve() },
    sendFriendMsg: (botId, userId, msg) => { calls.push({ kind: 'friend', target: userId, msg }); return Promise.resolve() },
    sendGroupMsg: (gid, msg) => { calls.push({ kind: 'group', target: gid, msg }); return Promise.resolve() }
  }
}

console.log('=== ① 四种 notifyMode 的目标 ===')
{
  const all = resolveNotifyTargets({ mode: 'all', firstMaster: FRIEND, groups: GROUPS })
  check('all → 全部主人 + 群', all.scope === 'all' && all.friend === null && all.groups.length === 2)

  const masterOnly = resolveNotifyTargets({ mode: 'master_only', firstMaster: FRIEND, groups: GROUPS })
  check('master_only → 全部主人、不群发', masterOnly.scope === 'all' && masterOnly.groups.length === 0)

  const first = resolveNotifyTargets({ mode: 'first_master', firstMaster: FRIEND, groups: GROUPS })
  check('first_master → 第一位主人、不群发',
    first.scope === 'first' && first.friend?.userId === FRIEND.userId && first.groups.length === 0)

  const firstGroups = resolveNotifyTargets({ mode: 'first_master_groups', firstMaster: FRIEND, groups: GROUPS })
  check('first_master_groups → 第一位主人 + 群',
    firstGroups.scope === 'first' && firstGroups.friend?.userId === FRIEND.userId && firstGroups.groups.length === 2)
}

console.log('\n=== ② 边界 ===')
{
  const unknown = resolveNotifyTargets({ mode: 'whatever', firstMaster: FRIEND, groups: GROUPS })
  check('未知 mode 按 all 处理（与 cfg.notifyMode || «all» 一致）', unknown.scope === 'all' && unknown.groups.length === 2)

  const noFirst = resolveNotifyTargets({ mode: 'first_master_groups', firstMaster: null, groups: GROUPS })
  check('取不到第一位主人 → friend 为 null，群仍照发', noFirst.friend === null && noFirst.groups.length === 2)

  const emptyGroups = resolveNotifyTargets({ mode: 'all', firstMaster: FRIEND, groups: undefined })
  check('缺 groups → 空数组（不抛）', Array.isArray(emptyGroups.groups) && emptyGroups.groups.length === 0)

  const defaulted = resolveNotifyTargets()
  check('不传参 → 默认 all 且无群', defaulted.scope === 'all' && defaulted.groups.length === 0)
}

console.log('\n=== ③ 文本路由：群收精简版、主人收完整版 ===')
{
  const bot = fakeBot()
  const targets = resolveNotifyTargets({ mode: 'all', firstMaster: FRIEND, groups: GROUPS })
  dispatchNotify(bot, targets, '完整版：ENOENT C:\\apps\\yunzai\\data', '精简版：初始化失败，可重跑')
  const masters = bot.calls.filter((call) => call.kind === 'masters')
  const groups = bot.calls.filter((call) => call.kind === 'group')
  check('主人收到完整版', masters.length === 1 && masters[0].msg.includes('ENOENT'))
  check('两个群都收到精简版', groups.length === 2 && groups.every((call) => call.msg === '精简版：初始化失败，可重跑'))
  check('精简版不含服务器路径', groups.every((call) => !String(call.msg).includes('C:\\apps')))
  check('一次通知总发送数 = 1 条主人 + 2 个群', bot.calls.length === 3)
}
{
  const bot = fakeBot()
  const targets = resolveNotifyTargets({ mode: 'first_master_groups', firstMaster: FRIEND, groups: GROUPS })
  dispatchNotify(bot, targets, '主人版', '群版')
  check('first_master_groups 只私聊第一位主人', bot.calls.filter((call) => call.kind === 'friend').length === 1)
  check('first_master_groups 不调 sendMasterMsg', bot.calls.filter((call) => call.kind === 'masters').length === 0)
  check('第一位主人收完整版', bot.calls.find((call) => call.kind === 'friend')?.msg === '主人版')
}
{
  const bot = fakeBot()
  const targets = resolveNotifyTargets({ mode: 'master_only', groups: GROUPS })
  dispatchNotify(bot, targets, '主人版', '群版')
  check('master_only 不群发', bot.calls.length === 1 && bot.calls[0].kind === 'masters')
}
{
  const bot = fakeBot()
  const targets = resolveNotifyTargets({ mode: 'all', groups: GROUPS })
  dispatchNotify(bot, targets, '只有一条')
  check('不传 groupMsg 时群收的内容与主人相同', bot.calls.filter((c) => c.kind === 'group').every((c) => c.msg === '只有一条'))
}
{
  const bot = fakeBot()
  const targets = resolveNotifyTargets({ mode: 'first_master_groups', firstMaster: null, groups: GROUPS })
  const sends = dispatchNotify(bot, targets, '主人版', '群版')
  check('取不到主人时不私聊、仍群发', sends.length === 2 && bot.calls.every((call) => call.kind === 'group'))
}

finish()