import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { CHALLENGE_PAGE_KEYS } from './constants.js'
import { getPluginConfig } from './config.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/** 渲染缩放取值范围与默认值（与锅巴「渲染缩放」字段一致） */
const RENDER_SCALE_MIN = 0.5
const RENDER_SCALE_MAX = 3
const RENDER_SCALE_DEFAULT = 1.5

/**
 * 取渲染缩放（config.yaml → renderScale）
 *
 * 框架渲染后端不暴露 DPR 旋钮，故由页面自身放大：模板 body 上的 CSS `zoom`
 * 会把布局盒整体放大，元素截图随之变大（整页等比放大，文字与图片一起变清晰）。
 * 越界、NaN 一律按默认值处理，避免配置写错导致图糊成一片或爆内存。
 * @returns {number}
 */
function renderScale () {
  const value = Number(getPluginConfig()?.renderScale)
  if (!Number.isFinite(value)) return RENDER_SCALE_DEFAULT
  return Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, value))
}

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

  // 缓存标识：唯一化避免并发渲染同模板时共享临时 HTML 文件互相覆盖
  // （框架 dealTpl 按 name+saveId 写 temp/html/，同名并发会竞态输出错图）
  data.saveId = data.saveId || `${tpl}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  data.imgType = imgType
  if (opts.multiPage) {
    data.multiPage = true
    data.multiPageHeight = opts.multiPageHeight || 4000
  }

  // 渲染缩放：模板 body 上的 CSS zoom（见 renderScale() 说明）
  data.renderScale = renderScale()

  const name = `Atlas-Plugin/${app}/${tpl}`
  return opts.multiPage ? await puppeteer.screenshots(name, data) : await puppeteer.screenshot(name, data)
}
