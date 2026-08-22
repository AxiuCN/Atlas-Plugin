/**
 * Atlas 别名管理指令
 *
 * #图鉴别名帮助
 * #图鉴别名设置 <标准名> <别名>            （自动判断游戏）
 * #图鉴别名原神/星铁/绝区零设置 <标准名> <别名>
 * #图鉴别名删除 <别名>                     （自动判断游戏）
 * #图鉴别名原神/星铁/绝区零删除 <别名>
 * #图鉴别名列表 / #图鉴别名原神/星铁/绝区零列表
 *
 * 权限：双闸设计——rule.permission 固定 master（框架第一道闸，兜底上限），
 * 函数内按配置 alias.set/del/list 的 level 用 checkPermission 二次判定
 * （支持 group_admin 等放宽场景，并修补框架 owner/admin 私聊不生效的漏洞）。
 */
import plugin from '../../../lib/plugins/plugin.js'
import { getPluginConfig } from '../components/config.js'
import { setAlias, delAlias, listAlias } from '../model/CustomAlias.js'
import { loadAliasMap, normalizeForMatch } from '../model/AliasLoader.js'

const GAME_CN = { gi: '原神', hsr: '星铁', zzz: '绝区零' }
const GAME_IDS = ['gi', 'hsr', 'zzz']
const LEVELS = ['master', 'group_admin', 'all']

export class AtlasAlias extends plugin {
  constructor () {
    super({
      name: 'Atlas别名管理',
      dsc: '#图鉴别名设置/删除/列表',
      event: 'message',
      priority: 8000,
      rule: [
        // 帮助
        { reg: /^#图鉴别名帮助$/, fnc: 'aliasHelp', permission: 'all' },
        // 设置（指定游戏）
        { reg: /^#图鉴别名原神设置\s+(\S+)\s+(\S+)$/, fnc: 'aliasSetGi', permission: 'master' },
        { reg: /^#(?:星铁)图鉴别名设置\s+(\S+)\s+(\S+)$/, fnc: 'aliasSetHsr', permission: 'master' },
        { reg: /^#(?:绝区零)图鉴别名设置\s+(\S+)\s+(\S+)$/, fnc: 'aliasSetZzz', permission: 'master' },
        // 设置（自动判断）
        { reg: /^#图鉴别名设置\s+(\S+)\s+(\S+)$/, fnc: 'aliasSetAuto', permission: 'master' },
        // 删除（指定游戏）
        { reg: /^#图鉴别名原神删除\s+(\S+)$/, fnc: 'aliasDelGi', permission: 'master' },
        { reg: /^#(?:星铁)图鉴别名删除\s+(\S+)$/, fnc: 'aliasDelHsr', permission: 'master' },
        { reg: /^#(?:绝区零)图鉴别名删除\s+(\S+)$/, fnc: 'aliasDelZzz', permission: 'master' },
        // 删除（自动判断）
        { reg: /^#图鉴别名删除\s+(\S+)$/, fnc: 'aliasDelAuto', permission: 'master' },
        // 列表
        { reg: /^#图鉴别名原神列表$/, fnc: 'aliasListGi', permission: 'all' },
        { reg: /^#(?:星铁)图鉴别名列表$/, fnc: 'aliasListHsr', permission: 'all' },
        { reg: /^#(?:绝区零)图鉴别名列表$/, fnc: 'aliasListZzz', permission: 'all' },
        { reg: /^#图鉴别名列表$/, fnc: 'aliasListAll', permission: 'all' }
      ]
    })
  }

  /** 权限二次判定（配置化 level），失败回复并返回 false */
  checkPerm (e, level) {
    const cfg = getPluginConfig()
    const want = LEVELS.includes(cfg?.alias?.[level]) ? cfg.alias[level] : 'master'
    // master 级 → 框架已拦，此处兜底校验
    if (want === 'master') {
      if (!e.isMaster) {
        e.reply('暂无权限，只有主人才能操作', true)
        return false
      }
      return true
    }
    if (want === 'group_admin') {
      if (!e.isGroup) {
        e.reply('暂无权限，该操作仅限群内管理员', true)
        return false
      }
      if (!e.member?.is_owner && !e.member?.is_admin) {
        e.reply('暂无权限，只有群主或管理员才能操作', true)
        return false
      }
      return true
    }
    return true // all
  }

  async aliasHelp (e) {
    const lines = [
      '【图鉴别名管理】',
      '',
      '设置：',
      '  #图鉴别名设置 <标准名> <别名>',
      '  #图鉴别名原神设置 <标准名> <别名>',
      '  #图鉴别名星铁设置 <标准名> <别名>',
      '  #图鉴别名绝区零设置 <标准名> <别名>',
      '',
      '删除：',
      '  #图鉴别名删除 <别名>',
      '  #图鉴别名原神/星铁/绝区零删除 <别名>',
      '',
      '查看：',
      '  #图鉴别名列表 / #图鉴别名原神/星铁/绝区零列表',
      '',
      'ℹ️ 别名写入 Atlas-Plugin/config/alias/<游戏>/<类别>.yaml，保存即热更新生效',
      'ℹ️ 预设别名不支持删除；管理员指令权限可按配置调整'
    ]
    return e.reply(lines.join('\n'), true)
  }

  // ── 设置 ──
  async aliasSetGi (e) { return this._doSet(e, 'gi', e.msg.replace(/^#图鉴别名原神设置\s+/, '')) }
  async aliasSetHsr (e) { return this._doSet(e, 'hsr', e.msg.replace(/^#(?:星铁)图鉴别名设置\s+/, '')) }
  async aliasSetZzz (e) { return this._doSet(e, 'zzz', e.msg.replace(/^#(?:绝区零)图鉴别名设置\s+/, '')) }

  async aliasSetAuto (e) {
    if (!this.checkPerm(e, 'set')) return true
    const [canonical, alias] = e.msg.replace(/^#图鉴别名设置\s+/, '').trim().split(/\s+/)
    const game = this._detectGame(canonical)
    if (!game) {
      e.reply('未找到该名字对应的游戏，请确认标准名或使用带游戏前缀的指令（如 #图鉴别名原神设置）', true)
      return true
    }
    return this._doSet(e, game, `${canonical} ${alias}`, true)
  }

  async _doSet (e, gameId, arg, alreadyChecked = false) {
    if (!alreadyChecked && !this.checkPerm(e, 'set')) return true
    const parts = String(arg).trim().split(/\s+/)
    if (parts.length !== 2) {
      e.reply('命令格式：#图鉴别名设置 <标准名> <别名>', true)
      return true
    }
    const ret = await setAlias(gameId, parts[0], parts[1])
    e.reply(ret.msg, true)
    return true
  }

  // ── 删除 ──
  async aliasDelGi (e) { return this._doDel(e, 'gi', e.msg.replace(/^#图鉴别名原神删除\s+/, '')) }
  async aliasDelHsr (e) { return this._doDel(e, 'hsr', e.msg.replace(/^#(?:星铁)图鉴别名删除\s+/, '')) }
  async aliasDelZzz (e) { return this._doDel(e, 'zzz', e.msg.replace(/^#(?:绝区零)图鉴别名删除\s+/, '')) }

  async aliasDelAuto (e) {
    if (!this.checkPerm(e, 'del')) return true
    const alias = e.msg.replace(/^#图鉴别名删除\s+/, '').trim()
    const game = this._detectAliasGame(alias)
    if (!game) {
      e.reply('该别名不在自定义配置中，请确认，或使用带游戏前缀的指令', true)
      return true
    }
    return this._doDel(e, game, alias, true)
  }

  async _doDel (e, gameId, alias, alreadyChecked = false) {
    if (!alreadyChecked && !this.checkPerm(e, 'del')) return true
    const ret = await delAlias(gameId, String(alias).trim())
    e.reply(ret.msg, true)
    return true
  }

  // ── 列表 ──
  async aliasListGi (e) { return this._doList(e, 'gi') }
  async aliasListHsr (e) { return this._doList(e, 'hsr') }
  async aliasListZzz (e) { return this._doList(e, 'zzz') }

  async aliasListAll (e) {
    if (!this.checkPerm(e, 'list')) return true
    for (const g of GAME_IDS) {
      await this._doList(e, g, true)
    }
    return true
  }

  async _doList (e, gameId, alreadyChecked = false) {
    if (!alreadyChecked && !this.checkPerm(e, 'list')) return true
    const { exists, lines } = listAlias(gameId)
    if (!exists) {
      e.reply(`暂无${GAME_CN[gameId]}自定义别名`, true)
      return true
    }
    if (lines.length === 0) {
      e.reply(`暂无${GAME_CN[gameId]}自定义别名`, true)
      return true
    }
    e.reply([`【${GAME_CN[gameId]}自定义别名】`, ...lines].join('\n'), true)
    return true
  }

  /** 标准名 → 游戏（自动判断；两游戏都命中返回 null 提示用带前缀指令） */
  _detectGame (canonical) {
    const hits = []
    for (const g of GAME_IDS) {
      const map = loadAliasMap(g)
      const normal = normalizeForMatch(canonical)
      const hit = map.get(normal)?.some(item => item.game === GAME_CN[g])
      if (hit) hits.push(g)
    }
    if (hits.length === 1) return hits[0]
    return null // 0 或多个 → 需精确指定
  }

  /** 别名 → 游戏（自动判断） */
  _detectAliasGame (alias) {
    const hits = []
    for (const g of GAME_IDS) {
      const map = loadAliasMap(g)
      const normal = normalizeForMatch(alias)
      if (map.get(normal)?.some(item => item.game === GAME_CN[g])) hits.push(g)
    }
    if (hits.length === 1) return hits[0]
    return null
  }
}