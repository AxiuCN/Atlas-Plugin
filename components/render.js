import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { CHALLENGE_PAGE_KEYS } from './constants.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/**
 * 根据搜索结果选择对应模板
 * 特殊触发词 → 挑战类 pageKey → 列表 → 默认详情
 * @param {object} result - search() 返回值或特殊触发结果
 * @returns {string} 模板名（对应 resources/atlas/<name>.html）
 */
// pageKey → 模板名映射（专用模板，不在映射中则走兜底）
const TEMPLATE_BY_PAGE = {
  character: 'character',
  weapon: 'weapon',
  lightcone: 'weapon',
  artifact: 'relic',
  relicset: 'relic',
  equipment: 'relic',
  monster: 'monster',
  bangboo: 'bangboo',
  item: 'item'
}

export function selectTemplate (result) {
  // 特殊页面
  if (result.type === 'special') {
    if (result.specialType === 'page_list') return 'achievement'
    if (result.specialType === 'page_detail') return 'challenge'
  }

  // 正常搜索：取第一条结果的 pageKey 判断
  const entry = result.results?.[0]
  if (!entry) {
    if (result.type === 'list') return 'list'
    return 'detail'
  }

  // 挑战类 pageKey
  if (CHALLENGE_PAGE_KEYS.has(entry.pageKey)) return 'challenge'

  // 类型专用模板
  if (TEMPLATE_BY_PAGE[entry.pageKey]) return TEMPLATE_BY_PAGE[entry.pageKey]

  if (result.type === 'list') return 'list'
  return 'detail'
}

/**
 * 渲染 HTML 模板并截图
 * @param {string} tpl - 模板名（对应 resources/atlas/<tpl>.html）
 * @param {object} data - 模板数据
 * @param {object} opts - 可选参数
 * @returns {Promise<object>} segment.image 可用的图片对象
 */
export async function renderAtlas (tpl, data = {}, opts = {}) {
  const app = 'atlas'
  const imgType = opts.imgType || 'jpeg'

  // 资源路径（模板内通过 _res_path 引用 CSS/图片）
  data._res_path = `../../../../../plugins/Atlas-Plugin/resources/`

  // 模板文件路径
  data.tplFile = `./plugins/Atlas-Plugin/resources/${app}/${tpl}.html`

  // 缓存标识
  data.saveId = data.saveId || tpl

  data.imgType = imgType

  // 渲染截图
  return await puppeteer.screenshot(`Atlas-Plugin/${app}/${tpl}`, data)
}
