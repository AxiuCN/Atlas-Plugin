import plugin from '../../../lib/plugins/plugin.js'
import { search, getPageRecords } from '../model/AtlasService.js'
import { renderAtlas } from '../components/render.js'
import { getPluginConfig } from '../components/config.js'
import {
  PREFIX_GAME,
  GAME_NAMES,
  PAGE_LABELS
} from '../components/constants.js'

const config = getPluginConfig()

export class atlas extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴',
      dsc: '多游戏图鉴查询：#原神 *星铁 %绝区零',
      event: 'message',
      priority: config.priority || 10000,
      rule: [
        { reg: /^#(.+)$/, fnc: 'atlasGI', permission: 'all', log: false },
        { reg: /^\*(.+)$/, fnc: 'atlasHSR', permission: 'all', log: false },
        { reg: /^%(.+)$/, fnc: 'atlasZZZ', permission: 'all', log: false }
      ]
    })
  }

  /** 原神 # 前缀 */
  async atlasGI (e) {
    return this._handle(e, 'gi', e.msg.replace(/^#/, '').trim())
  }

  /** 星铁 * 前缀 */
  async atlasHSR (e) {
    return this._handle(e, 'hsr', e.msg.replace(/^\*/, '').trim())
  }

  /** 绝区零 % 前缀 */
  async atlasZZZ (e) {
    return this._handle(e, 'zzz', e.msg.replace(/^%/, '').trim())
  }

  /**
   * 统一处理入口
   * @param {object} e - Runtime 实例
   * @param {string} gameId - gi/hsr/zzz
   * @param {string} keyword - 搜索词
   */
  async _handle (e, gameId, keyword) {
    if (!keyword) return false

    try {
      const result = search(gameId, keyword)

      switch (result.type) {
        case 'empty':
          if (result.keyword) {
            await e.reply(`[Atlas] 未在${GAME_NAMES[gameId]}中找到与"${result.keyword}"匹配的条目`)
          }
          return true

        case 'exact': {
          const data = this._buildDetailData(gameId, result.results[0])
          const img = await renderAtlas('detail', data, { imgType: 'jpeg' })
          if (img) await e.reply(img)
          else await e.reply(`[Atlas] ${data.recordName} — 渲染失败`)
          return true
        }

        case 'multi':
        case 'fuzzy': {
          const data = this._buildListData(gameId, result)
          const img = await renderAtlas('list', data, { imgType: 'jpeg' })
          if (img) await e.reply(img)
          else await e.reply(`[Atlas] 列表渲染失败`)
          return true
        }

        case 'special':
          return this._handleSpecial(e, gameId, result)

        default:
          return false
      }
    } catch (err) {
      logger?.error(`[Atlas] 查询出错: ${err.message}`)
      await e.reply(`[Atlas] 查询出错: ${err.message}`)
      return true
    }
  }

  /**
   * 处理特殊页面触发词（成就、挑战等）
   */
  async _handleSpecial (e, gameId, result) {
    if (result.specialType === 'page_list') {
      // 成就等列表型页面：显示所有子项
      const records = getPageRecords(gameId, result.pageKey)
      if (records.length === 0) {
        await e.reply(`[Atlas] ${result.pageTitle}数据为空`)
        return true
      }

      const groups = [{
        title: result.pageTitle,
        items: records.map(r => ({ name: r.name, rarity: r.rarity }))
      }]

      const data = {
        gameName: GAME_NAMES[gameId],
        keyword: result.pageTitle,
        groups,
        results: records,
        total: records.length
      }
      const img = await renderAtlas('list', data, { imgType: 'jpeg' })
      if (img) await e.reply(img)
      return true
    }

    if (result.specialType === 'page_detail') {
      // 挑战类页面：取第一条记录渲染详情
      const records = getPageRecords(gameId, result.pageKey)
      if (records.length === 0) {
        await e.reply(`[Atlas] ${result.pageTitle}数据为空`)
        return true
      }

      // 挑战页面通常按时间倒序，取第一条即最新
      const latest = records[records.length - 1] || records[0]
      const data = this._buildDetailData(gameId, latest)
      const img = await renderAtlas('detail', data, { imgType: 'jpeg' })
      if (img) await e.reply(img)
      else await e.reply(`[Atlas] ${data.recordName} — 渲染失败`, true)
      return true
    }

    return false
  }

  /**
   * 构建详情页模板数据
   */
  _buildDetailData (gameId, result) {
    const record = result.record
    const meta = record?.meta || {}
    const list = record?.content?.list || {}
    const detail = record?.content?.detail || {}

    // 从 list 和 detail 中提取可展示的字段
    const rawFields = []
    const seenKeys = new Set()

    // 先展示 list 中的关键字段
    const listPriority = ['zh', 'en', 'ja', 'ko', 'desc', 'description', 'rank', 'rarity', 'stars', 'baseType', 'damageType']
    for (const key of listPriority) {
      if (list[key] != null && !seenKeys.has(key)) {
        seenKeys.add(key)
        rawFields.push({ label: this._fieldLabel(key), value: this._formatValue(list[key]) })
      }
    }

    // 其余 list 字段
    for (const [key, value] of Object.entries(list)) {
      if (seenKeys.has(key) || key.startsWith('_')) continue
      seenKeys.add(key)
      if (value != null && typeof value !== 'object') {
        rawFields.push({ label: this._fieldLabel(key), value: this._formatValue(value) })
      }
    }

    // detail 中的关键字段
    if (detail && typeof detail === 'object') {
      const detailKeys = Object.keys(detail).filter(k => !k.startsWith('_') && detail[k] != null && typeof detail[k] !== 'object')
      for (const key of detailKeys.slice(0, 20)) {
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        rawFields.push({ label: this._fieldLabel(key), value: this._formatValue(detail[key]) })
      }
    }

    // 描述文本
    const desc = this._formatValue(list.desc || list.description || '')

    return {
      gameName: GAME_NAMES[gameId],
      pageTitle: result.pageTitle || (PAGE_LABELS[result.pageKey] || result.pageKey),
      recordName: meta.name || result.name,
      rarity: meta.rarity || result.rarity || '',
      desc: desc.length > 200 ? '' : desc,
      sections: [],
      rawFields,
      gameId,
      pageKey: result.pageKey
    }
  }

  /**
   * 构建列表页模板数据
   */
  _buildListData (gameId, result) {
    // 按 pageKey 分组
    const groupMap = new Map()
    for (const item of result.results) {
      const key = item.pageKey
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          title: item.pageTitle || (PAGE_LABELS[key] || key),
          items: []
        })
      }
      groupMap.get(key).items.push({
        name: item.name,
        rarity: item.rarity
      })
    }

    const groups = [...groupMap.values()]

    return {
      gameName: result.gameName || GAME_NAMES[gameId],
      keyword: result.keyword,
      groups,
      results: result.results,
      total: result.total
    }
  }

  /**
   * 字段名转中文标签
   */
  _fieldLabel (key) {
    const labels = {
      zh: '名称',
      en: '英文名',
      ja: '日文名',
      ko: '韩文名',
      desc: '描述',
      description: '描述',
      rank: '稀有度',
      rarity: '稀有度',
      stars: '星级',
      baseType: '类型',
      damageType: '属性',
      atk: '攻击力',
      def: '防御力',
      hp: '生命值',
      icon: '图标',
      id: 'ID',
      name: '名称',
      version: '版本'
    }
    return labels[key] || key
  }

  /**
   * 字段值格式化（处理 RUBY 标记等）
   */
  _formatValue (value) {
    if (value == null) return ''
    let str = String(value)
    // 清理 RUBY 标记
    str = str.replace(/\{RUBY_B#[^}]*}/g, '')
    str = str.replace(/\{RUBY_E#}/g, '')
    // 清理 HTML 标签
    str = str.replace(/<[^>]+>/g, '')
    return str.trim()
  }
}
