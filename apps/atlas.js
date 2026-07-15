import plugin from '../../../lib/plugins/plugin.js'
import { search, getPageRecords, loadRecord } from '../model/AtlasService.js'
import { renderAtlas, selectTemplate } from '../components/render.js'
import { getPluginConfig } from '../components/config.js'
import {
  PREFIX_GAME,
  GAME_NAMES,
  PAGE_LABELS,
  CHALLENGE_PAGE_KEYS
} from '../components/constants.js'
import { getSectionBuilder } from '../components/sections/index.js'

const config = getPluginConfig()

export class atlas extends plugin {
  constructor () {
    super({
      name: 'Atlas图鉴',
      dsc: '多游戏图鉴查询：#原神 *星铁 %绝区零',
      event: 'message',
      priority: config.priority || 10000,
      rule: [
        // 三条 rule 均匹配 # 前缀：框架会将 * → #星铁、% → #绝区零，
        // 因此 * / % 正则仅作兜底（无框架转换时生效），实际路由在 atlasGI 中二次判断
        { reg: /^#(.+)$/, fnc: 'atlasGI', permission: 'all', log: false },
        { reg: /^\*(.+)$/, fnc: 'atlasHSR', permission: 'all', log: false },
        { reg: /^%(.+)$/, fnc: 'atlasZZZ', permission: 'all', log: false }
      ]
    })
  }

  /** 原神 # 前缀 — 同时检测框架转换的星铁/绝区零前缀并路由 */
  async atlasGI (e) {
    let keyword = e.msg.replace(/^#/, '').trim()
    let gameId = 'gi'

    // 框架 loader.js 将 *xxx → #星铁xxx、%xxx → #绝区零xxx
    if (keyword.startsWith('星铁')) {
      gameId = 'hsr'
      keyword = keyword.replace(/^星铁/, '').trim()
    } else if (keyword.startsWith('绝区零')) {
      gameId = 'zzz'
      keyword = keyword.replace(/^绝区零/, '').trim()
    }

    return this._handle(e, gameId, keyword)
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
          const entry = result.results[0]
          const record = loadRecord(entry.filePath)
          if (!record) {
            await e.reply(`[Atlas] ${entry.name} 的数据文件缺失，请执行数据抓取`)
            return true
          }
          const data = this._buildDetailData(gameId, { ...entry, record })
          const tpl = selectTemplate(result)
          const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
          if (img) await e.reply(img)
          else await e.reply(`[Atlas] ${data.recordName} — 渲染失败`)
          return true
        }

        case 'list': {
          const data = this._buildListData(gameId, result)
          const tpl = selectTemplate(result)
          const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
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
      const tpl = selectTemplate(result)
      const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
      if (img) await e.reply(img)
      return true
    }

    if (result.specialType === 'page_detail') {
      // 挑战类页面：取最新记录渲染详情
      const records = getPageRecords(gameId, result.pageKey)
      if (records.length === 0) {
        await e.reply(`[Atlas] ${result.pageTitle}数据为空`)
        return true
      }

      // 挑战页面通常按时间倒序，取最后一条即最新
      const latest = records[records.length - 1] || records[0]
      const record = loadRecord(latest.filePath)
      if (!record) {
        await e.reply(`[Atlas] ${latest.name} 的数据文件缺失，请执行数据抓取`)
        return true
      }
      const data = this._buildDetailData(gameId, { ...latest, record })
      const tpl = selectTemplate(result)
      const img = await renderAtlas(tpl, data, { imgType: 'jpeg' })
      if (img) await e.reply(img)
      else await e.reply(`[Atlas] ${data.recordName} — 渲染失败`)
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
    const pageKey = result.pageKey

    // 类型专用 sections builder
    const builder = getSectionBuilder(pageKey)
    if (builder) {
      const typeData = builder(gameId, record)
      if (typeData) {
        return {
          gameName: GAME_NAMES[gameId],
          pageTitle: result.pageTitle || (PAGE_LABELS[pageKey] || pageKey),
          name: meta.name || result.name,
          rarity: meta.rarity || result.rarity || '',
          metaFields: typeData.metaFields || [],
          sections: typeData.sections || [],
          rawFields: [],
          gameId,
          pageKey
        }
      }
    }

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

    // 挑战类页面：提取结构化 sections
    const sections = CHALLENGE_PAGE_KEYS.has(pageKey)
      ? this._buildChallengeSections(pageKey, detail)
      : []

    return {
      gameName: GAME_NAMES[gameId],
      pageTitle: result.pageTitle || (PAGE_LABELS[pageKey] || pageKey),
      recordName: meta.name || result.name,
      rarity: meta.rarity || result.rarity || '',
      desc: desc.length > 200 ? '' : desc,
      sections,
      rawFields,
      gameId,
      pageKey
    }
  }

  /**
   * 构建挑战类页面的结构化 sections
   * 从 detail 中提取 floor/room/buff 等层级数据
   * @param {string} pageKey
   * @param {object} detail - record.content.detail
   * @returns {Array<{title: string, fields: Array<{label: string, value: string}>}>}
   */
  _buildChallengeSections (pageKey, detail) {
    if (!detail || typeof detail !== 'object') return []

    const sections = []
    let floorData = null

    // 定位楼层数据：不同的 pageKey 可能有不同的 key 名
    const floorKeys = ['floor', 'floors', 'nodes', 'rooms']
    for (const key of floorKeys) {
      if (detail[key] && typeof detail[key] === 'object' && !Array.isArray(detail[key])) {
        floorData = detail[key]
        break
      }
    }

    // 如果没有明确的楼层 key，尝试找任何有数字子键的对象
    if (!floorData) {
      for (const [key, value] of Object.entries(detail)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const subKeys = Object.keys(value)
          const numericKeys = subKeys.filter(k => /^\d+$/.test(k))
          if (numericKeys.length > 0) {
            floorData = detail[key]
            break
          }
        }
      }
    }

    if (floorData) {
      const floorNums = Object.keys(floorData).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
      for (const floorNum of floorNums) {
        const floor = floorData[floorNum]
        if (!floor || typeof floor !== 'object') continue
        const fields = []
        const floorTitle = `第${floorNum}层`

        // 地脉异常 / buff
        if (floor.buff) {
          const buffText = Array.isArray(floor.buff)
            ? floor.buff.map(b => (typeof b === 'object' ? (b.name || b.title || '') : String(b))).filter(Boolean).join('；')
            : String(floor.buff)
          if (buffText.trim()) {
            fields.push({ label: '地脉异常', value: buffText })
          }
        }

        // 记忆紊流（星铁特有）
        if (floor.turbulence) {
          const turbText = Array.isArray(floor.turbulence)
            ? floor.turbulence.map(t => (typeof t === 'object' ? (t.name || t.title || '') : String(t))).filter(Boolean).join('；')
            : String(floor.turbulence)
          if (turbText.trim()) {
            fields.push({ label: '记忆紊流', value: turbText })
          }
        }

        // 房间 / 节点
        if (floor.room && typeof floor.room === 'object') {
          const roomNums = Object.keys(floor.room).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b))
          for (const roomNum of roomNums) {
            const room = floor.room[roomNum]
            if (!room) continue
            let roomText = ''
            if (typeof room === 'object') {
              const parts = []
              if (room.name) parts.push(String(room.name))
              if (room.title) parts.push(String(room.title))
              const monsters = room.monsters || room.enemies || room.monster
              if (Array.isArray(monsters)) {
                for (const m of monsters) {
                  if (typeof m === 'object' && m.name) parts.push(String(m.name))
                  else if (typeof m === 'string') parts.push(m)
                }
              }
              roomText = parts.join(' — ')
            } else {
              roomText = String(room)
            }
            if (roomText.trim()) {
              fields.push({ label: `第${roomNum}间`, value: roomText })
            }
          }
        }

        // 通用：遍历 floor 的其他非嵌套字段作为补充
        for (const [key, value] of Object.entries(floor)) {
          if (['buff', 'turbulence', 'room', 'name', 'title'].includes(key)) continue
          if (value == null || typeof value === 'object') continue
          fields.push({ label: this._fieldLabel(key), value: this._formatValue(value) })
        }

        if (fields.length > 0) {
          sections.push({ title: floorTitle, fields })
        }
      }
    }

    return sections
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
