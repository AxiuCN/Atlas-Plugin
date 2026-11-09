/**
 * 结果通知的目标解析
 *
 * 通知分两条线：**主人**（要排查信息）与**配置群**（只要结论和行动项）。
 * 这里只算「发给谁」，不碰发送本身，便于回归直接断言四种模式。
 *
 * | notifyMode | 主人 | 配置群 |
 * |---|---|---|
 * | `all`（默认） | 全部 | 发 |
 * | `master_only` | 全部 | 不发 |
 * | `first_master` | 第一位 | 不发 |
 * | `first_master_groups` | 第一位 | 发 |
 *
 * 未知取值按 `all` 处理（与 `cfg.notifyMode || 'all'` 的旧行为一致）。
 */

/**
 * @param {object} [input]
 * @param {string} [input.mode] - `notifyMode`
 * @param {{botId: string, userId: string}|null} [input.firstMaster] - `firstMaster()` 的结果
 * @param {string[]} [input.groups] - `parseGroupList(notifyGroups)` 的结果
 * @returns {{scope: 'all'|'first', friend: {botId: string, userId: string}|null, groups: string[]}}
 *   `scope` 为主人范围；`friend` 仅在 `scope === 'first'` 时有值（取不到第一位主人时为 null，群仍照发）
 */
export function resolveNotifyTargets ({ mode = 'all', firstMaster = null, groups = [] } = {}) {
  // 非法/手改坏的值一律按 all：宁可多通知，也别把配置写错变成「谁都不发」
  const effective = ['all', 'master_only', 'first_master', 'first_master_groups'].includes(mode) ? mode : 'all'
  const firstOnly = effective === 'first_master' || effective === 'first_master_groups'
  const toGroups = effective === 'all' || effective === 'first_master_groups'
  return {
    scope: firstOnly ? 'first' : 'all',
    friend: firstOnly ? firstMaster || null : null,
    groups: toGroups && Array.isArray(groups) ? groups : []
  }
}

/**
 * 按目标派发通知（不 await，只把发送动作交出去）
 *
 * 主人收 `msg`、配置群收 `groupMsg`——这是「异常详情只给主人、群里只留结论」的落点。
 * @param {object} bot - 通常传框架的 `Bot`（需有 `sendMasterMsg` / `sendFriendMsg` / `sendGroupMsg`）
 * @param {ReturnType<typeof resolveNotifyTargets>} targets
 * @param {string|object} msg - 主人收到的内容（文字或图片消息段）
 * @param {string|object} [groupMsg] - 配置群收到的内容；缺省与 `msg` 相同
 * @returns {{kind: 'masters'|'friend'|'group', target: string, promise: *}[]} 每次发送的句柄
 */
export function dispatchNotify (bot, targets, msg, groupMsg = msg) {
  const sends = []
  if (targets.scope === 'first') {
    // 取不到第一位主人时跳过（群仍照发）
    if (targets.friend) {
      sends.push({
        kind: 'friend',
        target: targets.friend.userId,
        promise: bot.sendFriendMsg(targets.friend.botId, targets.friend.userId, msg)
      })
    }
  } else {
    sends.push({ kind: 'masters', target: '', promise: bot.sendMasterMsg(msg) })
  }
  for (const gid of targets.groups) {
    sends.push({ kind: 'group', target: gid, promise: bot.sendGroupMsg(gid, groupMsg) })
  }
  return sends
}