/**
 * atlasShortcut — 图鉴快捷入口（priority -99999，先于 miao-plugin 执行）
 *
 * 用户显式加「图鉴」或子视图后缀时提前拦截，避免被 miao-plugin 的 accept 机制抢走。
 * 例：#胡桃图鉴 / #胡桃天赋 / #胡桃命座 / #胡桃养成素材 / #胡桃升级材料
 *
 * 机制：miao 的 wiki 用 accept（priority 50）在 loader 的 accept 阶段先于全部 rule
 * 匹配执行，仅凭 rule 优先级（-99999）无法对抗。故本插件同时提供 accept()：
 * 在 accept 阶段按同规则抢先返回 true（跳过 miao 的 accept 循环），实际处理仍由
 * 下方 rule 完成——rule 保留以正常触发 loader 的匹配日志。
 */
import plugin from '../../../lib/plugins/plugin.js'
import { handleQuery } from '../modules/atlasQuery.js'
import { SHORTCUT_SUFFIXES } from '../components/constants.js'
import { isBlacklisted, isSlashMsg } from '../components/blacklist.js'

const SUFFIX_REG = SHORTCUT_SUFFIXES.join('|')

/** 与 constructor rule 相同的匹配正则（accept 与 rule 共用，保证判定一致） */
const RULE_GI = new RegExp(`^#(.+)(?:${SUFFIX_REG})$`)
const RULE_HSR = new RegExp(`^\\*(.+)(?:${SUFFIX_REG})$`)
const RULE_ZZZ = new RegExp(`^%(.+)(?:${SUFFIX_REG})$`)

export class atlasShortcut extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴快捷入口',
      dsc: '#角色图鉴 / 天赋 / 技能 / 命座 / 资料 / 故事 / 语音 / 养成 / 素材 / 材料 / 升级',
      event: 'message',
      priority: -99999,
      rule: [
        { reg: RULE_GI, fnc: 'shortcutGI', permission: 'all' },
        { reg: RULE_HSR, fnc: 'shortcutHSR', permission: 'all' },
        { reg: RULE_ZZZ, fnc: 'shortcutZZZ', permission: 'all' }
      ]
    })
  }

  /**
   * accept 阶段抢占 — loader 的 accept 循环按 priority 升序执行（atlasShortcut -99999
   * 排最前），本方法命中后缀查询时返回 true：loader 第 251-252 行 break accept 循环，
   * miao 的 accept（priority 50）不再执行；随后 rule 阶段照常匹配并完成实际处理与日志。
   * 黑名单 / /→# 转换消息按与 rule 内相同的条件放行（返回 false）。
   * @param {object} e - Runtime 实例
   * @returns {boolean} true=已抢占（rule 将继续处理），false=放行
   */
  async accept (e) {
    // 黑名单命中：跳过不处理（放行，与 rule 内一致）
    if (isBlacklisted(e.msg)) return false
    // /→# 转换消息不作为图鉴查询：放行（与 rule 内一致）
    if (isSlashMsg(e)) return false
    // 后缀判定与 rule 完全一致；框架已把 *xxx→#星铁xxx、%xxx→#绝区零xxx 转换到 # 前缀
    return RULE_GI.test(e.msg) || RULE_HSR.test(e.msg) || RULE_ZZZ.test(e.msg)
  }

  /**
   * 剥离「图鉴」后，其余子视图后缀（天赋/命座/养成素材等）保留，
   * 交由 handleQuery 的 parseSubView 解析出 subView（默认视图=图鉴）。
   */
  stripSuffix (raw) {
    return raw.replace(/图鉴$/, '').trim()
  }

  async shortcutGI (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false
    // /→# 转换消息不作为图鉴查询：跳过（返回 false 继续传递）
    if (isSlashMsg(e)) return false

    let keyword = this.stripSuffix(e.msg.replace(/^#/, '').trim())
    let gameId = 'gi'

    // 框架会将 *xxx → #星铁xxx、%xxx → #绝区零xxx
    if (keyword.startsWith('星铁')) {
      gameId = 'hsr'
      keyword = keyword.replace(/^星铁/, '').trim()
    } else if (keyword.startsWith('绝区零')) {
      gameId = 'zzz'
      keyword = keyword.replace(/^绝区零/, '').trim()
    }

    return handleQuery(e, gameId, keyword)
  }

  async shortcutHSR (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false
    // /→# 转换消息不作为图鉴查询：跳过（返回 false 继续传递）
    if (isSlashMsg(e)) return false

    return handleQuery(e, 'hsr', this.stripSuffix(e.msg.replace(/^\*/, '').trim()))
  }

  async shortcutZZZ (e) {
    // 黑名单命中：跳过不处理（返回 false 继续传递，不消费消息）
    if (isBlacklisted(e.msg)) return false
    // /→# 转换消息不作为图鉴查询：跳过（返回 false 继续传递）
    if (isSlashMsg(e)) return false

    return handleQuery(e, 'zzz', this.stripSuffix(e.msg.replace(/^%/, '').trim()))
  }
}
